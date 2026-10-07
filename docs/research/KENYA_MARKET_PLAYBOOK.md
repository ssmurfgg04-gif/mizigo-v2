# KENYA MARKET PLAYBOOK — MIZIGO v2

**Task:** 11-c research | **Agent:** research-subagent (kenya) | **Date:** compiled from live web research (searches + page fetches; raw artifacts in `scripts/research/kenya-11c/`)
**Purpose:** Ground MIZIGO's prices, M-Pesa go-live, compliance and driver/user strategy in verifiable 2024–2026 Kenyan market data before real users.
**Confidence labels used throughout:** `[S]` = sourced (URL cited) · `[E]` = estimate/derived (method shown) · `[S-E]` = sourced anchor + derived range.

---

## 0. Quick-reference card (TL;DR)

| Question | Answer | § |
|---|---|---|
| Is MIZIGO pricing right? | Per-km: yes. Minimums for pickup/canter/lorry: 40–60% under market. No boda tier. | 5, 11.1 |
| What commission should we charge? | Keep 15% + KSh 100 — Kenya caps ride-hail at 18%; Bolt/Uber both charge 18% | 2 |
| M-Pesa go-live blockers? | Company docs + Paybill (~KSh 1,800 setup) + **/privacy & /refund pages (missing today)**; code is already production-shaped | 7.2 |
| What must be registered before real users? | Ltd (KSh 10,650) · KRA PIN + eTIMS · Paybill · ODPC (KSh 4,000) · driver/vehicle verification | 8 |
| Driver pay pitch? | ≈KSh 63,000/month is the Bolt average; calibrated MIZIGO pickup work models at ~KSh 200k/month gross — verify with pilot | 9 |
| Web app or native? | Mobile web/PWA now (27.4M users, $0.59/GB); WhatsApp-first share links; native driver app later | 10 |
| Biggest competitor? | WhatsApp groups + phone brokers, not apps — win on upfront pricing, tracking, receipts, disputes | 2.2, 10 |

---

## 1. Executive summary (10 findings)

1. **Bolt is the volume leader, Little the corporate niche, Uber the premium relic.** Bolt marks 10 years in Kenya with 8M+ riders, 170,000+ driver/courier income opportunities and KSh 19B invested [S: africabusinesscommunities.com]. Little leads Kenya's *corporate* ride-hailing with 5,000+ business clients by prioritizing companies over discounts [S: restofworld.org, Jan 2025]. Statista describes Kenya's market as "dominated by Uber and Bolt, with local players struggling" [S: statista.com].
2. **Commission in Kenya is legally capped at 18%.** The state capped ride-hail commissions at 18% in July 2022 [S: nation.africa]; Uber cut Kenya commission from 25%→18% in Oct 2022 after protests [S: restofworld.org]; Bolt Kenya charges 18% today [S: bolt.eu driver guide]. **MIZIGO's 15% + KSh 100 platform fee is a below-cap recruiting weapon.**
3. **Driver unrest is chronic and price-driven.** Bolt raised fares 10% in Aug 2024 after a week-long driver strike [S: eastleighvoice.co.ke]; Little hiked fares 15% the same month [S: kenyanwallstreet.com]; boda riders demanded commission cuts to 15% in 2026 protests [S: Citizen TV via Facebook]; taxi per-km rates were ordered up ~50% under new guidelines (small-engine 1050cc: KSh 22→33/km) [S: technext24.com].
4. **Sendy is dead — a warning, not a moat.** Kenya's best-funded logistics marketplace shut down Aug 2023 and sold assets (~$26.5M raised) [S: techcrunch.com]; a post-mortem KRA VAT ruling demands $635,000 [S: TechCabal]. **Cargo aggregation with thin unit economics killed Sendy; pricing discipline is existential for MIZIGO.**
5. **Lori Systems survives at ~1/60th its peak valuation** — raised $2M at a ~$5M valuation in Apr 2025 (from ~$300M rumors), pivoting to a bank-financed trucking model (8–24% interest) [S: dabafinance.com, techcabal.com]. Its public metrics: 20,000-truck network, 29% backhaul rate [S: lorisystems.com] — return-load economics work.
6. **MIZIGO's per-km rates are close to market; its minimum fares are far below market for canter/lorry.** Canter hire in Nairobi runs KSh 8,000–15,000 for short jobs [S: primetruckservices.com] vs MIZIGO's seeded KSh 2,800 minimum; local trucking benchmark is KSh 225/km one-way [S: Kenya Transporters Association]. Detail in §5–6.
7. **Daraja production is a 1–3 week paperwork exercise, not a coding one** — MIZIGO's scaffold (STK push, 200-always callback, idempotency, EAT timestamps, 12-char AccountReference, stkQuery reconciliation) already matches the published production checklists [S: angaze.co]. The blockers are business-side: registered company, KRA PIN, Paybill (≈KSh 1,800 setup + ≈KSh 100/month), director ID, logo, HTTPS site **with privacy + refund policy pages** (MIZIGO has neither page today).
8. **Regulatory must-dos are cheap and fast except the new courier licence** (2026 proposal: KSh 100,000 minimum platform fee + 0.5% universal-service levy on gross revenue) [S: dawan.africa / businessdailyafrica.com, Jul 2026] — monitor before scaling, not before beta.
9. **Driver economics support the current take-rate.** Bolt's reported average Kenyan driver income is KSh 63,000/month [S: Kenyan Wall Street via LinkedIn]; boda riders gross ~$10/day with ~half going to fuel [S: energyalliance.org]; UNDP puts the sector at ~1M riders earning ~KSh 1B/day ≈ KSh 1,000/rider/day [S: undp.org]. MIZIGO fares at proposed calibration give a pickup driver ~KSh 4,000–5,500/day gross for 5–6 jobs [E, §8].
10. **Mobile-web-first is correct in Kenya; WhatsApp is the real competitor.** Internet penetration 48% (27.4M users) [S: DataReportal 2025 via workonline.africa]; 1GB of data costs $0.59 (vs $2.59 global average) [S: bestbroadbanddeals.co.uk]; WhatsApp reaches ~95–97% of Kenyan internet users [S: askyazi.com, page-one.co.ke]. Cargo hiring today happens in WhatsApp groups + calls; MIZIGO's wedge is exactly what groups can't do: upfront pricing, tracking, receipts, M-Pesa, disputes [S: kweli.co.za pattern analysis].

