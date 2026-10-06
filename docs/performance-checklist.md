> **Provenance:** moved into `docs/` from `scripts/pr-review/performance-checklist.md` for discoverability (CI + hygiene track, task 10-H). The original stays in place.

# Performance + Operations Checklist

## P0 — must have before scale
- [ ] Query load audit for active shipments, detail routes, and map endpoints
- [ ] `Shipment(status, createdAt)` index present and verified
- [ ] `Driver(lat, lng)` and driver status index present
- [ ] Quote and chat lookups indexed by `shipmentId`
- [ ] ShipmentEvent queries indexed by `shipmentId` + `createdAt`
- [ ] Active shipments list paginated
- [ ] Admin map uses low-cardinality DTO and cache
- [ ] Polling is state-aware and debounced
- [ ] No polling for completed / cancelled shipments
- [ ] Candidate-driver query uses bounding-box filtering before haversine
- [ ] Notification creation moved off synchronous API critical path
- [ ] Map and list results have stale cache TTL

## P1 — operational readiness
- [ ] Viewport-based admin map filtering
- [ ] Polyline results cached
- [ ] Client-side retry and backoff tuned
- [ ] API latency metrics recorded per endpoint
- [ ] State drift detection added
- [ ] Driver SLA breach alerts enabled
- [ ] Bulk admin actions for reschedule/cancel/assign

## P2 — competitor-grade
- [ ] Driver assignment fairness model
- [ ] ETA confidence scoring
- [ ] Delay detection and route variance alerts
- [ ] Payout reconciliation flow
- [ ] KYC / compliance visibility
- [ ] Support and dispute automation
- [ ] Route optimization and multi-stop planning

## Launch gating
- [ ] p95 shipment list < target threshold
- [ ] p95 detail endpoint < target threshold
- [ ] admin map renders under load without scan
- [ ] no unbounded polling loop in browser sessions
- [ ] no unsupported state transitions under concurrency
