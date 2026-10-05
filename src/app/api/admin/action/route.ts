// POST /api/admin — audited admin mutations: pricing | driver-verify | driver-suspend |
// dispute-resolve | assign-driver | payout-pay | promo-create | promo-toggle | setting-update
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { applyTransition } from "@/lib/shipments";
import { mpesaRef } from "@/lib/format";
import { ensureDB } from "@/lib/db-ready";

export const dynamic = "force-dynamic";

async function audit(actor: string, action: string, target: string, detail?: string) {
  await db.auditLog.create({ data: { actor, action, target, detail } });
}

export async function POST(req: Request) {
  await ensureDB();
  const body = await req.json().catch(() => ({}));
  const action = String(body.action ?? "");
  const actor = String(body.actor ?? "admin@mizigo.demo");

  if (action === "pricing-zone") {
    const { id, ...fields } = body;
    const allowed = ["basePrice", "pricePerKm", "pricePerMin", "minimumPrice", "waitingRateMin", "loadingFee", "extraStopFee", "peakMultiplier", "nightMultiplier", "scheduledDiscount", "platformFee", "commissionRate"];
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

  // ── manual dispatch: admin assigns a specific driver (final brief §19) ──
  if (action === "assign-driver") {
    const { shipmentId, driverId } = body;
    const s = await db.shipment.findUnique({ where: { id: String(shipmentId ?? "") }, include: { category: true } });
    if (!s) return NextResponse.json({ error: "Shipment not found" }, { status: 404 });
    if (!["MATCHING", "NO_DRIVERS"].includes(s.status)) {
      return NextResponse.json({ error: `Cannot assign while ${s.status}` }, { status: 409 });
    }
    const d = await db.driver.findUnique({ where: { id: String(driverId ?? "") }, include: { user: true, vehicles: { include: { category: true } } } });
    if (!d) return NextResponse.json({ error: "Driver not found" }, { status: 404 });
    const veh = d.vehicles.find((v) => v.categoryId === s.categoryId) ?? d.vehicles[0];
    if (s.status === "NO_DRIVERS") {
      // reopen the matching state first so the assign transition is legal
      await db.shipment.update({ where: { id: s.id }, data: { status: "MATCHING", stateEnteredAt: new Date() } });
    }
    await db.shipment.update({ where: { id: s.id }, data: { driverId: d.id, vehicleId: veh?.id ?? null } });
    const t = await applyTransition(s.id, "assign", "SYSTEM", {
      label: `Manually dispatched · ${d.user?.name ?? "Driver"} · ${veh ? `${veh.make} ${veh.model} ${veh.registration}` : ""}`,
      lat: d.lat, lng: d.lng,
    });
    if (!t.ok) return NextResponse.json({ error: t.error }, { status: t.code });
    await audit(actor, "MANUAL_DISPATCH", `shipment:${s.code}`, `driver:${d.id}`);
    return NextResponse.json({ ok: true });
  }

  // ── payouts ──
  if (action === "payout-pay") {
    const { payoutId } = body;
    const p = await db.payout.update({ where: { id: String(payoutId ?? "") }, data: { status: "PAID", ref: mpesaRef() } });
    await audit(actor, "PAYOUT_PAID", `payout:${p.id}`, `KES ${p.amount}`);
    return NextResponse.json({ ok: true, payout: p, note: "MOCK B2C: marked paid in sandbox" });
  }

  // ── promotions (plan §75) ──
  if (action === "promo-create") {
    const code = String(body.code ?? "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (code.length < 3) return NextResponse.json({ error: "Code needs at least 3 letters" }, { status: 400 });
    const kind = body.kind === "PERCENT" ? "PERCENT" : "FLAT";
    const value = Math.round(Number(body.value) || 0);
    if (value <= 0 || (kind === "PERCENT" && value > 90)) return NextResponse.json({ error: "Invalid discount value" }, { status: 400 });
    const exists = await db.promoCode.findUnique({ where: { code } });
    if (exists) return NextResponse.json({ error: "That code already exists" }, { status: 409 });
    const promo = await db.promoCode.create({
      data: {
        code, kind, value,
        minFare: Math.round(Number(body.minFare) || 0),
        firstBookingOnly: !!body.firstBookingOnly,
        businessOnly: !!body.businessOnly,
        expiresAt: body.expiresAt ? new Date(body.expiresAt) : null,
      },
    });
    await audit(actor, "PROMO_CREATED", `promo:${promo.code}`, JSON.stringify({ kind, value }));
    return NextResponse.json({ ok: true, promo });
  }

  if (action === "promo-toggle") {
    const { promoId } = body;
    const existing = await db.promoCode.findUnique({ where: { id: String(promoId ?? "") } });
    if (!existing) return NextResponse.json({ error: "Promo not found" }, { status: 404 });
    const p = await db.promoCode.update({ where: { id: existing.id }, data: { active: !existing.active } });
    await audit(actor, existing.active ? "PROMO_DISABLED" : "PROMO_ENABLED", `promo:${p.code}`);
    return NextResponse.json({ ok: true, promo: p });
  }

  // ── platform settings (plan §34 advance window, auto-dispatch, support line) ──
  if (action === "setting-update") {
    const key = String(body.key ?? "");
    const value = String(body.value ?? "");
    const ALLOWED = ["advanceBookingDays", "autoDispatch", "quoteExpiryMinutes", "supportPhone"];
    if (!ALLOWED.includes(key)) return NextResponse.json({ error: "Unknown setting" }, { status: 400 });
    if (["advanceBookingDays", "quoteExpiryMinutes"].includes(key) && (Number.isNaN(Number(value)) || Number(value) < 0)) {
      return NextResponse.json({ error: "Value must be a positive number" }, { status: 400 });
    }
    if (key === "autoDispatch" && !["true", "false"].includes(value)) {
      return NextResponse.json({ error: "autoDispatch must be true/false" }, { status: 400 });
    }
    const setting = await db.platformSetting.upsert({ where: { key }, update: { value }, create: { key, value } });
    await audit(actor, "SETTING_UPDATED", `setting:${key}`, value);
    return NextResponse.json({ ok: true, setting });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