---

## 2. Ride-hail landscape 2025–2026 (context for pricing + recruiting)

| Player | Kenya position (2024–26) | Commission | Notes for MIZIGO |
|---|---|---|---|
| **Bolt** | Volume leader: 8M+ riders, 170k+ drivers/couriers, KSh 19B invested over 10 yrs; 100M rides milestone [S: africabusinesscommunities.com, itweb.africa] | **18%** [S: bolt.eu] | Weekly payouts; "Early Cashout" instant payout costs **KSh 70** [S: techtrendske.co.ke]; Bolt Connect EV-boda program; top-50 drivers earned avg KSh 1.28M in H1-2025 [S: Kenyan Wall Street] |
| **Uber** | Present but shaken: cut commission 25%→18% (Oct 2022) under pressure [S: restofworld.org]; petitioned the 18% cap [S: gizmodo.com] | 18% [S: restofworld.org] | UberBODA product exists (boda benchmark, §5); Instant Pay up to 6×/day [S: uber.com] |
| **Little (Craft Silicon)** | Kenyan-made; leads corporate segment (5,000+ business clients) [S: restofworld.org, Jan 2025] | 18% cap applies; corporate service reported at ~19% pre-cap [S: cioafrica.co] | Hiked fares 15% Aug 2024 to lift driver pay [S: kenyanwallstreet.com] |
| **inDrive / Yango** | Growing African challengers; inDrive known for offer-your-own-price, Yango super-app push [$150M Africa commitment] [S: techpoint.africa, dealroom.co] | varies / lower commissions as wedge | Price-haggling UX is normalized — MIZIGO's fixed upfront quotes must *explain* why haggling is gone |

**Driver-strike pattern (why it matters):** 2021 switch-offs demanding <15% commissions [S: allafrica.com]; 2022 protests → 18% state cap [S: nation.africa]; Jul 2024 strike → Bolt +10% fares [S: eastleighvoice.co.ke]; 2026 boda protests demanding 15% commission and objecting to fare cuts [S: Citizen TV/nation via Facebook]. **Recruiting copy should lead with "15% + KSh 100, under the 18% cap."**

### 2.1 Why drivers switch platforms (recruiting playbook)

| Driver demand | Evidence | MIZIGO answer |
|---|---|---|
| Commission below 18% | the single loudest demand since 2021 [S: allafrica.com, nation.africa, Citizen TV 2026] | 15% + KSh 100 flat (seed) — say it on the onboarding hero |
| Fare adequacy (not just low commission) | Bolt raised fares 10% and Little 15% in the same month (Aug 2024) *to* raise driver pay [S: eastleighvoice, kenyanwallstreet] | higher minimums for canter/lorry (§11) put MIZIGO per-job pay above day-hire economics |
| Fast, predictable payouts | weekly is the norm; instant is a paid extra (Bolt Early Cashout KSh 70; Uber Instant Pay 6×/day) [S: bolt.eu, techtrendske, uber.com] | weekly payout from day one (manual send-money against `Payout` rows); instant cash-out once B2C is live |
| Return loads / no empty legs | Lori publishes a 29% backhaul rate as a headline metric [S: lorisystems.com] | ReturnLoadPublisher is already built — make "publish your return leg" part of driver onboarding |
| Fare transparency (drivers set own prices when platforms cut) | Kenya Uber drivers famously quote their own off-app fares; inDrive grew on offer-your-price [S: restofworld.org, techpoint.africa] | show drivers the full fare breakdown + net payout on the offer card (teardown P1) |

### 2.2 Cargo competitive matrix (Nairobi)

| Competitor set | Price transparency | Tracking/receipt | Payments | Trust/audit | Weakness MIZIGO exploits |
|---|---|---|---|---|---|
| WhatsApp groups + calls (incumbent) | none — haggle per job [S: kweli.co.za] | none | cash / ad-hoc M-Pesa | none (fraud risk) | noise, stale links, no receipts, no dispute path |
| Truck-hire brokers (Prime, Bamm, afib) | quoted per call [S: primetruckservices] | none | cash/invoice | moderate (physical office) | no instant booking, no small-vehicle tier, day-block pricing |
| Pickit.co.ke | quote-based | partial | mixed | moderate | breadth over depth; no fixed upfront pricing visible |
| Lori (long-haul) | contract/corridor | yes | enterprise | high | not in Nairobi last-mile at all [S: lorisystems] |
| Sendy | — | — | — | — | dead (Aug 2023) — market gap is open [S: techcrunch] |
| **MIZIGO** | **fixed upfront (base+km+min)** | **live track + receipt** | **M-Pesa STK** | **ratings + disputes + audit log** | — |

---

## 3. Cargo / logistics landscape (who MIZIGO actually competes with)

