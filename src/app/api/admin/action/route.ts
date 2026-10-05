// POST /api/admin — audited admin mutations: pricing | driver-verify | driver-suspend | dispute-resolve
import { NextResponse } from "next/server";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

async function audit(actor: string, action: string, target: string, detail?: string) {
  await db.auditLog.create({ data: { actor, action, target, detail } });
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const action = String(body.action ?? "");
  const actor = String(body.actor ?? "admin@mizigo.demo");

  if (action === "pricing-zone") {
    const { id, ...fields } = body;
    const allowed = ["basePrice", "pricePerKm", "pricePerMin", "minimumPrice", "waitingRateMin", "loadingFee", "extraStopFee", "peakMultiplier", "platformFee", "commissionRate"];
    const data: Record<string, number> = {};
    for (const k of allowed) if (fields[k] !== undefined && !isNaN(Number(fields[k]))) data[k] = Number(fields[k]);
    const z = await db.pricingZone.update({ where: { id }, data });
    await audit(actor, "PRICING_ZONE_UPDATED", `zone:${z.key}`, JSON.stringify(data));
    return NextResponse.json({ ok: true, zone: z });
  }

  if (action === "pricing-category") {
    const { id, ...fields } = body;
    const allowed = ["baseFare", "perKmRate", "perMinRate", "minimumFare", "loadingFee", "extraStopFee", "capacityKg"];
    const data: Record<string, number> = {};
    for (const k of allowed) if (fields[k] !== undefined && !isNaN(Number(fields[k]))) data[k] = Math.round(Number(fields[k]));
    const c = await db.vehicleCategory.update({ where: { id }, data });
    await audit(actor, "PRICING_CATEGORY_UPDATED", `category:${c.key}`, JSON.stringify(data));
    return NextResponse.json({ ok: true, category: c });
  }

  if (action === "driver-verify" || action === "driver-suspend") {
    const { driverId } = body;
    const verification = action === "driver-verify" ? "VERIFIED" : "SUSPENDED";
    const d = await db.driver.update({ where: { id: driverId }, data: { verification, status: action === "driver-suspend" ? "OFFLINE" : undefined } });
    await audit(actor, action === "driver-verify" ? "DRIVER_APPROVED" : "DRIVER_SUSPENDED", `driver:${d.id}`);
    return NextResponse.json({ ok: true });
  }

  if (action === "dispute-resolve") {
    const { disputeId, resolution } = body;
    const d = await db.dispute.update({ where: { id: disputeId }, data: { status: "RESOLVED", resolution: String(resolution ?? "") } });
    await audit(actor, "DISPUTE_RESOLVED", `dispute:${d.id}`, d.resolution ?? undefined);
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
