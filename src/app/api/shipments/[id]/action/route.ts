// POST /api/shipments/[id]/action — unified, server-validated actions.
// Actions: pay | pay-confirm | pay-timeout | request | cancel | driver-accept |
// arrive | start-loading | loaded | start-trip | arriving | deliver | pod | complete | rate | dispute | report-mismatch
// All money + state decisions are made here; the client never writes state.
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { applyTransition, getShipmentFull, shipmentDTO } from "@/lib/shipments";
import { matchDriver } from "@/lib/matching";
import { mpesaRef } from "@/lib/format";

export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const action = String(body.action ?? "");
  const actor = body.actor ?? "CUSTOMER"; // demo surfaces declare their role; production uses session

  const s = await getShipmentFull({ id });
  if (!s) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // ── M-Pesa STK push (mock Daraja lifecycle) ──
  if (action === "pay") {
    if (s.paymentStatus === "CONFIRMED") return NextResponse.json({ ok: true, alreadyPaid: true, shipment: shipmentDTO(s) });
    const checkoutReqId = `ws_CO_${s.code}_${Date.now()}`;
    await db.paymentEvent.deleteMany({ where: { shipmentId: s.id, status: "PENDING" } });
    await db.paymentEvent.create({ data: { shipmentId: s.id, checkoutReqId, method: s.paymentMethod, amount: s.fareTotal, status: "PENDING" } });
    await db.shipment.update({ where: { id: s.id }, data: { paymentStatus: "PENDING", checkoutReqId, status: "PAYMENT_PENDING", stateEnteredAt: new Date() } });
    return NextResponse.json({ ok: true, checkoutReqId, status: "PENDING", prompt: "Check your phone to complete payment." });
  }

  if (action === "pay-confirm") {
    // idempotent: only the latest PENDING payment can be confirmed
    const pending = await db.paymentEvent.findFirst({ where: { shipmentId: s.id, status: "PENDING" }, orderBy: { createdAt: "desc" } });
    if (!pending) {
      if (s.paymentStatus === "CONFIRMED") return NextResponse.json({ ok: true, alreadyPaid: true, shipment: shipmentDTO(await getShipmentFull({ id })!) });
      return NextResponse.json({ error: "No pending payment. Start again." }, { status: 409 });
    }
    const receipt = mpesaRef();
    await db.paymentEvent.update({ where: { id: pending.id }, data: { status: "CONFIRMED", mpesaReceipt: receipt } });
    await db.shipment.update({ where: { id: s.id }, data: { paymentStatus: "CONFIRMED", paymentRef: receipt, paidAt: new Date() } });
    const t = await applyTransition(id, "payment-confirmed", "SYSTEM", { label: `Payment confirmed · M-PESA ${receipt}` });
    if (!t.ok) return NextResponse.json({ error: t.error }, { status: t.code });
    return NextResponse.json({ ok: true, receipt, shipment: shipmentDTO(await getShipmentFull({ id })!) });
  }

  if (action === "pay-timeout") {
    await db.paymentEvent.updateMany({ where: { shipmentId: s.id, status: "PENDING" }, data: { status: "TIMEOUT" } });
    await db.shipment.update({ where: { id: s.id }, data: { paymentStatus: "TIMED_OUT" } });
    return NextResponse.json({ ok: true, status: "TIMED_OUT" });
  }

  // ── request vehicle → matching engine ──
  if (action === "request") {
    if (s.paymentStatus !== "CONFIRMED") {
      return NextResponse.json({ error: "Complete payment before requesting a vehicle." }, { status: 409 });
    }
    const t = await applyTransition(id, "request", actor === "ADMIN" ? "ADMIN" : "CUSTOMER");
    if (!t.ok) return NextResponse.json({ error: t.error }, { status: t.code });

    const driversRaw = await db.driver.findMany({ include: { user: true, vehicles: { include: { category: true } } } });
    const weightKg = s.items.reduce((acc, i) => acc + i.weightKg * i.qty, 0) || 300;
    const match = matchDriver(
      driversRaw.map((d) => ({ ...d, user: d.user ? { name: d.user.name } : null })),
      { lat: s.pickupLat, lng: s.pickupLng },
      { categoryKey: s.category.key, weightKg: Math.max(weightKg, 120) }
    );

    if (!match) {
      const fail = await applyTransition(id, "matching-failed", "SYSTEM");
      if (!fail.ok) return NextResponse.json({ error: fail.error }, { status: fail.code });
      return NextResponse.json({ ok: true, matched: false, reason: "NO_DRIVERS", shipment: shipmentDTO(await getShipmentFull({ id })!) });
    }

    // assign + capture driver origin in the event geo (used by the movement sim)
    await db.shipment.update({ where: { id: s.id }, data: { driverId: match.driverId, vehicleId: match.vehicleId } });
    const assign = await applyTransition(id, "assign", "SYSTEM", {
      label: `Driver matched · ${match.name} · ${match.vehicleName} ${match.registration}`,
      lat: driversRaw.find((d) => d.id === match.driverId)!.lat,
      lng: driversRaw.find((d) => d.id === match.driverId)!.lng,
    });
    if (!assign.ok) return NextResponse.json({ error: assign.error }, { status: assign.code });

    return NextResponse.json({
      ok: true, matched: true,
      match: { name: match.name, etaMin: match.etaMin, rating: match.rating, trips: match.trips, vehicle: match.vehicleName, registration: match.registration },
      shipment: shipmentDTO(await getShipmentFull({ id })!),
    });
  }

  // ── driver accepts the offer ──
  if (action === "driver-accept") {
    const t = await applyTransition(id, "driver-accept", "DRIVER");
    if (!t.ok) return NextResponse.json({ error: t.error }, { status: t.code });
    return NextResponse.json({ ok: true, shipment: shipmentDTO(await getShipmentFull({ id })!) });
  }
  if (action === "decline") {
    // driver declines: shipment returns to matching (simplified: assign next)
    const match = await reassign(s.id, s.category.key);
    if (!match) {
      const fail = await applyTransition(id, "matching-failed", "SYSTEM");
      if (!fail.ok) return NextResponse.json({ error: fail.error }, { status: fail.code });
      return NextResponse.json({ ok: true, matched: false, shipment: shipmentDTO(await getShipmentFull({ id })!) });
    }
    return NextResponse.json({ ok: true, matched: true, match, shipment: shipmentDTO(await getShipmentFull({ id })!) });
  }

  // ── generic guarded transitions ──
  const map: Record<string, { action: string; role: "CUSTOMER" | "DRIVER" | "ADMIN"; label?: string }> = {
    arrive: { action: "arrive", role: "DRIVER" },
    "start-loading": { action: "start-loading", role: "DRIVER" },
    loaded: { action: "loaded", role: "DRIVER" },
    "start-trip": { action: "start-trip", role: "DRIVER" },
    arriving: { action: "arriving", role: "DRIVER" },
    deliver: { action: "deliver", role: "DRIVER" },
    pod: { action: "pod", role: "DRIVER" },
    complete: { action: "complete", role: "DRIVER" },
    cancel: { action: "cancel", role: actor },
  };
  const m = map[action];
  if (m) {
    const meta: { label?: string; reason?: string; cancelledBy?: string; lat?: number; lng?: number } = {};
    if (body.reason) meta.reason = String(body.reason);
    if (action === "cancel") meta.cancelledBy = actor as string;
    if (action === "pod" && body.recipient) {
      meta.label = `Proof of delivery · ${body.recipient} · OTP ${body.otp ? "verified" : "captured"}`;
    }
    if (body.photo) meta.label = body.label;
    const t = await applyTransition(id, m.action, m.role, meta);
    if (!t.ok) return NextResponse.json({ error: t.error }, { status: t.code });
    // POD data
    if (action === "pod") {
      await db.shipment.update({
        where: { id },
        data: { podRecipient: String(body.recipient ?? "Recipient"), podOtp: body.otp ? String(body.otp) : null, podPhotoTaken: !!body.photo, podVerifiedAt: new Date(), podLat: s.dropoffLat, podLng: s.dropoffLng },
      });
    }
    return NextResponse.json({ ok: true, shipment: shipmentDTO(await getShipmentFull({ id })!) });
  }

  // ── rating (two-way) ──
  if (action === "rate") {
    const stars = Math.max(1, Math.min(5, Number(body.stars) || 5));
    await db.rating.create({ data: { shipmentId: id, byRole: actor === "DRIVER" ? "DRIVER" : "CUSTOMER", stars, tags: JSON.stringify(body.tags ?? []), comment: body.comment ?? null } });
    if (actor !== "DRIVER" && s.driverId) {
      // update driver rating as rolling average
      const d = await db.driver.findUnique({ where: { id: s.driverId } });
      if (d) {
        const total = d.tripsCompleted || 1;
        const newRating = Math.round(((d.rating * total + stars) / (total + 1)) * 100) / 100;
        await db.driver.update({ where: { id: d.id }, data: { rating: newRating } });
      }
    }
    if (s.status === "POD_CONFIRMED" || s.status === "DELIVERED") {
      await applyTransition(id, "complete", "SYSTEM");
    }
    return NextResponse.json({ ok: true, shipment: shipmentDTO(await getShipmentFull({ id })!) });
  }

  // ── dispute ──
  if (action === "dispute") {
    await db.dispute.create({ data: { shipmentId: id, type: String(body.type ?? "OTHER"), notes: String(body.notes ?? "") } });
    if (s.status !== "COMPLETED") await applyTransition(id, "cancel", "SYSTEM", { reason: "Dispute opened" }).catch(() => null);
    return NextResponse.json({ ok: true });
  }

  // ── driver reports cargo mismatch at pickup ──
  if (action === "report-mismatch") {
    await db.shipmentEvent.create({
      data: { shipmentId: id, type: "MISMATCH_REPORTED", label: `Driver reported: ${body.reason ?? "cargo differs from booking"}`, actor: "DRIVER", lat: s.pickupLat, lng: s.pickupLng },
    });
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: `Unknown action ${action}` }, { status: 400 });
}

async function reassign(shipmentId: string, categoryKey: string) {
  const s = await getShipmentFull({ id: shipmentId });
  if (!s || !s.driverId) return null;
  const driversRaw = await db.driver.findMany({ include: { user: true, vehicles: { include: { category: true } } } });
  const excluded = s.driverId;
  const match = matchDriver(
    driversRaw.filter((d) => d.id !== excluded).map((d) => ({ ...d, user: d.user ? { name: d.user.name } : null })),
    { lat: s.pickupLat, lng: s.pickupLng },
    { categoryKey, weightKg: 300 }
  );
  if (!match) return null;
  await db.shipment.update({ where: { id: shipmentId }, data: { driverId: match.driverId, vehicleId: match.vehicleId, status: "MATCHING", stateEnteredAt: new Date() } });
  await applyTransition(shipmentId, "assign", "SYSTEM", {
    label: `Driver matched · ${match.name} · ${match.vehicleName} ${match.registration}`,
    lat: driversRaw.find((d) => d.id === match.driverId)!.lat,
    lng: driversRaw.find((d) => d.id === match.driverId)!.lng,
  });
  return { name: match.name, etaMin: match.etaMin, rating: match.rating, vehicle: match.vehicleName, registration: match.registration };
}
