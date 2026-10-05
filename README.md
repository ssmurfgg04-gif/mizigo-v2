# MIZIGO v2

**Move anything. Anywhere.** A cargo transportation marketplace for Nairobi, Kenya — tuk-tuks, vans, pickups, canters and lorries, one network.

This is the sandbox MVP (v2): customer booking, driver operations and an admin console, built around a server-authoritative shipment state machine, a database-driven pricing engine and a matching engine — the way the product brief describes it (Uber's simplicity, cargo-specific intelligence, M-Pesa-first, deeply Kenyan behavior).

## What's inside

| Surface | Entry | Highlights |
|---|---|---|
| **Customer app** | `/?role=customer` (demo login: John K.) | Cargo-first booking flow, vehicle recommendation with locked upfront price, **multi-stop deliveries**, **scheduled bookings**, **promo codes**, **quote marketplace for large loads**, M-PESA STK simulation, live tracking, **in-app chat with quick messages**, **help centre**, POD, rating, receipt (+ **VAT invoices for business accounts**), trip history, **Book again**, **saved places**, notification deep-links, **English/Kiswahili switcher**, business account demo (ABC Traders) |
| **Driver app** | `/?role=driver` (demo: Peter Kamau) | Online/offline, earnings today + 7-day chart, demand map, job offers with full earnings disclosure, step-by-step trip flow with cargo verification + POD capture, **quote submission for marketplace jobs**, **stop sequence with mark-done**, **chat with the customer**, **cargo issue reporting to ops**, **documents screen** (licence/insurance/inspection with expiry), wallet + M-PESA withdrawals |
| **Admin console** | `/?role=admin` | KPI dashboard, live network map, bookings table + chain-of-custody drawers, **manual dispatch (assign driver)**, driver management with document verification, **customer/business accounts**, **live pricing editor** (zone + per-vehicle-category, no redeploy), payments, **payout ledger (B2C)**, disputes, **support exception queue**, **promotions manager**, analytics (+ **top drivers**), **platform settings** (advance-booking window, auto-dispatch toggle, quote expiry, hotline), audit log |
| **Public tracking** | `/?view=track&token=…` | No-login recipient page: driver first name, vehicle, ETA, status, journey timeline. No phones or private data. |

## Architecture (docs/)

- `docs/ARCHITECTURE.md` — surfaces, stack, state machine, pricing/matching engines, payments (Daraja-shaped mock), failure handling, security model
- `docs/DESIGN_SYSTEM.md` — tokens, typography (Manrope), spacing/radius locks, status language, motion rules
- `docs/ENGINEERING_RULES.md` — non-negotiables, file layout, API contract, verification protocol

## Core engineering

- **State machine** (`src/lib/state-machine.ts`) — 15 primary states (incl. `QUOTED` for the marketplace) + exceptions; transitions validated server-side; every transition appends an immutable event (chain of custody)
- **Pricing engine** (`src/lib/pricing.ts`) — base + per-km + per-min + loading + stops + platform fee from the DB; fare breakdown shown line-by-line; price locked at booking; **promo discounts validated and applied server-side**
- **Quote marketplace** — customers with large/commercial loads request driver quotes instead of instant pricing; verified transporters quote from their app (the sandbox also simulates a few quotes); the accepted quote locks the fare and reserves the quoting driver (plan §33/§36)
- **Matching engine** (`src/lib/matching.ts`) — filters (online, category, capacity, docs, service area) then ranks (distance, ETA, rating, acceptance, experience); **admin can disable auto-dispatch and assign drivers manually** (final brief §19 human-ops path)
- **Payments** (`src/app/api/shipments/[id]/action`) — mock M-PESA STK lifecycle with idempotency keys; server-authoritative status; refund on cancel; **B2C payout ledger**
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

Tests: `python3 scripts/e2e_test.py` (80 checks across the booking lifecycle, payments, matching, POD, pricing edits, promos, multi-stop, scheduling, the quote marketplace, manual dispatch, disputes, saved places, admin tabs and public-tracking privacy). Reseed anytime with `bun run scripts/reseed.ts`.
