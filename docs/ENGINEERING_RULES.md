# MIZIGO — Engineering Rules

Source of truth for implementation discipline. Distilled from the product brief (plan.txt) + design-taste guidance (Leonxlnx/taste-skill v2, studied not copied).

## Non-negotiables

1. **One route** (`src/app/page.tsx`) for all user-visible UI; surfaces switch client-side (`?role=`, `?view=`). API routes live under `src/app/api/`.
2. **Server-authoritative state**: shipment transitions, payments, fares, assignments are validated server-side. The client requests named transitions; it never writes state directly.
3. **No hard-coded marketplace data**: vehicle capacities, fares, zones, categories come from the DB. UI text comes from a copy module (`src/lib/copy.ts`) so Swahili can be added later.
4. **Honest labeling**: mock providers are typed/named `Mock*` and the UI marks demo behavior where it could mislead (payment sheet says "Sandbox"). Never claim production integrations.
5. **Idempotency**: booking creation (client draftId), payment confirm (checkoutRequestId), transitions (expected-state guard).
6. **Chain of custody**: every state transition appends an immutable `ShipmentEvent` with timestamp + geo.
7. **Design locks**: one accent color per screen; one radius system; labels above inputs; icon+text+color for statuses; no purple/neon/gradients; no emoji chrome; no em-dashes in UI copy; touch targets ≥ 44px.
8. **Perf on low-end Android**: no heavy images (SVG map, vector vehicles), polling capped at 2s, minimal re-renders (Zustand selectors).

## File layout

```
src/
  app/
    page.tsx                 — shell: role router + surfaces
    layout.tsx               — fonts, toaster
    api/                     — REST endpoints (thin, call services)
  components/mizigo/         — domain components (customer/driver/admin/shared)
  components/ui/             — shadcn primitives (customized)
  lib/
    db.ts, prisma            — data layer
    state-machine.ts         — shipment transitions (single source)
    pricing.ts               — pricing engine (reads DB)
    matching.ts              — matching engine
    geo.ts                   — Nairobi geo model + routes + projection
    map-provider.ts          — MapService/RoutingService/GeocodingService interfaces + MockMapProvider
    payment-provider.ts      — PaymentProvider interface + MockMpesaProvider (Daraja-shaped)
    copy.ts                  — UI copy keys
    format.ts                — KES / phone / time (Africa/Nairobi) formatting
    types.ts                 — shared DTOs
  store/
    session.ts               — Zustand: role, session, booking draft, UI
```

## API contract (summary)

- `POST /api/auth/otp` (request), `POST /api/auth/verify`
- `GET /api/locations?q=` — place search
- `POST /api/quote` — price a draft (returns per-category fares + recommendation)
- `POST /api/shipments` — create PRICED shipment (idempotent by draftId)
- `POST /api/shipments/[id]/pay` / `pay/confirm` — M-Pesa STK lifecycle
- `POST /api/shipments/[id]/request` — enter MATCHING (matching engine assigns driver)
- `POST /api/shipments/[id]/transition` — named, role-checked transitions
- `POST /api/shipments/[id]/rate`, `/dispute`
- `GET /api/shipments/[id]` — detail + events + simulated live position
- `GET /api/customer/*`, `GET /api/driver/*` — surface screens
- `GET/PUT /api/admin/*` — operations + pricing editors
- `GET /api/track/[token]` — public tracking (no auth, minimal data)

## Data integrity

- SQLite via Prisma; FKs with proper delete behavior; indexes on hot paths (shipment.status, driver.status, event.shipmentId)
- Seed script (`prisma/seed.ts`-equivalent via API `/api/dev/seed` or script) with realistic Kenyan data
- AuditLog rows for admin mutations

## Verification protocol (user-mandated)

10 VLM verification rounds; each round screenshots the running app via agent-browser and checks ≥ 4 features with pixel-level scrutiny; every finding is fixed and re-verified before the next round.