- **Sendy (dead, 2023).** Asset-light aggregator ("Uber for deliveries"); shut down Aug 2023, asset sale, ~$26.5M raised; KRA later ruled it owes $635K VAT [S: techcrunch.com 2023-08-08, TechCabal]. Lesson: marketplace take-rates must clear driver earnings math from day one.
- **Lori Systems (alive, retrenched).** Trucking marketplace for cargo owners ↔ vetted transporters; 20,000-truck network, 29% backhaul rate; claims up to 20% price reduction for shippers and ~2× truck utilization [S: lorisystems.com, Business Insider Africa 2022]. Apr 2025: raised $2M at ~$5M valuation; pivoting to bank-financed trucking (8–24% interest) [S: dabafinance.com, techcabal.com]. Focus is long-haul/corridor — **not Nairobi last-mile, which MIZIGO owns.**
- **Pickit.co.ke (live).** Nairobi moving & delivery marketplace: pickups, cargo vans, canters, trailers, tow trucks, tippers + warehousing + courier + cold chain [S: pickit.co.ke]. Closest analogue to MIZIGO.
- **Traditional truck-hire brokers (live, phone/WhatsApp-driven).** e.g. Prime Truck Services (canter KSh 8–15k short jobs), Bamm Tours (Mitsubishi FH day hire KSh 15,000, 6am–6pm incl. fuel + driver), afib.co.ke light-transport matching [S: primetruckservices.com, bammtours.co.ke, afib.co.ke]. **These per-trip prices are MIZIGO's true competitive set.**
- **WhatsApp groups + Facebook + calls (the real incumbent).** Fast, low-bandwidth, zero learning curve; dominate local/short-haul/backloads; break down at scale — noise, stale links, no audit trail, no payments, no disputes [S: kweli.co.za SADC analysis, Jan 2026; dotsavvy decision framework]. Kenyan cargo tuk-tuks are literally marketed via Facebook groups with WhatsApp numbers [S: facebook.com group posts].

---

## 4. KES price benchmarks — ride-hail anchors

| Benchmark | Value | Source |
|---|---|---|
| uberBODA launch fares (Nairobi) | Base KSh 55 · KSh 14/km · KSh 1/min · min KSh 60 | [S: uber.com blog, Nov 2018] |
| Bolt boda per-km (2026 report on fare adjustments) | "up to KSh 27.37/km in Nairobi"; +KSh 0.47/km uplift | [S: nation.africa via Facebook] |
| Taxi per-km under new guidelines | 1050cc: KSh 22 → 33/km (~+50%) | [S: technext24.com] |
| Courier/food per delivery (rider) | KSh 60–200 per delivery (distance-dependent) | [S: locallistingdealz.com 2026 guide] |
| Posta inland courier | 0–20g KSh 110; up to 100g KSh 340–405 (band table) | [S: posta.co.ke] |

---

## 5. KES price benchmarks — cargo vehicles (THE core table)

Every MIZIGO-facing row shows: **market range [S/E labeled] → current MIZIGO seed → verdict.** Distance assumptions for "typical town job": boda 6 km, tuktuk/pickup/van 10 km, canter 12 km, lorry 15 km [E].

| Vehicle | Market base / minimum (typical job) | Market per-km | Current MIZIGO seed (base / perKm / min) | Verdict |
|---|---|---|---|---|
| **Boda (parcel)** | per job KSh 60–200 [S: locallistingdealz]; structure base 55–100, 14–27/km [S: uber.com 2018, nation 2026] | KSh 14–27 | **MISSING — no boda category** | ADD (see §11.1 calibration) |
| **Tuk-tuk (cargo)** | no published per-km rate found; sits between boda and pickup [E]. Electric-tuk rental from KSh 540/day sets an earnings floor [S: tiktok rental ad, labeled weak] | ~KSh 40–60 [E] | 250 / 55 / 350 | Keep per-km; raise min to ~500 [E] |
| **Van (covered)** | day-hire listings cluster above pickups; covered premium [S-E: pickit/afib catalogs, no public rates] | ~KSh 70–90 [E] | 400 / 75 / 700 | In range; keep |
| **Pickup 1T** | per-trip town job **KSh 2,500–5,000** [S-E: truck-hire brokers & FB market chatter; day-hire incl. fuel+driver KSh 12,000–15,000 [S: instagram fleet ad, bammtours.co.ke]] | ~KSh 250–450 effective per job-km on 10km [E] | 500 / 90 / 900 | **Too low: 10-km quote ≈ KSh 1,580 vs market 2,500–5,000** |
| **Canter 3–5T** | **KSh 8,000–15,000 short distances; KSh 20,000+ longer/heavier** [S: primetruckservices.com]; day-hire FH KSh 15,000 [S: bammtours.co.ke] | ~KSh 200–250 [S-E: KTA 225/km local benchmark] | 1500 / 140 / 2800 | **Far too low: 12-km quote ≈ KSh 3,600 vs market 8,000–15,000** |
| **Lorry 7T** | day-hire KSh 15,000 (Mitsubishi FH, 6am–6pm) [S: bammtours.co.ke]; local trucking KSh 225/km one-way [S: Kenya Transporters Association] | KSh 190–225 [S] | 2800 / 190 / 5200 | per-km right; **minimum too low** (15-km quote ≈ KSh 5,600 vs 15k day-hire) |
| **Lorry 10T** | corridor trucking USD 2.12/km transit / KSh 225/km local one-way [S: KTA]; EAC corridor average USD 1.8/km/container [S: eabc-online.com] | KSh 230–275 [S] | 4200 / 240 / 7800 | per-km right; minimum low |
| **Nairobi–Mombasa (~480 km) reference** | household 1–2BR move KSh 50,000–100,000 [S: kejamove.com]; rail KSh 10,000/tonne [S: Kenya Railways via Instagram, labeled weak]; full-truck corridor math 480 × 225 ≈ KSh 108k [S-E] | KSh 210–275/km [S] | 10T quote ≈ KSh 124,900 (≈260/km) [E] | **Within corridor band — long-haul per-km is calibrated correctly** |

