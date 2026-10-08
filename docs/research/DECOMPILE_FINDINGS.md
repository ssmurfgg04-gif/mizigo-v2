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
