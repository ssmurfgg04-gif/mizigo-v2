# MIZIGO — Architecture

Working name: **Mizigo** (Swahili for "loads/cargo"). Branding is tokenized (`BRAND` in design tokens) so the name can change globally.

## Product

A cargo transportation marketplace for Kenya (Nairobi first): customers book tuk-tuks → pickups → canters → lorries to move goods; drivers accept and complete jobs; an operations team watches the network. Positioning: *Move anything. Know where it is. Know what it costs.*

## Surfaces

One Next.js 16 App Router application, one user-visible route (`/`). The three experiences are client-side surfaces switched by `?role=` (customer / driver / admin), plus a no-login public tracking view (`?view=track&token=...`).

- **Customer** — mobile-first (360-430px), map-centric booking, bottom-sheet steps.
- **Driver** — mobile-first, one-handed, action-first.
- **Admin** — desktop-first operations console, high density.

## Stack

| Layer | Choice | Why |
|---|---|---|
| Framework | Next.js 16 App Router, TypeScript | Required by environment; RSC + client islands |
| Styling | Tailwind CSS 4 + design tokens (CSS vars) | Token-level rebranding per brief |
| Components | shadcn/ui (customized — never default state) + custom domain components | Speed + ownership |
| State | Zustand (session/UI/draft booking) + TanStack Query (server state, polling for realtime) | Predictable, minimal |
| DB | Prisma ORM + SQLite | Required by environment; relational model with FKs, indexes |
| Realtime | Polling via TanStack Query `refetchInterval` (2s on live screens) + server-side movement simulation | No external realtime infra; driver/customer/admin views converge on the same DB rows |
| Maps | `MockMapProvider` — stylized SVG Nairobi map (roads, estates, landmarks), lat/lng→SVG projection, route polylines | Provider-abstracted: `MapService`, `RoutingService`, `GeocodingService` interfaces; swap for Google/Mapbox/OSM later |
| Payments | `PaymentProvider` abstraction. `MockMpesaProvider` (Daraja-shaped STK-push lifecycle: initiated → pending → confirm/timeout, server-authoritative, idempotent by checkoutRequestId) | Production would use Safaricom Daraja C2B (STK push) + B2C payouts; never trust the client |
| Icons | lucide-react (project dependency), one family, consistent stroke | Consistency |
| Font | Manrope (next/font, self-hosted by framework) | Brief-approved; not the LLM-default |

## Domain model (Prisma)

`VehicleCategory`, `PricingZone`, `Place` (Nairobi location catalog), `User` (role: CUSTOMER/DRIVER/ADMIN, accountType PERSONAL/BUSINESS), `Driver` (status, metrics, licence), `Vehicle` (registration, docs, verification), `Shipment` (code `MZG-XXXXXX`, state, route, cargo, fares, payment, POD, share token), `ShipmentItem`, `ShipmentEvent` (append-only chain of custody), `Quote`, `PaymentEvent`, `Payout`, `Rating`, `Dispute`, `Notification`, `SupportTicket`, `AuditLog`.

## Shipment state machine (server-validated)

```
DRAFT → PRICED → PAYMENT_PENDING → PAYMENT_CONFIRMED → MATCHING
      → DRIVER_ASSIGNED → DRIVER_EN_ROUTE → DRIVER_ARRIVED
      → LOADING → LOADED → IN_TRANSIT → ARRIVING → DELIVERED
      → POD_CONFIRMED → COMPLETED
Side states: CANCELLED (pre-IN_TRANSIT), EXPIRED, DISPUTED, NO_DRIVERS
```

- Transitions are validated server-side in `src/lib/state-machine.ts`; the client can only request named transitions.
- Every transition appends an immutable `ShipmentEvent` (type, label, geo, timestamp) — the chain of custody.
- Idempotency: transition requests carry the expected current state; payments are keyed by checkoutRequestId.

## Pricing engine (DB-driven, no hard-coded fares)

Zone (Nairobi default) × category: `base + perKm×distance + perMin×duration`, plus `loadingFee` (if assistance requested), `extraStopFee × (stops-1)`, `platformFee`, floor at `minimumFare`. Peak multiplier configurable. All inputs/outputs live in `PricingZone` + `VehicleCategory` rows, editable from Admin → Pricing (no redeploy). Fare breakdown is always shown line-by-line; the quoted fare is **locked** at booking.

## Matching engine (server-side ranking)

Filter: online drivers, correct category, capacity ≥ estimated load, compliance OK, in service area. Rank by: distance to pickup, ETA, rating, acceptance history, completed trips. Best match is offered; offer expires (configurable) → next-best.

## Movement simulation (dev adapter)

Driver GPS along a route is derived server-side from `stateEnteredAt` + route polyline + speed profile, so every polling client (customer map, admin live map, driver nav) sees the same believable movement without background workers. Clearly labeled a dev-mode adapter behind the map service.

## Payments (mock M-Pesa, Daraja-shaped)

`POST /api/shipments/:id/pay` → creates `PaymentEvent` PENDING with checkoutRequestId (idempotent) → client shows "Check your phone" STK sheet → `POST /api/shipments/:id/pay/confirm` (simulated PIN entry) → server marks CONFIRMED and advances state machine. Status is server-authoritative; duplicate confirmations are no-ops. Receipt refs look like Daraja (`QK41S...`).

## Failure handling (first-class)

- Duplicate taps → idempotent booking creation (client draft id) and payments
- Payment timeout → status TIMED_OUT with retry / change method
- No drivers → NO_DRIVERS state with actions (notify me / schedule / request quotes)
- Cancel policies by state (free before driver accepts)
- Offline → cached active shipment in Zustand + "No connection" banner; never fake success
- GPS gaps → "Last location received X min ago" instead of "hasn't moved"

## Security model

- OTP login (mock: code shown in dev), role-scoped API surfaces, server-side validation of every transition
- Public tracking pages expose only: vehicle type, driver first name + rating, route, ETA, status — no phones, no addresses beyond area names
- Audit log for admin actions (pricing edits, suspensions, dispute resolutions)
- No secrets client-side; mock providers are labeled MOCK in code and UI

## Demo accounts (seeded)

- Customer: `customer@mizigo.demo` / phone `0712 000 001` (Personal) and `business@mizigo.demo` (ABC Hardware, Business)
- Driver: `driver@mizigo.demo` — Peter Kamau, Toyota Dyna pickup, verified
- Admin: `admin@mizigo.demo`

Demo data: Kenyan names (Peter Kamau, Amina Wanjiku, Brian Mwangi, Kevin Otieno...), Nairobi places (Westlands, Industrial Area, Gikomba, Karen, JKIA, Donholm, South B, Kangemi, Ruaka...), KES currency, Africa/Nairobi timezone, Kenyan plates (KDA/KDG/KCY...).
