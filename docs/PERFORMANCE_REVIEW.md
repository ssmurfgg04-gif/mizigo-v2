> **Provenance:** moved into `docs/` from `scripts/pr-review/PERFORMANCE_REVIEW.md` for discoverability (CI + hygiene track, task 10-H). The original stays in place.

# MIZIGO v2 Performance Review and Remediation Plan

This document captures the main performance risks observed in the current codebase and a prioritized set of remediation tasks. It is intentionally exhaustive so it can be used as a design note for future implementation work.

## Scope and context

Repository: ssmurfgg04-gif/mizigo-v2

Observed architecture summary:
- Next.js application with Prisma + SQLite
- Marketplace logic centered around shipment lifecycle state transitions
- Admin dashboards and analytics built from many nested database queries
- Demo/sandbox behavior is embedded into runtime logic for shipment progression and notification flows
- Large DTO generation for shipment payloads is used across customer, driver, and admin APIs

This is a strong demo/product prototype, but it is not yet optimized for production-scale concurrency, large historical analytics, or admin-heavy operations.

## High-risk performance issues

### 1) Eager nested queries in admin endpoints

File cluster:
- src/app/api/admin/route.ts
- src/lib/shipments.ts

Risk:
- The admin routes fetch large, nested data graphs in a single query, including shipments, items, events, quotes, ratings, messages, customer, driver, vehicle, and category relations.
- These are all large documents and the admin dashboard can easily balloon into multi-megabyte payloads.

Why it hurts:
- More memory use on the server
- More serialization cost in Next.js
- More latency on each admin dashboard refresh
- Slower database execution as dataset grows

Observed patterns:
- `findMany({ include: { ... } })` with multiple relations
- `Promise.all([...])` across several large tables
- repeated joins and object expansion for each shipment row

Recommendations:
- Split admin API into smaller read models: summary, shipments table, payouts, disputes, support queue, analytics
- Use explicit `select` clauses for each tab instead of `include`
- Add pagination and server-side filtering instead of loading all rows in memory
- Use dedicated DTOs for each screen rather than reusing a single full-shipment payload

### 2) Full-DTO creation for every shipment request

Files:
- src/lib/shipments.ts
- src/lib/types.ts

Risk:
- `shipmentDTO()` constructs a very rich object including route polyline, cargo, driver, customer, fare, events, quotes, messages, ratings, live state, etc.
- This is computed on every shipment read and is expensive if the request is frequent.

Why it hurts:
- CPU and memory churn on customer and driver apps
- Repeated JSON parsing of nested strings
- Repeated route generation for each inbound request

Observed patterns:
- `JSON.parse(s.stops || "[]")`
- `JSON.parse(s.specialHandling || "[]")`
- `JSON.parse(r.tags || "[]")`
- `routePolyline(s)`
- `simulateLive(s)`

Recommendations:
- Avoid serializing heavy fields unless the client explicitly requests them
- Cache serialized DTOs for short-lived requests if the data is hot
- Defer expensive nested serialization to the UI layer when possible
- Precompute some fields in the database or cache layer instead of generating them repeatedly

### 3) Repeated database fetches and polling churn

Files:
- src/app/api/shipments/[id]/route.ts
- src/app/api/shipments/[id]/action/route.ts
- src/lib/shipments.ts

Risk:
- The shipment detail route contains sandbox progression logic that repeatedly fetches and updates shipment state.
- The code calls `getShipmentFull` more than once for the same flow and does per-step event creation.

Why it hurts:
- Extra DB round-trips during every progression cycle
- Repeated state reads can amplify under real-time polling
- It is fine in a demo, but not in a production workload with many active shipments

Recommendations:
- Introduce a dedicated shipment-state service with fewer reads per transition
- Batch or debounce state advancement logic for live tracking
- Add explicit read-through cache for active shipment detail payloads
- Use a lightweight projection for live tracking instead of the full DTO

### 4) Analytics logic done in JS instead of SQL

File:
- src/app/api/admin/route.ts

Risk:
- The analytics tab computes route counts, category counts, driver totals, daily aggregates, and summary metrics by iterating through large arrays in JavaScript.

Why it hurts:
- O(n) processing across all historical rows on every request
- High CPU use as records grow
- Harder to scale and maintain

Observed patterns:
- `for (let i = 13; i >= 0; i--)`
- `completed.filter(...)` and `reduce(...)` loops
- object aggregation with `routeCount`, `catCount`, `driverAgg`

