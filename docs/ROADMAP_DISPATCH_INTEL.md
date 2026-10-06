> **Provenance:** moved into `docs/` from `scripts/pr-review/30-day-roadmap.md` for discoverability (CI + hygiene track, task 10-H). The original stays in place.

# 30-Day Roadmap for mizigo-v2

## Goal
Turn the repo from a polished logistics MVP into a production-grade dispatch platform with strong performance, system observability, and operational tooling.

## Week 1 — Performance hardening
### Backend
- [ ] Add and verify all shipment and driver hot-path indexes
- [ ] Ensure `Shipment(status, createdAt)` exists and is used by admin map queries
- [ ] Reduce over-fetching in `getShipmentFull` and list endpoints
- [ ] Add cache layer for admin map, shipment list, and status summaries
- [ ] Use paginated results for active shipment screens
- [ ] Add a low-cardinality admin map DTO

### Frontend
- [ ] Debounce polling for active tracking screens
- [ ] Stop polling for completed or cancelled shipments
- [ ] Add idle backoff strategy to dashboard polling
- [ ] Add skeleton and error coverage for map/list screens

### QA
- [ ] Run SQL explain plans on the hot queries
- [ ] Measure p95/p99 for shipment list and detail APIs
- [ ] Verify admin map loads under synthetic load

## Week 2 — Dispatch intelligence
### Matching engine
- [ ] Add batch-friendly, cacheable “candidate driver” lookups
- [ ] Filter by bounding box before haversine distance
- [ ] Add driver score model: distance, rating, completion rate, rejection rate, ETA confidence
- [ ] Add requeue / retry logic for failed matching rounds
- [ ] Add audit trail for assignment decisions

### Admin tooling
- [ ] Filter shipments by status, zone, driver, and ETA risk
- [ ] Add bulk actions: reassignment, reschedule, cancellation
- [ ] Add delivery SLA risk badges and warnings

## Week 3 — ETA confidence and operational monitoring
### ETA layer
- [ ] Add ETA confidence buckets: low / medium / high
- [ ] Track route variance and delay drift
- [ ] Flag late pickups, late deliveries, and stale GPS pings
- [ ] Add “why did this ETA change?” reasoning telemetry

### Monitoring
- [ ] Add request metrics for matching, shipment fetch, and map load
- [ ] Add state-transition drift alerts
- [ ] Add failure analytics for quote acceptance and dispatch retries

## Week 4 — Trust, finance, and support
### Trust / compliance
- [ ] Driver KYC and document expiry alerts
- [ ] Vehicle inspection / insurance expiry flow
- [ ] Risk scoring for repeated disputes and cancellations
- [ ] Compliance dashboard for admin operations

### Finance
- [ ] Driver payout dashboard
- [ ] Settlement reconciliation and payout status tracking
- [ ] Refund logic and dispute resolution policy

### Support
- [ ] Shipment support timeline with evidence
- [ ] Agent-facing dispute triage workflow
- [ ] Customer and driver message review screens

## Definition of done
The platform is ready to scale when all of the following are true:
- [ ] Shipment APIs stay under target latency with realistic traffic
- [ ] Admin map loads stay fast with large active shipment counts
- [ ] Matching engine is explainable and auditable
- [ ] ETA risk is visible to ops staff
- [ ] Driver compliance and payout flows are operational
- [ ] Support and dispute tooling are in place

## Competitive gap focus
Priority wins to match stronger marketplace competitors:
1. Dispatch scoring and assignment fairness
2. ETA confidence and delay monitoring
3. Admin control room for dispatch operations
4. Driver payout and compliance tracking
5. Dispute and support tooling
