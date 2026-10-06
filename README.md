# MIZIGO v2

<!-- CI badge placeholder — goes live as soon as .github/workflows/ci.yml lands on main -->
[![CI](https://github.com/ssmurfgg04-gif/mizigo-v2/actions/workflows/ci.yml/badge.svg)](https://github.com/ssmurfgg04-gif/mizigo-v2/actions/workflows/ci.yml)

**Move anything. Anywhere.** A cargo transportation marketplace for Nairobi, Kenya — tuk-tuks, vans, pickups, canters and lorries, one network. Live sandbox: **[mizigo.netlify.app](https://mizigo.netlify.app)**.

This is v2: customer booking, driver operations and an admin console, built around a server-authoritative shipment state machine, a database-driven pricing engine and a matching engine — Uber's simplicity, cargo-specific intelligence, M-Pesa-first, deeply Kenyan behavior. Zero API keys required to run or deploy.

## What's inside

| Surface | Entry | Highlights |
|---|---|---|
| **Customer app** | `/?role=customer` (demo login: John K.) | Cargo-first booking flow, vehicle recommendation with locked upfront price, **multi-stop deliveries**, **scheduled bookings**, **promo codes**, **quote marketplace for large loads**, M-PESA STK simulation, **live tracking on real street maps**, **delivery-code POD handshake**, **safety centre + goods-in-transit cover copy**, **notification centre**, in-app chat with quick messages, help centre, rating, receipt (+ **VAT invoices for business accounts**), trip history, **Book again**, **saved places**, **18-language switcher**, business account demo (ABC Traders) |
| **Driver app** | `/?role=driver` (demo: Peter Kamau) | Online/offline, earnings today + 7-day chart, demand map, job offers with full earnings disclosure + **customer ratings**, step-by-step trip flow with cargo verification, **delivery-code verification at POD**, **turn-by-turn navigation with typical-traffic ETAs**, quote submission for marketplace jobs, stop sequence with mark-done, chat with the customer, cargo issue reporting, documents screen, wallet + balance-checked M-PESA withdrawals, **return-leg marketplace** |
| **Admin console** | `/?role=admin` | KPI dashboard + **ops/telemetry tab with SLIs**, live network map, bookings table + chain-of-custody drawers, **manual dispatch (assign driver)**, driver management with document verification, **customer/business accounts**, **live pricing editor** (zone + per-vehicle-category, no redeploy), payments, **payout ledger (B2C)**, disputes, **support exception queue**, **promotions manager**, analytics (+ **top drivers**), **platform settings** (advance-booking window, auto-dispatch toggle, quote expiry, hotline), audit log |
| **Public tracking** | `/?view=track&token=…` | No-login recipient page: driver first name, vehicle, ETA, status, journey timeline. No phones or private data. |

**Design layer** — route-M logomark with waypoint dot (favicons + PWA manifest + OG card in `public/`), premium side-view vehicle illustrations for all six classes (`VehicleAvatar`), cinematic login: night freight-yard photography (two webp assets, ~110KB total) under a Terminal-style telemetry HUD, fully responsive from iPhone SE to desktop.

## Architecture at a glance

- **Dual-mode database** — the same codebase runs as a zero-config sandbox (SQLite, per-instance `/tmp`, schema DDL + demo seed self-bootstrap on cold start) or a real multi-user deployment (any hosted Postgres) purely by setting `DATABASE_URL`. `scripts/db-prepare.mjs` generates the right Prisma client and pushes the schema at build time; `src/lib/db-ready.ts` verifies + seeds at runtime. Full details: [docs/NETLIFY_PRODUCTION.md](docs/NETLIFY_PRODUCTION.md).
- **Server-authoritative state machine** — 15 primary states (incl. `QUOTED` for the marketplace) plus exception paths; every transition is validated server-side and appends an immutable chain-of-custody event. Concurrent transitions use conditional-update claims — exactly one winner, races get 409s.
- **Security model** — HMAC-SHA256-signed HttpOnly session cookies (`src/lib/security.ts`); identity is never trusted from the client; a per-action authorization matrix (customer / assigned driver / admin, QUOTED marketplace allowance) on the unified action endpoint; OTP that actually verifies (expiry, attempt limits, consume-on-use); sliding-window rate limiting (in-memory in sandbox, DB-backed in Postgres mode); coordinate/quantity/string validation on every input; IDOR closed and fuzz-tested; hashed public-tracking capabilities; CSP and security headers.
- **Pricing & matching** — fares are DB-driven (base + per-km + per-min + loading + stops + platform fee, night surcharge, planned-delivery discount) and locked at booking; promos validated server-side. The matching engine filters (online, category, capacity, documents, service area) then ranks (distance, ETA confidence, rating, acceptance, experience, v1 reliability score).

## The map stack (keyless)

MapLibre GL + CARTO basemaps + OSRM routing — no API keys, no accounts, no billing. Driver movement is tracked live on real streets; ETAs use OSRM's typical-traffic model and are labelled as such (honest, not "live traffic"). Navigation for drivers is turn-by-turn from OSRM. The whole stack is client-side; there is no map server to operate.

## Languages

18 languages with offline dictionaries — Google-Translate-style coverage for the core journey without runtime dependencies or translation API calls. English and Kiswahili are hand-tuned; the dictionary ships in the bundle and works offline.

## The Rust core

Fare + dispatch math (the money path) runs through a Rust core compiled to WASM with a TypeScript fallback that is bit-identical in behavior — unit + parity tests (`bun run test`) prove both implementations agree, so the pure-TS sandbox and the WASM build can never drift on price.

## Integrations & environment variables

Everything below is **inert by default** — unset keys mean the sandbox mock/labels stay in place. Nothing is required to run or deploy the demo.

| Variable | Purpose | Default (unset) |
|---|---|---|
| `DATABASE_URL` | `file:…` → SQLite sandbox · `postgresql://…` → hosted Postgres (schema auto-pushed at build) | `/tmp` SQLite, self-bootstraps |
| `MIZIGO_SESSION_SECRET` | HMAC secret for session cookies | sandbox default (rotate for production) |
| `DEMO_AUTO_PROGRESS` | `true` → demo shipments auto-advance without a human driver | off — humans drive the demo |
| `DARAJA_CONSUMER_KEY` / `DARAJA_CONSUMER_SECRET` / `DARAJA_PASSKEY` / `DARAJA_ENVIRONMENT` | Safaricom Daraja M-PESA (STK push, B2C payouts) | labeled M-PESA sandbox simulation |
| `AT_API_KEY` / `AT_USERNAME` / `AT_SENDER_ID` | Africa's Talking SMS + USSD | OTP codes shown in-app (labeled mock) |
| `SENTRY_DSN` / `NEXT_PUBLIC_SENTRY_DSN` | Sentry error tracking (server / client) | disabled |
| `CRON_SECRET` | Shared secret for scheduled endpoints | scheduled jobs refuse to run |

## Testing & verification

- **150+ automated e2e checks** across the booking lifecycle, the authn/authz security matrix, input-validation fuzzing and stress suites (concurrency, malformed bodies, rate-limit floods) — `python3 scripts/e2e_test.py` (python3 + stdlib only; point it at another instance with `BASE_URL=…` or `MIZIGO_BASE=…`). The live demo walkthrough (`scripts/demo_walkthrough.py`) exercises the same flows a human would.
- **Unit + parity suites** — money paths, fare math and the Rust/TS parity checks run via `bun run test` (vitest; suites live under `tests/`).
- **Copy lint** — `bun run lint:copy` enforces user-facing text consistency (em-dash house style, ellipsis, apostrophes, no "coming soon" placeholders) with a reasoned allowlist at `scripts/lint-copy-allowlist.json`.
- **CI** (`.github/workflows/ci.yml`) — every push/PR to `main` runs: typecheck → eslint → copy lint → vitest → a production `next build` → the full e2e suite against the standalone server on a fresh SQLite → the same against a real Postgres 16 (allow-failure until stable).
- Reseed anytime: `bun run scripts/reseed.ts`. Full production simulation: `bash scripts/prod_sim.sh`.

## Local development

```bash
bun install       # postinstall generates the Prisma client
bun run dev       # schema + demo data bootstrap on first request
```

Optional: `bun run db:push` for a pristine local schema, `bash scripts/prod_sim.sh` for a cold-start production-parity run (builds, boots a fresh `/tmp` SQLite, runs the whole e2e suite against it).

Asset regeneration: `node scripts/make_icons.mjs` (logo → favicon/PWA/OG set) · `node scripts/make_hero.mjs` (hero webp) · `python3 scripts/make_ddl.py` (schema → `src/lib/ddl.ts` after model changes).

## Deploying

The repo is Netlify-ready — connect it at [app.netlify.com](https://app.netlify.com) and `netlify.toml` does the rest (build command, Prisma engines in the function bundle, security headers). The API self-bootstraps on the first request; for durable multi-user data set `DATABASE_URL` to a hosted Postgres — the five-minute upgrade is documented in [docs/NETLIFY_PRODUCTION.md](docs/NETLIFY_PRODUCTION.md).

## Documentation

| Doc | What's in it |
|---|---|
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Surfaces, stack, state machine, engines, payments, failure handling, security model |
| [docs/DESIGN_SYSTEM.md](docs/DESIGN_SYSTEM.md) | Tokens, typography, spacing/radius locks, status language, motion rules |
| [docs/ENGINEERING_RULES.md](docs/ENGINEERING_RULES.md) | Non-negotiables, file layout, API contract, verification protocol |
| [docs/NETLIFY_PRODUCTION.md](docs/NETLIFY_PRODUCTION.md) | Sandbox vs production modes, the one-env-var Postgres upgrade, ops notes |
| [docs/REVIEW_RESPONSE.md](docs/REVIEW_RESPONSE.md) | What we adopted, adapted and deferred from the reviews — with reasons |
| [docs/PERFORMANCE_REVIEW.md](docs/PERFORMANCE_REVIEW.md) | The performance review (§-numbered risks + remediation plan) |
| [docs/30DAY_ROADMAP.md](docs/30DAY_ROADMAP.md) | 30-day performance & observability roadmap |
| [docs/ROADMAP_DISPATCH_INTEL.md](docs/ROADMAP_DISPATCH_INTEL.md) | 30-day dispatch-intelligence roadmap variant |
| [docs/performance-checklist.md](docs/performance-checklist.md) | P0/P1/P2 performance + operations checklist |
| [docs/MINING.md](docs/MINING.md) | What was merged from the mizigo-v1 repo and the lessons adopted |
| [docs/DEMO_GUIDE.md](docs/DEMO_GUIDE.md) | Guided walkthrough of the demo |

Roadmap pointer: the current plan of record is [docs/30DAY_ROADMAP.md](docs/30DAY_ROADMAP.md), with the review-by-review decision log in [docs/REVIEW_RESPONSE.md](docs/REVIEW_RESPONSE.md).

## Honest sandbox labels

Mock OTP (code shown in-app), mock M-PESA (labeled SANDBOX, no real money), simulated GPS movement, sandbox quote simulation (real drivers can quote at any time), demo auto-accept/auto-advance only while the customer tracking screen is open (a human driver can always take over; full auto-progression needs `DEMO_AUTO_PROGRESS=true`). ETAs are typical-traffic estimates, labelled as such.

## Demo accounts

- Customer: `customer@mizigo.demo` · 0712 000 001 (John Kariuki, Personal)
- Business: `business@mizigo.demo` · 0722 000 033 (Zainab Mabuyu, ABC Traders Ltd)
- Driver: `driver@mizigo.demo` · 0712 000 002 (Peter Kamau, Toyota Dyna KDA 123X)
- Admin: `admin@mizigo.demo`

Demo promo codes: `MOVE200` (KES 200 off, min KES 1,000) · `WELCOME500` (first booking only, min KES 1,500) · `BIZ10` (10% business accounts, min KES 3,000).
