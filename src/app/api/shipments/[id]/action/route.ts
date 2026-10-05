// POST /api/shipments/[id]/action — unified, server-validated actions.
// Actions: pay | pay-confirm | pay-timeout | request | cancel | driver-accept |
// arrive | start-loading | loaded | start-trip | arriving | deliver | pod | complete | rate | dispute |
// report-mismatch | chat | request-quotes | driver-quote | accept-quote | stop-done | share-link
// All money + state decisions are made here; the client never writes state.
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { applyTransition, getShipmentFull, shipmentDTO } from "@/lib/shipments";
import { newShareTokenHashed } from "@/lib/tokens";
import { matchDriver } from "@/lib/matching";
import { mpesaRef } from "@/lib/format";
import { ensureDB } from "@/lib/db-ready";

export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  await ensureDB();
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
      if (s.paymentStatus === "CONFIRMED") return NextResponse.json({ ok: true, alreadyPaid: true, shipment: shipmentDTO((await getShipmentFull({ id }))!) });
      return NextResponse.json({ error: "No pending payment. Start again." }, { status: 409 });
    }
    const receipt = mpesaRef();
    await db.paymentEvent.update({ where: { id: pending.id }, data: { status: "CONFIRMED", mpesaReceipt: receipt } });
    await db.shipment.update({ where: { id: s.id }, data: { paymentStatus: "CONFIRMED", paymentRef: receipt, paidAt: new Date() } });
    const t = await applyTransition(id, "payment-confirmed", "SYSTEM", { label: `Payment confirmed · M-PESA ${receipt}` });
    if (!t.ok) return NextResponse.json({ error: t.error }, { status: t.code });
    return NextResponse.json({ ok: true, receipt, shipment: shipmentDTO((await getShipmentFull({ id }))!) });
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

    // quote-mode: the accepted quote already reserved the driver (plan §33)
    if (s.driverId) {
      const reserved = await db.driver.findUnique({ where: { id: s.driverId }, include: { user: true, vehicles: true } });
      if (reserved) {
        const veh = reserved.vehicles.find((v) => v.categoryId === s.categoryId) ?? reserved.vehicles[0];
        if (veh) await db.shipment.update({ where: { id: s.id }, data: { vehicleId: veh.id } });
        const assign = await applyTransition(id, "assign", "SYSTEM", {
          label: `Driver matched · ${reserved.user?.name ?? "Driver"} · ${veh ? `${veh.make} ${veh.model} ${veh.registration}` : ""}`,
          lat: reserved.lat, lng: reserved.lng,
        });
        if (!assign.ok) return NextResponse.json({ error: assign.error }, { status: assign.code });
        return NextResponse.json({
          ok: true, matched: true,
          match: { name: reserved.user?.name ?? "Driver", etaMin: 6, rating: reserved.rating, trips: reserved.tripsCompleted, vehicle: veh ? `${veh.make} ${veh.model}` : "", registration: veh?.registration ?? "" },
          shipment: shipmentDTO((await getShipmentFull({ id }))!),
        });
      }
    }

    // admin can disable auto-dispatch (plan §34/§41 Settings) → stays in MATCHING for manual dispatch
    const autoDispatch = (await db.platformSetting.findUnique({ where: { key: "autoDispatch" } }))?.value !== "false";
    if (!autoDispatch) {
      return NextResponse.json({ ok: true, matched: false, reason: "MANUAL_DISPATCH", shipment: shipmentDTO((await getShipmentFull({ id }))!) });
    }

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
      return NextResponse.json({ ok: true, matched: false, reason: "NO_DRIVERS", shipment: shipmentDTO((await getShipmentFull({ id }))!) });
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
      shipment: shipmentDTO((await getShipmentFull({ id }))!),
    });
  }

  // ── driver accepts the offer ──
  if (action === "driver-accept") {
    const t = await applyTransition(id, "driver-accept", "DRIVER");
    if (!t.ok) return NextResponse.json({ error: t.error }, { status: t.code });
    return NextResponse.json({ ok: true, shipment: shipmentDTO((await getShipmentFull({ id }))!) });
  }
  if (action === "decline") {
    // driver declines: shipment returns to matching (simplified: assign next)
    const match = await reassign(s.id, s.category.key);
    if (!match) {
      const fail = await applyTransition(id, "matching-failed", "SYSTEM");
      if (!fail.ok) return NextResponse.json({ error: fail.error }, { status: fail.code });
      return NextResponse.json({ ok: true, matched: false, shipment: shipmentDTO((await getShipmentFull({ id }))!) });
    }
    return NextResponse.json({ ok: true, matched: true, match, shipment: shipmentDTO((await getShipmentFull({ id }))!) });
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
    return NextResponse.json({ ok: true, shipment: shipmentDTO((await getShipmentFull({ id }))!) });
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
    if (actor === "DRIVER") {
      // v1 goodness: two-sided reputation — the customer's rating rolls too
      const c = await db.user.findUnique({ where: { id: s.customerId } });
      if (c) {
        const total = await db.shipment.count({ where: { customerId: s.customerId, status: "COMPLETED" } });
        const newRating = Math.round(((c.rating * Math.max(total - 1, 0) + stars) / Math.max(total, 1)) * 100) / 100;
        await db.user.update({ where: { id: c.id }, data: { rating: Math.max(1, Math.min(5, newRating)) } });
      }
    }
    if (s.status === "POD_CONFIRMED" || s.status === "DELIVERED") {
      await applyTransition(id, "complete", "SYSTEM");
    }
    return NextResponse.json({ ok: true, shipment: shipmentDTO((await getShipmentFull({ id }))!) });
  }

  // ── dispute ──
  if (action === "dispute") {
    await db.dispute.create({ data: { shipmentId: id, type: String(body.type ?? "OTHER"), notes: String(body.notes ?? "") } });
    if (["DELIVERED", "POD_CONFIRMED", "COMPLETED", "CANCELLED"].includes(s.status)) {
      await applyTransition(id, "dispute-open", actor === "DRIVER" ? "SYSTEM" : "CUSTOMER", { reason: String(body.type ?? "Dispute") }).catch(() => null);
    } else if (s.status !== "COMPLETED") {
      await applyTransition(id, "cancel", "SYSTEM", { reason: "Dispute opened" }).catch(() => null);
    }
    return NextResponse.json({ ok: true });
  }

  // ── mint a fresh recipient tracking link (v1 lesson: raw tokens never stored) ──
  if (action === "share-link") {
    // 24 random bytes, base64url — a real capability; only its sha256 is persisted
    const { raw, hash } = await newShareTokenHashed();
    await db.shipment.update({ where: { id }, data: { shareToken: hash } });
    return NextResponse.json({ ok: true, token: raw, url: `/?view=track&token=${raw}` });
  }

  // ── customer ↔ driver chat (plan §77: quick messages first, numbers masked) ──
  if (action === "chat") {
    const text = String(body.body ?? "").trim().slice(0, 280);
    if (!text) return NextResponse.json({ error: "Message required" }, { status: 400 });
    const role = actor === "DRIVER" ? "DRIVER" : "CUSTOMER";
    await db.chatMessage.create({ data: { shipmentId: id, senderRole: role, body: text } });
    // notify the other party
    if (role === "CUSTOMER" && s.driverId) {
      const d = await db.driver.findUnique({ where: { id: s.driverId } });
      if (d) await db.notification.create({ data: { userId: d.userId, role: "DRIVER", title: "New message", body: text.slice(0, 60), shipmentCode: s.code } });
    } else if (role === "DRIVER") {
      await db.notification.create({ data: { userId: s.customerId, role: "CUSTOMER", title: `Message from ${s.driver?.user?.name.split(" ")[0] ?? "driver"}`, body: text.slice(0, 60), shipmentCode: s.code } });
    }
    return NextResponse.json({ ok: true, shipment: shipmentDTO((await getShipmentFull({ id }))!) });
  }

  // ── quote marketplace (plan §33/§36) ──
  if (action === "request-quotes") {
    const t = await applyTransition(id, "request-quotes", actor === "ADMIN" ? "ADMIN" : "CUSTOMER", { label: "Driver quotes requested" });
    if (!t.ok) return NextResponse.json({ error: t.error }, { status: t.code });
    await db.shipment.update({ where: { id }, data: { pricingMode: "QUOTE" } });
    return NextResponse.json({ ok: true, shipment: shipmentDTO((await getShipmentFull({ id }))!) });
  }

  if (action === "driver-quote") {
    if (s.status !== "QUOTED") return NextResponse.json({ error: "This job is not open for quotes" }, { status: 409 });
    const driverId = String(body.driverId ?? "");
    if (!driverId) return NextResponse.json({ error: "driverId required" }, { status: 400 });
    const amount = Math.round(Number(body.amount) || 0);
    if (amount < 500) return NextResponse.json({ error: "Quote must be at least KES 500." }, { status: 400 });
    const already = await db.quote.findFirst({ where: { shipmentId: id, driverId, status: "PENDING" } });
    if (already) return NextResponse.json({ error: "You already quoted this job." }, { status: 409 });
    const expiryMin = Number((await db.platformSetting.findUnique({ where: { key: "quoteExpiryMinutes" } }))?.value ?? 60);
    const q = await db.quote.create({ data: { shipmentId: id, driverId, amount, etaText: String(body.etaText ?? "Tomorrow 08:00"), message: body.message ? String(body.message).slice(0, 120) : null, expiresAt: new Date(Date.now() + expiryMin * 60_000) } });
    await db.shipmentEvent.create({ data: { shipmentId: id, type: "QUOTE_RECEIVED", label: `Quote received · KES ${amount.toLocaleString()}`, actor: "DRIVER" } });
    await db.notification.create({ data: { userId: s.customerId, role: "CUSTOMER", title: "Driver submitted a quote", body: `KES ${amount.toLocaleString()} for ${s.code}`, shipmentCode: s.code } });
    return NextResponse.json({ ok: true, quote: q, shipment: shipmentDTO((await getShipmentFull({ id }))!) });
  }

  if (action === "accept-quote") {
    if (s.status !== "QUOTED") return NextResponse.json({ error: "Not in quote collection" }, { status: 409 });
    const quoteId = String(body.quoteId ?? "");
    const q = await db.quote.findUnique({ where: { id: quoteId } });
    if (!q || q.shipmentId !== s.id || q.status !== "PENDING") return NextResponse.json({ error: "Quote unavailable" }, { status: 404 });
    if (q.expiresAt < new Date()) {
      await db.quote.update({ where: { id: q.id }, data: { status: "EXPIRED" } });
      return NextResponse.json({ error: "This quote has expired." }, { status: 410 });
    }
    // fare is locked to the accepted quote; driver earnings follow zone commission
    const zone = await db.pricingZone.findFirst({ where: { key: "nairobi" } });
    const commissionRate = zone?.commissionRate ?? 0.15;
    const commission = Math.round(q.amount * commissionRate);
    await db.$transaction([
      db.quote.update({ where: { id: q.id }, data: { status: "ACCEPTED" } }),
      db.quote.updateMany({ where: { shipmentId: s.id, id: { not: q.id }, status: "PENDING" }, data: { status: "DECLINED" } }),
      db.shipment.update({
        where: { id },
        data: {
          fareBase: q.amount, fareDistance: 0, fareDuration: 0, fareStops: 0,
          fareTotal: q.amount, driverEarnings: q.amount - commission, commission,
          driverId: q.driverId, // reserve the quoting driver
        },
      }),
    ]);
    const t = await applyTransition(id, "accept-quote", actor === "ADMIN" ? "ADMIN" : "CUSTOMER", { label: `Quote accepted · KES ${q.amount.toLocaleString()} · fare locked` });
    if (!t.ok) return NextResponse.json({ error: t.error }, { status: t.code });
    return NextResponse.json({ ok: true, shipment: shipmentDTO((await getShipmentFull({ id }))!) });
  }

  // ── multi-stop: driver marks an intermediate stop complete (plan §35) ──
  if (action === "stop-done") {
    const idx = Number(body.stopIndex ?? -1);
    const stops = JSON.parse(s.stops || "[]") as { name: string; lat?: number; lng?: number }[];
    if (idx < 0 || idx >= stops.length) return NextResponse.json({ error: "Stop not found" }, { status: 404 });
    await db.shipmentEvent.create({ data: { shipmentId: id, type: "STOP_COMPLETED", label: `Stop ${idx + 1} complete · ${stops[idx].name}`, actor: "DRIVER", lat: stops[idx].lat, lng: stops[idx].lng } });
    return NextResponse.json({ ok: true, shipment: shipmentDTO((await getShipmentFull({ id }))!) });
  }

  // ── driver reports cargo mismatch at pickup ──
  if (action === "report-mismatch") {
    await db.shipmentEvent.create({
      data: { shipmentId: id, type: "MISMATCH_REPORTED", label: `Driver reported: ${body.reason ?? "cargo differs from booking"}`, actor: "DRIVER", lat: s.pickupLat, lng: s.pickupLng },
    });
    await db.notification.create({ data: { userId: s.customerId, role: "CUSTOMER", title: "Driver reported an issue", body: String(body.reason ?? "Cargo differs from booking").slice(0, 60), shipmentCode: s.code } });
    return NextResponse.json({ ok: true, shipment: shipmentDTO((await getShipmentFull({ id }))!) });
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
