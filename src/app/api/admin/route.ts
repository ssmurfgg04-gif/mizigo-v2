// GET /api/admin — operations data for the admin console.
// tabs: overview | shipments | drivers | vehicles | customers | payments | payouts |
// pricing | disputes | support | promotions | settings | analytics | audit | telemetry
//
// Perf (task 10-E): per-tab TTL cache (invalidated by every mutation path),
// SQL-side aggregation for analytics (no full-graph loads), scoped selects,
// payload-size debug flag, request telemetry. Response shapes are unchanged.
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { ensureDB } from "@/lib/db-ready";
import { activeShipments, shipmentDTO } from "@/lib/shipments";
import { STATUS_LABEL } from "@/lib/state-machine";
import { requireRole, isResponse } from "@/lib/security";
import { cacheGet, cacheSet } from "@/lib/query-cache";
import { record, logEvent, snapshot, recentEvents, businessMetrics } from "@/lib/telemetry";

export const dynamic = "force-dynamic";

// per-tab cache TTL (ms), prefix "admin". overview must stay near-live (the
// console polls it every 4s for the live map); reporting tabs hold 45s and are
// invalidated by every mutation path anyway. telemetry is never cached.
const ADMIN_CACHE_TTL: Record<string, number> = {
  overview: 5_000,
  support: 10_000,
  shipments: 45_000,
  drivers: 45_000,
  vehicles: 45_000,
  customers: 45_000,
  payments: 45_000,
  payouts: 45_000,
  pricing: 45_000,
  disputes: 45_000,
  promotions: 45_000,
  settings: 45_000,
  analytics: 45_000,
  audit: 15_000,
};

// ops/debug: MIZIGO_DEBUG_PAYLOAD=1 logs the serialized payload size per tab
const DEBUG_PAYLOAD = process.env.MIZIGO_DEBUG_PAYLOAD === "1";

function respond(tab: string, cacheKey: string, payload: unknown): NextResponse {
  const ttl = ADMIN_CACHE_TTL[tab] ?? 0;
  if (ttl > 0) cacheSet(cacheKey, payload, ttl);
  if (DEBUG_PAYLOAD) {
    console.log(`[mizigo:admin-payload] tab=${tab} bytes=${Buffer.byteLength(JSON.stringify(payload))}`);
  }
  return NextResponse.json(payload);
}

export async function GET(req: Request) {
  const t0 = Date.now();
  const tab = new URL(req.url).searchParams.get("tab") ?? "overview";
  try {
    const res = await handle(req);
    record("api:admin", Date.now() - t0, res.ok);
    logEvent({ route: "api:admin", action: tab, latencyMs: Date.now() - t0, ok: res.ok, status: res.status });
    return res;
  } catch (err) {
    record("api:admin", Date.now() - t0, false);
    logEvent({ level: "error", route: "api:admin", action: tab, ok: false, extra: { message: (err as Error)?.message } });
    throw err;
  }
}

