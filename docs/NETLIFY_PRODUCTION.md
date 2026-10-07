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
