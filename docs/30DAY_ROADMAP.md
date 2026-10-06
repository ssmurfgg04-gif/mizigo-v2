# MIZIGO v2 — 30-Day Performance & Observability Roadmap

This roadmap prioritizes performance optimization, APM instrumentation, and operational visibility across 4 weeks. The goal is to make the system observable, predictable, and production-ready.

## Architecture assumptions

- **Database**: SQLite with WAL mode enabled (concurrent writes, no Postgres migration needed)
- **Caching**: In-memory for hot shipment state, Redis optional for distributed scenarios later
- **APM**: Structured logs, request timing, and Prisma query insights
- **Concurrency model**: SQLite handles multi-concurrent writes well if indexes and query design are sound

## Phase 1 — Week 1: Baseline, instrumentation, and quick wins

### Add APM and request tracing

- [ ] Enable request timing middleware in `src/app/middleware.ts` or `next.config.ts`
  - log request start/end time
  - track latency by route
  - capture error codes
  - associate with shipment ID or user ID where possible
  
- [ ] Add Prisma query logging in development/staging
  - enable `prisma.log([{ emit: 'stdout', level: 'query' }])`
  - capture query time, affected rows, and slow query thresholds
  - log to structured format (JSON) for easy parsing
  
- [ ] Instrument critical APIs:
  - `GET /api/admin` (all tabs)
  - `GET /api/shipments/[id]`
  - `POST /api/shipments/[id]/action`
  - `POST /api/shipments` (booking creation)
  - `GET /api/quote`
  - `POST /api/admin/action`
  
- [ ] Add business event logging:
  - shipment created
  - driver matched
  - state transition
  - quote generated
  - payout processed
  - dispute opened
  
- [ ] Create structured log output:
  ```json
  {
    "timestamp": "2026-10-06T10:06:46Z",
    "level": "info",
    "route": "/api/shipments/[id]",
    "latencyMs": 145,
    "shipmentId": "...",
    "userId": "...",
    "actor": "CUSTOMER",
    "action": "get",
    "result": "success",
    "dbQueriesMs": 89,
    "queryCount": 3
  }
  ```

### Define performance SLIs (service level indicators)

- [ ] Admin dashboard load time: target <500ms p95
- [ ] Shipment detail endpoint: target <300ms p95
- [ ] Matching/dispatch latency: target <1000ms p95
- [ ] State transition throughput: target >100 transitions/sec
- [ ] Notification delivery: target <5s from event to user
- [ ] Quote generation: target <2000ms p95

### Audit hot queries

- [ ] Document all `findMany` calls with nested includes
  - `src/app/api/admin/route.ts`
  - `src/lib/shipments.ts`
  - `src/app/api/shipments/[id]/route.ts`
  
- [ ] Identify repeated `getShipmentFull` calls in single request flows
  - sandbox progression logic in `src/app/api/shipments/[id]/route.ts`
  
- [ ] Catalog all JSON.parse calls in hot paths
  - stops, specialHandling, tags serialization
  
- [ ] Create query performance baseline:
  - measure with 100, 1k, 10k seeded shipments
  - store results in `docs/PERF_BASELINE.md`

### Set up performance monitoring infrastructure

- [ ] Add timing to Prisma client (wrap db calls)
  ```typescript
  async function withTiming<T>(label: string, fn: () => Promise<T>): Promise<T> {
    const start = Date.now();
    const result = await fn();
    console.log(`[PERF] ${label}: ${Date.now() - start}ms`);
    return result;
  }
  ```
  
- [ ] Create a simple metrics collector:
  - route latencies
  - query latencies
  - error rates
  - memory usage
  
- [ ] Store metrics locally or in a simple JSON file for analysis
  - output to `logs/metrics.jsonl`
  - rotate daily

### Create performance backlog

- [ ] Tag all performance-related issues with labels:
  - `perf/critical` — blocks launch or causes user pain
  - `perf/high` — significant latency or resource use
  - `perf/medium` — incremental improvement
  
- [ ] Prioritize by:
  - impact on user experience
  - ease of fix
  - frequency of execution

---

## Phase 2 — Week 2: Admin API optimization and query reduction

### Reduce payload size in admin endpoints

- [ ] Break `GET /api/admin` into dedicated tab endpoints:
  - `GET /api/admin/bookings` — shipment list with pagination
  - `GET /api/admin/support` — disputes, mismatches, support queue
  - `GET /api/admin/payouts` — driver payouts and ledger
  - `GET /api/admin/analytics` — summary metrics and trends
  
