# MIZIGO v2

**Move anything. Anywhere.** A cargo transportation marketplace for Nairobi, Kenya — tuk-tuks, vans, pickups, canters and lorries, one network.

This is the sandbox MVP (v2): customer booking, driver operations and an admin console, built around a server-authoritative shipment state machine, a database-driven pricing engine and a matching engine — the way the product brief describes it (Uber's simplicity, cargo-specific intelligence, M-Pesa-first, deeply Kenyan behavior).

## Deploy to Netlify

The repo is Netlify-ready — no configuration needed beyond connecting it:

1. Push to GitHub (done).
2. [app.netlify.com](https://app.netlify.com) → **Add new site → Import an existing project** → pick the `mizigo-v2` repo.
3. Build settings are read from `netlify.toml` (command `npm run build:netlify`, `@netlify/plugin-nextjs`). Click **Deploy**.

On the first request after a deploy, the API bootstraps itself: SQLite is created in the function's writable `/tmp` (schema DDL + demo seed — see `src/lib/db-ready.ts`), so **no database service is required**. Notes for the demo: each warm function instance keeps its own data; a cold start reseeds fresh demo data (fine for a sandbox — it's labeled honestly in-app). For durable data, swap the Prisma datasource to Postgres/Turso and keep everything else.

Prisma query engines for the Netlify function runtime are prebuilt via `binaryTargets` in `prisma/schema.prisma`.

Local production-parity check: `bash scripts/prod_sim.sh` — builds with `NETLIFY=1`, boots a fresh `/tmp` SQLite and runs the full 147-check e2e against the production server (then restarts dev).

## Security model (public-deploy ready)

The sandbox keeps honest mocks, but the trust boundaries are real:

- **Sessions** — login issues an HMAC-SHA256–signed, HttpOnly cookie (`src/lib/security.ts`); every protected route derives identity from the session, never from the client. Logout revokes server-side.
- **OTP** — the mock SMS provider *does* verify: codes are server-generated, expire in 5 minutes, allow 5 attempts, and are consumed on use (the sandbox displays the code in-app — that's the labeled mock).
- **Authorization** — role checks on admin/driver surfaces; the unified action endpoint enforces a per-action matrix (customer / assigned driver / admin; QUOTED marketplace jobs accept any driver's quote). IDOR tested and closed (cross-customer reads, share-link minting, chat, driver-station actions all 403).
- **Rate limiting** — sliding-window limits per IP on every mutating route (auth, bookings, quotes, actions, return-load claims).
- **Validation** — coordinates bounded to the service region, quantities/weights clamped, string/array caps everywhere (fuzz-tested: NaN/1e308/out-of-region → 400).
- **Atomicity** — state transitions use a conditional-update claim (exactly one winner under concurrency; races return 409); pay-confirm is idempotent under concurrent calls; return-load claims are atomic.
- **Headers** — CSP, X-Frame-Options, nosniff, Referrer-Policy, Permissions-Policy (Next config + netlify.toml).
- **Public tracking** — hashed capabilities only; no phones, notes or customer names leave the public surface (verified by tests).

The e2e suite includes a 46-check security matrix + stress section (concurrency, malformed bodies, rate-limit floods) — `python3 scripts/e2e_test.py`.

## What's inside

| Surface | Entry | Highlights |
|---|---|---|
| **Customer app** | `/?role=customer` (demo login: John K.) | Cargo-first booking flow, vehicle recommendation with locked upfront price, **multi-stop deliveries**, **scheduled bookings**, **promo codes**, **quote marketplace for large loads**, M-PESA STK simulation, live tracking, **delivery-code POD handshake**, **safety centre + goods-in-transit cover copy**, **notification centre**, in-app chat with quick messages, help centre, rating, receipt (+ **VAT invoices for business accounts**), trip history, **Book again**, **saved places**, **English/Kiswahili switcher**, business account demo (ABC Traders) |
| **Driver app** | `/?role=driver` (demo: Peter Kamau) | Online/offline, earnings today + 7-day chart, demand map, job offers with full earnings disclosure + **customer ratings**, step-by-step trip flow with cargo verification, **delivery-code verification at POD**, quote submission for marketplace jobs, stop sequence with mark-done, chat with the customer, cargo issue reporting, documents screen, wallet + balance-checked M-PESA withdrawals |
| **Admin console** | `/?role=admin` | KPI dashboard, live network map, bookings table + chain-of-custody drawers, **manual dispatch (assign driver)**, driver management with document verification, **customer/business accounts**, **live pricing editor** (zone + per-vehicle-category, no redeploy), payments, **payout ledger (B2C)**, disputes, **support exception queue**, **promotions manager**, analytics (+ **top drivers**), **platform settings** (advance-booking window, auto-dispatch toggle, quote expiry, hotline), audit log |
| **Public tracking** | `/?view=track&token=…` | No-login recipient page: driver first name, vehicle, ETA, status, journey timeline. No phones or private data. |

**Design layer** — route-M logomark with waypoint dot (favicons + PWA manifest + OG card in `public/`), premium side-view vehicle illustrations for all six classes (`VehicleAvatar`), cinematic login: night freight-yard photography (two webp assets, ~110KB total) under a Terminal-style telemetry HUD (live coordinates, animated route with a moving vehicle, scanline sweep, Ken Burns drift), fully responsive — edge-to-edge on phones (safe-area aware, adapts down to iPhone SE) and a device frame on desktop.

## Architecture (docs/)

- `docs/ARCHITECTURE.md` — surfaces, stack, state machine, pricing/matching engines, payments (Daraja-shaped mock), failure handling, security model
- `docs/DESIGN_SYSTEM.md` — tokens, typography (Manrope), spacing/radius locks, status language, motion rules
- `docs/ENGINEERING_RULES.md` — non-negotiables, file layout, API contract, verification protocol
- `docs/MINING.md` — what was merged from the mizigo-v1 repo and the lessons adopted

## Core engineering

- **State machine** (`src/lib/state-machine.ts`) — 15 primary states (incl. `QUOTED` for the marketplace) + exceptions; transitions validated server-side; every transition appends an immutable event (chain of custody)
- **Pricing engine** (`src/lib/pricing.ts`) — base + per-km + per-min + loading + stops + platform fee from the DB; fare breakdown shown line-by-line; price locked at booking; **promo discounts validated and applied server-side**; **night surcharge (×1.12) and planned-delivery discount (−5%) factors, both admin-editable** (v1 goodness)
- **Return-load marketplace** (`/api/return-loads`) — drivers publish empty return legs at a discount; customers reserve them from a deals rail on home (atomic claim → real shipment at the locked empty-leg price with the publishing driver pre-assigned); honest savings computed against the live tariff (v1's "use the empty leg" flagship)
- **Two-sided reputation** — customers rate drivers *and drivers rate customers*; the driver's Network reliability score (v1 formula: 0.45·completion + 0.35·rating + 0.20·on-time − incident penalty) carries 18% of the dispatch ranking
- **Quote marketplace** — customers with large/commercial loads request driver quotes instead of instant pricing; verified transporters quote from their app (the sandbox also simulates a few quotes); the accepted quote locks the fare and reserves the quoting driver (plan §33/§36)
- **Matching engine** (`src/lib/matching.ts`) — filters (online, category, capacity, docs, service area) then ranks (distance, ETA, rating, acceptance, experience); **admin can disable auto-dispatch and assign drivers manually** (final brief §19 human-ops path)
- **Payments** (`src/app/api/shipments/[id]/action`) — mock M-PESA STK lifecycle with idempotency keys; server-authoritative status; refund on cancel; **B2C payout ledger**
- **Hashed share tokens** (`src/lib/tokens.ts`) — public tracking links are 24-byte capabilities stored only as sha256; links are minted on demand via the `share-link` action and the Share button uses the Web Share API (v1 security lesson)
- **Platform settings** (`PlatformSetting`) — advance-booking window (enforced server-side), auto-dispatch toggle, quote expiry, support hotline — editable in admin, audited
- **i18n** (`src/lib/i18n.ts`) — English-first with a live Kiswahili switcher for the core booking journey (plan §62 pattern)
- **Movement simulation** (`src/lib/shipments.ts`) — driver GPS derived from state + route + elapsed time (12× time compression in sandbox) so customer, driver and admin views converge on the same truth

## Honest sandbox labels

Mock OTP (code shown in-app), mock M-PESA (labeled SANDBOX, no real money), simulated GPS, sandbox quote simulation (real drivers can quote at any time), demo auto-accept/auto-advance (only while the customer tracking screen is open — a human driver can always take over from the driver app).

## Demo accounts

- Customer: `customer@mizigo.demo` · 0712 000 001 (John Kariuki, Personal)
- Business: `business@mizigo.demo` · 0722 000 033 (Zainab Mabuyu, ABC Traders Ltd)
- Driver: `driver@mizigo.demo` · 0712 000 002 (Peter Kamau, Toyota Dyna KDA 123X)
- Admin: `admin@mizigo.demo`

Demo promo codes: `MOVE200` (KES 200 off, min KES 1,000) · `WELCOME500` (first booking only, min KES 1,500) · `BIZ10` (10% business accounts, min KES 3,000).

## Run

```bash
bun install
bun run db:push     # SQLite schema
bun run dev         # seeds demo data on first request
```

Tests: `python3 scripts/e2e_test.py` (80 checks across the booking lifecycle, payments, matching, POD, pricing edits, promos, multi-stop, scheduling, the quote marketplace, manual dispatch, disputes, saved places, admin tabs and public-tracking privacy). Point it at another instance with `MIZIGO_BASE=http://localhost:3100`. Reseed anytime with `bun run scripts/reseed.ts`.

Icon/asset regeneration: `node scripts/make_icons.mjs` (logo → favicon/PWA/OG set) · `node scripts/make_hero.mjs` (hero webp) · `python3 scripts/make_ddl.py` (schema → `src/lib/ddl.ts` after model changes).
