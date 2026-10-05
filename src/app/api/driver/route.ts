// GET /api/driver — driver surface data (home | requests | earnings | trips | vehicle)
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { ensureDB } from "@/lib/db-ready";
import { ACTIVE_STATES } from "@/lib/state-machine";
import { DEMAND_ZONES } from "@/lib/matching";
import { shipmentDTO } from "@/lib/shipments";
import { requireSession, isResponse } from "@/lib/security";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  await ensureDB();
  // the session's driver profile — a query param can never read another driver
  const session = requireSession(req);
  if (isResponse(session)) return session;
  const { searchParams } = new URL(req.url);
  const driverId = session.role === "ADMIN" && searchParams.get("driverId") ? searchParams.get("driverId")! : session.did;
  if (!driverId) return NextResponse.json({ error: "No driver profile on this account." }, { status: 403 });

  const driver = await db.driver.findUnique({
    where: { id: driverId },
    include: { user: true, vehicles: { include: { category: true } } },
  });
  if (!driver) return NextResponse.json({ error: "Driver not found" }, { status: 404 });

  const [active, history, payouts, quoteJobs] = await Promise.all([
    db.shipment.findFirst({
      where: { driverId, status: { in: ["DRIVER_ASSIGNED", "DRIVER_EN_ROUTE", "DRIVER_ARRIVED", "LOADING", "LOADED", "IN_TRANSIT", "ARRIVING", "DELIVERED", "POD_CONFIRMED"] } },
      include: { category: true, vehicle: true, driver: { include: { user: true } }, customer: true, items: true, events: true, ratings: true, quotes: { include: { driver: { include: { user: true, vehicles: true } } } }, messages: { orderBy: { createdAt: "asc" } } },
      orderBy: { createdAt: "desc" },
    }),
    db.shipment.findMany({
      where: { driverId, status: { in: [...ACTIVE_STATES, "COMPLETED", "CANCELLED"] } },
      include: { category: true, vehicle: true, driver: { include: { user: true } }, customer: true, items: true, events: true, ratings: true, messages: { orderBy: { createdAt: "asc" } } },
      orderBy: { createdAt: "desc" },
    }),
    db.payout.findMany({ where: { driverId }, orderBy: { createdAt: "desc" } }),
    // open quote-marketplace jobs for this driver's vehicle categories (plan §33)
    db.shipment.findMany({
      where: { status: "QUOTED", categoryId: { in: driver.vehicles.map((v) => v.categoryId) } },
      include: { category: true, vehicle: true, driver: { include: { user: true } }, customer: true, items: true, events: true, ratings: true, quotes: { include: { driver: { include: { user: true, vehicles: true } } } } },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  const completed = history.filter((h) => h.status === "COMPLETED");
  const DAY = 86400_000;
  const todayStart = new Date(new Date().setHours(0, 0, 0, 0));
  const weekStart = new Date(Date.now() - 7 * DAY);
  const monthStart = new Date(Date.now() - 30 * DAY);

  const sum = (from: Date) => completed.filter((c) => new Date(c.stateEnteredAt) >= from).reduce((a, c) => a + c.driverEarnings, 0);
  const todayTrips = completed.filter((c) => new Date(c.stateEnteredAt) >= todayStart);
  const todayEarnings = todayTrips.reduce((a, c) => a + c.driverEarnings, 0);

  // 7-day chart
  const chart: { day: string; earnings: number; trips: number }[] = [];
  for (let i = 6; i >= 0; i--) {
    const dayStart = new Date(todayStart.getTime() - i * DAY);
    const dayEnd = new Date(dayStart.getTime() + DAY);
    const dayTrips = completed.filter((c) => new Date(c.stateEnteredAt) >= dayStart && new Date(c.stateEnteredAt) < dayEnd);
    chart.push({
      day: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][dayStart.getDay()],
      earnings: dayTrips.reduce((a, c) => a + c.driverEarnings, 0),
      trips: dayTrips.length,
    });
  }

  const withdrawn = payouts.filter((p) => p.status === "PAID").reduce((a, p) => a + p.amount, 0);

  return NextResponse.json({
    driver: {
      id: driver.id, status: driver.status, rating: driver.rating, trips: driver.tripsCompleted,
      acceptanceRate: driver.acceptanceRate, onTimePickup: driver.onTimePickup, onTimeDelivery: driver.onTimeDelivery,
      cancellationRate: driver.cancellationRate, incidents: driver.incidents, verification: driver.verification,
      licenceClass: driver.licenceClass, licenceExpiry: driver.licenceExpiry, onlineMinutes: driver.onlineMinutes,
      user: { id: driver.user.id, name: driver.user.name, phone: driver.user.phone, avatarSeed: driver.user.avatarSeed },
      vehicles: driver.vehicles.map((v) => ({
        id: v.id, make: v.make, model: v.model, registration: v.registration, bodyType: v.bodyType, capacityKg: v.capacityKg,
        category: v.category?.name ?? "", categoryKey: v.category?.key ?? "", docs: { registration: v.docRegistration, insurance: v.docInsurance, inspection: v.docInspection },
        insuranceExpiry: v.insuranceExpiry, inspectionExpiry: v.inspectionExpiry,
      })),
    },
    active: active ? shipmentDTO(active) : null,
    history: history.map(shipmentDTO),
    quoteJobs: quoteJobs
      .filter((j) => !j.quotes.some((q) => q.driverId === driverId))
      .map((j) => ({
        ...shipmentDTO(j),
        quotedByMe: j.quotes.some((q) => q.driverId === driverId),
        quoteCount: j.quotes.filter((q) => q.status === "PENDING").length,
      })),
    earnings: {
      today: todayEarnings, week: sum(weekStart), month: sum(monthStart),
      todayTrips: todayTrips.length, avgPerTrip: todayTrips.length ? Math.round(todayEarnings / todayTrips.length) : 0,
      chart,
      wallet: Math.max(0, sum(monthStart) - withdrawn),
      payouts,
      grossFares: completed.filter((c) => new Date(c.stateEnteredAt) >= monthStart).reduce((a, c) => a + c.fareTotal, 0),
      commission: completed.filter((c) => new Date(c.stateEnteredAt) >= monthStart).reduce((a, c) => a + c.commission, 0),
    },
    demand: DEMAND_ZONES,
    returnLoads: await db.returnLoad.findMany({
      where: { driverId, status: { in: ["AVAILABLE", "BOOKED"] } },
      orderBy: { createdAt: "desc" },
      take: 6,
    }),
    notifications: await db.notification.findMany({ where: { userId: driver.userId }, orderBy: { createdAt: "desc" }, take: 10 }),
  });
}
