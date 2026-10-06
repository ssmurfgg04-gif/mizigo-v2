// MIZIGO — lightweight server telemetry (per serverless instance).
//
// (a) structured logger: one JSON line per event → console.log (serverless log
//     drains parse it); ISO timestamp + trace id (crypto.randomUUID).
// (b) in-memory metrics: per-route ring histogram (count / p50 / p95 / max)
//     + error counters. Sync, allocation-light, fire-and-forget safe.
// (c) recent-events ring (last 50) for the ops console.
// (d) business metrics from the DB (minimal bounded queries) — only computed
//     when the telemetry tab asks for them.
//
// Everything here is intentionally tiny: no await in hot paths, no external
// APM dependency, safe to import from any route.

import { randomUUID } from "crypto";

// ─────────────────────────────────────────────────────────────────────────────
// (a) Structured logger
// ─────────────────────────────────────────────────────────────────────────────

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogEventInput {
  level?: LogLevel;
  route: string;
  actor?: string;
  shipmentId?: string;
  userId?: string;
  action?: string;
  latencyMs?: number;
  ok?: boolean;
  status?: number;
  extra?: Record<string, unknown>;
}

export interface LoggedEvent {
  ts: string; // ISO
  traceId: string;
  level: LogLevel;
  route: string;
  actor?: string;
  shipmentId?: string;
  userId?: string;
  action?: string;
  latencyMs?: number;
  ok?: boolean;
  status?: number;
  extra?: Record<string, unknown>;
}

/** Emit one structured JSON log line; returns the trace id. */
export function logEvent(e: LogEventInput): string {
  const traceId = randomUUID();
  const line: LoggedEvent = {
    ts: new Date().toISOString(),
    traceId,
    level: e.level ?? "info",
    route: e.route,
    ...(e.actor !== undefined ? { actor: e.actor } : {}),
    ...(e.shipmentId !== undefined ? { shipmentId: e.shipmentId } : {}),
    ...(e.userId !== undefined ? { userId: e.userId } : {}),
    ...(e.action !== undefined ? { action: e.action } : {}),
    ...(e.latencyMs !== undefined ? { latencyMs: Math.round(e.latencyMs) } : {}),
    ...(e.ok !== undefined ? { ok: e.ok } : {}),
    ...(e.status !== undefined ? { status: e.status } : {}),
    ...(e.extra ? { extra: e.extra } : {}),
  };
  // single line, serverless-friendly (each invocation's stdout is a log event)
  console.log(JSON.stringify(line));
  pushRecent(line);
  return traceId;
}

// ─────────────────────────────────────────────────────────────────────────────
// (c) Recent-events ring (last 50)
// ─────────────────────────────────────────────────────────────────────────────

const RECENT_MAX = 50;
const recent: LoggedEvent[] = [];

function pushRecent(line: LoggedEvent): void {
  recent.push(line);
  if (recent.length > RECENT_MAX) recent.shift();
}

/** Last (≤50) logged events, newest last. */
export function recentEvents(): LoggedEvent[] {
  return recent.slice();
}

// ─────────────────────────────────────────────────────────────────────────────
// (b) Per-instance metrics — ring histogram per route
// ─────────────────────────────────────────────────────────────────────────────

const RING_MAX = 512; // latency samples kept per route

interface RouteMetrics {
  count: number;
  errors: number;
  max: number;
  ring: number[]; // most recent latency samples
}

const routes = new Map<string, RouteMetrics>();
const startedAt = new Date();

/** Record one request observation (sync, cheap — call it fire-and-forget). */
export function record(route: string, latencyMs: number, ok = true): void {
  let m = routes.get(route);
  if (!m) {
    m = { count: 0, errors: 0, max: 0, ring: [] };
    routes.set(route, m);
  }
  const ms = Math.max(0, Math.round(latencyMs));
  m.count += 1;
  if (!ok) m.errors += 1;
  if (ms > m.max) m.max = ms;
  m.ring.push(ms);
  if (m.ring.length > RING_MAX) m.ring.shift();
}

/** Nearest-rank percentile over an ascending sample set (deterministic). */
export function percentile(sortedAsc: number[], p: number): number {
  if (sortedAsc.length === 0) return 0;
  const idx = Math.min(sortedAsc.length - 1, Math.max(0, Math.ceil(p * sortedAsc.length) - 1));
  return sortedAsc[idx];
}

export interface RouteSnapshot {
  count: number;
  errors: number;
  p50: number;
  p95: number;
  max: number;
}

export interface MetricsSnapshot {
  startedAt: string;
  routes: Record<string, RouteSnapshot>;
  totalRequests: number;
  totalErrors: number;
}