**Global sanity check:** IRU puts road-freight cost at EUR 0.50–2.00/km worldwide [S: iru.org] — Kenyan trucking (KSh 225/km ≈ EUR 1.5) is at the expensive end, driven by fuel [S: KTA].

---

## 6. What this means for MIZIGO pricing (summary)

- **Ladder is right, minimums are wrong.** The zone-based base+perKm+perMin engine and the 6-category ladder mirror the market; but short canter/lorry jobs quote 40–60% below phone-broker prices. Underpricing heavy vehicles guarantees driver rejection of the platform (they can earn more off-WhatsApp).
- **Boda gap is the biggest product miss.** Kenya's parcel volume rides on bodas (uberBODA, Bolt Send, Glovo, ~1M riders [S: undp.org]); MIZIGO has no boda category, so the cheapest tier of customers can't book.
- **Long-haul is fine.** The 10T Nairobi–Mombasa math lands inside the KSh 210–275/km corridor band — no change needed to per-km rates for lorries.
- **Fuel math supports increases.** At EPRA Nairobi prices (Super KSh 214.03/L; Diesel ~KSh 218–223/L across 2026 reviews) [S: epra.go.ke, peopledaily.digital, fuelkenya.com], a canter burns ~KSh 30–38/km loaded [E: 13–16L/100km diesel] — MIZIGO's KSh 140/km canter rate barely covers fuel + driver + vehicle, before commission.

---

## 7. M-Pesa Daraja production reality-check

### 7.1 STK Push flow (validated against MIZIGO's scaffold)
OAuth Basic token (1h life; cache ~50 min) → password = base64(shortcode + passkey + `yyyyMMddHHmmss` **EAT**) → POST `/mpesa/stkpush/v1/processrequest` (`CustomerPayBillOnline`, PartyA/B, CallBackURL, AccountReference, integer Amount) → customer PIN prompt → callback with `ResultCode`, `MpesaReceiptNumber`, `PhoneNumber` → **always respond 200 `{"ResultCode":0,"ResultDesc":"Accepted"}`**. Whole loop 4–8 s [S: angaze.co STK guide]. **MIZIGO's `src/lib/integrations/daraja.ts` implements every one of these correctly** (55-min token cache, EAT timestamp, 12-char AccountReference slice vs the 20-char limit, 5s aborts); `/api/mpesa/callback` is already 200-always + idempotent on duplicate CheckoutRequestIDs [S: angaze.co; verified against repo].

### 7.2 Sandbox → production checklist (what actually gates go-live)

| # | Requirement | Cost / detail | Status for MIZIGO |
|---|---|---|---|
| 1 | Registered business (sole-prop cert or **CR12** for Ltd) + **KRA PIN cert** + director ID + logo (PNG ≥1024×1024) | — | **BLOCKER — owner action** [S: angaze.co] |
| 2 | Live **Paybill** (via Safaricom Business, *not* Daraja) | ≈KSh 1,800 setup + ≈KSh 100/month; Till free monthly but higher per-transaction fees [S: angaze.co] | BLOCKER — owner action; Paybill preferred (structured AccountReference) |
| 3 | Website: HTTPS, no parking page, real product copy, **Privacy Policy linked in footer**, **Refund Policy (mandatory for M-Pesa merchants)** | — | **BLOCKER — MIZIGO has no /privacy, /terms, /refund pages today** [S: angaze.co] |
| 4 | Callback URL public HTTPS, returns 200 on failure paths | Daraja retries 3× then quarantines the app | ✅ already implemented (callback route) |
| 5 | Persist CheckoutRequestID for reconciliation | — | ✅ `PaymentEvent.checkoutReqId` unique |
| 6 | Go-live form in Daraja portal: upload docs, link shortcode, provide business email/phone | Approval **officially 1–3 working days; realistically 3–10 days; 24h if pre-met** [S: angaze.co] | owner action after 1–3 |
| 7 | Swap env: `api.safaricom.co.ke` base URL + production key/secret/passkey/shortcode | 5 DARAJA_* vars, code unchanged | ✅ scaffold is env-driven |
| 8 | First live transaction: KSh 1 self-test, verify receipt + DB mark-paid | save the receipt screenshot | run post-deploy |

### 7.3 B2C payouts (driver cash-outs)
- Daraja B2C ("Bulk Payment") moves money Paybill → driver M-Pesa; products: Business/Salary/Promotion Payment; needs the org's B2C credentials, an **initiator password encrypted with Safaricom's public cert** ("SecurityCredential"), and result/callback URLs [S: github.com safaricom-daraja-django-nextjs B2C docs; angaze.co]. 
- Charges follow Safaricom's published **M-PESA Bulk Payment tariff** (band-based; differs by whether withdrawal cost is borne by business or customer) [S: safaricom.co.ke M-PESA Bulk Payment Tariff form]. Confirm the current band at Paybill onboarding — do not hard-code.
- **Pragmatic path for MIZIGO:** at low volume, pay drivers by manual M-Pesa send-money (weekly, logged against `Payout` rows); switch to API B2C when volume justifies the tariff + reconciliation work. Uber/Bolt norms: weekly payouts standard, instant cash-out as paid feature (Bolt Early Cashout **KSh 70**) [S: techtrendske.co.ke; bolt.eu; uber.com Instant Pay 6×/day].
- Note: Safaricom halved till→wallet merchant transfer charges in Aug 2026 (CBK-led) — fee environment is improving [S: standardmedia.co.ke].

