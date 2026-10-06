# Uber / Bolt / Uber Freight — UX Teardown for MIZIGO v2

**Task:** 10-A · Research teardown of documented end-to-end flows of Uber (ride-hailing), Bolt (ride-hailing), and Uber Freight (cargo brokerage), distilled into engineering-actionable specs for MIZIGO (Nairobi cargo-mobility marketplace).
**Method:** Dissected first-party documented flows — Uber Help articles, Uber blog/design system (base.uber.com), Bolt support articles + bolt.eu product/safety pages, Uber Freight help/shipper docs + rates guide, Uber Direct (POD reference), Sendy press coverage (Kenya cargo context) — plus reputable third-party documentation where first-party pages are JS-walled (noted in sources). No videos used; all findings come from documented behavior and official copy.
**Date:** compiled from live web research, Oct 2026.

---

## 1. Executive summary

1. **Both Uber and Bolt converge on the same booking grammar:** one screen, destination-first input ("Where to?"), upfront price shown *before* request, tier/category selection presented as a horizontal scroll of cards, and a single confirm CTA. MIZIGO's `BookingFlow` (Location → Cargo → Vehicle → QuoteMarket → Review → Payment) is *more* steps than either; the win is not more steps but denser, price-forward cards at the moment of vehicle choice.
2. **Upfront pricing is the core trust contract.** Uber documents exactly when the price can change (route/drop-off changes, added stops, long delays), always shows a fare breakdown behind an **"i" icon at request time**, and shows a **new mid-trip fare that must be re-confirmed** when the trip is modified. This maps 1:1 onto MIZIGO's locked-quote model + `stopFee`/quote-expiry copy.
3. **The driver-assignment moment is the highest-trust screen in ride-hailing**, and both companies spend it on identity verification: photo, name, rating, plate, make/model, and "arriving in X min." Uber additionally documents PIN verification and tells riders *never* to enter a mismatched vehicle. For cargo this screen must also carry load responsibility (who loads, what's verified).
4. **Share-trip is a safety feature first, a convenience second.** Uber: swipe up → "Send Status", link shows driver first name + vehicle info + live map; up to 5 pre-selected Trusted Contacts auto-notified. Bolt: link works with no app installed, live location, valid for one ride only. MIZIGO's public `track` page is the right skeleton — the pattern to copy is *proactive* share prompts and expiry.
5. **Post-trip is a 3-beat flow: receipt → rating → tip.** Uber: anonymous rating, 30-day window, tips up to 30 days, no fees on tips, compliments. Bolt: tip prompt only appears after a 4–5★ rating, editable for 2 hours. Both separate the money conversation (receipt) from the gratitude conversation (rating/tip).
6. **Cancellation is a designed flow, not an error state.** Uber documents: 2-minute rider grace period after match, driver-side no-show thresholds (2–10 min economy, 5–15 premium), tier-based fee ranges, fee shown *before* you cancel, and automatic waivers (driver >5 min past ETA, no progress, or moving away). Wait-time fees are automatic, start 2 min after arrival (5 min premium), and never stack with cancellation fees.
7. **Driver-side economics are transparent by regulation-of-competition:** Uber offer cards show pickup, drop-off, estimated time/distance and payout *upfront* with a 10–15 s countdown; earnings screens show weekly balance, per-trip breakdown with the exact fare accepted, and cash-out. Bolt's pitch is lower commission + weekly Monday-to-Sunday payout cycle.
8. **Uber Freight/Sendy show the cargo divergences:** instant quotes (14-day price validity window), TONU ("truck order not used") cancellation fees when a carrier is assigned <24 h before pickup, BOL/rate-confirmation/invoice as the payment document set, POD as photo/signature + token ID, and multi-stop LTL. MIZIGO should mirror these *names and semantics* because Kenyan shippers already know them.

---

## 2. Journey map: booking → arrival → receipt (Uber vs Bolt side-by-side)

### Stage 1 — Booking / request

| Aspect | Uber (documented) | Bolt (documented) |
|---|---|---|
| Destination input | "Where to?" box is the app's home; pickup confirmed with two taps; app **auto-suggests a convenient pickup spot**, adjustable by typing or dragging pin "within the gray circle" | Enter destination; **green pin on map** is draggable to correct location accuracy |
| Stops | Extra stops can be added/modified; adding stops can change the fare (see pricing) | "Add extra stops if needed" is part of the primary request flow |
| Price display | **Upfront fare before request** — "calculated based on your estimated route, time, distance as well as real time conditions"; **fare breakdown via "i" icon at request time** (base + per-minute + per-mile + minimum + fees) | **Upfront price estimate once you enter your destination**; "prices vary based on journey distance and ride-type" |
| Tier cards | Ride options (UberX 4 seats, XL 6 seats in SUV/minivan, Comfort, Black…) each with **price + time estimate**; comparison is horizontal carousel | "Select the preferred category" — categories from budget to premium, selected as a step before confirm |
| Schedule vs now | **Uber Reserve**: book **30 minutes to 90 days** ahead; Reserve icon → pickup/destination/date/time; Reserve trips have separate (higher/stated) cancellation terms; drivers see Reserve requests up to a week ahead | **Reserve a ride** icon on home screen; pickup time + location + destination; **30 minutes to 90 days** ahead |
| Confirm | Tap "Request" → matched to nearby driver; if demand shifts price after request, rider must **accept the higher price** (documented "accepting a ride at a higher price" flow) | Confirm your request after category selection |
| Matching copy | "We're matching you…" style interim state; on no-drivers, price-change confirmation screen | "Request in seconds, ride in minutes" positioning |

### Stage 2 — Driver assignment

| Aspect | Uber | Bolt |
|---|---|---|
| Card content | Driver bar with **name, photo, vehicle**; tap to expand: **driver photo, vehicle make, model, license plate**; rating shown on profile | **Driver's face, car make and registration plate** must "match those shown in the app" |
| Arrival copy | "Arriving within 5 minutes" (Uber design-system example — prefers specific time over "arriving soon"); "When they're a few minutes away, wait for them at your pickup location" | Live tracking on map; ETA until pickup |
| Verification nudge | "Check your ride": match plate + make/model + photo; "never get in a car where the vehicle or driver identity doesn't match"; optional **4-digit PIN** pickup verification in some cities | **Pickup codes**: "nobody else can take your trip by mistake" — rider shows/enters code |
| Identity trust | **Verified rider badge** (blue) shown to drivers; drivers see only rider first name, star rating, verified badge, trip details | Drivers submit **real-time selfie** at registration and periodically thereafter |

### Stage 3 — Live tracking & communication

| Aspect | Uber | Bolt |
|---|---|---|
| Map | Driver vehicle marker on route to pickup; route line to pickup; then trip route | Driver moves toward you on map; green pickup pin |
| Share trip | **Swipe up → "Send Status"** → recipients get driver first name + vehicle info + real-time map location; **copy link** at bottom of app; pre-select up to **5 Trusted Contacts** who auto-receive status when you ride | **Share Location / Share Ride Details**: link with make, model, registration number + live location; **no app needed** to view; link **valid for one ride only**; drivers also have trip-sharing (email/SMS/WhatsApp/Messenger) |
| Status states | Documented states: matching → accepted → **arriving now** → on trip → completed (from Uber's own patent/help vocabulary) | Requested → driver assigned → arriving → on ride |
| Chat | Message driver from driver info bar; **suggested/quick responses**; driver side: incoming messages **read aloud (TTS)** while driving + **thumbs-up quick acknowledgment** | **In-app chat** for anonymous pre-pickup contact |
| Calls | **"Free Call"** button (data call); driver side: app **anonymizes both numbers, numbers rotate, can't be saved**; cost ≈ local call | Calls via app with **number masking** ("your number remains hidden"), VoIP routing |

### Stage 4 — Arrival + proof (ride-hailing baseline)

| Aspect | Uber | Bolt |
|---|---|---|
| Arrival | "The driver arrived at 8 PM." (present-tense/past-tense factual copy); payment charged automatically by method (cash/card/Uber Cash by region) | Fare charged to chosen method; cash an option |
| Wait time | **Per-minute wait-time fee starts 2 min after driver arrival** (UberX tier; 5 min for Black); charged automatically, not driver-triggered; airports/venues exempt | Driver waits then may cancel with fee after wait threshold |
| POD equivalent | None needed for passengers; Uber's delivery products require **photo POD / signature / ID scan** (Uber Direct) | None needed for passengers |

### Stage 5 — Post-trip

| Aspect | Uber | Bolt |
|---|---|---|
| Receipt | Itemized receipt: base, time, distance, tolls, booking fee, wait time, surge/premium **listed individually**, promos deducted; **"View Receipt" / "Resend Receipt"**, PDF download, also at riders.uber.com/trips; **updated receipt issued** when post-trip fees apply (e.g., cleaning fee) | Trip summary in app; fare breakdown available |
| Rating | **Anonymous** — "the driver will never see the rating you give"; rate **within 30 days**; driver rating = **average of last 500 trips** | Rate driver 1–5★ after every trip; riders are also rated by drivers (bad behavior → warning + suspension ≥6 months) |
| Tip | Prompt after rating; **tip up to 30 days later**; **no service fee on tips**; tip tied to trip, not name; compliments ("great conversation", "clean car") | **Tip prompt appears only after a 4★ or 5★ rating**; tip selectable **during the ride and for 2 hours after**; changeable/removable in that window; added to total price; cash tips allowed; business payment method → no tip option |
| Safety follow-up | Safety toolkit available during trip; incident reporting post-trip | Incident report can attach **encrypted in-app audio recording** (see safety) |

---

## 3. UI pattern inventory — concrete specs

### 3.1 Destination input
- **Uber:** single "Where to?" hero field; pickup auto-suggested, draggable pin constrained to a **gray circle** around the suggested spot (prevents absurd pickups); two-tap confirm.
- **Bolt:** destination first, then map shows a **green pin** — copy: "check the green pin on the map and move it if needed."
- **MIZIGO mapping:** `LocationStep` should show pickup pin + draggable correction with an explicit accuracy hint, and persist "Saved places" (Uber app feature list includes Saved Places) — MIZIGO already has a `SavedPlace` model.

### 3.2 Vehicle-tier cards
- **Uber ride-selector card anatomy** (documented + corroborated by tier guides): vehicle-type icon/illustration, tier name, **capacity ("4 seats")**, **time estimate ("5 min away")**, **upfront price**, and a selected-state CTA ("Choose UberX"). Recommended tier is visually first/default. Tier list with capacity: UberX (4), UberXL (6, SUV/minivan), Comfort (newer cars), Black (premium), plus variants (Green, Pet, Assist).
- **Bolt category anatomy:** name + short descriptor (budget vs premium), price on selection; "find the perfect ride-type to suit every need."
- **MIZIGO mapping:** `VehicleStep`/`QuoteMarketStep` cards for pickup → lorry → etc. should each carry: icon, name, **capacity in cargo units (e.g., "up to ~600 kg / 3 m³")**, ETA to pickup, and KES upfront price; the recommended category should be pre-badged ("Best for your load").

### 3.3 Upfront pricing + fare breakdown
- **Uber fare-breakdown screen** (behind the "i" at request time): **Base amount · per-minute · per-mile · minimum-fare adjustment · fees/tolls · promos**. Documented HK formula: `booking fee + base + estimated time & distance + toll + wait time − promotions`.
- **When price changes:** (1) significant route/drop-off change, (2) stops added/removed, (3) long unexpected delays → re-priced on default metered rates; **any mid-trip change shows a new fare the rider must confirm** before continuing.
- **Surge semantics:** "trip surge" (multiplier when demand > supply) and "trip premium" ($1–$10 flat on hard routes) — both **listed as separate line items on the receipt**, never hidden in the base.
- **MIZIGO mapping:** MIZIGO's locked quote is stronger than ride-hailing; the copyable pieces are the **"i" info icon on every quote card**, a **line-item fare breakdown sheet**, and an explicit **"what can change this price"** disclosure (stops, waiting, loading help).

### 3.4 Schedule vs now
- **Uber Reserve / Bolt Reserve:** both use a dedicated **calendar/clock icon on the home screen**, pickup time + locations flow, **30 min – 90 days** horizon, and *different cancellation economics* for reserved trips (shown in-app at request time).
- **MIZIGO mapping:** `ReviewStep` schedule toggle should state its fee consequences inline ("Scheduled trips can be cancelled free until 24 h before pickup" — mirrors Uber Freight's 24 h rule, which shippers understand).

### 3.5 Driver-assignment card
- **Uber expanded card:** driver **photo**, **first name**, **rating**, **vehicle make + model + color**, **license plate** (plate rendered prominently — it's the primary verification token), ETA, and contact row (call/message).
- **Copy patterns (from Uber's design system, real strings):** "Meet your driver at the pickup spot." · "Arriving within 5 minutes" (never the vaguer "Arriving soon") · "The driver arrived at 8 PM." · verification CTA: "Check your ride."
- **MIZIGO mapping:** MIZIGO's driver-found card should show photo, name, ★ rating, plate, vehicle model, **"Arriving in ~X min"** (numeric, updated), plus cargo-specific fields: helper/Loading option, and a **POD code pairing state** (see §5).

### 3.6 Map, marker, route, ETA conventions
- Driver marker = **vehicle-shaped icon** (not a pin), oriented to heading, on a route line to pickup; pickup = pin; destination = flag/pin. Traffic coloring on driver-side nav: **yellow = some traffic, red = heavy** (Uber driver app "On-route traffic").
- ETA updates are frequent and *numeric*; ETA regressions trigger fee waivers (Uber cancellation waivers) — i.e., **ETA is contractually meaningful**, not decorative.
- **MIZIGO mapping:** `TrackView` should keep numeric ETAs on both marker and timeline; the public `track` link page should render the same map minimalistically (Bolt: works with no app).

### 3.7 Status timeline states
- Documented Uber trip states (help-center + patent vocabulary): **Matching → Driver assigned → Arriving now → Driver arrived → On trip → Arriving at destination → Completed**, plus exception states (cancelled by rider/driver, no-show).
- Each state change is pushed as a notification; the timeline on-trip is a **vertical stepper of past states + current state + next expected state**.
- **MIZIGO mapping:** MIZIGO's 14-state machine is cargo-richer (QUOTED, cargo checks, POD…); the pattern to copy is the *presentation*: collapsed current-state banner ("Driver is arriving · 4 min") + expandable full timeline with timestamps per `ShipmentEvent`.

### 3.8 Share-trip link
- **Uber:** share CTA appears **after driver accepts** (swipe up → "Send Status"); link recipients see **driver first name + vehicle info + live map location**; "Send Status" also to **pre-selected Trusted Contacts (max 5)** — automatic sharing on request; link copyable.
- **Bolt:** link **requires no app**, carries make/model/registration + live location, and **expires after the ride** (one-ride links protect privacy).
- **MIZIGO mapping:** MIZIGO's `track` share token exists; copy the **prompt timing** (offer share at match + again at pickup), a **"Share trip" persistent button on ActiveTrip**, and **link expiry at delivery + N hours**.

### 3.9 Communication (chat + calling)
- **Uber rider side:** contact row on driver card → **Free Call** (data) or message with **suggested responses**.
- **Uber driver side:** messages **read aloud (TTS)** while driving; reply with **thumbs-up quick-ack**; calls **anonymized both directions, numbers rotate, cannot be saved**, cost ≈ local number.
- **Bolt:** in-app chat used specifically for **pre-pickup coordination** without phone numbers; calls masked so "your number remains hidden."
- **MIZIGO mapping:** MIZIGO already masks numbers in chat; add **quick-reply chips** (Uber pattern; MIZIGO has quick messages per Task 2 — verify they surface on the driver card), and a **call button** that routes through a masked/bridge number or clearly-labeled "dial via app."

### 3.10 Safety center
- **Uber safety toolkit (shield icon, on-trip):** Follow My Ride (share), Trusted Contacts, **emergency SOS that connects local police**, emergency assistance line, report an issue. Safety Center hub pages on web. Rider verification badges (both directions of trust).
- **Bolt safety toolkit:** **Emergency Assist** (discreet alert → Safety Team makes "immediate welfare call"), **Share Location**, **Record Audio** (in-trip only; encrypted on device; 24 h retention; shareable only via incident report; auto-ends with ride; pauses when another app uses the mic), **Ride Check** (detects unexpected/excessively long stops → proactive check-in), **24/7 Support**, **Ride Insurance** (trip injury cover), Trusted Contacts, Women for Women, pickup codes, driver **shift limits**, driver **static-vehicle check** (stationary too long → specialist calls both parties), driver selfie re-verification.
- **MIZIGO mapping:** the cargo-relevant subset is §6 (see P0 table): SOS/panic button, share link, ride-check-style "stopped too long" event, and incident report path.

### 3.11 Cancellation & fees (full documented Uber GB table)
- **Rider grace period:** cancel free within **2 minutes** after driver accepts.
- **Driver no-show threshold:** driver may cancel with fee after waiting **2–10 min (economy tiers: UberX, XL, Share…)** or **5–15 min (premium: Comfort, Black…)**.
- **Fee ranges by tier (GB, illustrative):** Economy £3.68–£11.10 · Premium £6.30–£18.14 · Airport £6.17–£20.26 · Assist/Access £3.15–£7.03.
- **Automatic waivers:** fee waived if the driver is **>5 min past the original ETA**, has **made no progress**, or is **moving away**.
- **Fee is displayed before the rider confirms cancellation.**
- **Wait-time fee:** automatic, **starts 2 min after arrival** (5 min premium), per-minute, excluded at airports; **never stacked** with a cancellation fee.
- **Stop-time fee:** at mid-trip extra stops, per-minute earnings begin after **1 minute**.
- **Bolt:** cancellation fee article documents refunds when e.g. driver refused the rider's payment method; **Bolt Plus** subscription: 4 free cancellations/month.
- **MIZIGO mapping:** MIZIGO has a flat KES 200 cancel fee concept (per R1 notes, partially unimplemented); copy the **structure**: grace window → warning modal showing exact fee + reason picker → waiver rules visible to the customer.

### 3.12 Rating + tipping
- **Uber:** rating prompt appears **after trip completion** (receipt flow); **anonymous**; window **30 days**; tips **up to 30 days**, **0% service fee on tips**, tip attached to trip not identity; **compliments** (chips like "Great conversation", "Clean car") as a lighter-weight alternative to 5★+text.
- **Bolt:** tip prompt is **gated on a 4–5★ rating** (you're only asked to tip when you were satisfied); tip window **2 hours**, editable; cash tips for cash trips; no tips on business profiles.
- **MIZIGO mapping:** `RatingSheet` should chain: ★ rating → (if ≥4★) tip chips → optional compliment chips + free text → done; tips must show "100% goes to your driver."

### 3.13 Receipt
- **Uber receipt anatomy:** itemized lines (base, time, distance, booking/service fee, tolls, wait time, surge/premium separately), promo deductions, total; **"View Receipt" / "Resend Receipt"** actions; **PDF download**; accessible in trip history (app + web); **updated receipt** re-issued when post-trip fees apply.
- **MIZIGO mapping:** `ReceiptFlow` should emit a downloadable/re-sharable receipt (PDF or print-friendly page) with line items incl. M-PESA ref, and any post-trip adjustment (e.g., off-route or waiting) issues an **updated receipt** — a documented Uber behavior that defuses disputes.

### 3.14 Driver offer card (Uber)
- Countdown modal: **10 s standard / 15 s in pilot** ("up to a third longer"), ring/progress timer, **Accept** button vs **X decline** (top-left); auto-expire = re-assigned, and expired "exclusive requests" count against acceptance rate.
- Card data: **pickup location, drop-off destination, estimated time & distance, upfront payout** — "see how much you'll make and where you'll go before accepting."
- Trip receipts now show **the exact fare accepted up front**; pre-trip estimates labeled as estimates.
- **MIZIGO mapping:** `DriverApp` offer cards should show: pickup area, drop-off area, distance/ETA, **cargo summary (size/weight/helpers)**, **net payout in KES**, and a visible countdown; MIZIGO's R1-noted "customer ★ name" render bug belongs on this card.

### 3.15 Driver navigation + traffic (Uber driver app)
- **Auto-navigate** (turn-by-turn starts automatically when trip begins), **Route overview** (pre-trip glance), **Night mode** (auto dark), **Lane guidance**, **On-route traffic** (yellow = some, red = heavy). Third-party nav apps (Google Maps/Waze) allowed for flexibility.
- **MIZIGO mapping:** deep-link the driver's in-trip screen to external nav (Google Maps directions URL with pickup/dropoff coords) — a keyless way to get world-class nav + traffic without a maps SDK commitment (MIZIGO already uses OSRM for routing).

### 3.16 Driver earnings screens (Uber)
- **Earnings tab:** weekly summary + balance, **"See details"** → **list of trips with amounts, tap Trip ID for trip detail**, cash-out options, tax documents; per-trip breakdown (base, surge, tolls…); web mirror at drivers.uber.com. Blog: receipts show **exact upfront fare accepted** to make the take-rate legible.
- **Bolt:** weekly cycle **Monday 00:00 → Sunday 23:59**, then balance statement, payout weekly; positioning: "lower commission than competitors."
- **MIZIGO mapping:** `DriverApp` wallet should follow the **weekly statement + per-trip drill-down + per-trip "fare you accepted"** pattern; commission line shown per trip (Bolt's transparency angle is the differentiator in Nairobi).

---

## 4. What MIZIGO should copy — prioritized

Legend: **P0** = copy before/with next deploy (trust & money correctness). **P1** = next sprint. **P2** = differentiators/polish. Component refs point at MIZIGO's real files (`src/components/mizigo/*`).

| # | Priority | Pattern (source) | MIZIGO implementation spec |
|---|---|---|---|
| 1 | **P0** | **Fee-shown-before-cancel + grace window** (Uber: 2-min grace, fee displayed pre-cancel, waivers) | Cancel modal in `ActiveTrip`/`MatchingStep`: free cancel within 2 min of driver-accept; after that show exact KES fee, waiver rules (driver ETA >5 min late / no progress / moving away → auto-waive), reason picker, and "fee never stacks with waiting fee" rule. Mirror KES 200 (or zone-based) fee with per-tier thresholds like Uber's economy/premium split (pickup vs lorry). |
| 2 | **P0** | **Numeric ETA + "Arriving in X min" copy discipline** (Uber design system: "Arriving within 5 minutes", not "Arriving soon") | `TrackView`/`ActiveTrip` banner: "Your driver is arriving in 4 min" / "Driver arrived at 2:15 PM". Ban vague strings ("soon", "on the way") from states where a number exists. Driver marker = vehicle icon; numeric ETA chip on marker. |
| 3 | **P0** | **Fare breakdown behind "i" on every quote card** (Uber request-time breakdown) | `QuoteMarketStep`: each vehicle-tier card gets an ⓘ affordance opening a sheet: base fare · distance · time/traffic · tolls (if any) · service fee − promo; plus "What can change this price" block (extra stop fee, waiting fee, loading help). Already-locked quote stays locked — this is transparency, not mutability. |
| 4 | **P0** | **Receipt as a re-shareable document** (Uber View/Resend Receipt, PDF, updated receipts for post-trip fees) | `ReceiptFlow`: persistent receipt URL per shipment (auth'd), line items incl. M-PESA code, "Resend receipt" (SMS/email/WhatsApp share), and updated-receipt re-issue if any post-trip adjustment (waiting/stop fee) is applied. |
| 5 | **P0** | **Share-trip prompt at the right moments + expiry** (Uber: prompt after match, Trusted Contacts; Bolt: no-app link, one-ride validity) | On driver-accept and at pickup, `ActiveTrip` surfaces a one-tap "Share tracking" sheet (contacts + copy link); public `track` page stays no-login; token expires at delivery + 12 h; page shows driver first name + vehicle + live location only (Uber's minimal payload). |
| 6 | **P0** | **SOS / panic + incident report** (Bolt Emergency Assist + welfare call; Uber SOS→police) | Safety center (real screen, not toast): big SOS button → calls configured emergency number (admin setting), records `ShipmentEvent` "SAFETY_ALERT", notifies admin Ops tab, then follow-up check-in prompt. Add "Report an issue" post-trip path that can attach photos (and later audio, Bolt-style 24 h encrypted retention). |
| 7 | **P1** | **Tier cards with capacity + ETA + price + recommended** (Uber ride-selector) | `VehicleStep` cards: icon · name · capacity in cargo terms ("~600 kg · 3 m³ · 2 loaders' worth") · "Picks up in ~12 min" · KES price; pre-select recommended tier with "Best for your load" badge (MIZIGO's `recommendation` engine already computes this — surface it). |
| 8 | **P1** | **Chat quick-replies + TTS-style acks** (Uber suggested responses, thumbs-up ack) | `ChatMessage` UI: quick-reply chips both sides ("I've arrived", "Please call me", "Loading now", "Stuck in traffic"); driver side gets 👍 quick-ack button; mask numbers in free text (already partially present). |
| 9 | **P1** | **Tip gated on ≥4★ + 2 h window + 100% to driver** (Bolt tipping) | `RatingSheet`: after ★ selection, if ≥4 → tip chips (KES 50/100/200/custom) + "100% goes to your driver"; editable 2 h; cash trips show "tip in cash" note; business accounts excluded. |
| 10 | **P1** | **Driver offer card: full economics + countdown** (Uber 10–15 s offer; Bolt auto-match) | `DriverApp` new-shipment offer: pickup/drop-off areas, distance, **cargo spec (weight/volume/fragile/helper)**, **net payout KES + commission line**, countdown ring (give cargo more than ride-hailing: 20–30 s), Accept/Decline; log expiry against acceptance metrics. |
| 11 | **P1** | **Weekly earnings statement + per-trip drill-down** (Uber Earnings tab; Bolt Mon–Sun cycle) | Driver wallet: weekly statement card (Mon 00:00–Sun 23:59), trips list with amounts → tap → trip detail incl. **"fare you accepted"** vs final (any adjustment reasons), payout status, cash-out (M-PESA). |
| 12 | **P1** | **Pickup/POD code verification** (Bolt pickup codes; Uber 4-digit PIN) | MIZIGO has a POD code concept (R1 flagged it decorative): make it *blocking* — driver cannot mark LOADED until customer shows/enters 4-digit code (or scans QR); chain-of-custody event records code match. Cargo analog at delivery: receiver code from recipient phone. |
| 13 | **P1** | **Schedule-vs-now with 24 h free-cancel rule** (Uber/Bolt Reserve 30 min–90 days; Uber Freight 24 h TONU) | `ReviewStep` schedule mode: date/time picker, note "Free cancellation until 24 h before pickup; after that a driver may already be committed (fee applies)" — imports shipper-familiar TONU semantics into city cargo. |
| 14 | **P1** | **Stopped-too-long detection (Ride Check analog)** | If vehicle stationary > threshold in-transit (configurable, e.g., 20 min outside known stops), fire check-in notification to customer + driver ("Is everything okay?") and log event; ops sees it as an exception row. MIZIGO's GPS simulation + `ShipmentEvent` already support this. |
| 15 | **P2** | **Compliments chips** (Uber driver compliments) | `RatingSheet`: after ≥4★, chips like "Careful with goods" · "Helped with loading" · "Great communication" → stored on driver profile, surfaced on driver-found card ("Frequently praised: careful with goods"). |
| 16 | **P2** | **Night mode + lane/traffic hints on driver nav** (Uber nav features) | Driver in-trip screen: dark theme after 18:30; traffic-colored route (OSRM/MapLibre already available); **deep-link "Navigate in Google Maps"** button as the P0-grade shortcut. |
| 17 | **P2** | **Verified-badge trust system** (Uber verified rider badge; Bolt selfie re-verification) | Customer OTP-verified badge shown to drivers; drivers periodically re-verify selfie (photo upload path exists in admin); badge displayed on offer cards and driver-found cards both directions. |
| 18 | **P2** | **Price-tracking / quote-validity notifications** (Uber Freight: 14-day quotes, lane price tracking emails) | QuoteMarket: "Lock this price for 7 days" on scheduled jobs; optional email/SMS when a frequently-used lane's price drops (MIZIGO `PricingZone` model makes this a query). |

---

## 5. Where cargo diverges from ride-hailing — and what Uber Freight / Sendy do

1. **POD (proof of delivery) replaces "arriving at destination."**
   - *Uber Direct (delivery product, documented):* POD = **required photo or signature at drop-off**; the captured artifact plus the **delivery token ID** forms the POD file, retrievable via dashboard and API; ID verification for age-restricted; "leave at door" photo confirmation; returns policy when customer absent.
   - *Uber Freight:* the document set is **rate confirmation + signed Bill of Lading (BOL) + invoice** — without the signed BOL, carriers can't collect payment (documented by freight-payment intermediaries); Uber Freight operates as a **licensed freight broker, not a motor carrier** (their own footer).
   - **MIZIGO spec:** keep the chain-of-custody events; make the **final POD capture mandatory** (photo of goods at drop-off + receiver signature/name or 4-digit code) before DELIVERED can fire; expose POD on the receipt page ("POD attached") and admin Ops; that is exactly Uber Direct's pattern and what B2B cargo customers in Nairobi will ask for.

2. **Cargo verification at pickup ≠ passenger identity check.**
   - Ride-hailing verifies *person in the vehicle*; cargo must verify *goods into the vehicle*: item count, weight/volume vs booked tier, fragile flag, photos at loading. Uber Freight shows **upfront load and facility details** on carrier offer cards (documented in their app-store listing) so drivers can self-select.
   - **MIZIGO spec:** `CargoStep` summary + photos become part of the driver offer card and the LOADED event (MIZIGO's shipment-items model supports this); a "load mismatch" path (items > booked capacity → re-quote flow, Uber's mid-trip fare-change-with-confirm pattern).

3. **Loading/waiting economics are cargo-native.**
   - Uber has **wait-time fees** (2-min grace, per-minute) and **stop-time fees** (1 min at extra stops); Uber Freight has **accessorials**: detention, TONU, layover — separately priced, shown in the rate confirmation.
   - **MIZIGO spec:** rename/structure MIZIGO's stop fee in industry vocabulary: **"Loading/unloading allowance: 30 min free, then KES X per 15 min"** (a detention analog); **helpers/loading assistance** as an explicit per-job add-on priced in the quote (ride-hailing has no analog; freight accessorials do).

4. **Cancellation is asymmetric in freight.**
   - Uber Freight shipper rule: cancel **free >24 h before pickup**; **within 24 h with a carrier assigned → TONU fee** ("truck order not used"). Ride-hailing's 2-minute grace is meaningless when a truck has dead-headed across town.
   - **MIZIGO spec:** time-scaled grace: free within minutes of match (driver still nearby), then standard fee, then **TONU-style commitment fee inside the 24 h window for scheduled jobs**; always display the fee before confirming (Uber rule) and auto-waive on driver-fault conditions (Uber rule).

5. **Pricing granularity.**
   - Uber Freight quotes are **instant, per-lane, equipment-specific (dry van/reefer/flatbed)**, valid for a window (quick-quote gives "quotes for the next 14 days"), spot vs contract distinction; rates driven by distance, weight/volume, fuel, seasonality.
   - **Sendy (Kenya):** positions as a platform connecting customers to **transporters of all vehicle sizes** app+web, from last-mile to Mombasa–ICD long-haul and cross-border (Rwanda, Tanzania, Uganda, DRC, Zambia, Sudan) — validation that "choose your vehicle class, get matched" is the accepted Kenyan cargo UX.
   - **MIZIGO spec:** keep zone + volume + tier pricing, but expose **quote validity ("price locked for X min/hours")** and consider an optional **return-load deal** pairing (already built: `ReturnLoadDeals`) — the freight-native answer to Uber's back-to-back loads for carriers.

6. **Vehicle tiers are capacity tiers, not comfort tiers.**
   - UberX→Black is comfort/price; cargo tiers are dimensional (what fits). Cards must lead with **capacity (kg/m³), loading style (open bed vs closed van), helpers** — MIZIGO's `VehicleCategory` model already encodes this; the *copy* should be dimensional-first, comfort-second ("Picks up in ~12 min · 600 kg · open bed · driver + 1 helper").

---

## 6. Copy pattern reference (steal these rules)

From Uber's own design-system writing guide (base.uber.com "Writing for users") — directly reusable as MIZIGO copy lint rules:

- **Sentence case everywhere**; contractions; second person ("you/your"); present tense ("Taco Heaven opens at 4 PM", not "will open").
- **Specific over vague:** "Arriving within 5 minutes" ✅ / "Arriving soon" ❌ · "Meet your driver at the pickup spot" ✅ / "Meet driver at pickup spot" ❌.
- **Goal-first framing:** "To arrive on time, request a ride within 15 minutes" ✅ / "Request a ride within 15 min to arrive on time" ❌.
- **Blame the thing, not the user:** "This card was declined by your bank" ✅ / "The issuing bank declined your card" ❌ (user-first phrasing); "Your account needs attention" ✅ / "Something's wrong with your account" ❌.
- **No editorializing:** ban "easy", "great", "simple", "helpful" ("Get started with Uber" ✅ / "It's easy to drive with Uber" ❌).
- **No directional words** ("Tap Accept" ✅ / "Tap the button below" ❌); avoid naming UI chrome.
- **Dynamic content discipline:** insert names/times where truncation is least likely ("[FIRSTNAME], take a quick selfie" only when name <6 chars).
- **Buttons are verb-first, article-free** ("Take a photo" ✅ / "Take photo" ❌ shows articles matter in sentences, not buttons).

---

## 7. Sources

**Uber — first-party**
- Uber Help (rider): Sharing your trip status FAQ — https://help.uber.com/riders/article/sharing-eta-and-trip-status?nodeId=e1f8ed2b-c0e5-45c6-9c73-552cf11c5581
- Uber Help (rider, HK locale): Contact a driver — https://help.uber.com/en/riders/article/contact-a-driver?nodeId=0e0bbf4e-2a95-42b6-9bc2-2566e8bd98dc
- Uber Help (rider, HK): How are fares calculated — https://help.uber.com/riders/article/how-is-the-price-of-a-trip-determined?nodeId=d2d43bbc-f4bb-4882-b8bb-4bd8acf03a9d
- Uber Help (rider, HK): What's included in your rider price — https://help.uber.com/en/riders/article/whats-included-in-your-rider-price?nodeId=d6587e64-42d0-40af-8cea-78840cf55b3e
- Uber Help (driver): Contacting your rider (masked numbers, TTS, thumbs-up) — https://help.uber.com/en/driving-and-delivering/article/contacting-your-rider?nodeId=08f102cf-2262-42f3-b3cc-9cb62cfde2c7
- Uber Help (driver): Driver app navigation features — https://help.uber.com/driving-and-delivering/article/uber-driver-app-navigation-features?nodeId=357c291a-9b6e-45e9-9614-aea820f089ce
- Uber Help (driver): Using a third-party navigation app — https://help.uber.com/en/driving-and-delivering/article/using-a-third-party-navigation-app?nodeId=36a70c53-4bb0-4e17-a044-d91c2d1ff080
- Uber Help (rider): Wait time fees — https://help.uber.com/en/riders/article/wait-time-fees?nodeId=22b6db22-0f86-4765-ac72-da549a2302d7 and https://help.uber.com/riders/article/wait-time-fees-and-refunds?nodeId=469f1786-1543-4c83-abbf-ddccb7826fc2
- Uber Help (freight shipper): Using Uber Freight Shipping (cancel/TONU/LTL/notifications) — https://help.uber.com/en/freight/shipper/article/using-uber-freight-shipping?nodeId=9121b6ef-79e8-4340-b3e4-0b6bbaa213c5
- Uber Help (merchants/Direct): What kinds of features does Uber Direct offer (POD: signature/photo/ID/token ID) — https://help.uber.com/merchants-and-restaurants/article/what-kinds-of-features-does-uber-direct-offer?nodeId=55f8c973-11df-47f6-84f5-1c5dc9874267
- Uber blog (GB): Understanding Your Upfront Fare (fare-change rules, cancellation table, wait/cleaning fees) — https://www.uber.com/gb/en/blog/understanding-your-upfront-fare-when-it-can-change-and-what-extra-fees-may-apply
- Uber blog (US): Upfront fares — https://www.uber.com/us/en/blog/upfront-fares
- Uber blog: Extra pay for extra time (stop-time fees) — https://www.uber.com/us/en/blog/extra-pay-for-extra-time
- Uber.com: A guide for how to use Uber (booking → verify → rate) — https://www.uber.com/us/en/ride/how-it-works/
- Uber.com: In-app tips — https://www.uber.com/us/en/ride/how-it-works/tips
- Uber.com: Rider verification (verified badge) — https://www.uber.com/us/en/safety/rider-verification
- Uber design system: Writing for users (copy rules + real strings incl. "Arriving within 5 minutes") — https://base.uber.com/6d2425e9f/p/03856f-writing-for-users
- Uber Reserve (help, US) — https://help.uber.com/en/riders/article/using-uber-reserve?nodeId=71708d67-bbac-4dda-9d32-53c2509bdd1b
- Uber trip status states vocabulary (patent filing) — https://patentimages.storage.googleapis.com (UBER TECHNOLOGIES, transport arrangement interface, 2018)

**Uber — well-corroborated third-party (used where help center is login-walled)**
- The Rideshare Guy: Uber extends offer-acceptance time (10 s → 15 s pilot; offer card contents) — https://therideshareguy.com/uber-extends-offer-acceptance-time-ping-for-drivers/
- Ridester: How to rate an Uber driver — https://www.ridester.com/how-to-rate-an-uber-driver/
- Ridesharing Driver: Uber ride types & seat capacities — https://www.ridesharingdriver.com
- KREM (CBS): Uber 4-digit PIN verification rollout — https://www.krem.com
- WBAL-TV / Gizmodo (2022): Uber safety toolkit redesign, Trusted Contacts — https://www.wbaltv.com, https://gizmodo.com
- Uber newsroom (2019): Safety toolkit / Trusted Contacts — via uber.com

**Uber Freight**
- Uber Freight rates guide 2025 (spot vs contract, per-mile benchmarks, rate factors, instant quote tool) — https://www.uberfreight.com/en-US/blog/freight-trucking-rates-guide
- Uber Freight shipper platform / quick quote (14-day quotes) — https://www.uberfreight.com (product pages; footer: "licensed freight broker, not a motor carrier")
- Uber Freight carrier app (app-store listing: instant booking, upfront pricing + facility details) — https://play.google.com/store/apps/details?id=com.ubercab.freight
- Carrier booking flow (search by trailer type, Book Load, back-to-back) — Uber Help freight/carrier articles via help.uber.com
- BOL/rate-confirmation/invoice payment-document set — https://transportationrecovery.com (freight payment recovery documentation)

**Bolt — first-party**
- Bolt Support: How to order a ride (green pin, stops, category) — https://bolt.eu/en/support/articles/115002296213
- Bolt Support: Reserving a ride (30 min–90 days) — https://bolt.eu/en/support/articles/7392556548114
- Bolt Support: How to tip my driver (4–5★ gating, 2-hour window) — https://bolt.eu/en/support/articles/360014247060
- Bolt: Ride with Bolt (upfront estimate, schedule 90 days, safety features incl. pickup codes, Ride Check, number privacy) — https://bolt.eu/en/rides/
- Bolt: Safety features for Bolt rides (Emergency Assist, Share Location, Trusted Contacts, Ride Check, Ride Insurance, selfie verification, shift limits) — https://bolt.eu/en/rides/safety
- Bolt blog: Trip-sharing functionality for drivers (one-ride links, no app needed, static vehicle checks, SOS, in-app chat) — https://bolt.eu/en/blog/trip-sharing-functionality-launched-for-bolt-drivers
- Bolt blog: Audio trip recording (in-trip only, encrypted, 24 h on-device, incident-report sharing) — https://bolt.eu/en/blog/audio-trip-recording-feature
- Bolt: Become a driver (accept → in-app navigation → drive; Mon–Sun weekly payout) — https://bolt.eu/en/driver/
- Bolt Plus: free cancellations — via bolt.eu search snippet

**Sendy (Kenya cargo context)**
- TechWeez: Sendy launches freight services (Mombasa–ICD, cross-border East Africa) — https://techweez.com/2019/08/28/sendy-freight-services/
- Sendy positioning (all vehicle sizes, app+web) — https://www.vestedworld.com / https://www.startupguide.com/blog/sendy (partial fetch failures noted)

**Notes on unreachable sources:** help.uber.com article pages for cancellation fees, ratings, receipts and the driver trip-request flow are login-walled/JS-rendered and returned 404 shells to fetches (several URLs 404 outright); their content was reconstructed from the official snippets surfaced in web search plus corroborating third-party documentation, as marked above. bolt.eu driver-guide subpages (ratings, auto-accept) 404'd; Bolt driver-offer specifics beyond the official "accept a ride request → in-app navigation → drive" flow remain thin and are flagged as such (no invented details).

---

*End of teardown. Compiled for MIZIGO v2 (mizigo.netlify.app) — component references valid against `src/components/mizigo/{customer,driver,shared}` as of this task.*
