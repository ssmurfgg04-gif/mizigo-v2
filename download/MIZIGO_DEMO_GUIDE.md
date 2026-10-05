# MIZIGO Demo Guide

Welcome to the MIZIGO sandbox — a cargo transportation marketplace for Nairobi. Three surfaces, one network. Open the preview link and use this guide to walk the whole product.

## Fast tour (5 minutes)

### 1. Customer books a delivery (2 min)
1. On the welcome screen tap **Get started**, then the **John K.** demo chip.
2. Home shows "What are you moving?" — tap **Start a delivery**.
3. **Cargo**: pick *Furniture*, tap + Sofa twice, + Chairs, choose *Medium*, add *Fragile* if you like → Continue.
4. **Pickup**: choose *ABC Industrial Area Godown 47* (Saved place "Shop"), scroll down to add pickup instructions.
5. **Destination**: choose *Sarit Centre*.
6. **Vehicle**: the platform recommends a Pickup for your load with a locked price. Expand *Price breakdown* to see the line items.
7. **Review → Pay with M-PESA**: a sandbox STK prompt appears — enter PIN `1234` → OK.
8. **Matching**: watch the driver get matched, then accept (~5s).
9. **Live tracking**: the vehicle moves on the map, the timeline advances automatically (en route → arrived → loading → in transit → arriving → delivered).
10. Rate Peter 5 stars → receipt.

### 2. See it from the driver side (1 min)
1. From the customer Account tab (or welcome screen) switch to **Drive & earn** → continue as Peter Kamau.
2. Toggle **online**. Watch today's earnings, the demand map ("Where the work is") and your reliability stats.
3. **Earnings** tab: 7-day chart, monthly breakdown, payout history. Withdraw to M-PESA.
4. **Account** tab: vehicle (Toyota Dyna KDA 123X) with document verification, licence class.

### 3. Run the operations console (1 min)
1. Switch to **Operations console**.
2. **Dashboard**: KPIs + live network map. While a delivery is active you'll see the vehicle moving.
3. **Bookings**: click any row for the full chain-of-custody timeline.
4. **Drivers**: click a driver → verify/suspend actions (audit-logged).
5. **Pricing**: edit any tariff (zone or vehicle category) → Save → the next customer quote uses the new price instantly. Try it!
6. **Analytics**: revenue by day, vehicle mix, top routes.
7. **Audit Log**: every admin mutation recorded.

### 4. Share tracking (30 sec)
During an active delivery, tap **Share** on the tracking screen — a no-login tracking link is copied. Open it in a new tab: the recipient sees driver first name, vehicle, ETA and status — no phones, no private data.

## Demo accounts

| Role | Login | Who |
|---|---|---|
| Customer | 0712 000 001 | John Kariuki (Personal) |
| Business | 0722 000 033 | Zainab Mabuyu · ABC Traders Ltd |
| Driver | 0712 000 002 | Peter Kamau · Toyota Dyna KDA 123X |
| Admin | — | Ops console needs no login in sandbox |

## What is real vs mocked (honesty table)

| Capability | Status |
|---|---|
| Database, state machine, pricing, matching, payments logic, POD, ratings, disputes, audit | **Real** (SQLite + server-authoritative APIs) |
| OTP login | Mock — code shown in the app (Sandbox SMS banner) |
| M-PESA payments | Mock Daraja-shaped lifecycle — labeled SANDBOX, no money moves, server-verified + idempotent |
| GPS movement | Simulated along real Nairobi routes, 12× time compression |
| Driver auto-accept / auto-advance | Sandbox convenience, only while the customer tracking screen is open — switch to the driver app to drive manually |
| Maps | Stylized vector Nairobi (provider-abstracted MapService) |
| WhatsApp / SMS / push notifications | Architecture stubs (NotificationService rows are real in the DB) |

## Try the edge cases

- Cancel while searching (free, auto-refund) vs after driver accepts (fee warning).
- Book with **Cash** to skip M-PESA.
- As admin, suspend a driver and watch matching skip them.
- Check `scripts/e2e_test.py` — 37 automated lifecycle checks.
