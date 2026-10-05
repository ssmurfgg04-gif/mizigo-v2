# MIZIGO v1 → v2 Mining Log

What was merged from the **mizigo-v1** repository (github.com/ssmurfgg04-gif/mizigo-v1,
449 commits: Fastify + PostgreSQL monorepo with Leaflet/OSM/Photon/OSRM zero-key stack)
into **mizigo-v2**, and the lessons that shaped the merge.

## v1's product truth (adopted wholesale)

> Price you can trust. Driver you can verify. Cargo you can track. Delivery you can prove.

v1 positioned Mizigo as **dependable logistics infrastructure, not an Uber clone**:
warm mineral paper, deep ink, hairlines, restrained signal colour, operational voice
("Direct, calm, operational, confident. Avoid startup theatre."). v2 already shares
this DNA (warm paper + ink + signal orange family, mono kickers, honest sandbox labels);
the merge deepened it rather than replacing it.

## Features merged (v1 had them, v2 didn't)

### 1. Return-load marketplace — "Use the empty leg" (v1's flagship)
- v1: drivers publish return capacity; customers reserve backhaul at a discount.
- v2 merge: full marketplace on v2's stack —
  - `ReturnLoad` Prisma model (+ DDL bootstrap for serverless cold start)
  - `GET /api/return-loads` (public deals), `POST /api/return-loads/[id]/book`
    (atomic claim → real Shipment at empty-leg price, publishing driver pre-assigned,
    M-Pesa sandbox or cash), `publish-return-load` / `return-load-cancel` driver actions
  - Customer home **deals rail** (savings badge, honest comparison fare computed from
    the live tariff, not marketing) + one-confirmation booking sheet
  - Driver home **"Sell your return leg"** publisher (landmark picker, 6-hour window,
    own-legs list with withdraw) — drivers earn on the drive home instead of returning empty
  - Admin overview KPI: `Return legs live · −NN%` average discount
  - Seed: 4 realistic legs (canter, 7T, tuktuk, 10T) with honest normal-price comparisons

### 2. Two-sided reputation — drivers rate customers
- v1: ratings table with rater/rated roles; both sides build reliability history.
- v2 merge: driver **Rate customer** stars in the Trips tab (with "You rated this
  customer" state), server rolls the customer's `User.rating` when a driver rates.

### 3. Night surcharge + planned-delivery discount (v1 pricing factors)
- v1: night ×1.12, scheduled −5%, helpers ×700, minimum billable distance.
- v2 merge (DB-driven, admin-editable like everything else in v2):
  - `PricingZone.nightMultiplier` (default 1.12) + `scheduledDiscount` (default 0.05)
  - Fare lines: `Night transport ×1.12` / `Planned delivery discount −…`
  - Quote + shipment + receipt + admin Pricing tab all wired
  - `isNightHour` (19:00–06:00) evaluated against the scheduled time when set

### 4. Reliability score (v1's reputation formula)
- v1: `0.45·completion + 0.35·rating + 0.20·onTime − disputePenalty`.
- v2 merge: `driverReliability()` in matching.ts, now 18% of the dispatch score
  (distance 28%, ETA 16%, rating 16%, acceptance 12%, experience 10%), surfaced in the
  driver Account screen as **Network reliability**.

### 5. Hashed delivery tokens (v1 security lesson)
- v1: recipient delivery links stored only sha256(token); tokens minted on demand.
- v2 merge: `src/lib/tokens.ts` — share tokens are 24 random bytes (base64url),
  only the sha256 is persisted; `/api/track/[token]` hashes incoming lookups;
  `share-link` action mints a fresh link per share (old link invalidates, v1 semantics);
  Share button now uses Web Share API with clipboard fallback.

### 6. Trust copy & voice
- v1's trust trio → desktop shell: `01 Know the price · 02 Know the driver ·
  03 Know the delivery`, plus v1's footer line **"Built for Kenya · Architected for
  East Africa."** (i18n keys for all new copy, en + sw).

## Lessons confirmed (v1 engineering rules → v2 invariants)

- Server state is authoritative; the client never writes price, role or status.
- Money is integer KES; every fare line is explainable ("Show the price breakdown,
  not just a total").
- Kenyan realities: landmark-first addressing (v1's estate/landmark hints live on in
  v2's PLACES catalog), M-Pesa-shaped payments, low cognitive load.
- Honest labelling of simulated integrations (SIMULATED_DEV → v2's sandbox labels).
- Idempotency on client-retryable commands (v2: draftId + checkoutReqId).
- Empty states that say what to do next, never just "No data".

## Verified

- 74/74 e2e checks green on dev (:3000) **and** against the `NETLIFY=1` production
  build (:3100) with a fresh cold-start bootstrap (empty /tmp SQLite → DDL → seed).
- 4 VLM rounds PASS: deals rail + booking sheet, driver publisher + rate-customer,
  admin KPI + desktop trust trio, welcome non-regression + public track (no phone leak).
- `eslint` clean, `tsc --noEmit` clean, production build green.