### 7.4 Gotchas checklist (all already handled or flagged in MIZIGO code)
1. **Idempotency** — duplicate callbacks happen; MIZIGO's callback returns 200 + skips duplicates on `checkoutReqId`. 
2. **Timeout reconciliation** — user ignores prompt (ResultCode 1032/1037) or callback lost: cron `reconcilePayments` + `stkQuery` follow-up after 10 min exists; keep it.
3. **Non-200 kills apps** — Safaricom retries 3× then quarantines [S: angaze.co]; MIZIGO always-200 contract is correct.
4. **EAT timestamps** — UTC passwords fail auth; MIZIGO formats EAT.
5. **Amount must be integer**; **AccountReference ≤ 20 chars** (MIZIGO slices 12) [S: angaze.co].
6. **Never collect/store M-Pesa PIN** [S: angaze.co].
7. **Token caching** — 1h life; MIZIGO caches 55 min.
8. Production passkey is **shortcode-specific** — all four credentials must come from the same production app [S: angaze.co].

---

## 8. Regulatory checklist for a Kenyan marketplace

### Must-do BEFORE launch (Beta with real money)
| Item | Cost | Detail | Source |
|---|---|---|---|
| Business registration | Ltd ≈ **KSh 10,650** statutory (name reservation + registration via eCitizen/BRS); sole-prop business name ≈ KSh 950 | Ltd recommended: liability + easier Paybill + CR12 | afrilinkconsultants.com (secondary; eCitizen is official) |
| KRA PIN + **eTIMS onboarding** | free | KRA scrapped the KSh 5M eTIMS exemption — **all businesses** must onboard electronic invoicing, regardless of turnover | fonoa.com (May 2024), kra.go.ke |
| M-Pesa Paybill + Daraja go-live | ≈KSh 1,800 + 100/mo | §7.2 | angaze.co |
| **ODPC data-protection registration** | **KSh 4,000** one-time (micro/small band: 1–50 staff, ≤KSh 5M turnover), renewal KSh 2,000, cert valid 24 months, ~14 days | Exemption only if turnover < KSh 5M **AND** <10 employees — MIZIGO processing payments + driver data will register. Mandatory regardless of size if in a listed sector, sensitive data, or ≥10,000 data subjects. **72-hour breach notification duty.** | naiforge.com (citing ODPC guidance), odpc.go.ke |
| Website legal pages | free | Privacy policy (also a Daraja requirement), refund policy, terms | angaze.co |
| Driver/vehicle verification (marketplace duty of care) | per driver | Verify NTSA licence class (Class A for boda, C/CE classes for trucks), commercial vehicle **annual inspection** (KSh 1,000 + KSh 50 eCitizen fee = **KSh 1,050**; mandatory for commercial vehicles under Traffic (Motor Vehicle Inspection) Rules 2026, effective Jul 1 2026), and motor insurance before activation | monolithafrica.com, kenyalaw.org, msacarmarket.com, senseicollege.co.ke, bolt.eu (boda doc list) |

### Must-do BEFORE scale (post-beta)
| Item | Cost | Detail | Source |
|---|---|---|---|
| **Courier-hailing platform licence** (watch closely) | proposal: **KSh 100,000 min fee + 0.5% universal-service levy on gross revenue** | Government moved in Jul 2026 to licence digital delivery platforms (Uber, Bolt, Glovo, Little named) — will likely capture MIZIGO at scale | dawan.africa, businessdailyafrica.com (Jul 2026) |
| VAT registration | free | mandatory once taxable turnover ≥ **KSh 5M/year** (voluntary below); file monthly via iTax by the 20th | kra.go.ke |
| Motor commercial + goods-in-transit insurance (fleet/partner program) | commercial third-party from ≈ **KSh 7,574/yr** [S: imana.co.ke]; comprehensive is % of vehicle value; **GIT % of load value: confirm with underwriter [E]** | Not a marketplace legal duty if drivers own vehicles, but a partnership product (offer GIT as upsell); marine-cargo insurance is mandatory for importers since 2017 | imana.co.ke, getcoveredkenya.com, hopemediakenya.org |
| Trademark (KIPI), driver contracts, tax structuring of commission income | varies | standard scale-up hygiene | — |

**Sendy's VAT lesson:** KRA's $635K claim against Sendy's remains [S: TechCabal] — treat eTIMS + VAT accrual on platform fees as a live obligation from day one, not a later cleanup.

---

## 9. Driver economics in Nairobi

| Metric | Value | Source/Method |
|---|---|---|
| Boda rider gross income | ~**$10/day** (≈KSh 1,300), ~half spent on fuel | energyalliance.org [S] |
| Boda sector average | ~1M riders earning ~KSh 1B/day ⇒ **~KSh 1,000/rider/day** | UNDP policy brief [S] |
| Asset-financed vs renting | financed riders make **KSh 1,100/day**; renters pay **KSh 300/day** bike rental | Tuko-style YouTube report [S, labeled weak] |
| Bolt driver average (Kenya) | **KSh 63,000/month** (≈2,900/working day) | Bolt-reported, via Kenyan Wall Street/Instagram [S] |
| Bolt top-50 drivers | avg **KSh 1.28M** in H1-2025 | Kenyan Wall Street [S] |
| Delivery riders (food/parcel) | KSh 60–200/delivery; **KSh 1,000–2,500/day** active; KSh 30–60k/month net of costs | locallistingdealz 2026 guide [S-E] |
| Employed HCV drivers | minimum consolidated wage **KSh 40,724/month** (KTA directive) | kenyans.co.ke [S] |
| Fuel (Nairobi, EPRA 2026 reviews) | Super **KSh 214.03/L**; Diesel **KSh 218–223/L** | epra.go.ke [S] |