Recommendations:
- Move aggregation to Prisma/SQL grouping (`groupBy`, `aggregate`, date truncation)
- Precompute daily summary tables if this is used frequently
- Add reporting tables for product metrics
- Add indexes on commonly filtered fields like created dates and status

### 5) SQLite mismatch for production market traffic

File:
- prisma/schema.prisma

Risk:
- The app is built around SQLite by design.
- For shipment marketplace workloads, this creates a hard ceiling on concurrency, reporting complexity, and write throughput.

Why it hurts:
- Worse concurrent write performance
- More expensive analytics and joined reporting
- Harder to scale on multi-user traffic
- Risk of lock contention around active shipment events and payments

Recommendations:
- Use PostgreSQL for production workloads
- Keep SQLite only for local dev, demos, low-volume staging, or test seeds
- Maintain the same Prisma schema contract but migrate the datasource provider for production

### 6) N+1 patterns and repeated resource lookups

Files:
- src/app/api/admin/route.ts
- src/lib/shipments.ts
- src/app/api/shipments/[id]/route.ts

Risk:
- Many endpoints fetch a list, then build derived maps (`Object.fromEntries`) and then do additional lookups per record.
- This pattern is especially visible in the admin workbench and support flows.

Why it hurts:
- More DB round-trips
- Slower page response times under moderate traffic
- More code complexity and more chances for duplication bugs

Recommendations:
- Batch lookups by IDs with `in: [...]`
- Use a single `findMany` with the necessary relations instead of repeated `findUnique` calls
- Normalize lookup data before response mapping

### 7) Unbounded or too-large in-memory filtering

Files:
- src/app/api/admin/route.ts
- src/app/api/shipments/route.ts

Risk:
- Some endpoints fetch a bounded set, but others fetch a large collection and then apply filter logic in memory.

Why it hurts:
- High memory and CPU cost
- Harder to scale as the database grows
- Filtering mostly in JS is wasteful compared to DB filtering

Recommendations:
- Move search/filter logic to Prisma queries as much as possible
- Add a proper API search model and pagination
- Push derived filters to DB indexes before JS filtering

### 8) Event-heavy write choreography

Files:
- src/lib/shipments.ts
- src/app/api/shipments/[id]/action/route.ts

Risk:
- Each important step creates `shipmentEvent` records, notifications, payment adjustments, and driver updates.
- These are sensible features, but they create write amplification.

Why it hurts:
- Slower state transitions under load
- More transaction contention
- More risk of partial-state failures during update sequences

Recommendations:
- Consolidate event+notification creation into a single transactional unit where possible
- Use queued background workers for non-critical notifications
- Reduce write fan-out for low-priority events

### 9) Over-serialization of large arrays and metadata

Files:
- src/lib/shipments.ts
- src/lib/types.ts

Risk:
- Many arrays are serialized into large response objects even when only a subset is needed.
- Customer app or admin screens often only need a few fields, but the backend exposes a heavier payload.

Why it hurts:
- More network traffic
- More client-side processing
- More time to render UI

Recommendations:
- Use partial payloads by view or screen
- Introduce per-endpoint response interfaces
- Avoid returning `messages`, `ratings`, `quotes`, and full event streams unless necessary

### 10) Lack of query-level indexing strategy

Files:
- prisma/schema.prisma
- all DB access points

Risk:
- There are many likely root fields used in filtering and sorting, but the schema seems to emphasize model relationships more than optimization.

Important fields likely needing indexes:
- Shipment.status
- Shipment.createdAt
- Shipment.customerId
- Shipment.driverId
- Shipment.pickupArea / dropoffArea
- Shipment.categoryId
- PaymentEvent.shipmentId
- PaymentEvent.status
- Dispute.shipmentId
- Dispute.status
- Notification.userId
- Notification.role
- Quote.shipmentId
- Quote.status
- Driver.status
- Driver.userId
- User.role

Recommendations:
- Add indexes to the Prisma schema for common query patterns
- Review query plans under realistic seed data
- Add explicit migration smoke checks before production

## Performance hotspots by file

### src/app/api/admin/route.ts

Main risks:
- Multiple heavy `findMany` calls with nested include relations
- UI summary loads large data sets and then compute derived stats in JS
- analytics tab expands arrays and builds running maps in memory