- [ ] For each endpoint, define explicit response DTOs:
  ```typescript
  // bookings tab — minimal shipment summary
  type BookingSummary = {
    id: string; code: string; status: string;
    customer: { name: string; phone: string };
    driver: { name: string } | null;
    fare: { total: number };
    createdAt: string;
  };
  
  // support tab — disputes and events only
  type SupportItem = {
    id: string; type: string;
    shipment: { code: string };
    status: string;
    createdAt: string;
  };
  ```
  
- [ ] Replace broad `include` with explicit `select`:
  ```typescript
  // BEFORE: bloated
  db.shipment.findMany({
    include: { category: true, vehicle: true, driver: { include: { user: true } }, customer: true, items: true, events: {...}, ... }
  })
  
  // AFTER: minimal
  db.shipment.findMany({
    select: {
      id: true, code: true, status: true, customerId: true, fareTotal: true, createdAt: true
    }
  })
  ```

### Add pagination and filters

- [ ] Implement cursor or offset-based pagination:
  - default page size: 20–50 items
  - support cursor-based for efficiency
  - expose `hasMore` flag to client
  
- [ ] Add filter parameters:
  - `?status=MATCHING,DRIVER_ASSIGNED` (comma-separated list)
  - `?customerId=...` (filter by customer)
  - `?driverId=...` (filter by driver)
  - `?createdAfter=...` (date range)
  
- [ ] Implement sorting:
  - default: `createdAt DESC`
  - support: `status`, `fare`, `updatedAt`

### Add database indexes

- [ ] Define indexes in `prisma/schema.prisma`:
  ```prisma
  model Shipment {
    // ... fields ...
    
    @@index([status])
    @@index([customerId])
    @@index([driverId])
    @@index([createdAt])
    @@index([categoryId])
    @@index([status, createdAt]) // composite for common queries
  }
  
  model ShipmentEvent {
    // ... fields ...
    @@index([shipmentId])
    @@index([type])
    @@index([createdAt])
  }
  
  model Notification {
    // ... fields ...
    @@index([userId])
    @@index([role])
    @@index([createdAt])
  }
  
  model Quote {
    // ... fields ...
    @@index([shipmentId])
    @@index([status])
    @@index([createdAt])
  }
  
  model Driver {
    // ... fields ...
    @@index([status])
    @@index([userId])
    @@index([createdAt])
  }
  ```

- [ ] Run migration: `npx prisma migrate dev --name add_perf_indexes`
- [ ] Verify indexes created: `sqlite3 dev.db ".indices"`
- [ ] Test query plans before/after

### Add query-level guardrails

- [ ] Enforce max result size:
  - no `findMany` without `take` or `skip`
  - default max: 100 items
  
- [ ] Enforce explicit select:
  - no unbounded `include` in admin/reporting endpoints
  - prefer `select` + composed objects
  
- [ ] Add helper to catch violations:
  ```typescript
  export function assertPaginatedQuery<T>(
    result: T[],
    maxSize: number = 100
  ): T[] {
    if (result.length > maxSize) {
      throw new Error(`Query returned ${result.length} rows, max is ${maxSize}`);
    }
    return result;
  }
  ```

---

## Phase 3 — Week 3: Shipment DTO optimization and live-state caching

### Split DTOs into lightweight variants

- [ ] Define DTO layers:
  ```typescript
  // Full shipment (detail page, comprehensive view)
  type ShipmentDetail = { /* all current fields */ };
  
  // Summary (list, admin, quick overview)
  type ShipmentSummary = {
    id: string; code: string; status: string;
    customer: { name: string };
    driver: { name: string } | null;
    fare: { total: number };
    createdAt: string;
  };
  
  // Live tracking (driver/customer real-time)
  type ShipmentLiveState = {
    id: string; code: string; status: string;
    live: { progress: number; heading: number; ... };
    eta: { minutes: number; confidence: number };
    vehicle: { registration: string };
    createdAt: string;
  };
  ```

- [ ] Route-specific serialization:
  - `GET /api/shipments` → summary list
  - `GET /api/shipments/[id]` → full detail
  - `GET /api/track` → live tracking state only
  - admin bookings tab → summary
  - driver app → live state

### Reduce repeated JSON parsing

- [ ] Identify all JSON string fields:
  - stops (array of { name, lat, lng })
  - specialHandling (array of strings)
  - tags (array of strings)
  - cargo items (parsed in loop)
  
- [ ] Cache parsed values at request time:
  ```typescript
  class ShipmentCache {
    private parsed = new Map<string, any>();
    
    getStops(s: Shipment): Stop[] {
      if (!this.parsed.has(s.id + ':stops')) {
        this.parsed.set(s.id + ':stops', JSON.parse(s.stops || '[]'));
      }
      return this.parsed.get(s.id + ':stops');
    }
  }
  ```
  
- [ ] Or move to structured fields if frequently accessed
  - add `stopsJson` array type or separate `Stop` relation
  - migration path: gradual

### Optimize live shipment updates

