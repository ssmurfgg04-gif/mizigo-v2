// GET /api/admin — operations data for the admin console.
// tabs: overview | shipments | drivers | vehicles | payments | pricing | disputes | analytics | audit
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { ensureSeed } from "@/lib/seed";
import { activeShipments, shipmentDTO } from "@/lib/shipments";
import { STATUS_LABEL } from "@/lib/state-machine";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  await ensureSeed();
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
      include: { category: true, vehicle: true, driver: { include: { user: true } }, customer: true, items: true, events: true, ratings: true },
      orderBy: { createdAt: "desc" }, take: 100,
    });
    let shipments = rows.map(shipmentDTO);
    if (q) {
      shipments = shipments.filter((s) =>
        s.code.toLowerCase().includes(q) || s.route.pickup.name.toLowerCase().includes(q) ||
        s.route.dropoff.name.toLowerCase().includes(q) || (s.driver?.name ?? "").toLowerCase().includes(q) ||
        (s.vehicle?.registration ?? "").toLowerCase().includes(q) || s.customer.name.toLowerCase().includes(q)
      );
    }
    return NextResponse.json({ shipments, statuses: Object.entries(STATUS_LABEL).map(([key, label]) => ({ key, label })) });
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

  if (tab === "payments") {
    const [payments, payouts] = await Promise.all([
      db.paymentEvent.findMany({ orderBy: { createdAt: "desc" }, take: 100 }),
      db.payout.findMany({ orderBy: { createdAt: "desc" }, take: 50 }),
    ]);
    const shipments = await db.shipment.findMany({ select: { id: true, code: true, customerId: true, driverId: true, fareTotal: true } });
    const byId = Object.fromEntries(shipments.map((s) => [s.id, s]));
    return NextResponse.json({
      payments: payments.map((p) => ({ ...p, code: byId[p.shipmentId]?.code ?? "-", })),
      payouts,
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

  if (tab === "analytics") {
    const DAY = 86400_000;
    const completed = await db.shipment.findMany({
      where: { status: { in: ["COMPLETED", "CANCELLED"] } },
      select: { status: true, fareTotal: true, commission: true, farePlatform: true, distanceKm: true, durationMin: true, createdAt: true, pickupArea: true, dropoffArea: true, category: { select: { name: true } }, driverEarnings: true },
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
    return NextResponse.json({
      days,
      topRoutes,
      categories: Object.entries(catCount).map(([name, count]) => ({ name, count })),
      totals: {
        gmv: completed.reduce((a, c) => a + c.fareTotal, 0),
        platform: completed.reduce((a, c) => a + c.commission + c.farePlatform, 0),
        avgFare: completed.length ? Math.round(completed.reduce((a, c) => a + c.fareTotal, 0) / completed.length) : 0,
        avgDistance: completed.length ? Math.round(completed.reduce((a, c) => a + c.distanceKm, 0) / completed.length) : 0,
      },
    });
  }

  if (tab === "audit") {
    const logs = await db.auditLog.findMany({ orderBy: { createdAt: "desc" }, take: 50 });
    return NextResponse.json({ logs });
  }

  return NextResponse.json({ error: "Unknown tab" }, { status: 400 });
}
