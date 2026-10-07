# Uber / Bolt Platform Architecture — Technical Teardown for MIZIGO v2

Task 11-a (research-subagent, architecture). Companion to `docs/UBER_BOLT_TEARDOWN.md` (UX layer) and `docs/research/SAFETY_TECH_TEARDOWN.md` (safety implementation layer); this doc covers the **technical architecture layer**: geospatial indexing, dispatch/matching, pricing internals, transport protocols, and mobile app architecture. Public sources only — first-party engineering blogs, open-source repos, official docs. Clean-room: we learn the design, never copy proprietary code; no decompilation.

**Legend:** **[S]** = verified against a fetched public page (URL given) · **[S-p]** = documented via search-result snippet of a public page (exact page fetch-blocked/JS-walled or path unverified — noted) · **[I]** = inferred by this agent from documented behavior · **[U]** = unknown / not publicly documented.

Research artifacts: 26 search-result JSONs under `tool-results/s11a_*.json` (from this + a prior partial run) and 13 curl-fetched pages/READMEs under `scripts/research/arch/pages/`. Uber.com blocks plain HTTP clients intermittently (406 bot-defense); z-ai `web_search` 429-rate-limited most of this session, so key claims below lean on successfully fetched pages ([S]) wherever possible.

---

## 1. H3 geospatial indexing (Uber open-source)

### 1.1 Why hexagons, not squares or polygons

From Uber's own H3 announcement (Isaac Brodsky, June 27, 2018) — fetched in full **[S]** — https://www.uber.com/blog/h3/ :