/** Current per-route metrics (computed from the sample rings). */
export function snapshot(): MetricsSnapshot {
  const out: Record<string, RouteSnapshot> = {};
  let totalRequests = 0;
  let totalErrors = 0;
  for (const [route, m] of routes) {
    const sorted = [...m.ring].sort((a, b) => a - b);
    out[route] = {
      count: m.count,
      errors: m.errors,
      p50: percentile(sorted, 0.5),
      p95: percentile(sorted, 0.95),
      max: m.max,
    };
    totalRequests += m.count;
    totalErrors += m.errors;
  }
  return { startedAt: startedAt.toISOString(), routes: out, totalRequests, totalErrors };
}

/** Reset metrics + recent events (test/debug only). */
export function resetMetrics(): void {
  routes.clear();
  recent.length = 0;
}

// ─────────────────────────────────────────────────────────────────────────────
// (d) Business metrics — minimal bounded queries against the DB
// ─────────────────────────────────────────────────────────────────────────────

export interface BusinessMetrics {
  timeToMatchMin: number | null; // avg minutes booking→driver-assigned (last 50 matched)
  completionRate: number; // 0..1 of all shipments
  cancellationRate: number; // 0..1 of all shipments
  onTimeRate: number; // 0..1 of recently completed, delivered within estimate+grace
  onTimeSample: number;
  shipmentTotal: number;
}

const EMPTY_METRICS: BusinessMetrics = {
  timeToMatchMin: null,
  completionRate: 0,
  cancellationRate: 0,
  onTimeRate: 0,
  onTimeSample: 0,
  shipmentTotal: 0,
};

/**
 * Marketplace health from the DB. Bounded queries only:
 *   1× groupBy status, 1× last-50 DRIVER_ASSIGNED events + their shipments,
 *   1× last-200 completed shipments (payment→POD span vs estimate).
 * Fails soft (empty metrics) if the DB is unavailable.
 */
export async function businessMetrics(): Promise<BusinessMetrics> {
  try {
    // lazy import: keeps this module DB-free at load time (tests, edge warmth)
    const { db } = await import("./db");

    const [statusRows, assignEvents] = await Promise.all([
      db.shipment.groupBy({ by: ["status"], _count: { _all: true } }),
      db.shipmentEvent.findMany({
        where: { type: "DRIVER_ASSIGNED" },
        select: { shipmentId: true, createdAt: true },
        orderBy: { createdAt: "desc" },
        take: 50,
      }),
    ]);

    let shipmentTotal = 0;
    let completed = 0;
    let cancelled = 0;
    for (const r of statusRows) {
      shipmentTotal += r._count._all;
      if (r.status === "COMPLETED") completed = r._count._all;
      if (r.status === "CANCELLED") cancelled = r._count._all;
    }

    // time-to-match: DRIVER_ASSIGNED event minus shipment creation, avg minutes
    let timeToMatchMin: number | null = null;
    if (assignEvents.length > 0) {
      const ids = assignEvents.map((e) => e.shipmentId);
      const created = await db.shipment.findMany({
        where: { id: { in: ids } },
        select: { id: true, createdAt: true },
      });
      const createdBy = new Map(created.map((s) => [s.id, s.createdAt.getTime()] as const));
      let sum = 0;
      let n = 0;
      for (const e of assignEvents) {
        const c = createdBy.get(e.shipmentId);
        if (c === undefined) continue;
        const mins = (e.createdAt.getTime() - c) / 60_000;
        if (mins >= 0 && mins < 24 * 60) {
          // guard: only sane spans (same-day dispatch)
          sum += mins;
          n += 1;
        }
      }
      if (n > 0) timeToMatchMin = Math.round((sum / n) * 10) / 10;
    }

    // on-time: last 200 completed, paid→POD span vs quoted duration (+20% grace)
    const done = await db.shipment.findMany({
      where: { status: "COMPLETED", paidAt: { not: null }, podVerifiedAt: { not: null } },
      select: { durationMin: true, paidAt: true, podVerifiedAt: true },
      orderBy: { podVerifiedAt: "desc" },
      take: 200,
    });
    let onTime = 0;
    for (const s of done) {
      const actualMin = ((s.podVerifiedAt!.getTime() - s.paidAt!.getTime()) / 60_000) || 0;
      if (actualMin >= 0 && actualMin <= s.durationMin * 1.2 + 5) onTime += 1;
    }

    return {
      timeToMatchMin,
      completionRate: shipmentTotal ? completed / shipmentTotal : 0,
      cancellationRate: shipmentTotal ? cancelled / shipmentTotal : 0,
      onTimeRate: done.length ? onTime / done.length : 0,
      onTimeSample: done.length,
      shipmentTotal,
    };
  } catch {
    return { ...EMPTY_METRICS };
  }
}