Priority fixes:
- Break into dedicated tab-endpoints or service functions
- Add pagination and explicit selects
- Move analytics to SQL aggregation

### src/lib/shipments.ts

Main risks:
- DTO construction is heavy for every shipment read
- `JSON.parse` on multiple fields per DTO
- `simulateLive(s)` and route generation repeated in responses
- add/transition logic may be too heavy for a busy fleet

Priority fixes:
- Add a lightweight live shipping projection
- Reduce DTO size for client-specific endpoints
- Optimize transitions and notifications with batching

### src/app/api/shipments/[id]/route.ts

Main risks:
- Live flow progression includes repeated reads and writes
- Demo-driven state transition logic is not production-safe if activated for many shipments
- Notification and state updates can create write amplification

Priority fixes:
- Separate demo auto-drive from production logic
- Gate AI/demo state machine behind explicit feature flags
- Add concurrency protections and minimal reads per state tick

### prisma/schema.prisma

Main risks:
- SQLite provider choice is not production-safe for high-volume marketplace workloads
- Large model graph plus live analytics likely needs stronger relational indexing

Priority fixes:
- Standardize schema for Postgres production
- Add indexes on high-query columns
- Review relationship cardinality

## Recommended priority order

### P0 — correctness plus baseline performance
1. Add database indexes for status/date and relationship lookups
2. Reduce admin query scope with dedicated endpoints and explicit selects
3. Split full shipment DTO from live tracking DTO
4. Add pagination to admin views

### P1 — scalability improvements
1. Move analytics to SQL aggregation
2. Batch notifications and event writes
3. Replace large JSON parsing in hot paths with structured fields or cached values
4. Create a lightweight “live shipment state” read model for tracking screens

### P2 — production architecture
1. Move from SQLite to Postgres for production
2. Add read replicas or separate reporting DB if analytics loads become heavy
3. Add a proper cache layer for active shipment lookups and recent admin summaries
4. Introduce asynchronous jobs for non-critical notifications and reporting

## Additional non-functional concerns

### Latency sensitivity
- Customer and driver experiences are latency-sensitive, especially tracking, ETA, and dispatch outcomes.
- Route and shipment detail requests must be fast and cheap.

### Concurrency
- Multiple drivers and customers can trigger transitions or quote events simultaneously.
- The system should be built around transactional writes and explicit locking semantics.

### Observability
- There is no strong evidence of structured performance instrumentation yet.
- Add timing logs for:
  - shipment GET
  - shipment transition
  - admin overview load
  - analytics query
  - matching and quote generation

### Safety and correctness
- Large DTOs and heavy queries are not just performance problems; they also create opportunities for stale reads and inconsistent UI states.

## Suggested engineering rules for continued work

1. Never fetch an entire shipment graph unless the caller explicitly needs the full record.
2. Keep UI-specific DTOs separate from domain DTOs.
3. Avoid building analytics in JS when the database can aggregate it.
4. Add pagination before exposing large list endpoints.
5. Prefer explicit `select` over `include` in hot paths.
6. Treat SQLite as a demo/local tool, not a production marketplace database.
7. Add indexing before feature expansion, not after the backlog grows.
8. Measure request latency and DB query time under data seeding, not only with tiny demo datasets.

## Final recommendation

The repo is a strong product prototype, but it is currently optimized for proving the marketplace concept and sprint demos rather than resilient production-scale operations. The biggest performance wins will come from:
- reducing query breadth
- reducing repeated serialization work
- moving analytics to SQL
- adding indexes
- moving the production database away from SQLite

This is the highest-value path to make the system sustainable as it grows from demo to real marketplace traffic.

## Practical implementation checklist

- [ ] Audit all admin endpoints for payload size and nested includes
- [ ] Replace broad `include` usage with `select` in hot paths
- [ ] Add pagination to admin and support APIs
- [ ] Create a lightweight shipment live-state projection
- [ ] Add database indexes for common filters and relationship lookups
- [ ] Move report and analytics workloads to SQL aggregation
- [ ] Add DB query timing instrumentation in the app
- [ ] Set explicit feature flags for sandbox state progression and mock auto-drive
- [ ] Plan production database migration from SQLite to PostgreSQL
- [ ] Establish load-test seed data for fleet sizes of 10x/100x/1000x

This document should be treated as a working engineering note and should be revisited as the architecture matures.
