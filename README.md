# MIZIGO

**Move anything. Anywhere.** A cargo transportation marketplace for Nairobi, Kenya — tuk-tuks, vans, pickups, canters and lorries, one network.

This is the sandbox MVP: customer booking, driver operations and an admin console, built around a server-authoritative shipment state machine, a database-driven pricing engine and a matching engine — the way the product brief describes it (Uber's simplicity, cargo-specific intelligence, M-Pesa-first, deeply Kenyan behavior).

## What's inside

| Surface | Entry | Highlights |
|---|---|---|
| **Customer app** | `/?role=customer` (demo login: John K.) | Cargo-first booking flow, vehicle recommendation with locked upfront price, M-PESA STK simulation, live tracking, POD, rating, receipt, trip history, business account demo (ABC Traders) |
| **Driver app** | `/?role=driver` (demo: Peter Kamau) | Online/offline, earnings today + 7-day chart, demand map, job offers with full earnings disclosure, step-by-step trip flow with cargo verification + POD capture, wallet + M-PESA withdrawals |
| **Admin console** | `/?role=admin` | KPI dashboard, live network map, bookings table + chain-of-custody drawers, driver management with document verification, **live pricing editor** (zone + per-vehicle-category, no redeploy), payments + B2C payouts, disputes, analytics, audit log |
| **Public tracking** | `/?view=track&token=…` | No-login recipient page: driver first name, vehicle, ETA, status, journey timeline. No phones or private data. |

## Architecture (docs/)

- `docs/ARCHITECTURE.md` — surfaces, stack, state machine, pricing/matching engines, payments (Daraja-shaped mock), failure handling, security model
- `docs/DESIGN_SYSTEM.md` — tokens, typography (Manrope), spacing/radius locks, status language, motion rules
- `docs/ENGINEERING_RULES.md` — non-negotiables, file layout, API contract, verification protocol

## Core engineering

- **State machine** (`src/lib/state-machine.ts`) — 14 primary states + exceptions; transitions validated server-side; every transition appends an immutable event (chain of custody)
- **Pricing engine** (`src/lib/pricing.ts`) — base + per-km + per-min + loading + stops + platform fee from the DB; fare breakdown shown line-by-line; price locked at booking
- **Matching engine** (`src/lib/matching.ts`) — filters (online, category, capacity, docs, service area) then ranks (distance, ETA, rating, acceptance, experience)
- **Payments** (`src/app/api/shipments/[id]/action`) — mock M-PESA STK lifecycle with idempotency keys; server-authoritative status; refund on cancel
- **Movement simulation** (`src/lib/shipments.ts`) — driver GPS derived from state + route + elapsed time (12× time compression in sandbox) so customer, driver and admin views converge on the same truth

## Honest sandbox labels

Mock OTP (code shown in-app), mock M-PESA (labeled SANDBOX, no real money), simulated GPS, demo auto-accept/auto-advance (only while the customer tracking screen is open — a human driver can always take over from the driver app).

## Demo accounts

- Customer: `customer@mizigo.demo` · 0712 000 001 (John Kariuki, Personal)
- Business: `business@mizigo.demo` · 0722 000 033 (Zainab Mabuyu, ABC Traders Ltd)
- Driver: `driver@mizigo.demo` · 0712 000 002 (Peter Kamau, Toyota Dyna KDA 123X)
- Admin: `admin@mizigo.demo`

## Run

```bash
bun install
bun run db:push     # SQLite schema
bun run dev         # seeds demo data on first request
```

Tests: `python3 scripts/e2e_test.py` (37 checks across the booking lifecycle, payments, matching, POD, pricing edits, public tracking privacy).