**Fuel cost per km [E — derived from EPRA prices + typical consumption]:** boda (2.5L/100km) ≈ **KSh 5/km** · petrol car/tuktuk (5–6L/100km) ≈ KSh 11–13/km · pickup diesel (8–10L/100km) ≈ **KSh 18–22/km** · canter (13–16L/100km) ≈ **KSh 29–36/km** · 7–10T lorry (17–22L/100km) ≈ **KSh 38–49/km**.

**MIZIGO payout at proposed calibration [E]:** pickup driver doing 5 town jobs/day at the proposed KSh 2,200 minimum ≈ KSh 11,000 gross/day → ≈ KSh 9,200 after 15% + platform fee → minus ~KSh 600–900 fuel (30–40 job-km) ≈ **KSh 8,300+/day ≈ KSh 200k/month** — far above the Bolt average (KSh 63k) and market day-hire economics. That is the recruiting pitch; verify with 10 pilot drivers before promising.

**What makes drivers join new platforms (synthesis):** (1) lower commission — the #1 strike demand since 2021 [S: allafrica.com, nation.africa]; (2) reliable payouts — weekly is the norm, instant is a paid differentiator (KSh 70) [S: bolt.eu, techtrendske]; (3) return-load economics — Lori's 29% backhaul rate shows empty legs kill margins [S: lorisystems.com] — MIZIGO's ReturnLoadPublisher targets exactly this; (4) fare honesty — drivers defected to "own-price" models (inDrive) when platforms cut fares [S: restofworld.org].

---

## 10. User behavior: mobile web, data cost, WhatsApp

- **Mobile-web/PWA is the right shape for Kenya.** 48% internet penetration, 27.4M users (2025) [S: DataReportal via workonline.africa]; Statista counts ~37M internet users in 2025 (different methodology) [S: statista.com]; mobile money subscriptions 45.36M and growing 7.2% [S: ca.go.ke]. Dotsavvy's Kenya framework: pick PWA "when reach and low friction matter"; pick native apps only for frequent, deep, push-dependent journeys — drivers eventually, customers now [S: dotsavvyafrica.com].
- **Data is cheap by world standards:** 1GB ≈ **$0.59** vs $2.59 global average [S: bestbroadbanddeals.co.uk] — but users are still bundle-conscious; keep the app light (MIZIGO already: offline 18-language i18n, keyless maps, SVG map fallback).
- **WhatsApp is the default business interface:** ~95–97% of Kenyan internet users are on it [S: askyazi.com, page-one.co.ke]. Cargo load-posting groups are the incumbent: instant, personal, low-bandwidth, zero learning curve — but they drown in noise, links go stale, no audit trail, no payments, no dispute path [S: kweli.co.za]. 
- **MIZIGO's positioning vs WhatsApp:** don't fight chat — **use it** (WhatsApp share links for quotes/tracking receipts; the repo already has `shared/share.ts`) and win on what groups can't do: fixed upfront price (anti-haggle copy), tracked delivery, M-Pesa receipt, rating/disputes.

---

## 11. Calibration actions for MIZIGO (research recommendations — no code changed by this agent)

### 11.1 `prisma/seed.ts` — `catDefs` rate changes (the money table)

| Category | Field | Current → Proposed | Rationale (source) |
|---|---|---|---|
| **boda (NEW row, sortOrder 0)** | — | base 60 · perKm 20 · perMin 1 · min 120 · loadingFee 0 · extraStopFee 50 · capacity ~60kg | uberBODA 55/14/1/60 [uber.com] ↔ Bolt boda ≤27.37/km [nation] ↔ KSh 60–200/delivery [locallistingdealz]; mid-point [E] |
| tuktuk | minimumFare | 350 → **500** | clearer separation from new boda tier [E] |
| van | — | keep (400/75/700) | in range [E] |
| pickup | minimumFare · perKmRate | 900 → **2200** · 90 → **110** | market per-trip 2,500–5,000 [brokers]; 10-km quote becomes ~KSh 2,200–2,600 vs today's 1,580 [S-E] |
| canter | minimumFare · perKmRate | 2800 → **6500** · 140 → **200** | market 8,000–15,000 short jobs [primetruckservices]; KTA 225/km local benchmark |
| lorry_7t | minimumFare | 5200 → **9500** (perKm 190 keep or →225) | day-hire 15,000 [bammtours]; KTA 225/km |
| lorry_10t | minimumFare | 7800 → **15000** (perKm 240 keep) | corridor math validated (§5); only the short-job floor was low |

Zone `nairobi` (`seed-zone-nairobi`): **keep** `commissionRate 0.15` (below 18% cap — recruiting lever [nation.africa, bolt.eu]) and `platformFee 100`; keep peak 1.25 / night 1.12 / scheduledDiscount 0.05 (no public source contradicts; label as house policy). Update `basePrice/pricePerKm/minimumPrice` zone mirrors to the pickup row so zone defaults don't contradict categories.

**Worked fares — before vs after [E, computed with the repo fare model: base + perKm×km + perMin×min + platform 100, no peak/night]:**

