// POST /api/driver — driver actions: status | withdraw
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { mpesaRef } from "@/lib/format";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
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

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
