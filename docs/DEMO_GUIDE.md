# MIZIGO v2 Demo Guide

Welcome to the MIZIGO sandbox — a cargo transportation marketplace for Nairobi. Three surfaces, one network. Open the preview link and use this guide to walk the whole product.

## Fast tour (8 minutes)

### 1. Customer books a delivery (2 min)
1. On the welcome screen tap **Get started**, then the **John K.** demo chip.
2. Home shows "What are you moving?" — tap **Start a delivery** (or pick **Now / Schedule** first on the home card).
3. **Cargo**: pick *Furniture*, tap + Sofa twice, + Chairs, choose *Medium*, add *Fragile* if you like → Continue.
4. **Pickup**: choose *ABC Industrial Area Godown 47* (Saved place "Shop"), tap the **star** to save any place as Home/Work/Shop, scroll down to add pickup instructions.
5. **Destination**: choose *Sarit Centre*, then tap **Add another stop** and add *T-Mall Langata* (each extra stop is KES 250 — watch it appear in the fare).
6. **Vehicle**: the platform recommends a Pickup for your load with a locked price. Expand *Price breakdown* to see the line items (incl. the extra stop).
7. **Review**: choose **Schedule** and a time chip (Today 4:30 PM / Tomorrow 8:00 AM, or any time within 14 days), tap **Add promo code** and enter `MOVE200` (−KES 200 shows instantly) → Continue to M-PESA.
8. **M-PESA**: a sandbox STK prompt appears — enter PIN `1234` → OK.
9. **Matching**: watch the driver get matched, then accept (~5s).
10. **Live tracking**: the vehicle moves on the map, the timeline advances automatically. Tap **Chat** and send a quick message, tap **Get help** for the help centre (call support, message driver, report a problem).
11. Rate Peter 5 stars → receipt → **Download** it.

### 2. Large load? Get driver quotes (90 sec)
1. Start a new delivery with *Construction materials* and a **Very large** load.
2. Choose the **7-Tonne Lorry** on the vehicle step → Review shows **Request driver quotes**.
3. Quotes stream in (sandbox simulation + real drivers). Compare driver rating, trips, vehicle and price → **Select quote** → pay the locked quote price.
4. Switch to the **driver app** as James Mutua's counterpart — with the driver app open on a pickup job you'll find **Potential jobs** under the **Jobs** tab where you can **Quote this job** yourself.

### 3. See it from the driver side (90 sec)
1. Switch to **Drive & earn** → continue as Peter Kamau.
2. Toggle **online**. Watch today's earnings, the demand map ("Where the work is") and your reliability stats.
3. **Jobs**: accept an offer → at pickup use **Cargo differs from the booking?** to report issues to ops, take cargo photos, start the trip; **Stop sequence** shows each stop with **Mark done**; **Message the customer** opens quick-message chat.
4. **Earnings**: 7-day chart, monthly breakdown, payout history. Withdraw to M-PESA.
5. **Account**: vehicle (Toyota Dyna KDA 123X) and **Documents** — licence, registration, insurance, inspection with expiry dates and verification badges.

### 4. Run the operations console (2 min)
1. Switch to **Operations console**.
2. **Dashboard**: KPIs + live network map. While a delivery is active you'll see the vehicle moving.
3. **Bookings**: filter by *Collecting quotes* or *Finding vehicle*, click a row for the full chain-of-custody timeline, driver quotes and **Manual dispatch** (assign any online driver).
4. **Drivers**: click a driver → verify/suspend actions (audit-logged).
5. **Customers**: personal + business accounts with spend and delivery counts.
6. **Pricing**: edit any tariff (zone or vehicle category) → Save → the next customer quote uses the new price instantly.
7. **Payments / Payouts**: C2B payments ledger and B2C payout ledger with commission per trip.
8. **Disputes / Support**: customer cases and the ops exception queue (cargo mismatches, failed matches, payment timeouts).
9. **Promotions**: create promo codes (KES/% , min fare, first-booking, business-only) and pause/resume them.
10. **Settings**: advance-booking window, **auto-dispatch toggle** (off = bookings wait for manual dispatch), quote expiry, support hotline — every change is audited.
11. **Analytics**: revenue by day, vehicle mix, top routes, **top drivers**, cancellation rate.
12. **Audit Log**: every admin mutation recorded.

### 5. Share tracking (30 sec)
During an active delivery, tap **Share** on the tracking screen — a no-login tracking link is copied. Open it in a new tab: the recipient sees driver first name, vehicle, ETA and status — no phones, no private data.

### 6. Business mode + Kiswahili (30 sec)
1. Log in as **ABC Traders** (business chip). Home greets the business, Account shows **Monthly invoices with VAT (16%)**, and receipts show the business name + PIN.
2. In Account, switch **Language** to **Kiswahili** — the booking journey switches to Swahili copy ("Unaleta nini?").

## Demo accounts

| Role | Login | Who |
|---|---|---|
| Customer | 0712 000 001 | John Kariuki (Personal) |
| Business | 0722 000 033 | Zainab Mabuyu · ABC Traders Ltd |
| Driver | 0712 000 002 | Peter Kamau · Toyota Dyna KDA 123X |
| Admin | — | Ops console needs no login in sandbox |

Demo promo codes: `MOVE200` (KES 200 off, min KES 1,000) · `WELCOME500` (first booking only, min KES 1,500) · `BIZ10` (10% for business accounts, min KES 3,000).

## What is real vs mocked (honesty table)

| Capability | Status |
|---|---|
| Database, state machine, pricing, matching, quotes, promos, multi-stop, scheduling, payments logic, POD, ratings, disputes, chat persistence, audit | **Real** (SQLite + server-authoritative APIs) |
| OTP login | Mock — code shown in the app (Sandbox SMS banner) |
| M-PESA payments | Mock Daraja-shaped lifecycle — labeled SANDBOX, no money moves, server-verified + idempotent |
| GPS movement | Simulated along real Nairobi routes, 12× time compression |
| Driver auto-accept / auto-advance | Sandbox convenience, only while the customer tracking screen is open — switch to the driver app to drive manually |
| Quote marketplace simulation | Sandbox drivers auto-quote after a few seconds; real driver quotes come through the driver app at any time |
| Maps | Stylized vector Nairobi (provider-abstracted MapService) |
| WhatsApp / SMS / push notifications | Architecture stubs (NotificationService rows are real in the DB) |

## Try the edge cases

- Cancel while searching (free, auto-refund) vs after driver accepts (fee warning).
- Book with **Cash** to skip M-PESA.
- Enter an invalid promo code (rejected with a clear reason) or `WELCOME500` as a repeat customer (first-booking-only).
- Schedule a delivery >14 days out — rejected (admin-set window).
- As admin, turn **auto-dispatch off** in Settings → new bookings wait in *Finding vehicle* for **Manual dispatch**.
- As a driver, report **Cargo too large** at pickup — watch it land in the admin **Support** queue.
- Check `scripts/e2e_test.py` — 80 automated lifecycle checks.
