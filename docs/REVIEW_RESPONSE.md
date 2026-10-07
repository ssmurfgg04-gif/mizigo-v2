# Review response — what we adopted, adapted, and deferred

**Maintainer's response to the friends' performance + production-readiness reviews and the 30-day roadmap.**
Sources: performance review (§-references below), 30-day roadmap, product/security/quality teardowns, Tier 1–3 recommendations.

## Adopted today (batch 2 — Uber/Bolt teardown + Kenya market research, Oct 2026)

- **Cancellation economics** (Uber §3.11): 2-min grace after driver-accept, KES 200 fee (admin setting) shown *before* confirming, auto-waiver on no-progress, fee withheld from refund — server-computed (`src/lib/cancellation.ts` + `cancel-quote` action)
- **Safety centre** (Uber SOS / Bolt Emergency Assist, scoped to a runnable small-platform version): safety-alert/checkin/ack actions, SAFETY_ALERT events, admin notifications + red ops Safety queue with one-tap call + ack, customer SOS sheet, driver SOS, post-alert check-in
- **Blocking POD handshake**: driver cannot close a delivery without the customer's 4-digit code (was advisory)
- **Tips after a 4–5★ rating** (Bolt §3.12): 100% to driver, chips + custom, wired into driver earnings + receipts
- **Driver offer card** (Uber §3.14): full money story (customer pays / commission / your earnings) + cargo spec + real 30 s countdown
- **Take-rate transparency** (Bolt's angle): earnings screen spells out 15% + KES 100 vs Kenya's 18% cap
- **Fare breakdown on every tier card + what-can-change-this-price disclosure** (Uber §3.3)
- **Numeric-ETA copy discipline** (Uber writing guide): "arrives in ~X min" wherever a number exists
- **Share-trip prompt at driver-accept + 48 h link expiry + live-location hidden 12 h after terminal** (Uber Trusted Contacts timing, Bolt one-ride links)
- **Receipt upgrades**: POD block, tip + refund/cancellation-fee lines, shareable receipt text
- **Pricing calibrated to Oct 2026 Nairobi benchmarks** (docs/research/KENYA_MARKET_PLAYBOOK.md): boda category added, pickup/canter/lorry minimums raised 40–60% to broker levels
- **Legal pages /privacy /terms /refund** — DPA 2019, marketplace contract, refund matrix (hard M-Pesa Daraja requirement)
- **Supabase production DB**: mizigo schema (isolated from plugpay in the same project), GitHub secrets + production-migrate / production-e2e / live-smoke workflows, 14-check production path probe — all green against the live cloud DB

## Adopted (batch 1)

- **DB indexes (both schemas) + cold-start DDL regen** — from perf review §10
- **Matching `dispatchScore` + ETA confidence** — from the perf branch (clean cherry-pick)
- **Pagination + admin query slimming + TTL query cache** — from performance review §1/§4/§7 (reimplemented: the branch's code commit had a file-content shuffle and was unusable as-is)
- **Structured telemetry + ops tab + SLIs** — 30-day roadmap week 1
- **Demo auto-progression behind `DEMO_AUTO_PROGRESS` flag** — roadmap week 3
- **DB-backed rate limiting (Postgres mode)** — answering the review's "rate limiting is per-instance"
- **CI (lint / type / test / build / e2e + a Postgres job)** — review Tier 3
- **Unit + parity tests for money paths** — review Tier 3
- **Package renamed to `mizigo`; copy lint; README counts fixed** — Tier 3
- **Daraja + Africa's Talking + Sentry scaffolds** (env-key inert until keys are set) — Tier 1 items 5–6, scoped to demo reality
- **MapLibre + CARTO + OSRM keyless maps; live driver tracking; driver turn-by-turn + typical-traffic ETAs** — owner priority
- **18-language i18n, offline dictionaries** (Google-Translate-style coverage without runtime deps)
- **Rust/WASM core for fare + dispatch math with a TS fallback**

## Adapted

- **SQLite stays for the sandbox; production is one env var away on Postgres** — already implemented and verified (see [NETLIFY_PRODUCTION.md](./NETLIFY_PRODUCTION.md)). Supabase/Neon are not required for the demo, per owner decision.
- **Real-time: 5s polling + client interpolation instead of websockets** (serverless constraint) — matches the review's own note that "5–10s polling is fine for cargo."
- **Rate limits: DB-backed counter instead of Upstash** (keyless — no account dependencies for the demo).

## Deferred (with reasons)

- **Expo driver app** — needs real device GPS; web demo comes first.
- **Upstash Redis / managed realtime** — no keys today; the DB-backed counter covers the current scale.
- **Live traffic feeds** — OSRM's typical-traffic model instead, labelled honestly in the UI.
- **eTIMS VAT invoices; ODPC registration; insurance copy hardening** — business-stage dependencies, not code-stage.
- **Postgres job in CI marked allow-failure** — until it has proven stable across a run of green builds.

## Known corruption note

The `perf/optimize-queries-and-ui` branch commit `a2e1394` shuffled file contents (`globals.css` contained React code, etc.) — its `matching.ts` + `schema.prisma` changes were cherry-picked; everything else was reimplemented from the review text. The branch is left intact on GitHub for reference.