| Trip | Vehicle | Fare today (seed) | Fare proposed | Market reference |
|---|---|---|---|---|
| 6 km parcel, 20 min | boda | n/a (no category) | 60+120+20+100 = **300** (min 120 not hit) | KSh 60–200/delivery short hops; uberBODA math ≈ 160 [S anchors] |
| 10 km town job, 28 min | pickup | 500+900+84+100 = **1,584** | 700+1,100+84+100 = **1,984** → min **2,200** | 2,500–5,000 per-trip brokers [S-E] |
| 12 km site delivery, 40 min | canter | 1,500+1,680+200+100 = **3,480** | 2,500+2,400+200+100 = **5,200** → min **6,500** | 8,000–15,000 [S: primetruck] |
| 15 km bulk load, 50 min | lorry_7t | 2,800+2,850+350+100 = **6,100** | 4,000+3,375+350+100 = **7,825** → min **9,500** | day-hire 15,000 [S: bammtours] |
| 480 km Nairobi–Mombasa, 600 min | lorry_10t | 4,200+115,200+5,400+100 = **124,900** | unchanged per-km → ≈ **124,300** | corridor 210–275/km ⇒ 101–132k [S: KTA/EABC] |

The pattern: **per-km stays honest, minimums catch the short-job underpricing.** A short canter job at KSh 6,500 still undercuts the broker's 8,000+ while paying the driver ~5,400 net vs ~2,900 today — roughly a 2× recruiting-improvement on the worst jobs.

### 11.1.1 `prisma/schema.prisma` (note, no change required)
Category capacity for boda would be `capacityKg ~60, volumeM3 ~0.15, bodyType "open"` — the existing `VehicleCategory` model already supports the row; only `seed.ts` + recommendation logic change.

### 11.2 `src/lib/pricing.ts`
- `LOAD_SIZES`: no change to tiers; consider renaming "Very large" hint to "Full house or shop · over 1,000 kg · book a canter" to steer to correct vehicle once minimums rise.
- `recommendCategory()`: once boda exists, route `SMALL` + ≤60kg household/retail loads to boda (add boda to the size-fit ladder) — boda becomes the funnel top.
- Fare-line copy: the "Minimum fare applied" line renders `amount: 0`; with the new higher minimums this line becomes common — show the delta (`minimum - subtotal`) so customers see what a short trip actually costs [E, UX].

### 11.3 M-Pesa go-live engineering checklist (mapped to files)
1. **Add `/privacy`, `/terms`, `/refund` pages + footer links** (Daraja appraisal rejects sites without them; refund policy is mandatory for M-Pesa merchants) [S: angaze.co] — `src/app/`, `src/components/mizigo/shared/ui.tsx`.
2. `src/lib/integrations/daraja.ts`: add `b2cPaymentRequest()` (B2C payout: initiator name, encrypted SecurityCredential, command `BusinessPayment`, result/callback URLs) behind the same env-driven inert pattern, for driver cash-outs post-beta [S: Safaricom B2C docs].
3. `src/lib/integrations/index.ts`: document the manual-send-money interim payout flow against the existing `Payout` model (weekly cadence — the Bolt norm [S: bolt.eu]).
4. `/api/cron`: keep `reconcilePayments` at 10 min — matches the timeout-reconciliation gotcha [S: angaze.co].
5. First-deploy runbook: KSh 1 self-test transaction, save receipt, verify `PaymentEvent` row [S: angaze.co].

### 11.4 Copy & positioning actions
1. Driver onboarding hero: **"MIZIGO takes 15% + KSh 100 — under Kenya's 18% app cap. Uber and Bolt take 18%."** (true today per seed + nation.africa/bolt.eu).
2. Customer quote cards: anti-haggle line — **"No calling around, no haggling. This is the price."** — aimed directly at the WhatsApp-group incumbent [S: kweli.co.za dynamics].
3. Keep every share link WhatsApp-first (quote + track receipt) [S: 95–97% penetration].
4. Fare-breakdown "i" on every quote card (already P0 in docs/UBER_BOLT_TEARDOWN.md — reinforced here: price trust is the wedge vs informal hire).
5. Data-cost reassurance microcopy on booking flow: "Works on a light bundle" [E, UX].

### 11.5 Regulatory to-dos for the owner (non-code)
1. Register Ltd (~KSh 10,650) + KRA PIN + eTIMS onboarding (all businesses, no threshold) [S: afrilink, fonoa].
2. Apply for Paybill via Safaricom Business (≈KSh 1,800 + 100/mo); prepare CR12/KRA PIN/director ID/1024×1024 logo [S: angaze.co].
3. Register with ODPC (KSh 4,000; 14 days; 72-hour breach duty) [S: naiforge/ODPC].
4. Pilot with driver vehicles verified: NTSA licence class + commercial inspection (KSh 1,050/yr) + insurance [S: monolithafrica, kenyalaw.org].
5. Track the courier-hailing licence (KSh 100k + 0.5% levy proposal) before scaling marketing spend [S: dawan.africa].

---

## 12. Risks, open questions & validation plan