- [ ] Remove redundant DB reads in sandbox progression:
  - currently calls `getShipmentFull` per state transition
  - reuse the same record or batch transitions
  
- [ ] Create a lightweight state projection:
  ```typescript
  async function getShipmentLiveState(id: string) {
    return db.shipment.findUnique({
      where: { id },
      select: {
        id: true, code: true, status: true,
        pickupLat: true, pickupLng: true, dropoffLat: true, dropoffLng: true,
        distanceKm: true, durationMin: true,
        stateEnteredAt: true,
        vehicle: { select: { registration: true } },
        driver: { select: { lat: true, lng: true } }
      }
    });
  }
  ```

- [ ] Add in-memory cache for active shipments:
  ```typescript
  class ActiveShipmentCache {
    private cache = new Map<string, CachedShipment>();
    private ttl = 30_000; // 30s
    
    async get(id: string): Promise<Shipment> {
      const cached = this.cache.get(id);
      if (cached && Date.now() - cached.at < this.ttl) {
        return cached.data;
      }
      const data = await getShipmentLiveState(id);
      this.cache.set(id, { data, at: Date.now() });
      return data;
    }
    
    invalidate(id: string) {
      this.cache.delete(id);
    }
  }
  ```

- [ ] Invalidate cache on state transition:
  - call `cache.invalidate(shipmentId)` after `applyTransition`

### Add feature flag for sandbox auto-progression

- [ ] Create a feature flag for demo mode:
  ```typescript
  const FEATURE_FLAGS = {
    DEMO_AUTO_PROGRESS: process.env.DEMO_AUTO_PROGRESS === 'true',
    SANDBOX_MODE: process.env.NODE_ENV === 'development'
  };
  ```
  
- [ ] Gate sandbox progression behind flag:
  ```typescript
  if (demoAuto && FEATURE_FLAGS.DEMO_AUTO_PROGRESS) {
    // only run auto-progression in dev or explicit demo mode
    ...
  }
  ```

- [ ] Disable for production:
  - set `DEMO_AUTO_PROGRESS=false` in production env
  - logs will show if it's disabled
  
- [ ] Add metrics for demo runs:
  - track how many auto-transitions fire
  - warn if running in production

---

## Phase 4 — Week 4: Analytics, business metrics, and load testing

### Move analytics to SQL aggregation

- [ ] Create dedicated analytics queries (no JS loops):
  ```typescript
  // Example: daily summary
  async function getDailySummary(days: number = 14) {
    return db.$queryRaw`
      SELECT
        DATE(createdAt) as date,
        COUNT(*) as shipmentCount,
        COUNT(DISTINCT customerId) as uniqueCustomers,
        COUNT(DISTINCT driverId) as uniqueDrivers,
        SUM(fareTotal) as gmv,
        SUM(commission) as commission,
        AVG(CAST(durationMin as REAL)) as avgDurationMin
      FROM Shipment
      WHERE createdAt >= datetime('now', '-' || ${days} || ' days')
      GROUP BY DATE(createdAt)
      ORDER BY date DESC
    `;
  }
  ```

- [ ] Precompute metrics for fast reads:
  - store aggregates in a `DailyMetrics` table
  - refresh nightly or on a schedule
  
- [ ] Remove from admin API the JS aggregation loops:
  - replace with single query per metric
  - dedicate `/api/admin/analytics` to SQL-based queries only

### Add structured business metrics

- [ ] Track core marketplace metrics:
  - **Time to match** — booking created → driver assigned (minutes)
  - **Match success rate** — (completed / total bookings) %
  - **Time to pickup** — assigned → driver arrived
  - **Time to delivery** — driver arrived → proof of delivery
  - **Cancellation rate** — cancelled / total %
  - **ETA accuracy** — actual vs estimated time variance
  - **Driver utilization** — active hours / online hours %
  - **Earnings per driver** — weekly/monthly summaries
  - **Payout processing time** — completion → payout

- [ ] Create a metrics dashboard:
  - daily/weekly views
  - drill-down by status, category, area, date range
  - alert on anomalies (e.g., match rate drops below 80%)

### Enable SQLite WAL mode and connection pooling

- [ ] Configure SQLite for production concurrency:
  ```typescript
  // src/lib/db.ts or next initialization
  const prisma = new PrismaClient({
    log: process.env.DEBUG_PRISMA ? ['query'] : []
  });
  
  // Enable WAL mode (better concurrency)
  if (process.env.NODE_ENV === 'production') {
    await prisma.$executeRawUnsafe('PRAGMA journal_mode = WAL');
    await prisma.$executeRawUnsafe('PRAGMA wal_autocheckpoint = 1000');
  }
  ```

- [ ] Use connection pooling:
  - Prisma handles this natively, but verify pool size
  - default is adequate for most workloads
  
