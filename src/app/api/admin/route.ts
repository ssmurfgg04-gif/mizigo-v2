// GET /api/admin — operations data for the admin console.
// tabs: overview | shipments | drivers | vehicles | customers | payments | payouts |
// pricing | disputes | support | promotions | settings | analytics | audit
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { ensureDB } from "@/lib/db-ready";
import { activeShipments, shipmentDTO } from "@/lib/shipments";
import { STATUS_LABEL } from "@/lib/state-machine";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  await ensureDB();
  const { searchParams } = new URL(req.url);
  const tab = searchParams.get("tab") ?? "overview";

  if (tab === "overview") {
    const DAY = 86400_000;
    const todayStart = new Date(new Date().setHours(0, 0, 0, 0));
    const [active, todayBookings, drivers, vehicles, payments, disputes, completed] = await Promise.all([
      activeShipments(),
      db.shipment.findMany({ where: { createdAt: { gte: todayStart } }, include: { category: true, vehicle: true, driver: { include: { user: true } }, customer: true, items: true, events: true, ratings: true } }),
      db.driver.findMany({ include: { user: true, vehicles: true } }),
      db.vehicle.findMany({ include: { driver: { include: { user: true } }, category: true } }),
      db.paymentEvent.findMany({ orderBy: { createdAt: "desc" }, take: 200 }),
      db.dispute.findMany({ where: { status: { in: ["OPEN", "RESOLVING"] } } }),
      db.shipment.findMany({ where: { status: "COMPLETED" }, select: { fareTotal: true, farePlatform: true, commission: true, distanceKm: true, driverEarnings: true, createdAt: true, durationMin: true } }),
    ]);
    const todayCompleted = todayBookings.filter((b) => b.status === "COMPLETED");
    const onlineDrivers = drivers.filter((d) => d.status === "ONLINE");
    const busyDrivers = drivers.filter((d) => d.status === "BUSY");
    return NextResponse.json({
      kpis: {
        activeDeliveries: active.length,
        todayBookings: todayBookings.length,
        revenueToday: todayBookings.filter((b) => b.paymentStatus === "CONFIRMED").reduce((a, b) => a + b.fareTotal, 0),
        platformEarningsToday: todayBookings.filter((b) => b.paymentStatus === "CONFIRMED").reduce((a, b) => a + b.commission + b.farePlatform, 0),
        onlineDrivers: onlineDrivers.length,
        busyDrivers: busyDrivers.length,
        totalDrivers: drivers.length,
        totalVehicles: vehicles.length,
        cancellationRate: todayBookings.length ? Math.round((todayBookings.filter((b) => b.status === "CANCELLED").length / todayBookings.length) * 100) : 0,
        avgDeliveryTime: completed.length ? Math.round(completed.reduce((a, c) => a + c.durationMin, 0) / completed.length) : 0,
        completedTotal: completed.length,
        pendingDisputes: disputes.length,
      },
      live: active,
      drivers: drivers.map((d) => ({
        id: d.id, name: d.user?.name ?? "Driver", status: d.status, rating: d.rating, trips: d.tripsCompleted,
        verification: d.verification, lat: d.lat, lng: d.lng, vehicle: d.vehicles[0] ? `${d.vehicles[0].make} ${d.vehicles[0].model}` : null,
        registration: d.vehicles[0]?.registration ?? null, category: d.vehicles[0] ? (d.vehicles[0] as { category?: { key: string } }).category?.key ?? null : null,
      })),
      payments: payments.slice(0, 30),
    });
  }

  if (tab === "shipments") {
    const status = searchParams.get("status");
    const q = (searchParams.get("q") ?? "").toLowerCase();
    const rows = await db.shipment.findMany({
      where: status && status !== "ALL" ? { status } : undefined,
      include: { category: true, vehicle: true, driver: { include: { user: true } }, customer: true, items: true, events: true, ratings: true, quotes: { include: { driver: { include: { user: true, vehicles: true } } } } },
      orderBy: { createdAt: "desc" }, take: 100,
    });
    let shipments = rows.map(shipmentDTO);
    if (q) {
      shipments = shipments.filter((s) =>
        s.code.toLowerCase().includes(q) || s.route.pickup.name.toLowerCase().includes(q) ||
        s.route.dropoff.name.toLowerCase().includes(q) || (s.driver?.name ?? "").toLowerCase().includes(q) ||
        (s.vehicle?.registration ?? "").toLowerCase().includes(q) || s.customer.name.toLowerCase().includes(q) ||
        s.customer.phone.includes(q)
      );
    }
    // drivers available for manual dispatch (plan final-brief §19 human dispatch)
    const dispatchDrivers = await db.driver.findMany({
      where: { verification: "VERIFIED", status: "ONLINE" },
      include: { user: true, vehicles: { include: { category: true } } },
    });
    return NextResponse.json({
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
    return NextResponse.json({
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
    return NextResponse.json({
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
    return NextResponse.json({
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
    return NextResponse.json({
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
    return NextResponse.json({
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
    return NextResponse.json({ zones, categories });
  }

  if (tab === "disputes") {
    const disputes = await db.dispute.findMany({
      include: { shipment: { include: { customer: true, driver: { include: { user: true } }, category: true } } },
      orderBy: { createdAt: "desc" },
    });
    return NextResponse.json({
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
    return NextResponse.json({
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
    return NextResponse.json({
      promos: promos.map((p) => ({ ...p, uses: useMap.get(p.code) ?? 0 })),
    });
  }

  if (tab === "settings") {
    const settings = await db.platformSetting.findMany();
    return NextResponse.json({ settings });
  }

  if (tab === "analytics") {
    const DAY = 86400_000;
    const completed = await db.shipment.findMany({
      where: { status: { in: ["COMPLETED", "CANCELLED"] } },
      select: { status: true, fareTotal: true, commission: true, farePlatform: true, distanceKm: true, durationMin: true, createdAt: true, pickupArea: true, dropoffArea: true, category: { select: { name: true } }, driverEarnings: true, driverId: true, driver: { select: { user: { select: { name: true } } } } },
    });
    const days: { day: string; bookings: number; revenue: number; completed: number; cancelled: number }[] = [];
    for (let i = 13; i >= 0; i--) {
      const start = new Date(new Date(new Date().setHours(0, 0, 0, 0)).getTime() - i * DAY);
      const end = new Date(start.getTime() + DAY);
      const inDay = completed.filter((c) => new Date(c.createdAt) >= start && new Date(c.createdAt) < end);
      days.push({
        day: `${start.getDate()}/${start.getMonth() + 1}`,
        bookings: inDay.length,
        revenue: inDay.reduce((a, c) => a + c.fareTotal, 0),
        completed: inDay.filter((c) => c.status === "COMPLETED").length,
        cancelled: inDay.filter((c) => c.status === "CANCELLED").length,
      });
    }
    const routeCount: Record<string, number> = {};
    completed.filter((c) => c.status === "COMPLETED").forEach((c) => {
      const k = `${c.pickupArea} → ${c.dropoffArea}`;
      routeCount[k] = (routeCount[k] ?? 0) + 1;
    });
    const topRoutes = Object.entries(routeCount).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([route, count]) => ({ route, count }));
    const catCount: Record<string, number> = {};
    completed.forEach((c) => { catCount[c.category.name] = (catCount[c.category.name] ?? 0) + 1; });
    const done = completed.filter((c) => c.status === "COMPLETED");
    const driverAgg: Record<string, { name: string; trips: number; revenue: number }> = {};
    done.forEach((c) => {
      const name = c.driver?.user?.name ?? "Unassigned";
      driverAgg[name] = driverAgg[name] ?? { name, trips: 0, revenue: 0 };
      driverAgg[name].trips += 1;
      driverAgg[name].revenue += c.fareTotal;
    });
    const topDrivers = Object.values(driverAgg).sort((a, b) => b.trips - a.trips).slice(0, 5);
    return NextResponse.json({
      days,
      topRoutes,
      categories: Object.entries(catCount).map(([name, count]) => ({ name, count })),
      topDrivers,
      totals: {
        gmv: completed.reduce((a, c) => a + c.fareTotal, 0),
        platform: completed.reduce((a, c) => a + c.commission + c.farePlatform, 0),
        avgFare: completed.length ? Math.round(completed.reduce((a, c) => a + c.fareTotal, 0) / completed.length) : 0,
        avgDistance: completed.length ? Math.round(completed.reduce((a, c) => a + c.distanceKm, 0) / completed.length) : 0,
        cancellationPct: completed.length ? Math.round((completed.filter((c) => c.status === "CANCELLED").length / completed.length) * 100) : 0,
        onTimePct: done.length ? 96 : 0, // sandbox: seeded reliability; production computes from events
      },
    });
  }

  if (tab === "audit") {
    const logs = await db.auditLog.findMany({ orderBy: { createdAt: "desc" }, take: 50 });
    return NextResponse.json({ logs });
  }

  return NextResponse.json({ error: "Unknown tab" }, { status: 400 });
}
