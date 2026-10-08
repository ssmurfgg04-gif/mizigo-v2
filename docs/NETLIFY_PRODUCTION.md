# Mizigo on Netlify — sandbox mode vs production mode

> **Current production setup (October 2026).** The hosted Postgres is a
> **Supabase** project (session pooler), and mizigo's tables live in their own
> **`mizigo` schema** — sharing the Supabase project safely with another app
> (`plugpay`, public schema — untouched, verified by reset script output).
> The full connection string is stored as the GitHub repo secret
> **`SUPABASE_DATABASE_URL`** (never in the repo). To flip the live site from
> sandbox to multi-user production: Netlify → Site configuration →
> Environment variables → `DATABASE_URL` = that secret's value, then redeploy.
> Everything else (schema push at build, seed on cold start) is automatic.
>
> Repo workflows that use the secret:
> - **production-migrate** — `prisma db push` against Supabase (manual + on
>   schema changes to `prisma/schema.postgres.prisma`)
> - **production-e2e** — resets the schema, builds + runs the FULL test
>   suites against the real production DB, then resets again (manual)
> - **live-smoke** — probes mizigo.netlify.app every 30 minutes
>
> Scripts: `scripts/mizigo_schema_reset.mjs` (truncate mizigo schema),
> `scripts/supabase_check.py` (focused 14-check production path probe).

Mizigo runs in two modes on Netlify, decided by a single environment variable:

| | Sandbox mode (default) | Production mode |
|---|---|---|
| `DATABASE_URL` | *not set* | `postgresql://…` (Neon / Supabase / any Postgres) |
| Database | SQLite in each function instance's `/tmp` | Shared hosted Postgres |
| Setup | Zero config — schema + demo seed self-bootstrap on cold start | One-time: set the env var, deploy |
| Concurrency | **Single sequential user** — parallel Lambda instances each get their own isolated DB, so concurrent viewers bounce between data sets | Full multi-user — one shared DB, atomic cross-instance transactions |
| Persistence | Per warm instance (~minutes); new deploys reset | Permanent |

The live demo at mizigo.netlify.app runs in sandbox mode. That is perfect for
walking one person through the app (login → book → track → deliver → admin),
and it survives any cold start anywhere. But **two people clicking at the same
time will spawn parallel function instances with separate databases** —
measured live: sequential requests hit the data-owning instance 20/20, but
under parallel load ~70% of requests landed on instances that had never seen
the data. That is a platform property (Netlify functions are stateless and
scale horizontally), not a bug Mizigo can code around from inside the app.

## Going multi-user (5 minutes, free tier)