async function handle(req: Request): Promise<NextResponse> {
  await ensureDB();
  // operations data is admin-only (PII, pricing, payouts)
  const session = requireRole(req, "ADMIN");
  if (isResponse(session)) return session;
  const { searchParams } = new URL(req.url);
  const tab = searchParams.get("tab") ?? "overview";

  // cached read-through (successful GET payloads only; mutations invalidate)
  const cacheable = (ADMIN_CACHE_TTL[tab] ?? 0) > 0;
  const statusParam = searchParams.get("status");
  const qParam = (searchParams.get("q") ?? "").toLowerCase();
  const cacheKey = `admin:${tab}${tab === "shipments" ? `:${statusParam ?? "ALL"}:${qParam}` : ""}`;
  if (cacheable) {
    const cached = cacheGet<unknown>(cacheKey);
    if (cached !== undefined) return NextResponse.json(cached);
  }

  if (tab === "overview") {
    const todayStart = new Date(new Date().setHours(0, 0, 0, 0));
    const [active, todayBookings, drivers, vehicleCount, payments, openDisputes, completed, returnLoads] = await Promise.all([
      activeShipments(),
      db.shipment.findMany({
        where: { createdAt: { gte: todayStart } },
        select: { status: true, paymentStatus: true, fareTotal: true, commission: true, farePlatform: true },
      }),
      db.driver.findMany({
        include: { user: { select: { name: true } }, vehicles: { select: { make: true, model: true, registration: true, category: { select: { key: true } } } } },
      }),
      db.vehicle.count(),
      db.paymentEvent.findMany({ orderBy: { createdAt: "desc" }, take: 30 }),
      db.dispute.count({ where: { status: { in: ["OPEN", "RESOLVING"] } } }),
      db.shipment.findMany({ where: { status: "COMPLETED" }, select: { fareTotal: true, farePlatform: true, commission: true, distanceKm: true, driverEarnings: true, createdAt: true, durationMin: true } }),
      db.returnLoad.findMany({ where: { status: "AVAILABLE" }, select: { priceKes: true, normalPriceKes: true } }),
    ]);
    const paid = todayBookings.filter((b) => b.paymentStatus === "CONFIRMED");
    const onlineDrivers = drivers.filter((d) => d.status === "ONLINE");
    const busyDrivers = drivers.filter((d) => d.status === "BUSY");
    return respond(tab, cacheKey, {
      kpis: {
        activeDeliveries: active.length,
        todayBookings: todayBookings.length,
        revenueToday: paid.reduce((a, b) => a + b.fareTotal, 0),
        platformEarningsToday: paid.reduce((a, b) => a + b.commission + b.farePlatform, 0),
        onlineDrivers: onlineDrivers.length,
        busyDrivers: busyDrivers.length,
        totalDrivers: drivers.length,
        totalVehicles: vehicleCount,
        cancellationRate: todayBookings.length ? Math.round((todayBookings.filter((b) => b.status === "CANCELLED").length / todayBookings.length) * 100) : 0,
        avgDeliveryTime: completed.length ? Math.round(completed.reduce((a, c) => a + c.durationMin, 0) / completed.length) : 0,
        completedTotal: completed.length,
        pendingDisputes: openDisputes,
        returnLoadsLive: returnLoads.length,
        returnLoadsAvgDiscount: returnLoads.length ? Math.round(returnLoads.reduce((a, l) => a + (1 - l.priceKes / Math.max(1, l.normalPriceKes)), 0) / returnLoads.length * 100) : 0,
      },
      live: active,
      drivers: drivers.map((d) => ({
        id: d.id, name: d.user?.name ?? "Driver", status: d.status, rating: d.rating, trips: d.tripsCompleted,
        verification: d.verification, lat: d.lat, lng: d.lng, vehicle: d.vehicles[0] ? `${d.vehicles[0].make} ${d.vehicles[0].model}` : null,
        registration: d.vehicles[0]?.registration ?? null, category: d.vehicles[0] ? (d.vehicles[0] as { category?: { key: string } }).category?.key ?? null : null,
      })),
      payments,
    });
  }

  if (tab === "shipments") {
    const rows = await db.shipment.findMany({
      where: statusParam && statusParam !== "ALL" ? { status: statusParam } : undefined,
      include: { category: true, vehicle: true, driver: { include: { user: true } }, customer: true, items: true, events: true, ratings: true, quotes: { include: { driver: { include: { user: true, vehicles: true } } } } },
      orderBy: { createdAt: "desc" }, take: 100,
    });
    let shipments = rows.map(shipmentDTO);
    if (qParam) {
      shipments = shipments.filter((s) =>
        s.code.toLowerCase().includes(qParam) || s.route.pickup.name.toLowerCase().includes(qParam) ||
        s.route.dropoff.name.toLowerCase().includes(qParam) || (s.driver?.name ?? "").toLowerCase().includes(qParam) ||
        (s.vehicle?.registration ?? "").toLowerCase().includes(qParam) || s.customer.name.toLowerCase().includes(qParam) ||
        s.customer.phone.includes(qParam)
      );
    }
    // drivers available for manual dispatch (plan final-brief §19 human dispatch)
    const dispatchDrivers = await db.driver.findMany({
      where: { verification: "VERIFIED", status: "ONLINE" },
      include: { user: true, vehicles: { include: { category: true } } },
    });
    return respond(tab, cacheKey, {
      shipments,
      statuses: Object.entries(STATUS_LABEL).map(([key, label]) => ({ key, label })),
      dispatchDrivers: dispatchDrivers.map((d) => ({
        id: d.id, name: d.user?.name ?? "Driver", rating: d.rating,
        vehicle: d.vehicles[0] ? `${d.vehicles[0].make} ${d.vehicles[0].model}` : "", registration: d.vehicles[0]?.registration ?? "",
        categories: d.vehicles.map((v) => v.category.key),
      })),
    });
  }

  if (tab === "drivers") {
    const drivers = await db.driver.findMany({ include: { user: true, vehicles: { include: { category: true } } }, orderBy: { rating: "desc" } });
    return respond(tab, cacheKey, {
      drivers: drivers.map((d) => ({
        id: d.id, name: d.user?.name ?? "Driver", phone: d.user?.phone ?? "", status: d.status, rating: d.rating,
        trips: d.tripsCompleted, acceptanceRate: d.acceptanceRate, onTimePickup: d.onTimePickup, onTimeDelivery: d.onTimeDelivery,
        cancellationRate: d.cancellationRate, incidents: d.incidents, verification: d.verification,
        licenceClass: d.licenceClass, licenceExpiry: d.licenceExpiry,
        vehicles: d.vehicles.map((v) => ({ id: v.id, make: v.make, model: v.model, registration: v.registration, capacityKg: v.capacityKg, category: v.category.name, docs: { registration: v.docRegistration, insurance: v.docInsurance, inspection: v.docInspection }, insuranceExpiry: v.insuranceExpiry, inspectionExpiry: v.inspectionExpiry })),
      })),
    });
  }

  if (tab === "vehicles") {
    const [vehicles, categories] = await Promise.all([
      db.vehicle.findMany({ include: { driver: { include: { user: true } }, category: true }, orderBy: { registration: "asc" } }),
      db.vehicleCategory.findMany({ orderBy: { sortOrder: "asc" } }),
    ]);
    return respond(tab, cacheKey, {
      vehicles: vehicles.map((v) => ({ id: v.id, make: v.make, model: v.model, registration: v.registration, capacityKg: v.capacityKg, bodyType: v.bodyType, driver: v.driver?.user?.name ?? "", category: v.category.name, docs: { registration: v.docRegistration, insurance: v.docInsurance, inspection: v.docInspection }, active: v.active })),
      categories,
    });
  }

  if (tab === "customers") {
    // customer + business accounts (plan §41 Customers/Businesses)
    const users = await db.user.findMany({
      where: { role: "CUSTOMER" },
      include: { customerShipments: { select: { id: true, status: true, fareTotal: true, createdAt: true } } },
      orderBy: { createdAt: "desc" },
    });
    return respond(tab, cacheKey, {
      customers: users.map((u) => {
        const completed = u.customerShipments.filter((s) => s.status === "COMPLETED");
        return {
          id: u.id, name: u.name, phone: u.phone, accountType: u.accountType, businessName: u.businessName,
          shipments: u.customerShipments.length, completed: completed.length,
          spent: completed.reduce((a, s) => a + s.fareTotal, 0),
          cancelled: u.customerShipments.filter((s) => s.status === "CANCELLED").length,
          joined: u.createdAt,
        };
      }),
    });
  }

  if (tab === "payments") {
    const payments = await db.paymentEvent.findMany({ orderBy: { createdAt: "desc" }, take: 100 });
    const shipments = await db.shipment.findMany({ select: { id: true, code: true, customerId: true, driverId: true, fareTotal: true } });
    const byId = Object.fromEntries(shipments.map((s) => [s.id, s]));
    const customers = await db.user.findMany({ select: { id: true, name: true } });
    const byCustomer = Object.fromEntries(customers.map((c) => [c.id, c.name]));
    return respond(tab, cacheKey, {
      payments: payments.map((p) => ({ ...p, code: byId[p.shipmentId]?.code ?? "-", customer: byCustomer[byId[p.shipmentId]?.customerId ?? ""] ?? "-" })),
    });
  }

  if (tab === "payouts") {
    // driver payout ledger — B2C disbursement side (plan §48)
    const payouts = await db.payout.findMany({ orderBy: { createdAt: "desc" }, take: 100 });
    const drivers = await db.driver.findMany({ include: { user: true } });
    const byDriver = Object.fromEntries(drivers.map((d) => [d.id, d.user?.name ?? "Driver"]));
    const shipments = await db.shipment.findMany({ select: { id: true, code: true, customerId: true, driverId: true, fareTotal: true, driverEarnings: true, commission: true, status: true }, orderBy: { createdAt: "desc" } });
    const customers = await db.user.findMany({ select: { id: true, name: true } });
    const byCustomer = Object.fromEntries(customers.map((c) => [c.id, c.name]));
    return respond(tab, cacheKey, {
      payouts: payouts.map((p) => ({ ...p, driver: byDriver[p.driverId] ?? "-" })),
      ledger: shipments
        .filter((s) => s.driverId && ["COMPLETED"].includes(s.status))
        .slice(0, 50)
        .map((s) => ({ id: s.id, code: s.code, driver: byDriver[s.driverId!] ?? "-", customer: byCustomer[s.customerId] ?? "-", gross: s.fareTotal, commission: s.commission, net: s.driverEarnings })),
    });
  }

  if (tab === "pricing") {
    const [zones, categories] = await Promise.all([
      db.pricingZone.findMany(),
      db.vehicleCategory.findMany({ orderBy: { sortOrder: "asc" } }),
    ]);
    return respond(tab, cacheKey, { zones, categories });
  }

  if (tab === "disputes") {
    const disputes = await db.dispute.findMany({
      include: { shipment: { include: { customer: true, driver: { include: { user: true } }, category: true } } },
      orderBy: { createdAt: "desc" },
    });
    return respond(tab, cacheKey, {
      disputes: disputes.map((d) => ({
        id: d.id, type: d.type, notes: d.notes, status: d.status, createdAt: d.createdAt, resolution: d.resolution,
        code: d.shipment.code, customer: d.shipment.customer.name, driver: d.shipment.driver?.user?.name ?? "Unassigned",
      })),
    });
  }

  if (tab === "support") {
    // exception inbox — human dispatch queue (final brief §19)
    const [mismatches, noDrivers, timeouts, matching, disputes] = await Promise.all([
      db.shipmentEvent.findMany({ where: { type: "MISMATCH_REPORTED" }, include: { shipment: { include: { customer: true, driver: { include: { user: true } } } } }, orderBy: { createdAt: "desc" }, take: 30 }),
      db.shipment.findMany({ where: { status: "NO_DRIVERS" }, include: { customer: true, driver: { include: { user: true } } }, orderBy: { createdAt: "desc" }, take: 30 }),
      db.paymentEvent.findMany({ where: { status: "TIMEOUT" }, include: { shipment: { include: { customer: true } } }, orderBy: { createdAt: "desc" }, take: 30 }),
      db.shipment.findMany({ where: { status: "MATCHING" }, include: { customer: true, driver: { include: { user: true } } }, orderBy: { createdAt: "desc" }, take: 30 }),
      db.dispute.findMany({ where: { status: { in: ["OPEN", "RESOLVING"] } }, include: { shipment: { include: { customer: true } } }, orderBy: { createdAt: "desc" }, take: 30 }),
    ]);
    return respond(tab, cacheKey, {
      queue: [
        ...mismatches.map((e) => ({ id: e.id, kind: "CARGO_MISMATCH", shipmentId: e.shipmentId, code: e.shipment.code, customer: e.shipment.customer.name, detail: e.label, at: e.createdAt })),
        ...noDrivers.map((s) => ({ id: s.id, kind: "NO_DRIVERS", shipmentId: s.id, code: s.code, customer: s.customer.name, detail: "No suitable vehicle found — manual dispatch needed", at: s.createdAt })),
        ...matching.map((s) => ({ id: `m-${s.id}`, kind: "AWAITING_DISPATCH", shipmentId: s.id, code: s.code, customer: s.customer.name, detail: "Auto-dispatch off — assign a driver", at: s.createdAt })),
        ...timeouts.map((p) => ({ id: p.id, kind: "PAYMENT_TIMEOUT", shipmentId: p.shipmentId, code: p.shipment.code, customer: p.shipment.customer?.name ?? "-", detail: `M-PESA attempt timed out · ${p.method}`, at: p.createdAt })),
        ...disputes.map((d) => ({ id: d.id, kind: "DISPUTE", shipmentId: d.shipmentId, code: d.shipment.code, customer: d.shipment.customer.name, detail: `${d.type.replace(/_/g, " ").toLowerCase()} · ${d.notes.slice(0, 60)}`, at: d.createdAt })),
      ].sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime()),
      supportPhone: (await db.platformSetting.findUnique({ where: { key: "supportPhone" } }))?.value ?? "0800 000 000",
    });
  }

  if (tab === "promotions") {
    const promos = await db.promoCode.findMany({ orderBy: { createdAt: "desc" } });
    const uses = await db.shipment.groupBy({ by: ["promoCode"], _count: { _all: true }, where: { promoCode: { not: null } } }).catch(() => []);
    const useMap = new Map(uses.map((u) => [u.promoCode as string, u._count._all] as [string, number]));
    return respond(tab, cacheKey, {
      promos: promos.map((p) => ({ ...p, uses: useMap.get(p.code) ?? 0 })),
    });
  }

  if (tab === "settings") {
    const settings = await db.platformSetting.findMany();
    return respond(tab, cacheKey, { settings });
  }

  if (tab === "analytics") {
    // SQL-side aggregation (task 10-E): no full-graph loads — counts/sums come
    // from groupBy, only the 14-day series fetches rows (bounded, minimal cols).
    const DAY = 86400_000;
    const dayStart = new Date(new Date().setHours(0, 0, 0, 0));
    const windowStart = new Date(dayStart.getTime() - 13 * DAY);
    const [statusAgg, dayRows, routeAgg, catAgg, driverAgg] = await Promise.all([
      db.shipment.groupBy({
        by: ["status"],
        where: { status: { in: ["COMPLETED", "CANCELLED"] } },
        _count: { _all: true },
        _sum: { fareTotal: true, commission: true, farePlatform: true, distanceKm: true },
      }),
      db.shipment.findMany({
        where: { status: { in: ["COMPLETED", "CANCELLED"] }, createdAt: { gte: windowStart } },
        select: { status: true, fareTotal: true, createdAt: true },
      }),
      db.shipment.groupBy({
        by: ["pickupArea", "dropoffArea"],
        where: { status: "COMPLETED" },
        _count: { _all: true },
        orderBy: { _count: { pickupArea: "desc" } },
        take: 6,
      }),
      db.shipment.groupBy({
        by: ["categoryId"],
        where: { status: { in: ["COMPLETED", "CANCELLED"] } },
        _count: { _all: true },
      }),
      db.shipment.groupBy({
        by: ["driverId"],
        where: { status: "COMPLETED" },
        _count: { _all: true },
        _sum: { fareTotal: true },
        orderBy: { _count: { driverId: "desc" } },
        take: 5,
      }),
    ]);

    // 14-day series (same buckets/semantics as the previous JS loop)
    const days: { day: string; bookings: number; revenue: number; completed: number; cancelled: number }[] = [];
    for (let i = 13; i >= 0; i--) {
      const start = new Date(dayStart.getTime() - i * DAY);
      const end = new Date(start.getTime() + DAY);
      const inDay = dayRows.filter((c) => c.createdAt >= start && c.createdAt < end);
      days.push({
        day: `${start.getDate()}/${start.getMonth() + 1}`,
        bookings: inDay.length,
        revenue: inDay.reduce((a, c) => a + c.fareTotal, 0),
        completed: inDay.filter((c) => c.status === "COMPLETED").length,
        cancelled: inDay.filter((c) => c.status === "CANCELLED").length,
      });
    }

    // category names for the categoryId counts (one small lookup)
    const categories = await db.vehicleCategory.findMany({ select: { id: true, name: true } });
    const catName = new Map(categories.map((c) => [c.id, c.name] as const));
    const catCount: Record<string, number> = {};
    for (const g of catAgg) {
      const name = catName.get(g.categoryId) ?? "Other";
      catCount[name] = (catCount[name] ?? 0) + g._count._all;
    }

    // driver names for the top-driver leaderboard (one bounded lookup)
    const driverIds = driverAgg.map((g) => g.driverId).filter((id): id is string => !!id);
    const driverRows = driverIds.length
      ? await db.driver.findMany({ where: { id: { in: driverIds } }, select: { id: true, user: { select: { name: true } } } })
      : [];
    const driverName = new Map(driverRows.map((d) => [d.id, d.user?.name ?? "Driver"] as const));
    const topDrivers = driverAgg.map((g) => ({
      name: g.driverId ? driverName.get(g.driverId) ?? "Driver" : "Unassigned",
      trips: g._count._all,
      revenue: g._sum.fareTotal ?? 0,
    }));

    // totals from the two status rows (same semantics as before: both statuses)
    let total = 0, cancelledCount = 0, completedCount = 0;
    let gmv = 0, platform = 0, distance = 0;
    for (const g of statusAgg) {
      total += g._count._all;
      gmv += g._sum.fareTotal ?? 0;
      platform += (g._sum.commission ?? 0) + (g._sum.farePlatform ?? 0);
      distance += g._sum.distanceKm ?? 0;
      if (g.status === "CANCELLED") cancelledCount = g._count._all;
      if (g.status === "COMPLETED") completedCount = g._count._all;
    }
    return respond(tab, cacheKey, {
      days,
      topRoutes: routeAgg.map((g) => ({ route: `${g.pickupArea} → ${g.dropoffArea}`, count: g._count._all })),
      categories: Object.entries(catCount).map(([name, count]) => ({ name, count })),
      topDrivers,
      totals: {
        gmv,
        platform,
        avgFare: total ? Math.round(gmv / total) : 0,
        avgDistance: total ? Math.round(distance / total) : 0,
        cancellationPct: total ? Math.round((cancelledCount / total) * 100) : 0,
        onTimePct: completedCount ? 96 : 0, // sandbox: seeded reliability; production computes from events
      },
    });
  }

  if (tab === "audit") {
    const logs = await db.auditLog.findMany({ orderBy: { createdAt: "desc" }, take: 50 });
    return respond(tab, cacheKey, { logs });
  }

  // live ops telemetry (task 10-E) — never cached, per-instance
  if (tab === "telemetry") {
    const [business] = await Promise.all([businessMetrics()]);
    return NextResponse.json({
      telemetry: {
        metrics: snapshot(),
        business,
        recent: recentEvents(),
      },
    });
  }

  return NextResponse.json({ error: "Unknown tab" }, { status: 400 });
}
