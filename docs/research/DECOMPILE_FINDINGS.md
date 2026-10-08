# DECOMPILE_FINDINGS.md — What the real Bolt & Uber Android binaries actually do

Task ID: 15-a · RE research subagent · 2026-10-08

> **Legal / clean-room statement.** This document is the result of studying lawfully
> obtained, publicly distributed APK files for interoperability-research and
> educational purposes. **No code, assets, icons, fonts, or string tables were
> copied into mizigo.** All findings below are paraphrased observations about
> *patterns*. Short UI microcopy (button labels, one-line status texts) is quoted
> occasionally and explicitly labelled "tone reference" — tone only, never pasted
> into our product. Nothing from this research goes into git except this document
> (APKs and decompiled output live in `research-apk/`, which is gitignored, line 88
> of `.gitignore`). Cross-reference: `UBER_BOLT_ARCHITECTURE.md` (public-source
> architecture), `SAFETY_TECH_TEARDOWN.md` (public-source safety), this file
> (binary evidence).

---

## 1. Methodology

### 1.1 Tooling

| Step | Tool | Result |
|---|---|---|
| Decompiler | **jadx 1.5.0** (zip from `github.com/skylot/jadx/releases/download/v1.5.0/jadx-1.5.0.zip`) | works |
| GitHub API for release lookup | `api.github.com` | **rate-limited** (worked around with the direct release-asset URL) |
| Maven Central mirror | `repo1.maven.org/maven2/io/github/skylot/jadx/cli/` | 404 on that path (the group listing exists but the task setup's URL was wrong); not needed after GitHub worked |
| Raw view | `unzip` + `strings` on `classes*.dex` | used heavily — package inventories and constant extraction without decompiling |

**Sandbox constraint & workaround (worth remembering):** the box has ~3 GB RAM
(~2.1 GB usable; the mizigo dev server holds ~1.3 GB). Full-APK jadx runs were
OOM-killed (exit 137) even for a resources-only pass. Three techniques that work:

1. **Resources-only re-zip:** extract only `AndroidManifest.xml`,
   `resources.arsc`, `res/*`, `assets/*` from the APK, re-zip that (~6–28 MB),
   run `jadx --no-src` on it. Fast, tiny, gets decoded manifest + all
   strings/colors/dimens/layouts.
2. **Per-dex source decompile:** extract individual `classes*.dex`, run
   `jadx --no-res -j 1` with `JAVA_OPTS="-Xmx750m"` per dex. Counterintuitively
   *smaller* heap survives better than 1 GB+ (GC stays ahead of the OOM killer).
   ~6–8 min per ~8 MB dex.
3. **Dex `strings` scanning:** `strings classes*.dex | grep` gives package
   inventories, framework markers, header names, and URL surfaces for free.
   This alone answered most architecture questions.

### 1.2 Apps obtained (all four targets acquired)

| App | Package | Version (code) | min/target SDK | Source | Format |
|---|---|---|---|---|---|
| Uber Driver | `com.ubercab.driver` | **4.599.10004** (313038) | 29 / 36 | apkcombo.com | XAPK (base + arm64 + xxxhdpi + BarcodeScanner split) |
| Bolt Rider | `ee.mtakso.client` | **CA.228.0** (4370) | 24 / 36 | apkcombo.com | XAPK (base + 21 language splits + `face_dynamic` + `voip_ui` DFMs) |
| Bolt Driver | `ee.mtakso.driver` | **DA.151.0** (900) | 26 / 36 | apkcombo.com | XAPK (base + abi/density splits) |
| Uber Rider | `com.ubercab` | **4.651.10003** (316108) | 29 / 36 | apkcombo.com | XAPK (base + 60+ language splits + 11 dynamic-feature modules) |

**Mirror report:** apkcombo.com worked every time (its `/download/apk` pages
redirect through signed Cloudflare-R2 links — pass a desktop User-Agent and the
Referer). apkpure.com and apkpure.net are Cloudflare-challenge-walled from this
sandbox. apksum.com was reachable but unneeded. GitHub release *downloads* work
even when the *API* is rate-limited. XAPK is just a zip containing the base APK
plus splits; unzip it and analyze the base APK.

### 1.3 Readability difference (shapes the whole doc)

- **Bolt apps are NOT obfuscated** at class level. Class names like
  `PreOrderFlowRibInteractor`, `IncomingOrderActivity`, screens packages with
  `earnings/v3/breakdown` are all readable → real flow reconstruction below.
- **Uber apps ARE ProGuarded** (single-letter classes) *but package names and
  RIB component names survive*, string resources are huge, and they ship an
  explicit UI-state registry (below). So Uber findings lean on manifest +
  resources + assets + package inventories.

---

## 2. Uber Driver 4.599.10004 — deep findings

### 2.1 Manifest & platform facts

- Launcher/main activity: `com.ubercab.carbon.core.CarbonActivity` — **"Carbon"
  is the driver app's shell codename**; most driver-app strings are prefixed
  `carbon_*`, and the whole framework package is `com.ubercab.carbon.*`
  (plus `presidio_*` — Presidio is the legacy driver-app codename, still the
  largest package family, and `beacon_*` is the driver UI toolkit).
- 47 permissions. Notable: `FOREGROUND_SERVICE_{CAMERA,MICROPHONE,LOCATION,
  MEDIA_PROJECTION,DATA_SYNC}`, `DETECT_SCREEN_CAPTURE` (screenshot detection
  for privacy), `USE_BIOMETRIC`, `SYSTEM_ALERT_WINDOW`, `NFC`,
  `REQUEST_IGNORE_BATTERY_OPTIMIZATIONS`, Android-Auto navigation templates.
- **Foreground services** (all driver tracking/AV flows declare them):
  - WorkManager `SystemForegroundService` typed `microphone|camera|location|dataSync`
  - `com.ubercab.voip.v2.service.VoipKeepAliveService` (microphone)
  - **`io.livekit.android...ScreenCaptureService`** (mediaProjection) — driver
    support video calls run on **LiveKit** (open-source WebRTC stack)
  - `com.ubercab.meter_ota.MeterDfuService` — OTA firmware updates for external
    taxi meters (they support physical meter hardware!)
  - `com.uber.carbon_auto.core.CarbonCarAppService` — the whole driver app
    runs in **Android Auto**
  - `com.ubercab.push.UberFirebaseMessagingService` (FCM)
- **Deep links:** `uberdriver://` scheme + https hosts `partners.uber.com`,
  `accounts.uber.com`, `auth3.uber.com` (SSO), `www.ubereats.com`,
  `payment-providers.uber.com`, plus `upi://pay` (India), `otpauth`, `tel`,
  `smsto`, `geo`. Credential sharing (`asset_statements`) is declared with the
  rider app, driver-internal, and "uberlite" builds.
- **QA/design infrastructure shipped in production:** `DragonCrawlActivity`
  (their screenshot-crawl test bot), `CarbonStyleGuideActivity`,
  `StyleGuideLauncherActivityV2`, `ComposeStyleGuideActivity` — the design
  system's living style guide is a first-class screen in prod.
- Home-screen **Quest app widgets** (`quest_app_widget_provider` + v2) —
  promotions live on the launcher, not just in-app.

### 2.2 Architecture (binary evidence)

Framework markers found in dex strings (counts of references):

- **RIBs** (`com.uber.rib.core.*`: ViewRouter, RibletViewProvider, lifecycle)
  — Uber's own business-logic-tree framework, heavily used. Class-evidence
  includes `com.ubercab.ui.*` (their RIBs UI layer).
- **gRPC** (`io.grpc.internal.RetriableStream`, `Metadata`) + **protobuf**
  (`GeneratedMessageLite`) — driver↔backend is gRPC/protobuf, not REST.
- **Jetpack Compose** in meaningful volume (Arrangement/Modifier/Composer refs)
  — the app is mid-migration to Compose on top of RIBs.
- **Moshi** (JSON where needed), **Picasso** (images), Room, WorkManager.
- Payments: **Adyen 3DS2**, Braintree PayPal/Venmo connectors — card auth
  inside the driver app (for driver debit cards / cashout).

Feature package inventory (survives obfuscation — 82 top-level `com.ubercab.*`
packages in just one dex pair), including: `earnings_ui`, `earnings_forecast`,
`earnings_tracker_data_listener`, `payment_carbon_cash_collect` (with
`collect_cash`, `in_person` subpackages), `payment_mobile_wallet`,
`wallet_common`, `wallet_transaction_history`, `driver_loyalty` (Uber Pro),
`audio_recording`, `safety`, `risk`, `help`, `tax`, `courier_trip_issues`,
`cancellation_survey`, `cancellation_warning`, `carbon_driver_menu`,
`carbon_location_upload`, `carbon_map`. The earnings domain is a *cluster of
six+ modules*, not one screen.

### 2.3 THE FINDING: a UI-state registry shipped as data

`assets/uistate/uistate_mapping_rule.json` — **117 named UI states**, each with
`state_name`, `priority`, `min_version` (app-version gate), `scene`, and
optional `sub_state`. This is a server-drivable screen registry: navigation
targets are *data*, version-gated, not hardcoded routes. Earnings-related
states verbatim from the list:

```
cashout, earner_home, earner_payments_hub, earner_payments_management,
earning_week_picker, earnings_details, earnings_historical_trends,
earnings_historical_trends_detail, balance_summary, transaction_feed,
session_summary, trip_details, tax_landing, tax_forms_router,
tax_summaries_router, tax_document_info_router, tax_forms_delivery_preference,
earnings_inspection_sheet, driving_hour_limits, loyalty_home_v4/v5,
opportunity_center, performance_hub, planner, offers_dispatch
```

MIZIGO parallel: our `src/lib/state-machine.ts` is the same idea on the
shipment domain; this validates extending it to a *screen* registry with
version gating (which our PWA can drive via `feature-flags.ts`).

Other server-driven assets: `analytics_filter_prod_all_apps.json`,
`bool_parameters_hash.txt` (remote-config hash pinning), a `geojson/` asset
folder, tzdb, Lottie animations for bike-safety items, and
`mobile-content.uber.com` as the CDN for remotely-updated content/illustrations.

### 2.4 Networking surface

Session headers observed as constants in dex strings (evidence of a rich
device/session contract on every call — paraphrased list, Uber's names):
`x-uber-uuid`, `x-uber-request-uuid`, `x-uber-call-uuid`, `x-uber-device-id`,
`x-uber-device-os`, `x-uber-device-language`, `x-uber-device-timezone`,
`x-uber-device-location-latitude/-longitude` (**live location rides on the
session header**), `x-uber-client-version`, `x-uber-client-name`,
`x-uber-client-user-session-id`, `x-uber-app-variant`, `x-uber-cit`,
`x-uber-edge`, `x-uber-do-not-failover`, and `x-uber-request-type: shadow`
(**shadow/dry-run traffic mode** — a request can be mirrored for testing
without executing).

URL surface highlights: `drivers.uber.com/earnings/trips`,
`payments.uber.com/payment-history`, `static-maps.uber.com/map`,
`platform.uberinternal.com/carbon/components` (a component registry endpoint),
`t.uber.com` short links everywhere. Earnings detail screens have both a
native path (`transaction_feed`) and webview fallbacks (`/earnings/webview`).

### 2.5 Design tokens (the scale, not the brand values)

- **Spacing is a named-unit ladder, not raw dp:** `ui__spacing_unit_Nx` where
  1x = **8dp**: 0x=0, 1x=8, 2x=16, 3x=24 … 10x=80, up to 23x=184dp. Every
  layout references `@dimen/ui__spacing_unit_Nx` — an 8-point grid, strictly.
- **Type ladder by name:** micro 10sp, tiny 12sp, small 14sp, smallmedium 16sp,
  medium 18sp, large 24sp, extra_large 28sp, mega 36sp; styles named like
  `Platform.TextStyle.LabelLarge` (role-based, not size-based, styling).
- **Radii:** default corner token is **2dp** (sharp, utilitarian), feature
  radii range 4→100dp with **pill (100dp/full-round) chips and trackers**;
  common card/sheet radii land on 8/12/16/20/24/28/32dp.
- **Fonts:** exactly two families + mono — `UberMove` (display),
  `UberMoveText` (body), `UberMoveMono` (numbers/codes), preloaded via a
  manifest-declared font array. Two weights per family. *(Scale lesson only —
  we keep Manrope + JetBrains Mono.)*
- Colors: 2,174 named colors; semantic prefixes (`brand_colors_*`,
  `carbon_*`, functional sets), plus alpha-suffixed variants
  (`_a75`, `_a70` — transparency variants as first-class tokens).

### 2.6 Earnings flow — reconstructed screen order

From the 117-state registry + strings + layout names + package structure:

1. **Earnings tab (`earner_home`)** — the driver home has a tab bar whose
   Earnings entry is literally `carbon_tab_title_earnings` = "Earnings"
   (`com.uber.earnings_tab.core.EarningsTabView` is its own module). Contains
   an **earnings tracker** widget (`ub__earnings_tracker_*` tokens, 30dp
   inner/32dp outer radii) + "Earnings Trends" entry.
2. **Weekly summary / week picker (`earning_week_picker`)** — week-based
   navigation is first-class ("See Weekly Summary", "Weekly, Monthly" report
   email settings). A **date picker menu item** sits in the toolbar of
   "Earnings Activity" (`activity_feed_richcards`).
3. **Earnings details (`earnings_details` + `earnings_historical_trends`)** —
   breakdown + trends; empty state: "No Earnings Activity — Please select a
   different period or start taking trips to log Earnings Activity." Error
   state keeps reassurance: "Can't load your Earnings / **Don't worry, you'll
   still earn for your trips.**" (tone reference).
4. **Transaction feed (`transaction_feed`, `balance_summary`)** — line items
   per trip/promotion with "See Earnings Activity" entry.
5. **Trip details (`trip_details`, `session_summary`)** — per-trip fare
   breakdown incl. "Surge" line (`carbon_help_trip_summary_surge`), audio
   recording card if applicable, "Trip summary" transparent-fare section at
   rating time.
6. **Wallet / payments hub (`earner_payments_hub`)** — titled **"Wallet"**
   (`ub__earner_payments_hub_header_title`), leading to payments management
   (bank accounts, debit card) and tax documents (`tax_landing` cluster).
7. **Cashout (`cashout`)** — full string set exists: enter screen "Cashout",
   "Current balance", "Amount" + Edit, "Confirm amount", **"Cashout speed
   options"** (speed → fee matrix, payment-method auto-selection warnings),
   success "Your money is on the way", "Transaction details".
8. **Earnings Forecast (`earnings_forecast`)** — peak-earnings map: "Areas near
   you", distance list ("%.1f km"), "Current area", footer "View on Trip
   Planner". The map markers are **hexagons** — layout
   `area_marker_earnings_forecast_hex.xml` / `com.ubercab.carbon...HexAreaMarkerView`
   (H3 in the actual binary, confirming task 11-a's public-source finding).

**Manual cash-fare entry guardrails** (cash trips, directly relevant to
Nairobi): flow "Enter fare" → "Confirm fare" with **soft bounds** ("The entered
fare of %1$s seems higher than expected. Please verify…") and **hard bounds**
("Fare seems unusually high") that block, "Add extras", "Adjust Fare",
"Re-enter fare". Plus "Ask rider to pay" framing and a "Refresh fare" check
("The fare may have changed"). This is a full defensive UX pattern for letting
humans enter prices safely.

### 2.7 Other copy worth noting (tone references only)

- Promotions: "Pick Your Quest", "Quest Details", Quest widgets, "Promotions"
  tab; "next_marker_earnings_destination_name: Going to busy area".
- Payout education: "Go to the Earnings section of this app to cash out at any
  time"; "it can take 1-2 business days for your payout to post"; bank
  auto-verification education ("Get verified instantly", "No documents
  required" — via TrueLayer).
- Accessibility: "Voice trip requests" ("Read aloud details such as fare and
  total trip distance"), "Screen flash for requests", "Vibration for requests".
- Requests: "Requests paused after trip", "Pause requests" (refueling break
  modal), driver offers job board: "New requests", "This request is no longer
  available".

---

## 3. Bolt Rider CA.228.0 — deep findings

### 3.1 Manifest & platform facts

- **Native Android** (1,102 XML layouts; not RN/Flutter). Kotlin-first with an
  in-flight Compose migration (Compose refs alongside XML).
- Main activities: `SplashHomeActivity`, `RideHailingMapActivity` (the home is
  map-first), `ThreeDSActivity` (card auth), `DeeplinkActivity` +
  `AttributionDeeplinkActivity`, `VoipTrampolineActivity`.
- Schemes: `bolt://`, **`taxify://` (legacy still live!)**, `boltprelive://`,
  `geo:`; AppsFlyer OneLink host (`bolt.sng.link`).
- Foreground services: `IncidentReportingService` (**location** — SOS
  incident tracking), `TripAudioRecordingService` (**microphone**),
  `VoipService` (**phoneCall**) — in-app calling via **Sinch**
  (`com.sinch.android.rtc`), plus `CrossAppLoginService` (eu.bolt namespace —
  cross-app SSO with the driver/food apps).
- Dynamic feature modules shipped: `face_dynamic` (+ ML Kit OCR models —
  document-scan face verification) and `voip_ui`.
- 21 language config splits in the XAPK; the **en-GB split alone adds 1,938
  strings** — locale splits carry real content.
- Assets tell the stack: Braze in-app-message bridge JS, Sentry debug meta,
  FontAwesome webfont (icon font strategy), custom GLSL `shaders/` (map
  rendering effects), `passkey_config.json` (passkeys auth), own embedded
  map SDK (`ee.mtakso.map` package: `ExtendedMap`, `MapStyle`, `MarkerCreator`
  — a vendor-agnostic map abstraction layer).

### 3.2 Architecture (from readable decompiled code)

- **RIBs — Uber's framework — is Bolt's app skeleton too.** Package
  `ee.mtakso.client.ribs.root.*` with `LoggedInRibInteractor`,
  `PreOrderFlowRibInteractor`, `ActiveRideFlowRibInteractor`. Both giants run
  the same business-logic-tree pattern (from the same open-source project).
- **Kotlin + coroutines everywhere** (thousands of Continuation refs), Dagger2
  DI, **Retrofit + OkHttp** (plain REST — no gRPC, unlike Uber), Moshi.
- **Namespace migration visible in code:** legacy `ee.mtakso.client.*` core vs
  new per-feature modules `eu.bolt.ridehailing.ui.ribs.*`,
  `eu.bolt.searchaddress.*`, `eu.bolt.android.theme.*` — a gradual
  strangler-pattern re-modularization around `eu.bolt.*` gradle modules.
- Clean-architecture interactors (`...core.interactors.order.
  GetSelectedCategoryRouteUseCase`, `GetRequestingHeaderUseCase`).
- **Whitelabel in strings:** many keys exist twice with a `__hopp` suffix
  ("Bolt" → "Hopp", their sister brand) — brand is a string-variant axis, not
  a fork.
- Internal build identity: `assets/info.txt` = "Singular-v12.10.0-…" — the
  rider app's internal codename is **Singular** (internal train 12.10.0
  maps to release CA.228.0).

### 3.3 The request flow — exact RIB tree (readable class names)

`PreOrderFlowRibInteractor` implements ~40 listener interfaces, each naming a
child screen-RIB. The preorder (request) flow therefore is:

1. **Home / map** (`HomeRib`, `VehiclesMapRib`) — map always visible; pickups
   visible as markers; location-services watcher.
2. **Destination entry** — `addresssearch` (search) **or** `destinationchooseonmap`
   **or** saved places (`favourite.flow`, `EditFavAddressIconAndName`) **or**
   airline picker (airport). "Add destination later" is an explicit path.
3. **Pickup refine** — `confirmpickup` ("Pickup here", "Tap to edit",
   "Change pickup" with "Outside your pickup area" boundary warning; a
   "no-waiting zone" advisory: "Your pickup is in a no-waiting zone — Be
   ready to hop in…").
4. **Category selection** (`CategorySelection`, `CategoryDetails`) — vehicle
   class cards; deep-linkable directly.
5. **Gates inside the flow** — `VerificationFlowRib` (rider verification),
   `ConsentRequired`, `PromoApplied`, `PriceBiddingBottomSheet` (rider can
   *offer* a price; errors like "Couldn't update the offer"),
   `ScheduledRidesTimepicker` + `ReviewScheduledRide`, `ParcelOnboarding` /
   `ParcelDetails` (parcel delivery inside the same flow!),
   `OrderPreferencesFlow`, `ChooseRiderFlow` ("ride for someone else" →
   "Yes, share details"), `Tour` (onboarding), in-app messages.
6. **Confirm** — `confirm_price_*` set: "Confirm new price", "New price is
   %1$s", "Price was adjusted due to change of pick-up location".
7. **ActiveRideFlow** — `handleChatSelected`, `callDriverVoIP` /
   `callDriverPhoneCall`, `cancelRide` (reason picker → fee warning → confirm),
   `onPickupUpdated`, `onOpenPriceConfirmation` (driver-changed-destination
   re-price), `shareTripDetails`, `onAudioRecordingClick`, safety toolkit,
   "Driver has arrived", tips.
8. **No-supply state** — `AllDriversAreBusy` rib + `drivernotfound` package:
  "Sorry, no drivers available at the moment. Please try again in a few
  minutes." (tone reference)

### 3.4 Pricing / cancellation / receipt copy (tone references)

- Surge honesty: "Prices are higher than usual due to high demand" / "Prices
  are temporarily higher due to increased demand." (two variants — with and
  without multiplier).
- **Wait-time fee consent:** "Don't keep your driver waiting!" — "Please get
  ready in %d minutes or less after driver's arrival. Every additional minute
  of waiting increases your fare by %s."
- **Cancellation fee warning:** "Your driver has been en route for %1$s
  minutes. A cancel fee of %2$s will apply if you cancel." Reason screen
  titled "What went wrong?" with in-progress warning: "You might be partially
  charged for the ride since it is already in progress."
- Re-price on destination change: snackbar "Driver updated your destination /
  The final price will be shown at the end of your ride."
- Receipts: "Price breakdown" on the finished screen; receipt send status
  strings; business rides ("Work ride", VAT fields).
- Route limits: "Distance is too long / Please select another destination."
- Tips: "Tip Driver", "Add custom amount", "Tip amount", "Remove tip".

### 3.5 Design tokens (Bolt UIKit — the cleanest system of the four)

- **Typography is an enum with roles**, consumed via
  `app:bolt_typography="…"` on `BoltTextView`: scale =
  `heading_{xs,s,m,l} × {accent,regular}`, `body_{xs,s,m,l} × {regular,accent}`
  (+ `compact` variants), `caps_{s,m,l}_accent`, and **`body_tabular_*`**
  variants (tabular numerals for money!). Most-used tokens in layouts:
  body_m_regular (292×), body_s_regular (190×), heading_s_accent (96×) —
  i.e., 90% of UI is 3 text styles.
- Each typography token resolves to **7 properties** (from decompiled
  `BoltFontStyle`/`BoltTypographyToken`): size, line-spacing extra, weight,
  all-caps, letter-spacing, optical size, tabular flag.
- "Accent" == semibold — **the entire app uses exactly two font weights**
  (Inter Regular + Semibold files are the only fonts shipped).
- **Semantic color attributes** (used via `?attr/…` in layouts):
  `colorContentPrimary/Secondary/Tertiary`, `colorContentActionPrimary`,
  `colorContentDangerPrimary/Secondary`, `colorContentPrimaryInverted`,
  `colorBgNeutralPrimary/Secondary`, `colorBgActionPrimary/Secondary`,
  `colorBorderSeparator`, `colorLayerFloor`, `colorSpecialScrim`,
  `colorStatic*`. Named themes: `BoltTheme`, `BoltDarkTheme`,
  **`BoltGrayscaleTheme` / `BoltGrayscaleDarkTheme`** (a whole grayscale
  accessibility theme ships!), and indicator styles
  `BoltIndicator{Action,Danger,Neutral}Primary`.
- **Spacing: 4dp base grid** (histogram of padding/margin dimens peaks at
  4/8/12/16/20/24/32; bottom nav 56dp; chips 8/16dp radii; FAB 40/56dp).
- Text sizes in play: 11–36sp with 14sp dominant; headers to 36sp.
- Bottom sheets are the primary container (`rib_actions_sheet`,
  `design_order_sheet_content_view` with a generic **key-value row system**:
  `info_bottom_sheet_row_{key_value,text,badge,divider,bullet,icon}` — rows
  composed from primitives, not bespoke layouts).

---

## 4. Bolt Driver DA.151.0 — deep findings

### 4.1 Manifest & platform facts

- The most permission-hungry of the four: **`ACCESS_BACKGROUND_LOCATION`**
  (driver tracking beyond foreground), **`PACKAGE_USAGE_STATS`** (device-usage
  signals — likely online-detection/fraud), `SYSTEM_ALERT_WINDOW`
  (incoming-order overlay over other apps), full-screen-intent notifications,
  biometrics, BLUETOOTH advertise/scan/connect (beacon/device pairing),
  `MAPS_RECEIVE` (own maps permission).
- Same native Kotlin stack, `uikit`/`uicore` shared packages (Bolt's driver
  and rider apps share a UIKit module — `android-app-common:uikit_release`
  appears in the rider binary's metadata).
- API surface found in strings: `driver.live.boltsvc.net` (API gateway),
  `driver.applog.bolt.eu` (logging), and **ops deep links into
  `admin-panel.bolt.eu/…`** (fleet/driver/order admin URLs embedded for
  support flows — their ops tooling is linked from the app).

### 4.2 Screen inventory (82 package dirs under `ui/screens`)

`authenticate, blocking, campaigns, contact_methods, demand, destination,
earnings, history, home, information_message, infoweb, login, navigator_chooser,
operation_result, order, peer_vote, permission_onboarding, pickup_code,
priority, profile, report_map_issue, report_pickup, safety_toolkit, score,
settings, sidebar, signup, support, time_limit, training, vehicle,
verification, warning, waybill, work` — note **`pickup_code`** (their
equivalent of our POD PIN), **`waybill`** (cargo transport documents — Bolt
formally supports freight paperwork in-app), **`demand`** (supply heatmap),
**`time_limit`** (shift/fatigue), **`score`** (driver ratings), `peer_vote`
(driver community checks), `blocking` (blocked-driver states).

### 4.3 Driver order flow (from screens + strings)

1. **Home / shift** — big toggle copy "GO ONLINE" / "GO OFFLINE"; persistent
   notification "Online and ready for requests / Waiting for ride requests".
2. **Fatigue gate** — "For road safety and to ensure high-quality service,
   Bolt places a 12-hour maximum driving limit from when you go online." +
   compulsory 6-hour offline break; hours accumulate only while online.
3. **Incoming order** (`order/incoming/v2`, full-screen overlay activity) —
   accept/decline with confirm ("Decline the request?"), **counter-offer**
   flow ("Waiting for rider reply"), **Auto-Accept** with safety filters
   ("optional rides — unsafe areas, outside your radius" are excluded; auto
   accept disables on decline/cancel/miss; "No filters set" warning: "all
   rides will be automatically accepted. These may include long or low-value
   rides.").
4. **Arrival & pickup verification** — "Arrived at pickup?" confirm;
   **GPS-mismatch guard**: "Your GPS location doesn't match the pickup spot";
   pickup code entry (mirrors rider-side code display).
5. **Cash collection** — "Cash ride, collect displayed sum!" / "Collect cash
   from %1$s"; if rider switches method mid-trip: "Ride will be paid for by
   cash" (bold Card→Cash transition message).
6. **Finish / summary** — finished screen with earnings summary and history
   ("Accepted requests will be shown here").

### 4.4 Earnings flow (v3 packages: landing, balance, breakdown, netbreakdown,
explanation, goal, payout, cache)

1. **Earnings landing (weekly)** — "Current Week Earnings", week selector
   ("Current week", "Weekly Activity"), per-day history.
2. **Breakdown vs NET breakdown** — two variants: gross and **NET** with the
   standing disclaimer "NET shows earnings excluding commissions."
   (`commissions_disclaimer`) — commission transparency is a mode toggle.
3. **Balance** — "Bolt balance" with the cash-reconciliation line:
   "Balance does not include %1$s you received in cash payments."
   (`earnings_balance_disclaimer`) + "Compensated cash discounts" as a line
   item + error state "Your balance is currently unavailable…".
4. **Payout / early cashout** — "Review and Confirm" screen: "Bolt will pay
   you %1$s", **"The Early Cashout fee is %1$s"** (fee shown as its own line),
   "Confirm cashout", "Payout history", "Pdf receipt", statuses Sent /
   Processing / Declined / "Your transfer failed.", "Problem with payout?" →
   Help.
5. **Earnings goal** — "Earnings Target" / "Weekly Target" ("Fill the weekly
   target field", "Delete your earnings target?").
6. **Bonuses / campaigns** — "Choose a bonus campaign", "This week's
   bonuses", "Bonuses are paid out together with earnings", "Your bonus".
7. **Earn More / demand map** — "All opportunities to earn more money in one
   place."; the demand heatmap onboarding tooltips: "Where to drive? — The map
   shows where demand is highest — darker areas mean more demand", "Tap to
   change the day — See how average demand changes throughout the week",
   "When to drive? — Drag the time to see how demand changes throughout the
   day" (day-of-week + time-of-day scrubbing on a heatmap), "Increase
   earnings by driving when and where demand is highest".
8. Empty state: "No earnings to show — Your earnings will appear here once
   your account is activated and you've completed your first rides."

---

## 5. Uber Rider 4.651.10003 (lighter pass, priority #4)

- **Modular delivery is extreme:** 11 dynamic-feature modules in the XAPK —
  `BarcodeScanner`, `CarRentalsDFMApi`, `Diagnostic`, `EatsDFMAPI`,
  `EatsDFMViewAPI`, `FlashNacional`, `GoogleAds`, `GooglePaySdk`,
  `MobileStudio`, `StyleGuide`, `VoipTwilio` (in-app calls via **Twilio**,
  where the driver app uses LiveKit). Business lines (Eats, Car Rentals,
  Connect/courier `connect_*` strings) are downloaded on demand — the rider
  app is a *platform shell*.
- 60+ language splits; asset-statements SSO across rider/driver/lite builds.
- Pricing copy: **"See the price upfront"** as a category-level promise; a
  dedicated "Fare Breakdown" screen with a legal disclaimer line ("Your fare
  will be the price presented before the trip or based on the rates below and
  other applicable surcharges and adjustments." — tone reference);
  upfront-tip flow ("You have already tipped %1$s. 100% of your tip will go to
  %2$s"); "Schedule pickup" / "Select time" for scheduled/courier orders;
  promo codes ("Add Promo Code", applied-state toast).
- `uber-eats://nfc` deep link (NFC-tag ride hailing for Eats devices).

---

## 6. Cross-cutting patterns (both companies, all four binaries)

1. **RIBs is the shared skeleton.** Uber authored it; **Bolt adopted the
   open-source framework** — both apps' flows are business-logic trees
   (Interactor + Router + Builder per feature) with thin view layers.
   MIZIGO's `state-machine.ts` + thin components is the same philosophy in
   web form.
2. **Two font weights, one or two families, roles not sizes.** Uber: two
   families + mono, named sizes; Bolt: one family, two weights, role-sized
   tokens with a **tabular-numeral variant for money**. Nobody ships 10
   weights.
3. **Semantic color layers.** Content/Background/Border/Special + intent axes
   (Action/Danger/Neutral/Success). Bolt even ships a grayscale theme.
4. **Grid discipline:** Bolt = 4dp base; Uber = 8dp named units. Both strict.
5. **Bottom-sheet-first commerce.** The request flow lives in a persistent
   sheet over an always-visible map (Bolt's `RideHailingMapActivity`,
   Uber's map-first home). Sheets compose from generic row primitives
   (key-value, badge, divider, bullet, icon).
6. **Fee transparency as a designed moment.** Every fee gets its own line +
   plain-language sentence *before* the confirm button: cancellation (minutes
   en route → fee), wait-time (per-minute rate), early-cashout fee, NET vs
   gross commission toggle, surge sentence, price-changed re-confirm. This is
   the single most consistent UX law across all four binaries.
7. **Cash markets are first-class.** Cash payment selection, cash-collection
   instructions to drivers, balance-minus-cash disclaimers, manual fare entry
   with soft/hard guardrails, card-required-for-promo rules. (Exactly the
   Nairobi reality.)
8. **Verification gates inside flows, not at signup only.** Rider
   verification ribs, driver selfie/face modules (Bolt `face_dynamic` + ML Kit
   OCR), "let's get you verified… It takes 1 minute and helps keep your
   account safe."
9. **Server-driven everything:** UI-state registry as JSON (Uber), remote
   config with hashes, remote content CDN, string variants per brand
   (`__hopp`), locale splits carrying real content. Clients are shells;
   behavior is data.
10. **Driver economics is a product surface.** Weekly summaries, NET/GROSS,
    goals/targets, bonus campaigns, demand heatmaps with day/time scrubbing,
    earnings forecast hex maps, Uber Pro loyalty, tax document hubs.
11. **Empty/error states have personality + reassurance.** "Don't worry,
    you'll still earn for your trips." / "We're stocking our shelves" /
    "Your balance is currently unavailable. Please try again later." Every
    list screen has a named empty state.
12. **Safety is always 1–2 taps away on-trip** (safety toolkit / SOS in the
    active-ride sheet; audio recording service; incident reporting service
    with location foreground type) — confirms SAFETY_TECH_TEARDOWN.md.
13. **Deep links + attribution everywhere** (own scheme + https hosts + OneLink
    branch domains); QR/NFC entry points; share links with "follow in real
    time" copy.
14. **Accessibility is a settings surface:** voice trip requests, screen flash,
    vibration, grayscale theme, biometrics, voice/video support calls.

---

## 7. MIZIGO COPY-LIST (prioritized, mapped to real files)

Clean-room: we implement the *pattern*, never the text/assets. "Q" = quoted
tone reference from above.

| # | What to build | Evidence → | MIZIGO file(s) |
|---|---|---|---|
| 1 | **Driver Earnings tab with the 5-screen spine**: weekly tracker home → week picker → breakdown (tap-through per item) → trip detail → payout/cashout. Uber ships this as six modules + 20 UI states; Bolt as 9 sub-packages | §2.6, §4.4 | new `src/components/mizigo/driver/EarningsTab.tsx` + `EarningsDetail.tsx` (mount inside `driver/DriverApp.tsx`) |
| 2 | **NET vs GROSS toggle with standing commission disclaimer** (one-line explainer under the number, always) | Q "NET shows earnings excluding commissions." | `EarningsTab.tsx` + `src/lib/pricing.ts` (take-rate already computed) |
| 3 | **Cash-reconciliation disclaimer on driver balance**: balance excludes cash collected; make cash lines visible in the same statement | Q "Balance does not include … cash payments." | `EarningsTab.tsx`; cash data via `src/lib/shipments.ts` |
| 4 | **Review-and-confirm payout screen** with fee as its own row, then explicit Confirm; statuses Sent/Processing/Declined/Failed on a history list | §4.4 payout flow | `EarningsTab.tsx` payout section (future: `src/app/api/driver/payout` action) |
| 5 | **Manual price-entry guardrails** for any price-adjust flow (dispute/counter-offer): soft warning (verify) at ±band, hard block beyond; "Add extras" pattern for tolls/loading | §2.6 guardrails | `src/components/mizigo/customer/ProblemScreen.tsx`, `ReviewStep.tsx`, `src/lib/cancellation.ts` sibling `src/lib/price-adjust.ts` |
| 6 | **Fee-visibility law**: every fee sentence names the trigger + amount before Confirm (cancel fee w/ minutes-en-route; wait-time per-minute; re-price confirm on destination change) | §3.4, §6.6 | `src/lib/cancellation.ts` copy layer, `TrackView.tsx` banner, `ReceiptFlow.tsx` |
| 7 | **Typography tokens as roles with tabular money variant**: adopt `heading/body/caps × xs/s/m/l × regular/accent + tabular` naming in our token system; enforce via a `Money` text component using JetBrains Mono + tabular-nums | §3.5 | `src/components/mizigo/shared/ui.tsx` (Text + Money components), `src/lib/palette.ts` (token names) |
| 8 | **Semantic color layers** (content/bg/border/special × action/danger/neutral) instead of per-component hexes; keep our palette values, rename to layered semantics | §3.5, §2.5 | `src/lib/palette.ts` + `ui.tsx` |
| 9 | **4dp spacing ladder constant set** (4/8/12/16/20/24/32) exported as named units; audit components to reference units | §3.5, §2.5 | `ui.tsx` spacing export; components |
| 10 | **Earnings goal + weekly-activity mini-chart** on driver home (set target, progress bar, "on track" state) | §4.4 goal | `driver/DriverApp.tsx` home card + prisma `Driver.earningsGoal` (schema change via main agent) |
| 11 | **Demand heatmap with day/time scrubber** in ops (and later driver app): "darker = more demand", tap day, drag time | §4.4 demand | `admin/OpsTab.tsx` (day × hour grid over shipments), `shared/MapCanvas.tsx` hex layer |
| 12 | **Screen registry as data with version gating** (our own uistate equivalent): declare named screens + feature-flag/min-version gating in one file | §2.3 | extend `src/lib/state-machine.ts` + `src/lib/feature-flags.ts` |
| 13 | **GPS-mismatch pickup confirmation** on driver arrival ("location doesn't match — confirm anyway / correct spot") | §4.3 | `driver/DriverApp.tsx` arrival step (uses existing geo distance in `src/lib/geo.ts`) |
| 14 | **Decline confirmation + counter-offer status states** on the driver offer card ("Are you sure you want to decline?" → reason chips; counter-offer → "Waiting for customer reply") | §4.3, §3.3 price bidding | `driver/DriverApp.tsx` offer card + new `CounterOfferSheet` |
| 15 | **No-supply + empty-state copy system**: every list/screen gets a named empty state with a reassurance line (see §6.11 examples) — add to copy-lint rules | §6.11 | copy lint config + `ui.tsx` `<EmptyState>` component |

## 8. WILL NOT COPY (explicit exclusions)

- **Branding & assets:** no Uber/Bolt colors, fonts (UberMove, Inter), icons,
  illustrations, Lottie files, app icons, or any binary asset from the APKs.
  None of the decompiled output leaves `research-apk/` (gitignored).
- **No code:** no Java/Kotlin, XML layouts, or resource tables get translated
  into our source. Patterns are reimplemented from scratch in our stack.
- **No verbatim copy:** string tables are paraphrased; only short microcopy is
  quoted in this doc as tone reference (labelled). No sentence from either app
  ships in mizigo UI.
- **No proprietary algorithms or parameters:** DeepETA residuals, batch-match
  windows, H3 resolutions *they* use, 12h/6h fatigue thresholds, fee amounts,
  fraud thresholds. Where we adopt the *pattern* (e.g., shift limits,
  guardrail bands) we pick our own numbers for Nairobi cargo and label them
  ours.
- **No session-header cloning:** we don't replicate `x-uber-*` naming; if we
  build a device/session contract we namespace it `x-mizigo-*`.
- **No internal codenames as identifiers** ("carbon", "presidio", "singular",
  "dragon crawl" stay in this doc as findings only).
- **APKs never committed**; `research-apk/` verified gitignored (`.gitignore`
  line 88); this doc is the only artifact added to git.

## 9. Tool & mirror notes for future runs

- apkcombo.com: reliable APK/XAPK source; the trick is desktop UA + Referer +
  following the `/r2?u=<signed R2 url>` redirect; XAPKs contain the base APK
  + splits + `manifest.json` (a convenient metadata summary).
- apkpure(.net): Cloudflare-blocked from this sandbox. GitHub API: rate-limited
  (unauthenticated); direct release-asset URLs still work.
- jadx on low-RAM boxes: use the resources-rezip + per-dex recipes in §1.1;
  `-Xmx750m -j 1` decompiles an ~8MB dex in ~6–8 min.
- Bolt binaries are readable (no obfuscation) — decompilable to full source;
  Uber binaries are ProGuarded — mine strings/manifest/assets/packages instead.
- Bolt language splits (config.<lang>.apk) are worth decoding separately
  (en-GB adds ~1,900 strings); Uber localizes almost entirely server-side,
  so base strings are all you get.

---

## Deep Dive 2 (October 2026, round 2)

Task ID: 19-a · RE deep-mining subagent. Same clean-room rules as §0/§8: no
code/assets/string tables copied into mizigo; short microcopy below is quoted
only as labelled **tone references**; all binaries stay in `research-apk/`
(gitignored). Evidence paths are relative to `research-apk/work/<app>/`.

### 0. What was re-acquired (round 2)

| App | Version re-acquired | Round-1 version | Notes |
|---|---|---|---|
| Bolt Driver | **DA.151.0** (900) | DA.151.0 | identical build, re-downloaded |
| Bolt Rider | **CA.228.0** (4370) | CA.228.0 | identical |
| Uber Driver | **4.600.10000** (313129) | 4.599.10004 | one patch newer; uistate registry now v20 |
| Uber Rider | **4.651.10003** (316108) | 4.651.10003 | identical |

Acquisition recipe from §1.1/§9 still works unchanged (apkcombo `/<slug>/<pkg>/download/apk`
page → extract `<a href="/r2?u=…">` → fetch with desktop UA + Referer; all four
XAPKs downloaded in ~1 min each; ~900 MB total). One new operational fact:
**background/detached processes are reaped when a tool call ends** in this
sandbox — jadx per-dex runs MUST be foreground with a 600 s timeout (round 1's
6–8 min/dex estimate still fits). Disk after all work: 3.3 GB in
`research-apk/`, 4.1 GB still free.

Decompiled this round (Bolt Driver base, unobfuscated → readable):
`work/bolt-driver/src12/` (classes12: active-order interactors, earnings/v3
Compose screens, order/v2 screens, network/order models) and
`work/bolt-driver/src13/` (classes13: arrived/finish/pickup_code/cancel/report_pickup
fragments + price-safety ViewModels). Resources-only jadx passes
(`--no-src`) for all four apps; strings-scans of all remaining dex files.

---

### 1. Bolt Driver GPS-mismatch pickup confirmation (PRIORITY — exact flow, copy, architecture)

#### 1.1 The microcopy (tone references; resource keys from
`work/bolt-driver/resout/resources/res/values/strings.xml`)

| Key | Text (tone ref) |
|---|---|
| `confirm_pickup_title` | "Arrived to pickup?" |
| `confirm_pickup_title_parcel` | "Arrived at pickup?" |
| `confirmation_pickup_message` | "Your GPS location is far from the pickup pin." |
| `confirmation_pickup_message_parcel` | "Your GPS location doesn't match the pickup spot" |
| `confirm_pickup_confirm_parcel` | "Confirm arrival" |
| `confirm_pickup_cancel_parcel` | "Not there yet" |

The same pattern mirrors on the **destination side** (same file):

| Key | Text (tone ref) |
|---|---|
| `confirm_destination_arrival_title` | "Arrived at destination?" |
| `confirm_destination_arrival_message` | "Your GPS location doesn't match the destination address" |
| `confirm_destination_arrival_confirm` / `_cancel` | "Confirm arrival" / "Not there yet" |
| `confirm_end_ride_md_title` / `_message` | "End trip here?" / "You are far from the planned final destination." |
| `confirm_start_ride_title` / `_message` | "Forgot to Start Ride?" / "You have moved %s from the pin." |

So Bolt runs **three** GPS-fence confirmations in the driver flow: pickup,
start-ride (moved-from-pin after pickup), and destination/end-trip.

#### 1.2 The architecture (decompiled evidence — the important discovery)

There is **no client-side meter threshold**. The arrival gate is a
**server-driven state machine**; the client renders what the backend pushes:

- `src12/.../ui/interactor/order/automatic_arrival/a.java` =
  `AutomaticArrivalManager` — listens for a **`DriverInformationMessage.AutomaticArrival`**
  push (backend geofence detects the driver near the pin and pushes the
  arrival prompt), then calls `confirmAutomaticArrival` when the driver
  confirms.
- `src12/.../ui/interactor/order/active/a.java` = `ArrivalIssue(attemptsLeft:
  Int, errorData)` — the arrival-confirm dialog tracks **server-counted
  retry attempts**.
- `src12/.../network/client/order/PickupConfirmationCodeStatus.java` — enum
  `DISABLED / OPTIONAL / REQUIRED / CONFIRMED` shipped per-order inside
  `DriverPickupSafetyData` → the PIN-at-pickup requirement is a **per-order
  server field**, exactly like our POD PIN toggle.
- `src12/.../interactor/order/active/ValidatePickupCodeUseCase.java` — its
  result is `Args(arrivalBlocked: Boolean, code: String?)`: a wrong PIN
  returns `arrivalBlocked=true`, i.e. **wrong code blocks the arrival
  transition**, not just an error toast.
- `PickupCodeStateManager` (`src13/.../ui/screens/pickup_code/`) + screens
  `pickup_code_skip_rationale`, `pickup_code_bluetooth_permission` — the PIN
  can be auto-verified over **BLE** ("Confirms the ride without manual input")
  and skipped for saved/favourite pickups (`SetSkipPickupConfirmationUseCase`,
  classes4) with a **rationale screen** before skipping.
- Rider-side, the driver app also bundles `ee.mtakso.client.core` (rider core)
  with `GetIsConfirmPickupNeededUseCase` + `ConfirmPickupRequiredException`
  (classes11) — the *rider's* "confirm your pickup before ordering" gate.
- Preference layer (classes3 strings): `/driver/getPickupDistanceConfig` →
  `GetPickupDistanceConfigResponse(items, PickupDistanceConfig(title…, DriverSliderItem))`
  — a **server-configured slider** ("flight distance") letting the driver cap
  how far they'll drive to a pickup. `FlightDistancePreferenceViewModel.savePickUpDistance`
  persists it. Remote flags `dev/prod_is_redesigned_driver_pickup_distance_screen_enabled`
  gate the redesigned screen.
- Airport-style queues: `/driver/matchWithPin` + `eu.bolt.driver.fifo.*`
  (`MatchWithPinUseCase`, `MatchWithPinRibViewModel`) — FIFO queue joined by
  pin.

**Implication for mizigo (implementation now):** copy the *shape*, not a
number: on `AT_PICKUP` arrival intent, compute `geo.ts` distance
driver→pickup; if beyond **our own** threshold (pick 150 m for Nairobi cargo —
labelled ours, not theirs), show title + one plain sentence + two buttons
("Confirm arrival" / "Not there yet" in our voice). Add `attemptsLeft` on the
action response, a per-shipment `pinStatus: disabled|optional|required|confirmed`
server field mirroring `PickupConfirmationCodeStatus`, and wrong-PIN → blocked
arrival. Distance bands, like everything else here, should be server-config
(`feature-flags.ts`), which is exactly how both apps do it.

### 2. Bolt Driver decline-confirm + counter-offer (full flow)

Strings (`work/bolt-driver/resout/.../strings.xml`):

- **Decline has a confirm step but NO reason picker.** `confirm_decline_order_title`
  "Decline the request?" / `confirm_decline_order_message` "Are you sure you
  want to decline the request?" — that's the entire decline flow. (Reasons
  exist only on *cancel*, not decline.)
- **Counter-offer sheet** (`offer_details_*`): buttons "Accept" /
  "Accept %1$s" (amount on the accept button) / "Decline" / **"Change price"**;
  steppers `offer_details_increase_price_btn_text` "+ %1$s" /
  `offer_details_decrease_price_btn_text` "− %1$s"; submit carries the amount:
  `offer_details_submit_btn_text_format` "Submit %1$s". Every action has its
  own error line ("Couldn't accept/decline/submit the offer. Please try again.").
- Pending state: `counter_offer_waiting_for_reply_btn_txt` "Awaiting rider
  reply" (v2 "Waiting for reply") — the button itself becomes the status.
- **Auto-accept filters** (`auto_accept_*`, `price_bidding_prefs_*`): setting
  is "Price per km" with subtitle "Auto-accept rides that pay at least this
  much per km" (a min-ppkm filter), 4 description variants of the same rule:
  auto-accept on unless the ride is *optional* (unsafe areas, outside radius);
  **auto-accept switches off when you decline, cancel or miss a request**;
  "No filters set" warns "all rides will be automatically accepted. These may
  include long or low-value rides." Confirm-changes dialog on save.
- Offer list empty states: "Waiting for offers" / "Waiting for more offers —
  You'll see more offers here when they are available". Push title "New ride
  request"; auto-accepted push: "Request was auto-accepted — Passenger is
  waiting for you to arrive."
- Swipe UX: tooltip "Swipe to accept or decline — • Swipe left to decline a
  ride • Swipe right to accept a ride" (+ RTL variant).
- Layout evidence (`resout/.../layout/delegate_item_offer_v2.xml`,
  `content_offer_button.xml`): offer card = MaterialCardView, 16 dp corner
  radius, 16 dp horizontal margin / 4 dp vertical, layered background,
  `colorSpecialNulled` bg; "Change price" is a `BoltMainButton` style
  `secondary`, size `L`.

### 3. Fee-transparency copy law (Bolt Rider + Uber Rider + Bolt Driver payout)

The consistent sentence anatomy across all three surfaces is
**[trigger condition] + [amount] + plain sentence, shown BEFORE the Confirm
button**, with a typed explainer available per fee cause.

- **Bolt Rider cancellation** (en-GB split confirms identical copy):
  "Your driver has been en route for %1$s minutes. A cancel fee of %2$s will
  apply if you cancel." In-progress hedge: "You might be partially charged
  for the ride since it is already in progress." No-show receipt line:
  "Cancel fee of %1$s has been charged for driver waiting time."
- **Bolt Rider wait-time consent**: "Please get ready in %1$d minutes or less
  after driver's arrival. Every additional minute of waiting increases your
  fare by %2$s" (title "Don't keep your driver waiting!").
- **Bolt surge**: three tiers — "Prices are higher than usual due to high
  demand" / "…temporarily higher…" (no multiplier shown) / driver-side
  `warning_high_surge` "The prices are currently %s higher than usual…" (% =
  percentage, not multiplier).
- **Bolt re-price**: "Confirm new price / New price is %1$s / Price was
  adjusted due to change of pick-up location".
- **Uber Rider cancellation** (hedged, softer than Bolt): "You may be charged
  a small fee since your driver is already on the way." + the marketed
  waiver: "Automatically waiving your cancellation fee when a driver isn't
  making progress toward you."
- **Uber wait-time**: constant threshold in copy — "When a driver waits more
  than **2 minutes** after arriving at your pickup location, a wait time fee
  will be added…" + tooltip "This includes a %s wait time fee."
- **Uber surge confirm**: "Confirm your %1$sx fare — Fares are higher because
  it's busy." Mid-trip destination change: "If you update your destination
  your fare may change. The new fare will include a %s surge pricing charge."
- **Uber fare-breakdown explainer system** (`ub__trip_fare_breakdown_*`): a
  typed modal per fee cause — `arrears / credits / promos / toll / waittime /
  ufP_not_honored` ("trip duration or distance different than estimated") —
  each ending with the SAME reassurance footer: "If you have any questions or
  concerns, please still pay your driver. You can contact support after the
  trip and we'll get back to you shortly." (Tone reference for our
  ReceiptFlow explainers.)
- **Bolt Driver payout** (`payout_*`): "Review and Confirm" → "Bolt will pay
  you %1$s" + **"The Early Cashout fee is %1$s"** (fee as its own row) →
  "Confirm cashout"; history statuses Sent/Processing/Declined/"Your transfer
  failed."; "Problem with payout?" → Help.
- **Composition anatomy** (Bolt Rider layouts): fee sheets compose from
  `info_bottom_sheet_row_{key_value,badge,divider,bullet,icon,asset,inline_notification}`
  primitives; `DesignKeyValueView` renders key→value rows with
  `design_divider="dots"` (**dotted leaders**, receipt-style) and
  `bolt_font="body_m"`; skeleton loading exists for the order sheet
  (`design_order_sheet_skeleton_view.xml`).

### 4. Empty-state system (Bolt UIKit — the actual layout contract)

`work/bolt-rider/resout/resources/res/layout/trips_empty_state.xml` (and its
siblings) define the pattern precisely:

```
[DesignImageView — Lottie illustration, autoPlay, loop=false]
        ↓ 16dp
[title: bolt_typography=heading_xs_accent, color=?attr/colorContentPrimary,
 center gravity, 24dp side margins]
        ↓ 8dp
[description: body_m_regular, ?attr/colorContentSecondary, centered]
        ↓ 12dp
[action: body_m_regular, ?attr/colorContentLinkPrimary — a LINK, not a button]
```
…all in a packed vertical ConstraintLayout chain (vertically centered).

**Error state** (`error_state_layout.xml`) differs in exactly two ways:
title is `heading_s_accent`, body is `body_l_regular`, and the action IS a
button — full-width `DesignButton` `button_style="secondary"` "Try again"
with `big_side_margin` insets.

Copy rules observed: every empty state names the future ("Your promotions
**will appear here**", "Accepted requests **will be shown here**", "Your
earnings will appear here once your account is activated and you've completed
your first rides"); errors lead with reassurance ("Your balance is currently
unavailable. Please try again later."; Uber: "Don't worry, you'll still earn
for your trips."); driver-side compliments empty state even coaches ("Keep
driving well and passengers will share their appreciation here!"). In the
earnings v3 DTOs (§6) empty/error/placeholder are first-class *server data*
(`BarChartEmptyState`, `BarChartErrorState`, `BarChartPlaceholderData`).

### 5. Bolt UIKit design tokens — how they compose in real layouts

- **Typography histogram** (1,058 usages across 501 Bolt Rider layouts):
  25 distinct tokens in use; top 3 (`body_m_regular` 292, `body_s_regular`
  190, `heading_s_accent` 96) ≈ 55%; the long tail is `compact` variants
  (dense rows) and `caps_*` (4–8 uses). Exactly **2 font weights** back all
  of it (Inter Regular + Semibold).
- **Tabular numerals are money-only**: `body_tabular_m_regular` etc. appear
  in just 8 layouts — `bolt_label_value_item`, `design_selected_payment_view`,
  `item_category_selection`, `view_price_breakdown_main_item/subitem`,
  `addon_configurator_list_item`, live-offer view. Price-breakdown row =
  label `body_m_regular` start-aligned + value `body_tabular_m_regular`
  end-aligned, 16dp gap (`view_price_breakdown_main_item.xml`).
- **Semantic color layers in real use**: `?attr/colorContentPrimary` /
  `Secondary` / `LinkPrimary`, `?attr/colorSpecialScrim`, and the offer card
  uses `?attr/colorSpecialNulled` as its background (a "nulled/neutralized
  special" layer for chrome-less cards).
- **Component vocabulary**: `eu.bolt.uikit.components.text.BoltTextView`
  (`app:bolt_typography`), `eu.bolt.uikit.components.button.BoltMainButton`
  (`app:button_bolt_style` = primary|secondary, `app:button_size` = L…),
  `eu.bolt.client.design.button.DesignButton`, `DesignKeyValueView`,
  `DesignImageView` (Lottie-aware). UIKit is shared driver↔rider (the driver
  APK ships the same `eu.bolt.uikit.*` packages).
- **4dp grid evidence**: 16dp card side-margins, 4dp card-to-card gaps,
  16dp card padding, 12dp button top-gaps, 8dp text gaps — every number in
  the layouts is a multiple of 4.
- **Uber parallel**: `ui__spacing_unit_Nx` (8dp base) confirmed again; also
  every Uber marker layout carries an embedded `uber:analyticsId` **UUID**
  (`area_marker_earnings_forecast_hex.xml`) — analytics identity lives in the
  layout itself.

### 6. Bolt Driver earnings v3 — the screens round 1 didn't open

**The headline: earnings v3 is a server-driven UI.** The client ships typed
screen models, not hardcoded screens (all names from `classes3.dex` strings;
`eu.bolt.driver.earnings.network.*`):
`EarningLandingScreenV4`, `BalanceScreen` + `BalanceScreenHeaderItem` +
`BalanceHistory{,Section,SectionItem,Tab}`, `EarningBreakdownScreenV3`
(+ `BottomSectionV2`, `PayoutSection`, `Intervals`),
`EarningPayoutExplanationResponse` (the payout *explanation* screen is a
server response), `EarningPieChartItem`, `EarningsActivityTile`,
`BarChartData`/`Bar`/`BarSegment` (+ **EmptyState/ErrorState/PlaceholderData
variants**), `PeriodSelector`/`PeriodMode`/`PeriodData`,
`EarningsGoal{,ExpenseCategory,Period}`, `LandingGraphRestoreState`.
Endpoints: `/driver/v2/getBalanceScreen`, `/driver/v2/getBalanceHistory`,
`/driver/getEarningBarChartData`, `/driver/getDriverEarningsGoal` +
`/driver/setDriverEarningsGoal`. The landing page is Compose inside a
ViewPager2 (`NestedScrollableHost.java`, `src12/.../earnings/v3/landing/`).

Also confirmed (copy, driver strings file): balance disclaimer
("Balance does not include %1$s you received in cash payments."), NET/GROSS
`commissions_disclaimer`, `compensated_cash_discounts` line item,
`earnings_island_error_fetching` ("Couldn't load earnings. Try again." — the
home widget has its own error state), weekly landing ("Current Week
Earnings", "Current week", "Weekly Activity"), goals ("Earnings Target",
"Weekly Target", "Fill the weekly target field", "Delete your earnings
target?"), campaigns ("Choose a bonus campaign", "This week's bonuses",
"Bonuses are paid out together with earnings", "Expected bonus %s").

**Driver-side price dispute (new — feeds our dispute flow):** the *arrived*
screen ships "Problem with price?" (link "Report") →
`choose_problem_reason` = `ChoosePriceReviewDialog` over a
`PriceReviewReason` DTO whose fields are `code`, `name`,
**`driver_allow_comment`** and **`driver_allow_set_price`** (booleans!) — the
SERVER decides per-reason whether the driver may comment and/or set a price
(`src12/.../network/client/price/PriceReviewReason.java`). Reason tiles
(strings): "Ride did not happen" (confirm-only), "Client did not pay"
(confirm-only), "Client paid less" → "Set amount client paid in cash"
("Amount client paid"), "Price is inaccurate", "Additional fees problem",
"Other problem" ("What went wrong?" comment hint). Guard: "A problem with
the price for this trip has already been reported…". The manual-price editor
itself is server-configured via `PriceModificationConfig(currencyGravity,
currencySymbol, priceModificationStep, method)` where method ∈
`FREE_INPUT_SHIFTING / FREE_INPUT / STEP / DISABLED`
(`src13/.../arrived/PriceModificationConfig.java`) — i.e. even the input
interaction is a server decision, and the taximeter hint is "Enter the price
indicated on the taximeter".

### 7. Uber Driver — forecast, hex markers, uistate registry

- **uistate registry** (`base/assets/uistate/uistate_mapping_rule.json`,
  registry v20, hash-pinned): 117 rules → **115 unique state names** (two
  states are listed twice with different scenes/min_versions). Each rule:
  `state_name, priority, min_version, scene[], sub_state{}`. New states
  round 1 didn't name: `agenda_map_{online,offline,ontrip}` + trip-planner
  agenda variants, `driver_offers_job_board`, `offers_dispatch`,
  `overflow_job_v2`, `tr_offers_card`, `preference_area` (driver home-area
  preference), `preference_rider_rating` (min-rider-rating filter!),
  `planning_hub_actions_sections`, `speed_intervention_settings`,
  `rider_checks_settings`, `follow_my_ride_later`, `night_mode_picker`,
  `starpower_search_screen`. Human typos ship in prod data
  (`navigation_settinngs`, `unifoed_account_manager`) — it really is data.
- **Earnings-forecast surface** (`market_preview_*`, `peak_earnings_*`):
  header "Hourly Trends: %1s" / "Today's earnings forecast", a "Now" chip,
  "See all areas"; list "Areas near you" with "%.1f km" rows + "Current
  area" + footer "View on Trip Planner". Education modal states the
  methodology: "These trends are calculated daily for this area using data
  from the last 4 weeks; they're not a guarantee of future earnings." +
  disclaimer "This graph is for illustrative purposes and does not represent
  or guarantee earnings." (Tone reference for our demand-heatmap copy.)
- **Hex markers**: `com.ubercab.carbon.marker_management.marker.HexAreaMarkerView`
  wraps a shared `carbon_area_marker` include — a horizontal pill
  (`mapMarkerPrimary` style, inverse color) with title + icon and a
  **clustered chevron** when markers overlap. The marker family:
  `area_marker_{,area_preferences,boost,driver_surge,driver_surge_hex,
  earnings_forecast_hex,high_demand,paid_movement,surge,empty}` — one pill
  system, ten skins, three of them hex (H3).
- **Uber has NO GPS-mismatch dialog.** Arrival is a navigation-state machine:
  `on_job_status_assistant_*` copy ("Heading to pickup", "Picking up %1$s",
  "You've arrived", "Dropping off %1$s") per nav state per product
  (borrow/delivery/errands/package_delivery). Pickup safety = **PIN
  verification** instead: "Customer PIN Required", "Customer will provide
  PIN", "PIN required at dropoff" (Connect/dropoff PIN).
- Card verification UX (penny-auth): 2-step "authorization holds" flow with
  "Your card won't actually be charged." — reusable shape for verifying a
  driver's M-Pesa/payout number.

### 8. Payment failure / retry / stuck UX

- **Bolt rider paywall (end-of-ride blocking)**: failure title "That payment
  didn't work" / body "You weren't charged. Wait a moment and try again, or
  choose a different payment method." / action "Pay another way". You cannot
  dismiss it: discard attempt → "You haven't paid yet — Complete payment to
  end your ride." (Tone reference for our M-Pesa-stuck sheet.)
- Pre-auth retry: "Don't worry, you'll only be charged once you complete a
  ride. For now, we just need to authenticate your payment details with your
  bank." Debt repayment failure: "Something went wrong. Please try again
  later or contact your payment provider…". Account-level: "Your account has
  a pending payment. Please choose another payment method to request a
  ride."; auto-cancel honesty: "Due to failed payment, the order has been
  automatically cancelled."
- **Uber checkout/collect failure**: "Payment failed — Try again or switch to
  a different payment method" (repeated verbatim across checkout, in-person
  collect, and arrears settlement — one pattern, everywhere).
- **QR cash-collection fallback** (Uber Driver): QR tab ("Valid until %s",
  "Secure transaction") + banner "Have an issue? Switch to cash instead." +
  connectivity fallback "Try again or switch to cash" — a graceful
  degradation ladder digital → retry → **cash**.
- Driver app POS-terminal pending state: "Waiting for card… Ask the rider to
  tap or insert their card into the POS terminal now".
- **No literal "M-Pesa" strings in any of the four binaries** — mobile money
  is a server-side payment-method concern (Uber deep-links
  `payment-providers.uber.com`; localization happens server-side too). Our
  M-Pesa surfaces are free to be first-class, no pattern to inherit here
  beyond the retry/fallback ladder above.

### 9. Other discoveries worth keeping

- **Driver Score (Bolt)** — a full quality-score surface: tooltip "Driver
  score is calculated based on the last **100 trips**… On the progress bar you
  can also see how close you are to the **retraining or blocking
  thresholds**"; "Positive/Negative signals" lists ("In the list below, you
  can see what exactly affected you"); push "Your Driver Score has dropped
  %s — Find out what reduced your score."; endpoints `/driver/getScore`,
  `/driver/getScoreOverview`, `/driver/getScoreExplanation`. Rating-the-app
  taxonomy (`rateme_*`): Account / Pricing-Earnings / Map-Navigation / Ride
  safety / Technical / Other, with items like "I'm not receiving requests",
  "Bad Rider behaviour", "Slow responses from Customer Support".
- **Fatigue limits are server-parameterized**: the shipped copy hardcodes
  "12-hour maximum driving limit" but a `_placeholder` twin exists: "Bolt
  places a %d hour(s) maximum driving limit from when you go online." +
  "When you reach your %d hour(s) online limit, you'll only be able to
  receive new orders after a %d hour(s) offline compulsory break." The
  driver can pre-empt it: "Need a break?" → "Going to a break means that
  after completing your last accepted trip, you'll get new requests" →
  offline seamlessly (break_mode screen).
- **Notification-channel taxonomy** (Bolt Driver, 14 channels): awake/online
  status, new ride requests, status notifications, push, silent, route-change
  requests ("Heads-up when the rider asks to change pickup or drop-off"),
  emergency assistance, in-app calls, audio recording ("This ride is being
  recorded"), active ride, rider shared location, live activities per
  product. Online status persistent notif: "You're online / Waiting for ride
  requests".
- **Full Bolt Driver endpoint inventory** (classes3 strings) — notable
  beyond §6: `/driver/getHomeScreenCards` (**home cards are server-driven**),
  `/driver/getDriverNavBarBadges`, `/driver/boltClub/*` (loyalty),
  `/driver/getReferralsListScreen`, `/driver/safety/settingsItems`,
  `/driver/dashcam/{form,list,set,remove}` (dashcam product!),
  `/driver/getPricePolling`, `/driver/getPastOrderDetails`.
- Uber Driver ships `assets/geojson/` country boundary polygons
  (california/china/india/japan/south_korea, +`_approximate` twins) and
  Lottie equalizer/loading animations; `analytics_filter_prod_all_apps.json`
  + `bool_parameters_hash.txt` (remote-config hash pinning) confirmed again
  in 4.600.
- `rider_location_pager…`: Uber markets the no-progress auto-waiver as an
  onboarding selling point — regulatory-flavored disclosures exist too
  ("This price was set by an algorithm using your personal data…" for NY).
  Relevant precedent for Nairobi (ODPC) when we add dynamic pricing.

### 10. Round-2 MIZIGO copy-list (prioritized, mapped)

Clean-room as ever — we build the pattern in our own words and numbers.

| # | What to build | Evidence → | MIZIGO file(s) + guidance |
|---|---|---|---|
| 1 | **GPS-mismatch arrival confirm** (NOW): distance gate → title + one sentence + "Confirm arrival"/"Not there yet"; per-shipment `pinStatus` enum (disabled/optional/required/confirmed); wrong-POD blocks arrival; attemptsLeft on failure; config-driven threshold (150 m, ours) | §1 | `driver/DriverApp.tsx` (AT_PICKUP step) + `src/lib/geo.ts` distance + server action in `src/app/api/driver/…`; add `pinStatus` + `arrivalAttemptsLeft` to shipment state |
| 2 | **Decline-confirm + counter-offer**: confirm-decline dialog (no reason picker — Bolt has none); counter-offer sheet with ± steppers (server step), amount echoed on buttons ("Submit KSh X", "Accept KSh X"), button-becomes-status ("Waiting for customer reply"), per-action error lines; auto-offer disable-after-decline rule | §2 | `driver/DriverApp.tsx` offer card + new `CounterOfferSheet.tsx`; offer state in `src/lib/state-machine.ts` |
| 3 | **Fare-breakdown explainer system**: typed modal per fee cause (wait-time / tolls / arrears / price-adjust / distance-variance) sharing one reassurance footer; line-item tooltips | §3 | `customer/ReceiptFlow.tsx` + `ReviewStep.tsx`; content map in `src/lib/pricing.ts` |
| 4 | **Blocking paywall for unpaid/failed payment**: "payment didn't work" + "Pay another way" + cannot-dismiss body + cash fallback ladder (retry → alternate → cash) | §8 | `customer/PaymentStep.tsx` + `ReceiptFlow.tsx`; M-Pesa stuck state uses the same ladder |
| 5 | **EmptyState/ErrorState components** to the Bolt contract: illustration (ours) + `heading` title + `body` description + link-action (empty) vs button-action (error, "Try again"); future-tense copy rule + reassurance rule | §4 | `shared/ui.tsx` (`<EmptyState>`, `<ErrorState>`) then sweep list screens (`EarningsTab`, `NotificationsSheet`, history lists) |
| 6 | **Money rows: dotted-leader key-value + tabular numerals only on money**; money row = label regular + value tabular end-aligned | §5 | `shared/ui.tsx` `Money` + new `<KVRow divider="dots">`; use in receipts, quote market, earnings |
| 7 | **Driver price-dispute flow**: reason list where each reason is flagged (comment allowed? price-set allowed?); interaction mode per market (free input vs stepper vs disabled); calculated-vs-expected price display; already-reported guard | §6 | `customer/ProblemScreen.tsx` + new `src/lib/price-adjust.ts` (sibling of `cancellation.ts`); later a driver-side variant |
| 8 | **Earnings v3 completion**: payout review screen with fee row + explicit confirm + status history (Sent/Processing/Declined/Failed) + "Problem with payout?" help entry; balance-history tabs (weekly/daily) | §6 | `driver/EarningsTab.tsx` + `driver/DriverPayoutDetails.tsx` |
| 9 | **Driver Score card**: progress bar with retraining/blocking thresholds, positive/negative signals list, "score dropped" alert; formula = trailing-100-trips (our own weighting) | §9 | new `driver/DriverScoreCard.tsx` inside `DriverApp.tsx` sidebar; data from existing ratings/shipment history |
| 10 | **Auto-accept filters**: min price-per-km filter + optional-ride exclusions + "no filters set" warning + auto-disable on decline/cancel/miss | §2 | `driver/DriverApp.tsx` offer settings + `src/lib/feature-flags.ts` config |
| 11 | **Trip-relevant alerts channel taxonomy** (route-change heads-up, auto-accepted, "you're online" persistent status, recording-in-progress) | §9 | `driver/DriverApp.tsx` + `customer/NotificationsSheet.tsx` naming scheme |
| 12 | **Fatigue/shift limit with server-parameterized copy**: "%d-hour limit + %d-hour compulsory break" placeholders; "Need a break?" pause that finishes the last accepted job first | §9 | `driver/DriverApp.tsx` shift gating; constants in `feature-flags.ts` (our numbers, e.g. 10h/8h for boda) |
| 13 | **Demand/forecast copy pattern**: methodology disclosure ("calculated from the last 4 weeks… not a guarantee") + "Now" chip + "Areas near you" list + km distances | §7 | `admin/OpsTab.tsx` heatmap + future driver demand card |
| 14 | **Server-driven cards**: home cards + earnings screens as typed data (screen registry v2) — extend our state-machine with a `ScreenModel` layer rather than hardcoding layouts | §6, §7 | `src/lib/state-machine.ts` + `src/lib/feature-flags.ts` |
| 15 | **Offer-card visual spec**: 16dp-radius card, 4dp gaps, layered neutral bg, secondary button for "Change price"; swipe-to-accept with tooltip | §2, §5 | `driver/DriverApp.tsx` offer card |

### 11. Contradictions / corrections to round 1

1. Round 1 §4.3 implied a client-side GPS threshold on the pickup confirm —
   **wrong**: the arrival gate is server-driven (info-message push +
   per-order status enum); no meter constant exists in the binary. Our
   implementation should read the threshold from config, not copy a number
   (there is none to copy).
2. Round 1 said "117 named UI states" — precisely **117 rules / 115 unique
   state names** (duplicates carry different scenes/min_versions).
3. Round 1 §4.4's "12-hour maximum driving limit" is the *hardcoded default*;
   a `%d`-parameterized twin ships alongside it (the limit is per-market
   server config).
4. Round-1 item 14 sketched decline "reason chips" — Bolt ships **no
   decline-reason picker** (only a confirm). Reasons exist for cancel and
   price-dispute only. Our planned reason chips would exceed Bolt's pattern;
   keep or drop, but know it's ours.
5. Uber Driver 4.600 (round 2) still has **no GPS-mismatch dialog** — PIN
   verification + nav-state status copy instead; don't look to Uber for the
   pickup-distance pattern.
