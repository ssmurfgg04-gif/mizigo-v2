// GET /api/driver — driver surface data (home | requests | earnings | trips | vehicle)
// GET /api/driver?earnings=1&week=YYYY-MM-DD — weekly earnings statement
//   (Uber Earnings-tab pattern: Mon 00:00 → Sun 23:59 EAT, NET/GROSS math
//   computed server-side — docs/UBER_BOLT_TEARDOWN.md §3.16, copy row #11)
// POST /api/driver — driver-scoped settings actions (currently: earnings-goal)
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { ensureDB } from "@/lib/db-ready";
import { ACTIVE_STATES } from "@/lib/state-machine";
import { DEMAND_ZONES } from "@/lib/matching";
import { shipmentDTO } from "@/lib/shipments";
import { requireSession, isResponse, rateLimit } from "@/lib/security";
import {
  weekBoundsEAT, weekLabelEAT, resolveWeekAnchor,
  type StatementPayout, type StatementTrip, type WeeklyStatement,
} from "@/lib/earnings";

export const dynamic = "force-dynamic";

// ── weekly earnings statement (GET ?earnings=1) ───────────────────────────────
async function earningsStatement(driverId: string, ownProfile: boolean, weekParam: string | null): Promise<NextResponse> {
  const driver = await db.driver.findUnique({ where: { id: driverId }, select: { id: true, earningsGoal: true } });
  if (!driver) {
    // same stale-session contract as the main GET: own session → 401 (clean
    // logout), admin querying a param driver → real 404
    return NextResponse.json(
      ownProfile ? { error: "Session expired. Please sign in again." } : { error: "Driver not found" },
      { status: ownProfile ? 401 : 404 },
    );
  }

  const { start, end } = weekBoundsEAT(resolveWeekAnchor(weekParam));
  const DAY = 86_400_000;

  // completed trips keyed on the POD handshake (the moment the money is
  // earned); includes cash trips — cashCollectedKes is broken out separately
  const [tripRows, weekPayouts, monthCompleted, allPayouts] = await Promise.all([
    db.shipment.findMany({
      where: { driverId, status: "COMPLETED", podVerifiedAt: { gte: start, lte: end } },
      select: {
        id: true, code: true, stateEnteredAt: true, podVerifiedAt: true,
        pickupName: true, dropoffName: true, fareTotal: true, driverEarnings: true,
        commission: true, farePlatform: true, paymentMethod: true, podRecipient: true,
      },
      orderBy: { podVerifiedAt: "desc" },
    }),
    db.payout.findMany({
      where: { driverId, createdAt: { gte: start, lte: end } },
      orderBy: { createdAt: "desc" },
    }),
    db.shipment.findMany({
      where: { driverId, status: "COMPLETED" },
      select: { driverEarnings: true, stateEnteredAt: true },
    }),
    db.payout.findMany({ where: { driverId }, select: { amount: true, status: true } }),
  ]);

  // customer tips per shipment (100% driver's; already inside driverEarnings)
  const tipByShipment = new Map<string, number>();
  if (tripRows.length) {
    const tips = await db.rating.findMany({
      where: { shipmentId: { in: tripRows.map((t) => t.id) }, byRole: "CUSTOMER", tip: { not: null } },
      select: { shipmentId: true, tip: true },
    });
    for (const r of tips) tipByShipment.set(r.shipmentId, (tipByShipment.get(r.shipmentId) ?? 0) + (r.tip ?? 0));
  }

  const tripList: StatementTrip[] = tripRows.map((t) => ({
    id: t.id,
    code: t.code,
    completedAt: t.stateEnteredAt.toISOString(),
    podVerifiedAt: (t.podVerifiedAt as Date).toISOString(),
    pickupName: t.pickupName,
    dropoffName: t.dropoffName,
    grossKes: t.fareTotal,
    netKes: t.driverEarnings,
    commissionKes: t.commission,
    platformFeeKes: t.farePlatform,
    tipKes: tipByShipment.get(t.id) ?? 0,
    paymentMethod: t.paymentMethod,
    podRecipient: t.podRecipient,
  }));

  const payouts: StatementPayout[] = weekPayouts.map((p) => ({
    id: p.id,
    amount: p.amount,
    status: p.status,
    method: p.method,
    ref: p.ref,
    createdAt: p.createdAt.toISOString(),
    processedAt: p.processedAt ? p.processedAt.toISOString() : null,
    failureReason: p.failureReason,
  }));

  // pending balance mirrors the wallet math the withdraw action enforces
  // (api/driver/action): completed net earnings over the trailing 30 days −
  // paid-out withdrawals, minus anything still in flight — so the number the
  // driver reads here is the number a withdrawal would actually move.
  const monthStart = new Date(Date.now() - 30 * DAY);
  const earnedMonth = monthCompleted
    .filter((c) => new Date(c.stateEnteredAt) >= monthStart)
    .reduce((a, c) => a + c.driverEarnings, 0);
  const paidOut = allPayouts.filter((p) => p.status === "PAID").reduce((a, p) => a + p.amount, 0);
  const inFlight = allPayouts
    .filter((p) => p.status === "PENDING" || p.status === "PROCESSING")
    .reduce((a, p) => a + p.amount, 0);

  const totals = tripList.reduce(
    (acc, t) => ({
      gross: acc.gross + t.grossKes,
      net: acc.net + t.netKes,
      commission: acc.commission + t.commissionKes,
      platform: acc.platform + t.platformFeeKes,
      tips: acc.tips + t.tipKes,
      cash: acc.cash + (t.paymentMethod === "CASH" ? t.grossKes : 0),
    }),
    { gross: 0, net: 0, commission: 0, platform: 0, tips: 0, cash: 0 },
  );

  const thisWeek = weekBoundsEAT(new Date());
  const statement: WeeklyStatement = {
    weekStart: start.toISOString(),
    weekEnd: end.toISOString(),
    weekLabel: weekLabelEAT(start, end),
    isCurrentWeek: start.getTime() === thisWeek.start.getTime(),
    trips: tripList.length,
    grossKes: totals.gross,
    netKes: totals.net,
    commissionKes: totals.commission,
    platformFeeKes: totals.platform,
    tipsKes: totals.tips,
    cashCollectedKes: totals.cash,
    tripList,
    payouts,
    pendingBalanceKes: Math.max(0, earnedMonth - paidOut - inFlight),
    earningsGoal: driver.earningsGoal,
  };
  return NextResponse.json(statement);
}

