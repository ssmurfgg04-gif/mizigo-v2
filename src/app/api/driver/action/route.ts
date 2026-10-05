// POST /api/driver — driver actions: status | withdraw | publish-return-load | return-load-cancel
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { mpesaRef } from "@/lib/format";
import { priceFor } from "@/lib/pricing";
import { routeDistanceKm, routeDurationMin } from "@/lib/geo";
import { ensureDB } from "@/lib/db-ready";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  await ensureDB();
  const body = await req.json().catch(() => ({}));
  const action = String(body.action ?? "");

  if (action === "status") {
    const { driverId, status } = body;
    if (!driverId || !["ONLINE", "OFFLINE", "BREAK"].includes(status)) {
      return NextResponse.json({ error: "Invalid status" }, { status: 400 });
    }
    const d = await db.driver.findUnique({ where: { id: driverId } });
    if (!d) return NextResponse.json({ error: "Driver not found" }, { status: 404 });
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
    const { driverId, amount } = body;
    const amt = Math.floor(Number(amount) || 0);
    if (!driverId || amt < 100) return NextResponse.json({ error: "Minimum withdrawal is KES 100." }, { status: 400 });
    const payouts = await db.payout.findMany({ where: { driverId, status: { in: ["PENDING", "PROCESSING"] } } });
    if (payouts.length) return NextResponse.json({ error: "A withdrawal is already processing." }, { status: 409 });
    const p = await db.payout.create({ data: { driverId, amount: amt, method: "MPESA", status: "PROCESSING", ref: mpesaRef() } });
    // mock B2C disbursement: completes immediately in sandbox
    await db.payout.update({ where: { id: p.id }, data: { status: "PAID" } });
    return NextResponse.json({ ok: true, payout: p, note: "MOCK B2C: paid instantly in sandbox" });
  }

  // ── v1 goodness: publish an empty leg on the return-load marketplace ──
  if (action === "publish-return-load") {
    const { driverId, from, to, categoryKey, cargoNote, maxWeightKg, priceKes, availableUntil } = body;
    if (!driverId || !from?.name || !to?.name) {
      return NextResponse.json({ error: "Pickup and destination for the return leg are required." }, { status: 400 });
    }
    const [driver, zone] = await Promise.all([
      db.driver.findUnique({ where: { id: driverId }, include: { vehicles: { include: { category: true } } } }),
      db.pricingZone.findFirst({ where: { key: "nairobi" } }),
    ]);
    if (!driver) return NextResponse.json({ error: "Driver not found" }, { status: 404 });
    // the leg must match a vehicle the driver actually owns (accept key or name)
    const vehicle = driver.vehicles.find((v) => v.category?.key === categoryKey || v.category?.name === categoryKey) ?? driver.vehicles.find((v) => v.active) ?? null;
    const category = vehicle?.category ?? null;
    if (!category || !zone) return NextResponse.json({ error: "Add a vehicle before publishing capacity." }, { status: 400 });

    const weight = Math.max(1, Math.floor(Number(maxWeightKg) || category.capacityKg));
    const price = Math.floor(Number(priceKes) || 0);
    if (price < 500) return NextResponse.json({ error: "Return price must be at least KES 500." }, { status: 400 });

    // honest comparison fare: what a normal booking of this leg would cost
    const distanceKm = Math.round(routeDistanceKm(
      { lat: Number(from.lat), lng: Number(from.lng) },
      { lat: Number(to.lat), lng: Number(to.lng) }
    ) * 10) / 10;
    const normal = priceFor(category, zone, {
      distanceKm, durationMin: routeDurationMin(distanceKm), helpers: 0, extraStops: 0,
    });
    const until = availableUntil ? new Date(availableUntil) : new Date(Date.now() + 6 * 3600_000);
    const row = await db.returnLoad.create({
      data: {
        driverId,
        fromName: String(from.name), fromArea: String(from.area ?? ""), fromLat: Number(from.lat), fromLng: Number(from.lng),
        toName: String(to.name), toArea: String(to.area ?? ""), toLat: Number(to.lat), toLng: Number(to.lng),
        categoryKey: category.key, cargoNote: String(cargoNote ?? "General cargo").slice(0, 60),
        maxWeightKg: weight, priceKes: price, normalPriceKes: Math.max(price, normal.total),
        availableUntil: isNaN(until.getTime()) ? null : until,
      },
    });
    return NextResponse.json({ ok: true, returnLoad: row });
  }

  if (action === "return-load-cancel") {
    const { id, driverId } = body;
    if (!id || !driverId) return NextResponse.json({ error: "Missing load reference." }, { status: 400 });
    const cancelled = await db.returnLoad.updateMany({
      where: { id, driverId, status: "AVAILABLE" },
      data: { status: "CANCELLED" },
    });
    if (!cancelled.count) return NextResponse.json({ error: "That leg can no longer be cancelled (it may be booked)." }, { status: 409 });
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
