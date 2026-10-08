// POST /api/driver — driver actions: ping (GPS) | status | withdraw | payout-setup | publish-return-load | return-load-cancel
import { NextResponse } from "next/server";
import { db } from "@/lib/db";

import { priceFor } from "@/lib/pricing";
import { routeDistanceKm, routeDurationMin } from "@/lib/geo";
import { cellOf } from "@/lib/h3";
import { setupDriverPayout, createWithdrawalPayout } from "@/lib/payments";
import { ensureDB } from "@/lib/db-ready";
import { requireSession, isResponse, rateLimit, clampInt, capStr, validCoord } from "@/lib/security";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  await ensureDB();
  // every driver action is bound to the session's own driver profile
  const session = requireSession(req);
  if (isResponse(session)) return session;
  const body = await req.json().catch(() => ({}));
  const action = String(body.action ?? "");
  // GPS pings get their own tight window (see the "ping" action below);
  // every other action keeps the shared 40/min driver-action budget.
  const limited = action === "ping"
    ? rateLimit(req, "driver:ping", 60, 60_000)
    : rateLimit(req, "driver:action", 40, 60_000);
  if (limited) return limited;
  const driverId = session.did;
  if (!driverId && session.role !== "ADMIN") {
    return NextResponse.json({ error: "No driver profile on this account." }, { status: 403 });
  }

  // ── GPS ping — the seam where a real driver app later feeds live position ──
  // Today tracking prefers the server-side simulation (simulateLive in
  // lib/shipments.ts derives position from state + elapsed time); a future
  // change can prefer fresh pings (lastPingAt < 90s) on the tracking surfaces
  // once the driver app is actually feeding this endpoint.
  if (action === "ping") {
    if (!driverId) return NextResponse.json({ error: "No driver profile on this account." }, { status: 403 });
    const c = validCoord(body.lat, body.lng);
    if (!c) return NextResponse.json({ error: "Invalid coordinates." }, { status: 400 });
    // 401: session-bound driver missing = stale session (sandbox instance churn)
    const d = await db.driver.findUnique({ where: { id: driverId }, select: { id: true } });
    if (!d) return NextResponse.json({ error: "Session expired. Please sign in again." }, { status: 401 });
    await db.driver.update({ where: { id: driverId }, data: { lat: c.lat, lng: c.lng, h3Cell: cellOf(c.lat, c.lng), lastPingAt: new Date() } });
    return NextResponse.json({ ok: true, lat: c.lat, lng: c.lng });
  }

  if (action === "status") {
    const status = body.status;
    if (!driverId || !["ONLINE", "OFFLINE", "BREAK"].includes(status)) {
      return NextResponse.json({ error: "Invalid status" }, { status: 400 });
    }
    const d = await db.driver.findUnique({ where: { id: driverId } });
    // 401: session-bound driver missing = stale session (sandbox instance churn)
    if (!d) return NextResponse.json({ error: "Session expired. Please sign in again." }, { status: 401 });
    if (d.verification !== "VERIFIED") {
      return NextResponse.json({ error: "Your account is awaiting verification." }, { status: 403 });
    }
    if (status === "ONLINE" && !(await db.vehicle.count({ where: { driverId, active: true } }))) {
      return NextResponse.json({ error: "Add a verified vehicle before going online." }, { status: 403 });
    }
    await db.driver.update({ where: { id: driverId }, data: { status, lastPingAt: new Date() } });
    return NextResponse.json({ ok: true, status });
  }

  if (action === "withdraw") {
    if (!driverId) return NextResponse.json({ error: "No driver profile on this account." }, { status: 403 });
    const amt = clampInt(body.amount, 0, 200_000, 0);
    if (amt < 100) return NextResponse.json({ error: "Minimum withdrawal is KES 100." }, { status: 400 });
    const driver = await db.driver.findUnique({ where: { id: driverId } });
    if (!driver) return NextResponse.json({ error: "Session expired. Please sign in again." }, { status: 401 });
    // payout destination: explicitly saved via payout-setup, else the driver's
    // own M-Pesa number (auto-default in executePayout)
    const payouts = await db.payout.findMany({ where: { driverId, status: { in: ["PENDING", "PROCESSING"] } } });
    if (payouts.length) return NextResponse.json({ error: "A withdrawal is already processing." }, { status: 409 });
    // wallet = completed earnings this month − already-paid withdrawals (same as /api/driver)
    const DAY = 86400_000;
    const monthStart = new Date(Date.now() - 30 * DAY);
    const [completed, paid] = await Promise.all([
      db.shipment.findMany({ where: { driverId, status: "COMPLETED" }, select: { driverEarnings: true, stateEnteredAt: true } }),
      db.payout.findMany({ where: { driverId, status: "PAID" }, select: { amount: true } }),
    ]);
    const wallet = Math.max(0, completed.filter((c) => new Date(c.stateEnteredAt) >= monthStart).reduce((a, c) => a + c.driverEarnings, 0) - paid.reduce((a, p) => a + p.amount, 0));
    if (amt > wallet) {
      return NextResponse.json({ error: `That's more than your KES ${wallet.toLocaleString()} wallet balance.` }, { status: 400 });
    }
    // marketplace: real Paystack transfer in live mode, instant in sandbox
    const res = await createWithdrawalPayout(driverId, amt);
    if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.code ?? 502 });
    const p = await db.payout.findFirst({ where: { driverId, initiatedBy: "DRIVER" }, orderBy: { createdAt: "desc" } });
    return NextResponse.json({
      ok: true, payout: p,
      note: res.status === "PAID" ? "Sent — check your M-PESA." : "Sent to your " + (driver.payoutType === "kepss" ? "bank" : "M-PESA") + ". It arrives within minutes.",
    });
  }

  // ── payout destination (once per driver): M-Pesa wallet or bank account →
  // Paystack transfer recipient (blueprint §c.2). Drivers enter this once;
  // every later payout (POD share + withdrawals) reuses the recipient code. ──
  if (action === "payout-setup") {
    if (!driverId) return NextResponse.json({ error: "No driver profile on this account." }, { status: 403 });
    const type = body.type === "kepss" ? "kepss" : "mobile_money";
    const accountNumber = String(body.accountNumber ?? "").trim();
    const bankCode = String(body.bankCode ?? "").trim();
    if (!accountNumber || !bankCode) {
      return NextResponse.json({ error: "Choose a destination and enter the account details." }, { status: 400 });
    }
    const res = await setupDriverPayout(driverId, { type, accountNumber, bankCode });
    if (!res.ok) return NextResponse.json({ error: res.error }, { status: 400 });
    const d = await db.driver.findUnique({ where: { id: driverId }, select: { payoutType: true, payoutAccountNumber: true, payoutBankName: true, payoutRecipientCode: true, payoutSetupAt: true } });
    return NextResponse.json({ ok: true, payout: d, note: `Saved — payouts go to your ${d?.payoutBankName ?? (type === "kepss" ? "bank" : "M-PESA")}.` });
  }

  // ── v1 goodness: publish an empty leg on the return-load marketplace ──
  if (action === "publish-return-load") {
    if (!driverId) return NextResponse.json({ error: "No driver profile on this account." }, { status: 403 });
    const { from, to, categoryKey, cargoNote, maxWeightKg, priceKes, availableUntil } = body;
    const fromC = validCoord(from?.lat, from?.lng);
    const toC = validCoord(to?.lat, to?.lng);
    if (!from?.name || !to?.name || !fromC || !toC) {
      return NextResponse.json({ error: "Pickup and destination for the return leg are required." }, { status: 400 });
    }
    const [driver, zone] = await Promise.all([
      db.driver.findUnique({ where: { id: driverId }, include: { vehicles: { include: { category: true } } } }),
      db.pricingZone.findFirst({ where: { key: "nairobi" } }),
    ]);
    // 401: session-bound driver missing = stale session (sandbox instance churn)
    if (!driver) return NextResponse.json({ error: "Session expired. Please sign in again." }, { status: 401 });
    // the leg must match a vehicle the driver actually owns (accept key or name)
    const vehicle = driver.vehicles.find((v) => v.category?.key === categoryKey || v.category?.name === categoryKey) ?? driver.vehicles.find((v) => v.active) ?? null;
    const category = vehicle?.category ?? null;
    if (!category || !zone) return NextResponse.json({ error: "Add a vehicle before publishing capacity." }, { status: 400 });

    const weight = clampInt(maxWeightKg, 1, category?.capacityKg ?? 20000, category?.capacityKg ?? 1000);
    const price = clampInt(priceKes, 0, 500_000, 0);
    if (price < 500) return NextResponse.json({ error: "Return price must be at least KES 500." }, { status: 400 });

    // honest comparison fare: what a normal booking of this leg would cost
    const distanceKm = Math.round(routeDistanceKm(fromC, toC) * 10) / 10;
    const normal = priceFor(category, zone, {
      distanceKm, durationMin: routeDurationMin(distanceKm), helpers: 0, extraStops: 0,
    });
    const until = availableUntil ? new Date(availableUntil) : new Date(Date.now() + 6 * 3600_000);
    const row = await db.returnLoad.create({
      data: {
        driverId,
        fromName: capStr(from.name, 80), fromArea: capStr(from.area ?? "", 60), fromLat: fromC.lat, fromLng: fromC.lng,
        toName: capStr(to.name, 80), toArea: capStr(to.area ?? "", 60), toLat: toC.lat, toLng: toC.lng,
        categoryKey: category.key, cargoNote: capStr(cargoNote ?? "General cargo", 60),
        maxWeightKg: weight, priceKes: price, normalPriceKes: Math.max(price, normal.total),
        availableUntil: isNaN(until.getTime()) ? null : until,
      },
    });
    return NextResponse.json({ ok: true, returnLoad: row });
  }

  if (action === "return-load-cancel") {
    if (!driverId) return NextResponse.json({ error: "No driver profile on this account." }, { status: 403 });
    const { id } = body;
    if (!id) return NextResponse.json({ error: "Missing load reference." }, { status: 400 });
    const cancelled = await db.returnLoad.updateMany({
      where: { id, driverId, status: "AVAILABLE" },
      data: { status: "CANCELLED" },
    });
    if (!cancelled.count) return NextResponse.json({ error: "That leg can no longer be cancelled (it may be booked)." }, { status: 409 });
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