export async function GET(req: Request) {
  await ensureDB();
  // the session's driver profile — a query param can never read another driver
  const session = requireSession(req);
  if (isResponse(session)) return session;
  const { searchParams } = new URL(req.url);
  const driverId = session.role === "ADMIN" && searchParams.get("driverId") ? searchParams.get("driverId")! : session.did;
  if (!driverId) return NextResponse.json({ error: "No driver profile on this account." }, { status: 403 });

  // weekly earnings statement branch — ?earnings=1[&week=YYYY-MM-DD]
  if (searchParams.get("earnings") === "1") {
    return earningsStatement(driverId, driverId === session.did, searchParams.get("week"));
  }

  const driver = await db.driver.findUnique({
    where: { id: driverId },
    include: { user: true, vehicles: { include: { category: true } } },
  });
  // Stale own-session (sandbox instance churn) → 401 so the client logs out
  // cleanly; an admin querying a nonexistent driver by param is a real 404.
  const ownProfile = driverId === session.did;
  if (!driver) {
    return NextResponse.json(
      ownProfile
        ? { error: "Session expired. Please sign in again." }
        : { error: "Driver not found" },
      { status: ownProfile ? 401 : 404 },
    );
  }

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

// ── POST /api/driver — driver-scoped actions (settings the driver owns) ──────
export async function POST(req: Request) {
  await ensureDB();
  // every action is bound to the session's own driver profile
  const session = requireSession(req);
  if (isResponse(session)) return session;
  const body = await req.json().catch(() => ({}));
  const action = String(body.action ?? "");
  const limited = rateLimit(req, "driver:action", 40, 60_000);
  if (limited) return limited;
  const driverId = session.did;
  if (!driverId && session.role !== "ADMIN") {
    return NextResponse.json({ error: "No driver profile on this account." }, { status: 403 });
  }

  // weekly earnings goal (Uber Earnings-goal pattern — DECOMPILE §4.4):
  // whole KES 0..1,000,000; 0 clears the target
  if (action === "earnings-goal") {
    if (!driverId) return NextResponse.json({ error: "No driver profile on this account." }, { status: 403 });
    const goal = Math.round(Number(body.goalKes));
    if (!Number.isFinite(goal) || goal < 0 || goal > 1_000_000) {
      return NextResponse.json({ error: "Enter a goal between KES 0 and KES 1,000,000." }, { status: 400 });
    }
    const d = await db.driver.findUnique({ where: { id: driverId }, select: { id: true } });
    // 401: session-bound driver missing = stale session (sandbox instance churn)
    if (!d) return NextResponse.json({ error: "Session expired. Please sign in again." }, { status: 401 });
    const earningsGoal = goal === 0 ? null : goal;
    await db.driver.update({ where: { id: driverId }, data: { earningsGoal } });
    return NextResponse.json({ ok: true, earningsGoal });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