| # | Risk / open question | Severity | Mitigation / next step |
|---|---|---|---|
| R1 | Rate changes rely partly on broker/UGC listings, not a rate card | Medium | Before hard-launch, mystery-shop 5–10 live quotes (3 brokers, 3 WhatsApp groups, 2 mover companies) per vehicle tier; record in this doc's table |
| R2 | Courier-hailing licence (KSh 100k + 0.5% levy) becomes law & applies to beta | Medium | Track Kenya Gazette / Business Daily; budget line before paid acquisition; engage a compliance consultant if it passes |
| R3 | Daraja appraisal rejects mizigo.netlify.app (third-level domain OK? parking-page heuristics?) | Medium | angaze checklist requires a real product site with policies — netlify subdomain with HTTPS normally passes; if rejected, attach a custom .ke domain (~KSh 1–3k/yr) |
| R4 | B2C payout tariffs + reconciliation not yet scaffolded | Low (post-beta) | Manual weekly send-money against `Payout` rows first; build `b2cPaymentRequest()` when >50 payouts/week |
| R5 | Driver supply at higher customer prices (demand elasticity unknown) | Medium | Run the new rates as an A/B in pricing zones (zone multipliers) for 2 weeks; watch quote→book conversion + driver accept-rate in Ops telemetry |
| R6 | Fuel is EPRA-reviewed monthly — margins move with it | Low | Recheck EPRA prices monthly; the fare engine is DB-driven so no code change needed |
| R7 | WhatsApp incumbents undercut on price (informal, untaxed, uninsured) | Structural | Don't race to the bottom: sell receipts+tracking+disputes (§10) to customers who lose money to no-audit hires; keep an eye on corporate accounts (Little's playbook [S: restofworld]) |
| R8 | 18% cap could be extended/changed; MIZIGO's 15% could be squeezed later | Low | Commission is a DB zone field (`commissionRate`) — adjustable without code |

**Validation plan (2 weeks, pre-launch):**
1. Mystery-shop quotes (R1) → update §5 table → recompute seed numbers.
2. 10-driver pilot: show them the §11.1 worked fares; measure intent-to-join at 15%+KSh100.
3. Daraja sandbox regression: run the existing 147-check e2e suite against sandbox STK with the pay/pay-confirm swap.
4. First live KSh 1 transaction post-appraisal (save receipt per angaze runbook).

---

## 13. Sources (primary links)

- Uber (official): uberBODA Nairobi launch fares — https://www.uber.com (blog, Nov 21 2018)
- Bolt (official): Kenya commission 18% — https://bolt.eu (Driver Guide → Income → commissions); boda requirements — bolt.eu support article 360001842294
- Nation Africa: state caps commissions at 18% — https://www.nation.africa (Jul 7 2022); Bolt boda fare report (2026, via Facebook post)
- Rest of World: Uber Kenya 25%→18% (Aug 30 2024); Little corporate lead (Jan 7 2025) — https://restofworld.org
- Eastleigh Voice: Bolt +10% fares after strike — https://eastleighvoice.co.ke (Aug 26 2024); Kenyan Wall Street: Little +15% fares (Aug 23 2024)
- TechCrunch: Sendy shutdown — https://techcrunch.com/2023/08/08/kenyan-logistics-startup-sendy-shuts-down-embarks-on-asset-sale; TechCabal: Sendy $635K VAT ruling
- Lori Systems: https://www.lorisystems.com (impact metrics); TechCabal/dabafinance: Apr 2025 $2M raise at ~$5M valuation; Business Insider Africa: Google backing (2022)
- Prime Truck Services: canter pricing Nairobi — https://primetruckservices.com/canter-truck-price-nairobi; Bamm Tours truck hire — https://bammtours.co.ke/trucks-for-hire-in-kenya; Pickit — https://www.pickit.co.ke
- Kenya Transporters Association: KSh 225/km local, USD 2.12/km transit (Facebook post, labeled as association statement); EABC: USD 1.8/km corridor — https://eabc-online.com; IRU: EUR 0.50–2.00/km — https://www.iru.org
- Kejamove: Nairobi–Mombasa move pricing — https://kejamove.com; Rapid Route Logistics: local mover bands — https://www.rapidroutelogisticsltd.co.ke; Multicare Movers
- Angazé (engineered M-Pesa go-live + STK guides, primary for §7) — https://www.angaze.co/blog/daraja-sandbox-to-production and /blog/daraja-stk-push
- Safaricom: M-PESA Bulk Payment Tariff form — https://www.safaricom.co.ke; Daraja portal — https://developer.safaricom.co.ke; EPRA pump prices — https://www.epra.go.ke/pump-prices
- KRA: VAT 5M threshold — https://www.kra.go.ke; Fonoa: eTIMS threshold scrapped (May 2024) — https://www.fonoa.com
- NaiForge (citing ODPC guidance): ODPC fees/thresholds — https://naiforge.com; ODPC — https://www.odpc.go.ke
- Kenya Law: Traffic (Motor Vehicle Inspection) Rules 2026 — https://new.kenyalaw.org; Monolith Africa: KSh 1,050 inspection — https://www.monolithafrica.com; Capital FM: Senate annulment of private-vehicle inspections (Jul 2026)
- Dawan Africa / Business Daily: courier-hailing licence proposal KSh 100k + 0.5% levy (Jul 2026)
- UNDP: boda sector policy brief — https://www.undp.org; Energy Alliance: boda $10/day — https://energyalliance.org; Kenyan Wall Street: Bolt averages (KSh 63k/mo, 1.28M top-50)
- DataReportal Digital 2025: Kenya via https://www.workonline.africa; Communications Authority: https://www.ca.go.ke; BestBroadbandDeals: $0.59/GB — https://bestbroadbanddeals.co.uk
- Dotsavvy: app/PWA/WhatsApp decision framework — https://dotsavvyafrica.com; Kweli: WhatsApp load groups — https://www.kweli.co.za; AskYazi/Page-One: WhatsApp 95–97% penetration
- Raw search/fetch artifacts: `scripts/research/kenya-11c/` (41 search files + 21 page captures + this doc's digests)

*All prices are KES unless noted. Items marked [E] are estimates derived from the cited anchors — validate against 5–10 live quotes before hard-launch.*
