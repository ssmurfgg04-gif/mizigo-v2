// MIZIGO — runtime secret hydration from Supabase Vault.
//
// ARCHITECTURE ("serverless functions + encrypted storage" — the owner-selected
// pattern, docs/NETLIFY_PRODUCTION.md §Secrets): the Netlify site keeps a
// MINIMAL env set (DATABASE_URL only, plus the optional session secret); the
// provider secrets live in the Supabase project's **Vault** (encrypted at rest
// with pgsodium, readable only through the database connection itself) and are
// fetched at runtime by the API functions, then hydrated into `process.env`.
// Everything else in the app keeps reading plain env vars — code stays
// source-agnostic whether a key came from Netlify env or the Vault.
//
// Resolution order for any provider key (Paystack example, lib/integrations/paystack.ts):
//   1. real env var (Netlify UI / CI)          — always wins if set
//   2. Supabase Vault (this module)            — hydrated into env once per TTL
//   3. AES-256-GCM PlatformSetting row + PAYSTACK_MASTER_KEY (legacy fallback)
//
// Why this answers "where does the Paystack master key go?": with the Vault
// path provisioned, the master key is NOT needed on Netlify at all — the DB
// credential (DATABASE_URL) is the only root secret the functions hold. The
// master key stays in GitHub Secrets where the CI provisioning path uses it.
//
// Safety rules:
//   * never throws — any failure (sandbox SQLite, no vault table, no rows,
//     query error) is a cached no-op; the app degrades to the next source
//   * never logs secret VALUES — only names/counts
//   * single-flight + TTL: one query per instance per 10 minutes, success or
//     failure alike (no per-request DB chatter)
//   * MIZIGO_PAYMENTS=simulated short-circuits everything (CI/e2e safety
//     valve: production DB + provisioned vault must never turn the test
//     suites onto the live provider)
//   * only fills UNSET env vars — an explicit Netlify env var always wins

import { db } from "@/lib/db";
import { dbIsPostgres } from "@/lib/feature-flags";

/** CI/tests: force the simulated money path regardless of any configured key. */
export function paymentsSimulated(): boolean {
  return (process.env.MIZIGO_PAYMENTS ?? "").trim().toLowerCase() === "simulated";
}

const TTL_MS = 10 * 60_000;

/**
 * Vault secret name → env var. `env.<NAME>` is the generic escape hatch: any
 * future key (Africa's Talking, Daraja when it arrives, …) can be provisioned
 * as a Vault secret named `env.AFRICASTALKING_API_KEY` etc. with no code
 * change; the explicit map below exists for the well-known, documented names.
 */
const VAULT_ENV_MAP: Record<string, string> = {
  "paystack.secret.live": "PAYSTACK_SECRET_KEY",
  "paystack.secret.test": "PAYSTACK_SECRET_KEY_TEST",
  "daraja.consumer-key": "DARAJA_CONSUMER_KEY",
  "daraja.consumer-secret": "DARAJA_CONSUMER_SECRET",
  "daraja.shortcode": "DARAJA_SHORTCODE",
  "daraja.passkey": "DARAJA_PASSKEY",
  "daraja.callback-url": "DARAJA_CALLBACK_URL",
  "daraja.env": "DARAJA_ENV",
};

const GENERIC_PREFIX = "env.";

interface VaultRow {
  name: string;
  decrypted_secret: string | null;
}

let hydrateState: { promise: Promise<void>; at: number } | null = null;

/** env-var name hygiene for the generic `env.<NAME>` path */
function safeEnvName(name: string): string | null {
  return /^[A-Z][A-Z0-9_]*$/.test(name) && name.length <= 64 ? name : null;
}

async function hydrate(): Promise<void> {
  // Postgres mode only — the sandbox SQLite has no vault, and MIZIGO_PAYMENTS
  // =simulated (CI boots against the production DB) must never see keys.
  if (!dbIsPostgres() || paymentsSimulated()) return;
  try {
    const rows = await db.$queryRawUnsafe<VaultRow[]>(
      "SELECT name, decrypted_secret FROM vault.decrypted_secrets",
    );
    let applied = 0;
    for (const row of rows) {
      const name = String(row.name ?? "");
      const value = row.decrypted_secret == null ? "" : String(row.decrypted_secret).trim();
      if (!name || !value) continue;
      let envName: string | null = VAULT_ENV_MAP[name] ?? null;
      if (!envName && name.startsWith(GENERIC_PREFIX)) {
        envName = safeEnvName(name.slice(GENERIC_PREFIX.length));
      }
      if (!envName) continue; // unknown secret name — skip silently
      if ((process.env[envName] ?? "").trim()) continue; // explicit env wins
      process.env[envName] = value;
      applied += 1;
    }
    if (applied > 0) {
      console.log(`[runtime-secrets] hydrated ${applied} provider key(s) from Supabase Vault (env: ${Object.keys(VAULT_ENV_MAP).length} known names)`);
    }
  } catch (err) {
    // sandbox / no vault / permission — all expected; degrade silently
    console.warn(`[runtime-secrets] vault hydration skipped (${(err as Error).message})`);
  }
}

/**
 * Ensure provider secrets from the Vault are visible as env vars. Safe to
 * call from any money path; at most one vault query per instance per TTL.
 */
export async function hydrateRuntimeSecrets(): Promise<void> {
  if (hydrateState && Date.now() - hydrateState.at < TTL_MS) {
    await hydrateState.promise; // propagate in-flight/concurrent failures too
    return;
  }
  const promise = hydrate();
  hydrateState = { promise, at: Date.now() };
  await promise;
}
