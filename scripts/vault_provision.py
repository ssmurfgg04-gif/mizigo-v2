#!/usr/bin/env python3
"""MIZIGO — provision provider secrets into the Supabase Vault.

Implements the "serverless functions + encrypted storage" pattern the owner
selected (docs/NETLIFY_PRODUCTION.md §Secrets): the Netlify site only holds
DATABASE_URL; the API functions fetch provider keys at runtime from the
Supabase project's Vault (encrypted at rest via pgsodium, readable only
through the database connection — src/lib/runtime-secrets.ts).

The script talks to the Supabase Management API (POST
/v1/projects/<ref>/database/query) so it never needs the database password.
Secrets are read from ENV (never CLI args) — two forms:

  named mapping (well-known secrets):
    PAYSTACK_SECRET_KEY       -> paystack.secret.live
    PAYSTACK_SECRET_KEY_TEST  -> paystack.secret.test
    PAYSTACK_PUBLIC_KEY       -> paystack.public.live
    DARAJA_CONSUMER_KEY       -> daraja.consumer-key
    DARAJA_CONSUMER_SECRET    -> daraja.consumer-secret
    DARAJA_SHORTCODE          -> daraja.shortcode
    DARAJA_PASSKEY            -> daraja.passkey
    DARAJA_CALLBACK_URL       -> daraja.callback-url
    DARAJA_ENV                -> daraja.env

  generic mapping (anything else):
    VAULT_SECRET_<NAME>       -> env.<NAME>   e.g. VAULT_SECRET_AFRICASTALKING_API_KEY

Usage:
  SUPABASE_ACCESS_TOKEN=sbp_... SUPABASE_PROJECT_REF=xxxx \\
  PAYSTACK_SECRET_KEY=sk_live_... python3 scripts/vault_provision.py [--list]

Idempotent: re-running replaces each named secret (delete + create).
Values are never printed. Requires the `supabase_vault` extension (enabled
by default on Supabase projects; `create extension if not exists vault;`
otherwise — the script checks and reports).
"""

import json
import os
import secrets as pysecrets
import sys
import urllib.error
import urllib.request

API = "https://api.supabase.com"

NAMED = {
    "PAYSTACK_SECRET_KEY": "paystack.secret.live",
    "PAYSTACK_SECRET_KEY_TEST": "paystack.secret.test",
    "PAYSTACK_PUBLIC_KEY": "paystack.public.live",
    "DARAJA_CONSUMER_KEY": "daraja.consumer-key",
    "DARAJA_CONSUMER_SECRET": "daraja.consumer-secret",
    "DARAJA_SHORTCODE": "daraja.shortcode",
    "DARAJA_PASSKEY": "daraja.passkey",
    "DARAJA_CALLBACK_URL": "daraja.callback-url",
    "DARAJA_ENV": "daraja.env",
}


def run_sql(token: str, ref: str, query: str, args: list | None = None) -> list[dict]:
    # NOTE: the Management API query endpoint does NOT forward `args` to
    # Postgres (verified: 42P02 "there is no parameter $1") — callers must
    # inline values via sql_literal()/sql_name() below.
    del args  # unused, kept for signature stability
    body = {"query": query}
    req = urllib.request.Request(
        f"{API}/v1/projects/{ref}/database/query",
        data=json.dumps(body).encode(),
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as res:
            return json.loads(res.read().decode() or "[]")
    except urllib.error.HTTPError as err:
        detail = err.read().decode()[:300]
        raise RuntimeError(f"HTTP {err.code}: {detail}") from err


import re

_NAME_RE = re.compile(r"^[a-z0-9][a-z0-9._-]{0,127}$")


def sql_name(name: str) -> str:
    """Validate a vault secret name for safe inlining (strict charset)."""
    if not _NAME_RE.match(name):
        raise ValueError(f"unsafe vault secret name: {name!r}")
    return f"'{name}'"


def sql_literal(value: str) -> str:
    """Dollar-quote a value with a random tag guaranteed absent from it."""
    while True:
        tag = "mzg" + pysecrets.token_hex(4)
        if f"${tag}$" not in value:
            return f"${tag}${value}${tag}$"


def main() -> int:
    token = os.environ.get("SUPABASE_ACCESS_TOKEN", "").strip()
    ref = os.environ.get("SUPABASE_PROJECT_REF", "").strip()
    if not token or not ref:
        print("vault_provision: set SUPABASE_ACCESS_TOKEN and SUPABASE_PROJECT_REF", file=sys.stderr)
        return 1
    list_only = "--list" in sys.argv

    # vault availability check (extension + view)
    try:
        rows = run_sql(token, ref, "select name from vault.secrets order by name")
    except Exception as err:  # noqa: BLE001 — report and exit cleanly
        print(f"vault_provision: cannot read vault.secrets ({err}) — is supabase_vault enabled?", file=sys.stderr)
        return 1

    if list_only:
        for r in rows:
            print(f"vault secret: {r['name']}")
        print(f"vault_provision: {len(rows)} secret(s) present (values never shown)")
        return 0

    # collect desired secrets from env (values never logged)
    wanted: dict[str, str] = {}
    for env_name, vault_name in NAMED.items():
        v = os.environ.get(env_name, "").strip()
        if v:
            wanted[vault_name] = v
    for env_name, v in os.environ.items():
        if env_name.startswith("VAULT_SECRET_") and v.strip():
            wanted[f"env.{env_name[len('VAULT_SECRET_'):]}"] = v.strip()

    if not wanted:
        print("vault_provision: nothing to provision (no *_KEY / VAULT_SECRET_* env vars set)")
        return 0

    ok = True
    for vault_name, value in wanted.items():
        try:
            # replace semantics: drop any prior secret of this name, then create
            # (values inlined via dollar-quoting — the API has no parameter path)
            run_sql(token, ref, f"delete from vault.secrets where name = {sql_name(vault_name)}")
            run_sql(
                token, ref,
                f"select vault.create_secret({sql_literal(value)}, {sql_name(vault_name)}, "
                f"{sql_literal(f'mizigo {vault_name} (vault_provision)')})",
            )
            print(f"vault_provision: stored '{vault_name}' ({len(value)} chars)")
        except Exception as err:  # noqa: BLE001
            ok = False
            print(f"vault_provision: FAILED to store '{vault_name}': {err}", file=sys.stderr)

    # verify by name only
    rows = run_sql(token, ref, "select name from vault.secrets order by name")
    names = {r["name"] for r in rows}
    for vault_name in wanted:
        mark = "OK" if vault_name in names else "MISSING"
        print(f"vault_provision: verify {vault_name}: {mark}")
    print("vault_provision: done — the app resolves these at runtime via lib/runtime-secrets.ts")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