- [ ] Document SQLite limits and assumptions:
  - single-file database (backup strategy)
  - suitable for <100k concurrent active requests
  - suitable for <50 concurrent writers

### Add alerting and dashboards

- [ ] Set up simple alerting:
  - p95 latency spike on critical endpoints
  - error rate above 1%
  - DB query time exceeding SLI
  - memory growth beyond baseline
  
- [ ] Create observability outputs:
  - `logs/metrics.jsonl` — structured metrics
  - `docs/PERF_BASELINE.md` — baseline measurements
  - `docs/ALERTS.md` — alert thresholds and runbooks

### Conduct load testing

- [ ] Seed realistic data:
  - 100 shipments (baseline)
  - 1,000 shipments (moderate)
  - 10,000 shipments (stress)
  
- [ ] Run load tests:
  - concurrent booking creation (10, 50, 100 requests/sec)
  - concurrent state transitions (10, 50, 100 per sec)
  - admin dashboard refresh under load
  - tracking API polling (1-2 sec intervals per shipment)
  
- [ ] Measure and capture:
  - latency (p50, p95, p99)
  - error rate
  - DB lock contention
  - memory growth
  
- [ ] Store results:
  - `docs/LOAD_TEST_RESULTS.md`
  - before/after optimization comparison

### Create operational runbooks

- [ ] **Performance triage**:
  - how to identify slow endpoints
  - how to check query plans
  - how to analyze logs
  
- [ ] **Rollback plan**:
  - how to revert schema changes
  - how to restore from DB backup
  
- [ ] **Hotspot review cadence**:
  - weekly performance review meeting
  - monthly deep-dive on trends
  - post-incident review for latency spikes

---

## Cross-cutting work (all 4 weeks)

### APM and structured logging

- [ ] Every critical flow logs a structured event:
  ```json
  {
    "timestamp": "...",
    "traceId": "...",
    "spanId": "...",
    "service": "mizigo-api",
    "route": "/api/shipments",
    "action": "create",
    "actor": "CUSTOMER",
    "shipmentId": "...",
    "latencyMs": 145,
    "dbMs": 89,
    "status": "success",
    "errors": null
  }
  ```

- [ ] Ingest logs into simple analysis:
  - write to `logs/events.jsonl`
  - use `jq` or simple Node script to analyze
  - export to CSV for charting

### Business event tracking

- [ ] Log every important event:
  - shipment created
  - quote generated
  - driver matched
  - state transition (with actor, reason, latency)
  - payout processed
  - dispute opened/resolved
  - cancellation (reason)
  
- [ ] Use events to drive alerts and dashboards

### Cost and resource monitoring

- [ ] Track database resource use:
  - file size growth
  - checkpoint frequency
  - lock wait time
  
- [ ] Track server resource use:
  - memory (baseline, peak)
  - CPU (baseline, peak under load)
  - startup time
  
- [ ] Document scaling assumptions:
  - SQLite works well up to ~50k shipments
  - beyond that, consider sharding or moving to Postgres (future)

---

## Success criteria by day 30

- [ ] All critical APIs instrumented with timing and structured logging
- [ ] Admin endpoints respond in <500ms p95 under realistic load
- [ ] No unbounded database queries in hot paths
- [ ] Pagination and indexing live on all list endpoints
- [ ] Sandbox auto-progression gated behind feature flag
- [ ] Analytics computed in SQL, not JavaScript
- [ ] Performance baseline and load-test results documented
- [ ] Alerting thresholds set and tested
- [ ] Operational runbooks complete
- [ ] Team can identify and triage performance issues using APM data

---

## Rollout timeline

**Week 1 (Days 1–7)**
- APM instrumentation
- Query auditing and baseline measurements
- Performance backlog creation

**Week 2 (Days 8–14)**
- Admin API refactoring and pagination
- Database indexes deployed
- Query guardrails implemented

**Week 3 (Days 15–21)**
- DTO optimization and caching
- Feature flag for sandbox mode
- Live-state projection created

**Week 4 (Days 22–30)**
- Analytics queries rewritten
- Load testing and results
- Alerting and runbooks finalized

---

## Notes and assumptions

- SQLite with WAL mode is production-suitable for this workload
- No Postgres migration needed (was over-prescribed)
- Focus is on query optimization, indexing, and observability
- Concurrency is achievable with proper schema design and caching
- Load testing will validate assumptions and guide further work

---

## Next steps after day 30

- Establish performance review cadence (weekly on Fridays)
- Iterate on alerts based on real traffic patterns
- Build customer-facing performance dashboard (ETA accuracy, match rate, etc.)
- Consider caching layer (Redis) if distributed deployments needed later
- Plan for marketplace scaling (100k+ shipments, 1k+ drivers)
