# MIZIGO — Design System

Feel: calm, fast, trustworthy, precise, Kenyan, professional, operational. **Not** flashy, not "AI startup", not generic SaaS, not an Uber visual clone.

## Color tokens (CSS variables, rebrandable)

| Token | Light | Dark | Use |
|---|---|---|---|
| `--background` | `#F7F6F3` warm paper | `#121316` | Page |
| `--surface` | `#FFFFFF` | `#1A1C20` | Cards, sheets |
| `--surface-2` | `#F1EFEA` | `#22242A` | Nested rows, inputs |
| `--ink` | `#17181C` | `#F4F3F1` | Primary text |
| `--ink-2` | `#5A5C63` | `#A6A8AF` | Secondary text |
| `--ink-3` | `#8B8D94` | `#7A7C83` | Tertiary/placeholder |
| `--line` | `#E4E1DA` | `#2B2D33` | Hairlines, borders |
| `--brand` | `#E8590C` signal orange | `#F2681C` | Prices, active states, links, progress |
| `--brand-deep` | `#C2410C` | `#D95410` | Filled CTA background (AA on white text) |
| `--brand-soft` | `#FCEDE3` | `rgba(232,89,12,.14)` | Selected backgrounds, badges |
| `--success` | `#15803D` | `#4ADE80` | Delivered, verified, online |
| `--warn` | `#B45309` | `#FBBF24` | Attention, delayed |
| `--danger` | `#DC2626` | `#F87171` | Cancelled, disputes, errors |
| `--info` | `#0369A1` | `#7DD3FC` | Informational |

Rules: brand orange is used **sparingly** — primary CTA, price, live/active state, selected option. Primary buttons on light surfaces are charcoal (`--ink`) with white text (Uber-grade contrast); orange fills are reserved for the single most important action per screen. No purple, no neon, no gradients as decoration. One accent, locked per screen.

## Typography — Manrope

| Style | Size/weight | Notes |
|---|---|---|
| Display | 28-32 / 800 | Splash, welcome |
| Page title | 22-24 / 700 | Screen headers |
| Section title | 16-18 / 700 | Card/section headers |
| Body | 14-15 / 500 | Default |
| Supporting | 12-13 / 500 | Meta, labels |
| Price | 24-30 / 800 | Tabular numerals (`font-feature-settings "tnum"`) |
| Button | 15-16 / 700 | Never below 14 |

Body text never below 12px. Numerals tabular in prices/stats/tables.

## Spacing, radius, elevation

- Spacing scale: 4 / 8 / 12 / 16 / 20 / 24 / 32
- Radius: **10px** controls & inputs · **14px** cards · **18px** bottom sheets (top corners) — one system, locked
- Shadows: tinted, never pure black: `0 1px 2px rgba(23,24,28,.06), 0 8px 24px rgba(23,24,28,.08)`
- Hairlines over heavy borders; elevation only where hierarchy demands it

## Components (domain kit)

`PrimaryButton` (h-14, full-width, charcoal), `BrandButton` (orange, one per screen), `SecondaryButton` (outline), `LocationField`, `BottomSheet` (draggable feel, rounded top 18px), `VehicleCard`, `DriverCard`, `PriceBreakdown`, `TripTimeline` (dot states: done ● / active pulsing ● / todo ○), `StatusBadge` (icon+text+color, never color alone), `CargoItemRow`, `CargoCategoryCard`, `PaymentMethodCard`, `RatingStars`, `VehicleAvatar` (SVG vector vehicles), `QuoteCard`, `TripCard`, `EmptyState`, `ErrorState`, `Skeleton`, `Toast`, `OTPInput`, `PhoneInput`, `PhotoTile`, `ProofOfDelivery`, `SupportCard`.

## Status language (icon + text + color, per a11y rule)

- ✓ Delivered / Verified / Paid (success) · ● In transit / Active (brand) · ○ Pending (ink-3) · ⚠ Attention (warn) · ✕ Cancelled (danger)

## Copy voice

Conversational, cargo-first, no logistics jargon: "What are you moving?", "Where should we pick it up?", "What should carry it?", "Roughly how heavy?", "Your delivery is on the way", "Check that the vehicle details match". Numbers as "KES 4,850". Times as "Today · 2:30 PM" (Africa/Nairobi). Phones as "0712 345 678". No em-dashes in UI copy. No emoji in UI chrome (icon library only).

## Map treatment

Stylized vector Nairobi: warm paper base, charcoal major roads with names, soft area fills, brand route line, charcoal vehicle marker with heading, green pickup dot, orange drop-off pin. Map dominates live states (~65% height). Booking forms sit in cards/sheets over/below the map. Clutter-free: ≤ 8 markers on customer maps.

## Motion

Purposeful only: status-change transitions (timeline item activates), driver-found card entrance (subtle slide-up), success check on payment/POD, sheet slide-ins. Spring physics, 200-300ms. No confetti, no parallax, no infinite loops, no fake 3D. `prefers-reduced-motion` respected.

## Responsive & density

- Customer/Driver: 360-430px first-class; presented inside a device frame on desktop with ambient context
- Admin: sidebar + content, ≥1024px first-class, stacks to tablet
- Touch targets ≥ 44px. WCAG AA contrast everywhere. Labels always above inputs; helper below; error below in danger color.

## Empty / loading / error states

Every list has an empty state with one CTA. Live screens poll with skeletons that match final layout. Errors are human ("We couldn't find a vehicle nearby." + actions), never raw codes.