- Purpose: *"Uber developed H3, our grid system for efficiently optimizing ride pricing and dispatch, for visualizing and exploring spatial data… We use H3 as the grid system for analysis and optimization throughout our marketplaces."* **[S]**
- Why grid at all: analyzing every event at exact GPS coordinates is *"very difficult and expensive"*; bucketing events into cells makes city-scale marketplace analysis practical. **[S]**
- Why hexagons: *"people in a city are often in motion, and hexagons minimize the quantization error introduced when users move through a city. Hexagons also allow us to approximate radiuses easily."* **[S]** (All 6 neighbors of a hexagon are equidistant; squares have 2 distinct neighbor distances — adjacent vs diagonal — making "nearby" ambiguous; H3 docs compare hexagon vs square-cell systems explicitly at https://h3geo.org/docs/highlights/indexing/ **[S]**.)
- Why not zip-code / ops-drawn polygons: *"unusual shapes and sizes which are not helpful for analysis, and are subject to change for reasons entirely unrelated"*; hand-drawn zones *"require frequent updating as cities change."* Neighborhoods are instead represented by **clustering adjacent cells**, and *"determining membership of a cluster is as efficient as a set lookup operation."* **[S]**
- Concrete ride-hail uses stated by Uber: **surge pricing from per-hex supply/demand** (*"we calculate surge pricing by measuring supply and demand in hexagons in each city that we serve"*), and marketplace signals such as *"two ride requests within close proximity to a specific driver"* for pooling. **[S]**

### 1.2 Hierarchy & resolution levels

- H3 is hierarchical with **aperture 7**: *"Every hexagonal cell… has seven child cells below it in this hierarchy"*; subdivision is approximate (alternating grid orientation). 12 pentagons exist at every resolution (unavoidable icosahedron artifacts — they need special-casing in neighbor operations). **[S]** https://h3geo.org/docs/highlights/indexing/
- Full resolution table — https://h3geo.org/docs/core-library/restable/ **[S]** (fetched; values below verbatim):

| Res | Cells worldwide | Avg hex area | Avg edge length |
|-----|-----------------|--------------|-----------------|
| 6 | 14,117,882 | 36.13 km² | 3.72 km |
| 7 | 98,825,162 | 5.16 km² | 1.41 km |
| 8 | 691,776,122 | 0.74 km² | 0.53 km |
| 9 | 4.84 B | 0.105 km² | 0.20 km |
| 10 | 33.9 B | 0.015 km² (15,047 m²) | 0.076 km (75.9 m) |

- City-scale usage in the wild: the State of Vermont's open-data H3 extract ships **resolution 8 ("approximately 0.5 km per edge")** for location indexing, with a res-9 (~0.2 km) variant also published **[S-p]** (sov-vcgi.opendata.arcgis.org / geodata.vermont.gov). Uber's own city use is commonly cited in the res 7–9 band; the exact per-market resolution Uber uses for surge/matching is not published **[U]**. For MIZIGO's purposes the geometry speaks for itself: res 8 gives ~0.5 km edges — a `gridDisk(k)` ring at res 8 spans a credible Nairobi pickup radius **[I]**.

### 1.3 h3-js API basics (what MIZIGO would actually call)

`h3-js` — https://github.com/uber/h3-js **[S]** (README fetched): *"provides a pure-JavaScript version of the H3 Core Library… can be used either in Node >= 6 or in the browser. The core library is transpiled from C using emscripten, offering full parity with the C API."* `npm install h3-js`; ES6 `import {latLngToCell} from "h3-js"`. H3 **v4** (Aug 23, 2022) renamed most functions. Key v4 functions verified against h3geo.org API docs **[S]**:

- Indexing (https://h3geo.org/docs/api/indexing/): `latLngToCell`, `cellToLatLng`, `cellToBoundary` (→ GeoJSON-ready polygon).
- Traversal (https://h3geo.org/docs/api/traversal/): `gridDisk(origin, k)` (all cells within distance k — the expanding-ring primitive), `gridDistance`, `gridRing`, `gridPathCells` (line of cells between two cells).
- Hierarchy (https://h3geo.org/docs/api/hierarchy/): `cellToParent`, `cellToChildren`, `compactCells` / `uncompactCells` (merge small hexes into large ones for display at low zoom).
- 122 base cells at res 0 (110 hexagons + 12 pentagons) **[S]** (restable).
- Pentagon caveat: `gridDiskUnsafe` variants skip pentagon checks; the 12 pentagons per resolution have no full 6th neighbor and must be special-cased in neighbor operations — a non-issue if MIZIGO uses the safe `gridDisk` and treats a pentagon like any cell it returns **[I]**.
- Hex geometry used below **[I, derived from the [S] restable numbers]**: for edge length *a*, circumradius = *a*, inradius = √3/2·*a*, and adjacent-cell **center-to-center spacing = √3·a**. So at res 8 (a ≈ 0.53 km): neighbors' centers sit ~0.92 km apart; `gridDisk(1)` spans ~1 km, `gridDisk(2)` ~1.8–2 km, `gridDisk(3)` ~2.8 km.

### 1.4 Choosing resolutions for Nairobi cargo **[I — derived from the [S] table in §1.2 + MIZIGO use cases]**

| MIZIGO purpose | Suggested res | Edge / spacing | Why
|---|---|---|---|
| City heatmap, ops dashboard, demand reporting | 7 | 1.41 km edge | ~5.2 km² cells ≈ Nairobi neighborhoods (CBD, Westlands, Industrial Area)
| **Matching + surge cell (default)** | **8** | 0.53 km edge, ~0.92 km center spacing | gridDisk(1–3) = 1–3 km pickup band — right scale for van/lorry pickup in a congested city
| Pickup-point precision, driver "at pickup" detection | 9 | 0.20 km edge | distinguishes "on your street" from "in the estate"
| Storing exact points | — (lat/lng) | — | keep raw coords; cells are an *index*, not a replacement **[I]**

Rule of thumb from H3's design: pick the resolution whose cell diameter ≈ the radius you most often query **[I]**. Use `cellToParent(cell, 7)` to roll res-8 activity up to res-7 dashboards — store each event once at the fine resolution (res 8) and aggregate on read; never store both **[I]**.

### 1.5 Ride-hail uses of H3 (summary of documented pattern)

1. **Matching radius**: hexes *"approximate radiuses easily"* **[S]** (uber.com/blog/h3/) — i.e., "drivers within k cells of pickup" instead of great-circle distance scans over all supply. Community system-design write-ups describe this as incrementally expanding search rings when no supply is found in the inner disk **[S-p, secondary]** (systemdesignhandbook.com; systemcraft.in: *"expand the search radius and try again… If still no match after 60 seconds, notify rider 'No drivers available.'"*).
2. **Supply/demand heatmaps**: bucket online drivers vs open requests per cell (the H3 blog's own bucketing example — cars → hexagons → shaded hexagons) **[S]**.
3. **Surge zones**: pricing computed per hex from supply/demand (§3) **[S]**; larger zones by clustering/parenting cells **[S]**.

---

## 2. Dispatch / matching

The documented Uber dispatch picture, assembled from the sources below (each step's strength varies):

1. Rider requests → request lands in a **geo-indexed queue** keyed by pickup cell **[I from S-p community HLDs]**.
2. Dispatch scores candidate drivers with **ML over "thousands of features in real time"** — not simple nearest-driver **[S-p]** (uber.com/blog/engineering-reliability-machine-learning/).
3. Candidates come from cells near the pickup — Uber: hexes "approximate radiuses easily" **[S]** (uber.com/blog/h3/); community HLDs describe **incrementally expanding search rings** with retry, ending in "no drivers available" **[S-p, secondary]**.
4. Matching runs **in batches** that lower waiting times area-wide rather than greedily per-request **[S-p]** (Cornell market-design blog; academic literature on greedy-vs-batching).
5. The winning pair gets an **offer broadcast to multiple drivers** (driver-side offer card with countdown, see UX teardown §3.14); first accept wins **[I — offer fan-out mechanics are [U] first-party]**.

What is NOT public: the exact scoring features, batch window length, offer radius ladder, and fan-out count are all **[U]** — anything specific beyond the above should be treated as folklore, not Uber documentation.

Supporting evidence: Uber engineering (Nov 9, 2017, "Engineering More Reliable Transportation with Machine Learning"): *"Once a rider is ready to take a trip, we also use ML to match riders to drivers. Our dispatch algorithms look at thousands of features in real time"* — URL slug verified live (https://www.uber.com/blog/engineering-reliability-machine-learning/, HTTP 200) but body bot-blocked during this session → **[S-p]**. Same article series is Uber's primary public statement that matching scores drivers rather than nearest-driver-greedy **[I from S-p]**.
- **Batch matching:** Uber matches rider/driver in windows that *"lower waiting times for everyone in the area"* — documented by Cornell's market-design blog describing Uber's system as **"batch matching"** (Oct 23, 2019, blogs.cornell.edu) **[S-p, secondary but academic]**. Academic follow-ups (Eom et al. 2025/2026, INFORMS/SSRN; Gupta's bounded-regret multiway matching) formalize greedy-vs-batching trade-offs in ride-hail dispatch **[S-p]**. Uber's own first-party description of the production batch-matching algorithm internals is **[U]**.
- **Offer distribution to multiple drivers:** Uber's driver-app UX (offer card with countdown, documented in `docs/UBER_BOLT_TEARDOWN.md` §3.14) implies an offer is broadcast and the first driver to accept wins; first-party engineering detail of the offer-fanout policy is **[U]**. Community HLDs describe concurrent match locking (one driver, one rider at a time) **[S-p, secondary]** (systemcraft.in).
- **Location pipeline feeding dispatch:** driver apps sample and upload GPS roughly every second per driver-forum teardowns **[S-p, forum — treat as anecdotal]** (uberpeople.net, 2018); Uber engineered a dedicated "beacon" device to improve vehicle location accuracy (uber.com, Nov 5, 2019) **[S-p]**; "How Uber matches 2M drivers in real time" community write-ups cite geohash-style sharding and ~500K location pings/sec scale **[S-p, secondary, numbers unverified]** (systemcraft.in).
- **Real-time push vs polling:** Uber engineering (Dec 17, 2020) describes moving *"from polling for refreshing the app to a gRPC-based bi-directional streaming protocol"* for live app updates **[S-p]** (uber.com; exact URL [U]).

### 2.1 How much of this MIZIGO should believe **[I]**

Uber runs at a scale where batching and ML are existential; a marketplace with tens of concurrent shipments benefits from the *shape* (cell-indexed supply → ring search → batched scoring → timed offers) while the ML scoring can start as a 3-term score: `capacityFit × distanceDecay × reliability`. The documented-but-undetailed parts ("thousands of features") are where MIZIGO must design its own, not copy what isn't published.

---

## 3. Pricing & surge internals

### 3.1 Upfront (fixed) fares

- Uber quotes an **upfront fare** at request time; community fare guides document the mechanics: the surge/dynamic multiplier *"is calculated by multiplying your total fare (before tolls)"* **[S-p]** (ride.guru, 2016). Upfront prices are computed in real time from **driver availability, traffic conditions, and request volume** — i.e., price is a function of live supply/demand + predicted route, not just the rate card **[S-p]** (affl.com; consistent with Uber's official help pages). Uber's first-party algorithm for upfront pricing is **[U]**.
- DeepETA (Uber AI/Maps, Feb 9, 2022 — fetched in full) states the dependency directly: *"We use ETAs to calculate fares, estimate pickup times, match riders to drivers, plan deliveries, and more."* **[S]** https://www.uber.com/blog/deepeta-how-uber-predicts-arrival-times/ — i.e., **the ETA model is an input to the price**.

### 3.2 Surge mechanics

- **Per-hex supply/demand:** surge is computed *"by measuring supply and demand in hexagons in each city"* **[S]** (uber.com/blog/h3/). Academic survey literature confirms surge *"varies spatially at the hexagon (or location) level"* **[S-p]** (researchgate.net).
- **Trigger condition:** Uber's marketplace pages: surge *"automatically goes into effect when there are more riders in a given area than available drivers"* **[S-p]** (uber.com, exact URL [U]).
- **Rider-facing transparency:** the multiplier is shown in-app before request **[S-p]** (andrewchen.com hosting "A Deep Dive into the Anatomy of Surge", J. Hall — a widely-cited white-paper analysis of Uber's surge architecture).
- **Historical scale:** Bill Gurley (investor, 2014): dynamic pricing affected *"less than 10% of trips"* in early years **[S-p]** (abovethecrowd.com, Mar 11, 2014). Modern multiplier distribution / cap values: **[U]**.

### 3.3 ML ETAs — DeepETA architecture (the clean-room-learnable part)

From the fetched DeepETA post **[S]**:

1. **Hybrid "ETA post-processing"**: *"Our physical model is a routing engine that uses map data and real-time traffic measurements to predict an ETA as a sum of segment-wise traversal times along the best path"*; then *"machine learning [predicts] the residual between the routing engine ETA and real-world observed outcomes."* They call this hybrid approach **ETA post-processing** — *"generally easier to assimilate new data sources… by updating the post-processing model than it is to refactor the routing engine."*
2. **Evolution:** gradient-boosted trees (XGBoost — *"one of the largest and deepest XGBoost ensembles in the world at that time"*) → deep neural net for scaling.
3. **Requirements that drove design:** latency (*"return an ETA within a few milliseconds at most"*), MAE accuracy vs incumbent, generality across mobility + delivery.
4. **Features:** spatial/temporal — *"origin, destination and time of the request"* — plus route/real-time signals.

**Takeaway for a small player:** keep the routing engine (OSRM) as the physical model; correct its systematic error with a cheap learned/tabled residual per (hour-of-day × zone). That is DeepETA's architecture at toy scale, fully clean-room **[I]**.

---

## 4. Protocols & RIBs (brief)

### 4.1 gRPC internally, QUIC/HTTP-3 to the edge (client-server)

Uber's protocol story is two-tier: **gRPC (and legacy TChannel) between thousands of internal microservices**, and **QUIC/HTTP-3 between the mobile apps and the edge** — because the two links fail differently (datacenter fiber vs. lossy cellular) **[S]** (QUIC post) + **[S-p]** (gRPC posts).

- **Microservices over gRPC:** Uber operates *"thousands of internal services that expose APIs over HTTP, gRPC, and TChannel"* (uber.com engineering, recent post; exact URL [U]) **[S-p]**. Historically Uber built its own RPC (TChannel) and has been migrating toward gRPC per industry coverage **[S-p]** (nordicapis.com; levelup.gitconnected.com).
- **Client-server on mobile networks — QUIC** (fetched in full **[S]**, https://www.uber.com/blog/employing-quic-protocol/, May 2019): Uber's apps run over *"wireless connectivity from over 4,500 mobile carriers"* in 600+ cities; *"the HTTP/2 stack fares poorly in dynamic, lossy wireless networks"* with problems *"traced directly to TCP implementations buried in OS kernels."* They adopted **QUIC** — *"a stream-multiplexed modern transport protocol implemented over UDP… currently being standardized by the IETF as HTTP/3"* — and measured a **"reduction of 10-30 percent in tail-end latencies for HTTPS traffic at scale in our rider and driver apps,"** plus *"end-to-end control over the flow of packets in the user space."* (0-RTT connection establishment is a standard QUIC property motivating mobile adoption, though the Uber post itself emphasizes tail latency and user-space control **[S]**.) Relevance: Nairobi mobile networks are exactly the "dynamic, lossy wireless" regime Uber optimized for **[I]**.
- **Live location delivery:** polling → gRPC bidirectional streaming for app freshness **[S-p]** (§2). Web equivalent for a PWA: one persistent channel (SSE/WebSocket) for shipment + driver deltas instead of REST polling **[I]**.

### 4.2 RIBs (Router-Interactor-Builder) — Uber's open-source mobile architecture

- Repo (README fetched **[S]**, https://github.com/uber/RIBs): RIBs is *"the cross-platform architecture framework behind many mobile apps at Uber… designed for mobile apps with a large number of engineers and nested states."* Key differentiators vs MV*/VIPER: **"Business logic drives the app, not the view tree"**; a RIB need not have a view; the app has a **deep business-logic tree with a shallow view hierarchy** — *"isolating business logic nodes, while maintaining a shallow view hierarchy making layouts, animations and transitions easy."* State is communicated via **hierarchical DI** (each RIB declares dependencies; parents fulfill them for child Builders). Scaled to *"hundreds of engineers… apps with hundreds of RIBs."*
- Backstory post (fetched **[S]**, https://www.uber.com/blog/new-rider-app-architecture/): the 2017 rider-app rewrite to "riblets"; reliability goal **99.99% availability** for the core request flow (*"one cumulative hour of downtime a year"*); framework of **core vs optional code** so experiments can't take down the booking path.
- **Mapping to React [I]:** RIBs ≈ separating a state/routing tree from a shallow presentational component tree. MIZIGO already embodies this: the 14-state shipment state machine lives in `src/lib/state-machine.ts` (plain TS, UI-independent) and screens render it. The RIBs insight to keep: *business-logic nodes own navigation/state transitions; components stay thin and swappable; "core" booking states get hard guarantees, "optional" features degrade independently.*

---

## 5. Bolt — architecture visibility

Bolt publishes very little engineering detail. Public record is essentially: (a) its **pricing model** — city-specific base+time+distance fares with demand multipliers in peak periods **[S-p]** (bolt.eu pricing blog, Jun 2025; gmdirecthire.com: surge increments are *"a multiplier of the standard rates"*) — and (b) product-level features (already covered in `UBER_BOLT_TEARDOWN.md`). No first-party Bolt engineering blog on dispatch/H3/matching was found; web search for Bolt open-source architecture is heavily polluted by the unrelated "bolt.new" product **[S-p, negative result]**. Bolt's internal matching/pricing architecture: **[U]**.

---

## 6. Source index

**Fetched & verified [S]:** 1. https://www.uber.com/blog/h3/ · 2. https://h3geo.org/docs/core-library/restable/ · 3. https://h3geo.org/docs/highlights/indexing/ · 4. https://h3geo.org/docs/api/indexing/ , /api/traversal/ , /api/hierarchy/ · 5. https://github.com/uber/h3 · 6. https://github.com/uber/h3-js · 7. https://github.com/uber/RIBs · 8. https://www.uber.com/blog/new-rider-app-architecture/ · 9. https://www.uber.com/blog/deepeta-how-uber-predicts-arrival-times/ · 10. https://www.uber.com/blog/employing-quic-protocol/
**Snippet-backed [S-p]:** 11. https://www.uber.com/blog/engineering-reliability-machine-learning/ (slug live, body bot-blocked) · 12. uber.com surge marketplace page (URL [U]) · 13. abovethecrowd.com (Mar 2014) · 14. andrewchen.com — "Anatomy of Surge" (J. Hall) · 15. ride.guru (2016) · 16. affl.com upfront pricing · 17. blogs.cornell.edu batch matching (Oct 2019) · 18. systemdesignhandbook.com + systemcraft.in + system-designschool.io (secondary HLDs) · 19. bolt.eu pricing blog (Jun 2025) · 20. uberpeople.net GPS cadence (forum) · 21. sov-vcgi.opendata.arcgis.org / geodata.vermont.gov (H3 res 8/9 extracts) · 22. nordicapis.com, levelup.gitconnected.com (gRPC at Uber) · 23. systemcraft.in "How Uber matches 2M drivers" (scale figures unverified) · 24. uberpeople.net / uber.com beacon (Nov 2019)

---

## 7. What MIZIGO should adopt (clean-room) — prioritized

Paths refer to the real repo layout: `src/lib/{geo,matching,pricing,routing,state-machine,rust-engine}.ts`, `src/wasm/pricing_core.wasm`, `src/components/mizigo/shared/{LiveMap,MapCanvas}.tsx`.

| # | Pattern (source) | Evidence | Effort | Value for Nairobi cargo | Concrete MIZIGO mapping |
|---|------------------|----------|--------|--------------------------|--------------------------|
| 1 | **H3 cell keys on every geo entity** — store pickup/dropoff/driver cells, not just lat/lng (Uber H3 §1.1) | uber.com/blog/h3/ | **S** | Makes "near", heatmap, and zone ops O(1) set lookups; works offline in SQLite | `src/lib/geo.ts`: `addH3(lat,lng,res)` — persist `originCell`/`destCell` (res 8) + `pickupCell` (res 9) on Shipment & Driver; `latLngToCell`, `cellToBoundary` from `h3-js` |
| 2 | **Expanding-ring matching** — `gridDisk(k=1→2→3)` at res 8 (~0.5 km edges), stop at first ring with capacity (Uber "approximate radiuses"; community HLDs) | uber.com/blog/h3/ + [S-p] #18 | **M** | Replaces O(all-drivers) distance scans; ring 3 ≈ ~1.5–3 km — right Nairobi pickup band for a lorry/boda | `src/lib/matching.ts`: candidate query = `gridDisk(pickupCell, k)` over driver cells, scored by `gridDistance`, vehicle capacity, licence class; k widens on empty rings with retry/backoff |
| 3 | **Batch window + multi-driver offer fan-out, first-accept-wins** (Uber batch matching [S-p] #17; offer card UX in UX teardown §3.14) | [S-p] #17 | **M** | Cargo supply is thin (vans vs bodas); batching 15–30 s pools demand so one driver is chosen for the best 2–3 shipments, not greedily | `src/lib/matching.ts`: collect requests N s → score pairs (capacity × distance × price) → emit offers to top-m drivers with expiry; re-offer on decline/timeout; log offer events on Shipment |
| 4 | **Per-hex supply/demand index → demand multiplier bands** (surge = per-hex S/D, §3.2) — *demand pricing, applied transparently & capped* | uber.com/blog/h3/ | **M** | Nairobi demand is spiky (CBD weekday AM, markets, rains); smooths thin cargo supply without gouging | `src/lib/pricing.ts` + `src/wasm/pricing_core.wasm` (Rust fn): inputs += `demandIndex = openShipments/idleDrivers per cell` → multiplier bands (1.0×–1.5× cap), shown in quote UI as "busy area" chip; honest-label it (cargo trust economy) |
| 5 | **Upfront quote lock + expiry** (Uber upfront fares §3.1) | [S-p] #15/#16 | **S** | Locks shipper's price for decision time; prevents disputes at POD | `src/lib/pricing.ts` + `state-machine.ts`: quote snapshot (rate, distance, multiplier, OSRM ETA) stored on Shipment with `quoteExpiresAt` (~10 min); stale quote → recalc flow |
| 6 | **DeepETA-lite: OSRM ETA + empirical residual correction** (DeepETA post-processing §3.3) | uber.com/blog/deepeta… | **S–M** | OSRM over OSM systematically underestimates Nairobi traffic (jam hours); a residual table fixes the worst bias cheaply | `src/lib/routing.ts`: keep OSRM as-is; add correction factor per (hour-of-day bucket × res-7 parent cell) computed from completed-shipment actuals; feed corrected ETA into pricing + LiveMap ETA chips |
| 7 | **H3 supply/demand heatmap overlay** (Uber's own H3 bucketing visualization §1.1) | uber.com/blog/h3/ | **S** | Ops + shipper trust: see where vans/bodas are scarce before quoting | `src/components/mizigo/shared/MapCanvas.tsx` + `LiveMap.tsx`: GeoJSON polygon layer from `cellToBoundary` of active cells, fill-color by demandIndex; `compactCells` + `cellToParent` for zoomed-out city view; hover = cell stats |
| 8 | **Streaming location channel, not polling** (Uber polling→bidirectional streaming §4.1) | [S-p] #22 + QUIC post | **S** | Driver GPS every ~2–4 s over one SSE/WebSocket beats REST polling on Kenyan mobile data; HTTP/3 (QUIC) already served at CDN edge | `src/lib/routing.ts`/tracking API: SSE endpoint for driver position deltas keyed to active shipments; keep `/api/track/[token]` share page reading the same stream |
| 9 | **RIBs-style logic/view separation as a codified rule** (§4.2) | github.com/uber/RIBs | **S** | Protects the 14-state shipment machine from UI churn; enables the "core vs optional" reliability split | `src/lib/state-machine.ts` stays UI-free; add an ENGINEERING_RULES.md rule: transitions/fees/dispatch logic live in `src/lib/*`, components in `src/components/mizigo/*` only render + dispatch intents; booking-critical states treated as "core" |
| 10 | **Zone clustering from cells, not hand-drawn polygons** (H3 clustering §1.1) | uber.com/blog/h3/ | **M** | Ops needs corridors (CBD–Industrial Area–JKIA) without maintaining polygon files | `src/lib/geo.ts`: neighborhood = set of res-8 cells (or parent res-7 cell); membership check = `Set.has(cell)`; use for driver home zones + demand reporting |

### 7.1 Suggested adoption sequence **[I]**

- **P0 (this sprint, all S-effort):** #1 H3 keys, #5 quote lock, #8 SSE stream — pure plumbing, no UX risk.
- **P1:** #2 ring matching + #3 batch/offers (matching.ts rewrite behind current API), #7 heatmap layer, #9 codify the rule.
- **P2 (needs volume data):** #4 demand multiplier (requires the per-hex counters from #1 running for a few weeks), #6 ETA residual table (requires completed-shipment actuals), #10 zone clustering (once ops asks for corridors).

This ordering follows the evidence: every P2 pattern depends on data that P0 instrumentation starts producing.

### 7.2 Not adopted / deprioritized

QUIC client implementation (browser handles HTTP/3 transparently — nothing to build) **[I]**; ML feature-rich dispatch (thousands of features [U] — overkill at MIZIGO's volume; start with the 3-factor score in #2/#3) **[I]**; gRPC (server-less Next.js API routes + JSON/SSE is the right weight) **[I]**; emulating Uber's separate pricing/pricing-with-surge services — one Rust/WASM core covers quote math deterministically **[I]**.

**Clean-room note:** everything above is derived from public engineering blogs, official H3 documentation, and open-source READMEs (Apache-2.0). Design patterns are not proprietary; no Uber/Bolt code, decompilation, or confidential material was consulted. H3 itself is open-source (Apache-2.0) and safe to depend on directly.