1. Create a free Postgres database:
   - [Neon](https://neon.tech) → New Project → copy the *pooled* connection
     string, or
   - [Supabase](https://supabase.com) → New project → Settings → Database →
     Connection string (URI, "Session pooler").
2. In your Netlify site: **Site configuration → Environment variables →
   Add a variable** → key `DATABASE_URL`, value = the connection string
   (URL-encode special characters in the password; append
   `?connection_limit=5&pool_timeout=10` to be gentle with free-tier
   connection limits).
3. Optional but recommended: also set `MIZIGO_SESSION_SECRET` to a long random
   string (e.g. `openssl rand -base64 48`). Otherwise sessions fall back to the
   sandbox default, which is fine for a demo but lets anyone forge sessions if
   they know the source.
4. Trigger a deploy (push any commit, or Deploys → Trigger deploy).

The build handles everything else automatically:

- `scripts/db-prepare.mjs` detects the Postgres URL, generates the Postgres
  client from `prisma/schema.postgres.prisma`, and runs `prisma db push`
  (idempotent — safe on every deploy; it fails loudly rather than dropping
  data silently).
- On the first request, `ensureSeed()` seeds the demo data into the shared DB.
- Every API route, the booking lifecycle, tracking, chat, payments, admin
  console — all run unchanged against Postgres (the schema is intentionally
  provider-portable: no enums, no SQLite-specific types).

Both modes are covered by the same e2e suite
(`MIZIGO_BASE=<url> python3 scripts/e2e_test.py`): 150+ checks — lifecycle,
security matrix, races and rate limits — passing against the real Netlify
function bundle in sandbox mode *and* against a real PostgreSQL 18 in
production mode, including back-to-back runs on persistent state.

## Local development

Unchanged: `npm run dev` uses the repo SQLite (`db/custom.db` via `.env`,
`prisma db push` to (re)create). To develop against local Postgres:

```bash
npm run db:prepare   # with DATABASE_URL exported → postgres client + push
```

## Why not "just fix" sandbox concurrency?

The only shared stores available inside Netlify functions without external
accounts are ephemeral (`/tmp`) — there is no cross-instance filesystem, and
Netlify offers no single-instance pinning for functions. Every real fix needs
state outside the function fleet; a hosted Postgres is the smallest,
cheapest, most boring one that works (Neon/Supabase free tiers are enough for
a demo or a pilot). This is the same conclusion as the general rule: serverless
compute + local files = per-request islands; put the state where the compute
can share it.

---

## Going LIVE for real users — Paystack marketplace + real data (October 2026)

The app now runs the **marketplace money model** (hold-then-payout on POD):

- **Payments**: customer pays by M-PESA through **Paystack** (checkout
  redirect → `/pay/callback` verify → webhook is the source of truth).
  Provider selection at runtime: `PAYSTACK_SECRET_KEY` (or the encrypted DB
  key, below) → Daraja → sandbox simulation. With NO keys configured the app
  keeps the simulated flow — zero-risk default.
- **Payouts**: after proof of delivery the driver's share moves by Paystack
  Transfer to their saved M-Pesa/bank recipient (auto-default: the driver's
  own phone as M-Pesa). Commission is **15%** + KES 100 platform fee (the
  owner-confirmed starting sweet spot, October 2026).
- **Real data only**: production Postgres never seeds demo users/drivers/
  shipments — reference data (tariffs, zone, places, settings) self-seeds on
  first boot. Demo logins + the demo dataset exist only in the SQLite sandbox
  and CI (`SEED_DEMO=true`).

### Netlify environment variables (the full production set)

| Variable | Value | Required |
|---|---|---|
| `DATABASE_URL` | the `SUPABASE_DATABASE_URL` GitHub secret's value | yes |
| `MIZIGO_SESSION_SECRET` | long random string | recommended |
| `AFRICASTALKING_API_KEY` + `AT_USERNAME` (+ `AT_SENDER_ID`) | Africa's Talking SMS credentials | for real OTP SMS (without them the login code shows in-app) |
| `MIZIGO_PAYMENTS` | set to `simulated` to force the sandbox money path on a production DB (CI uses this) | optional safety valve |

That's the whole set — **provider keys never go to Netlify** (see below).

### Secrets: Supabase Vault + runtime fetch (the marketplace key store)

Provider secrets live in the Supabase project's **Vault** (encrypted at rest
with pgsodium, readable only through the database connection itself). The
Netlify API functions fetch them at runtime and hydrate them into the
process environment (`src/lib/runtime-secrets.ts`) — one vault query per
instance per 10 minutes, values never logged, explicit Netlify env vars
always win.

Resolution order for any provider key (Paystack example):
1. **env** (`PAYSTACK_SECRET_KEY` in Netlify UI / CI) — wins if set
2. **Supabase Vault** secret `paystack.secret.live` (hydrated into env)
3. AES-256-GCM `PlatformSetting.paystack.secret.live` row decrypted with
   `PAYSTACK_MASTER_KEY` (the original path — kept as fallback; the master
   key is **no longer needed on Netlify** when the vault is provisioned, it
   stays a GitHub secret for the CI provisioning path)

**So where does the Paystack master key go?** Nowhere on Netlify — with the
vault provisioned, `DATABASE_URL` is the only root secret the functions hold
(the DB credential gates the vault). The master key remains in GitHub
Secrets (`PAYSTACK_MASTER_KEY`) for `scripts/paystack_provision.mjs`.

Provisioning (idempotent, values from env only — never CLI args):

```bash
SUPABASE_ACCESS_TOKEN=sbp_… SUPABASE_PROJECT_REF=xycmzhpkuzyhmgucwqys \
PAYSTACK_SECRET_KEY=sk_live_… [DARAJA_* when they arrive] \
python3 scripts/vault_provision.py          # stores + verifies by name only
python3 scripts/vault_provision.py --list   # names only, never values
```

Known vault names: `paystack.secret.live|test`, `paystack.public.live`,
`daraja.consumer-key|consumer-secret|shortcode|passkey|callback-url|env`
(ready for the moment Daraja keys arrive), plus a generic escape hatch — any
vault secret named `env.<UPPER_SNAKE>` hydrates that env var (e.g.
`env.AFRICASTALKING_API_KEY`). The **production-migrate** workflow runs
`scripts/vault_read_check.mjs` after every migrate: it proves the app's own
DB role can read the vault (names only).

Current state (October 2026): `paystack.secret.live` +
`paystack.public.live` are provisioned; `MIZIGO_PAYMENTS=simulated` keeps
CI/e2e boots off the live provider regardless.

### Daraja backup channel + GPS-mismatch arrival confirm (October 2026)

- **Backup channel**: Paystack stays the primary collection rail; if
  `transaction/initialize` fails (outage/timeout), `startCustomerPayment`
  automatically falls back to a **Daraja STK push** when the Safaricom keys
  are configured (vault or env). The fallback is recorded on the
  PaymentEvent (`providerMeta.fallbackFrom`) for reconciliation. Live
  Daraja payments can ONLY be confirmed by the Safaricom callback
  (`/api/mpesa/callback` → the same atomic-claim funnel, with amount
  integrity) — a client action can never confirm an unpaid STK push. The
  customer app polls (`I've entered my PIN — check status`) instead of
  showing the sandbox PIN simulator.
- **GPS-mismatch confirm** (Bolt Driver pattern, DECOMPILE_FINDINGS §Deep
  Dive 2): the driver app feeds real GPS (`/api/driver/action` ping — also
  refreshes the H3 supply cell). When the driver claims arrival
  (`arrive`/`deliver`) with fresh GPS **> 150 m** from the target point,
  the server answers `409 GPS_MISMATCH` with the distance; the driver app
  shows an explicit confirm ("Arrived at pickup? … doesn't match the pickup
  spot") and the confirmed off-location arrival is recorded on the delivery
  timeline. No/stale GPS (every sandbox/demo flow) never gates.

### Paystack dashboard checklist (one-time)

1. **Webhook URL** → `https://mizigo.netlify.app/api/paystack/webhook`
   (direct — recommended; ✅ set October 2026). Alternative: the Supabase
   forwarder `https://xycmzhpkuzyhmgucwqys.supabase.co/functions/v1/paystack-webhook`
   (already deployed; forwards raw body + signature to the same route).
2. **Transfers OTP**: Settings → Preferences → uncheck "Confirm transfers
   before sending" so POD payouts are fully automatic. (If left ON, payouts
   park in PROCESSING with an "Awaiting OTP" note and ops finalizes them from
   the admin Payouts tab — the app handles both.)
3. Live callback URL `https://mizigo.netlify.app` — ✅ set; the
   per-transaction `callback_url` overrides it anyway.

### First live smoke (after `DATABASE_URL` is pasted into Netlify)

0. `GET /api/bootstrap` → `payments.provider` should read `"PAYSTACK"` and
   `build.mode` `"postgres"` — that single URL proves the switch flipped.
1. Book a small delivery (KES 10–50) with your own phone → confirm the M-PESA
   STK push arrives via Paystack → pay → the delivery flips to confirmed.
2. Check the Paystack dashboard: transaction shows, fee = 1.5%.
3. Complete the delivery to POD → the driver payout (your driver account)
   queues and lands on M-Pesa (KES 20–60 transfer fee per the band).
4. Ops view: admin → Payouts shows the lifecycle rows with statuses.
