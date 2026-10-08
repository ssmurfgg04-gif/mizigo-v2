// POST /api/shipments/[id]/action — unified, server-validated actions.
// Actions: pay | pay-confirm | pay-timeout | request | cancel | cancel-quote |
// driver-accept | arrive | start-loading | loaded | start-trip | arriving | deliver |
// pod | complete | rate | dispute | report-mismatch | chat | request-quotes |
// driver-quote | accept-quote | stop-done | share-link | safety-alert |
// safety-checkin | safety-ack
// All money + state decisions are made here; the client never writes state —
// and every action is bound to the session identity (customer / assigned driver / admin).
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { applyTransition, getShipmentFull, shipmentDTO, simulateLive } from "@/lib/shipments";
import { cancellationQuote } from "@/lib/cancellation";
import { newShareTokenHashed } from "@/lib/tokens";
import { matchDriverRing } from "@/lib/matching";
import { ringFetcher } from "@/lib/dispatch";
import { mpesaRef } from "@/lib/format";
import { startCustomerPayment, confirmCustomerPayment, initiatePodPayout, refundShipmentPayment } from "@/lib/payments";
import { GPS_MISMATCH_METERS, gpsMismatchMeters } from "@/lib/geo";
import { ensureDB } from "@/lib/db-ready";
import { requireSession, isResponse, rateLimit, clampInt, capStr } from "@/lib/security";
import { invalidatePrefix } from "@/lib/query-cache";
import { record, logEvent } from "@/lib/telemetry";

export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const t0 = Date.now();
  const { id } = await params;
  let action = "";
  try {
    const bodyPeek = await req.clone().json().catch(() => ({}));
    action = String(bodyPeek.action ?? "");
  } catch {
    action = "";
  }
  try {
    const res = await handle(req, id);
    // any successful action changes what cached lists/summaries show
    if (res.ok) {
      invalidatePrefix("shipments");
      invalidatePrefix("admin");
    }
    record("api:shipment:action", Date.now() - t0, res.ok);
    logEvent({ route: "api:shipment:action", shipmentId: id, action, latencyMs: Date.now() - t0, ok: res.ok, status: res.status });
    return res;
  } catch (err) {
    record("api:shipment:action", Date.now() - t0, false);
    logEvent({ level: "error", route: "api:shipment:action", shipmentId: id, action, ok: false, extra: { message: (err as Error)?.message } });
    throw err;
  }
}

async function handle(req: Request, id: string): Promise<NextResponse> {
  await ensureDB();
  const session = requireSession(req);
  if (isResponse(session)) return session;
  const limited = rateLimit(req, "shipment:action", 120, 60_000);
  if (limited) return limited;
  const body = await req.json().catch(() => ({}));
  const action = String(body.action ?? "");

  const s = await getShipmentFull({ id });
  if (!s) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // ── authorization: the customer, the assigned driver, or an admin ──
  // (QUOTED marketplace jobs are open to any driver — per-action checks below
  // decide what a marketplace visitor may actually do.)
  const isCustomer = session.uid === s.customerId;
  const isDriver = !!session.did && session.did === s.driverId;
  const isAdmin = session.role === "ADMIN";
  const marketplace = s.status === "QUOTED" && !!session.did;
  if (!isCustomer && !isDriver && !isAdmin && !marketplace) {
    return NextResponse.json({ error: "You don't have access to this delivery." }, { status: 403 });
  }
  const asCustomer = (label: string) => {
    if (!isCustomer && !isAdmin) return NextResponse.json({ error: label }, { status: 403 });
    return null;
  };
  const asDriver = (label: string) => {
    if (!isDriver && !isAdmin) return NextResponse.json({ error: label }, { status: 403 });
    return null;
  };

  // ── customer payment — provider-routed (Paystack marketplace → Daraja →
  // sandbox simulation) via lib/payments, the only money-state funnel ──
  if (action === "pay") {
    const deny = asCustomer("Only the customer can pay for this delivery.");
    if (deny) return deny;
    if (s.paymentStatus === "CONFIRMED") return NextResponse.json({ ok: true, alreadyPaid: true, shipment: shipmentDTO(s) });
    // attempt counter drives the Paystack reference (MZG482913A2 on retries)
    const prior = await db.paymentEvent.count({ where: { shipmentId: s.id } });
    const res = await startCustomerPayment(s.id, prior + 1);
    if (!res.ok) return NextResponse.json({ error: res.error }, { status: 502 });
    const { outcome } = res;
    return NextResponse.json({
      ok: true, checkoutReqId: outcome.checkoutReqId, status: "PENDING",
      provider: outcome.provider, mode: outcome.mode,
      ...(outcome.authorizationUrl ? { authorizationUrl: outcome.authorizationUrl } : {}),
      prompt: outcome.prompt,
    });
  }

  // sandbox PIN flow (MOCK/Daraja) AND the server-side verify for Paystack —
  // both funnel into the same atomic-claim confirmation in lib/payments
  if (action === "pay-confirm" || action === "pay-verify") {
    const deny = asCustomer("Only the customer can confirm this payment.");
    if (deny) return deny;
    const res = await confirmCustomerPayment(id, action === "pay-verify" ? "pay-verify" : "pay-confirm");
    if (!res.ok && !res.alreadyPaid) {
      // 202 = the provider is still processing (e.g. a live Daraja STK push the
      // customer hasn't PIN'd yet) — a pollable state, not an error
      if (res.code === 202) return NextResponse.json({ ok: false, pending: true, error: res.error }, { status: 202 });
      return NextResponse.json({ error: res.error }, { status: res.code ?? 400 });
    }
    return NextResponse.json({
      ok: true, ...(res.alreadyPaid ? { alreadyPaid: true } : { receipt: res.receipt }),
      ...(res.shipment ? { shipment: res.shipment } : { shipment: shipmentDTO((await getShipmentFull({ id }))!) }),
    });
  }

  if (action === "pay-timeout") {
    const deny = asCustomer("Only the customer can reset this payment.");
    if (deny) return deny;
    await db.paymentEvent.updateMany({ where: { shipmentId: s.id, status: "PENDING" }, data: { status: "TIMEOUT" } });
    await db.shipment.update({ where: { id: s.id }, data: { paymentStatus: "TIMED_OUT" } });
    return NextResponse.json({ ok: true, status: "TIMED_OUT" });
  }

  // ── request vehicle → matching engine — customer (or admin) ──
  if (action === "request") {
    const deny = asCustomer("Only the customer can request a vehicle.");
    if (deny) return deny;
    if (s.paymentStatus !== "CONFIRMED") {
      return NextResponse.json({ error: "Complete payment before requesting a vehicle." }, { status: 409 });
    }
    const t = await applyTransition(id, "request", isAdmin ? "ADMIN" : "CUSTOMER");
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

    // H3 expanding-ring matching (Uber pattern — drivers indexed by res-8 hex
    // cell; rings k=0..3 around the pickup, full-scan fallback for stale/null
    // cells — docs/research/UBER_BOLT_ARCHITECTURE.md §1)
    const weightKg = s.items.reduce((acc, i) => acc + i.weightKg * i.qty, 0) || 300;
    const { match, ring } = await matchDriverRing({
      ...ringFetcher(),
      pickup: { lat: s.pickupLat, lng: s.pickupLng },
      need: { categoryKey: s.category.key, weightKg: Math.max(weightKg, 120) },
    });
    record("dispatch:match-ring:ring-" + String(ring), 1, true);

    if (!match) {
      const fail = await applyTransition(id, "matching-failed", "SYSTEM");
      if (!fail.ok) return NextResponse.json({ error: fail.error }, { status: fail.code });
      return NextResponse.json({ ok: true, matched: false, reason: "NO_DRIVERS", shipment: shipmentDTO((await getShipmentFull({ id }))!) });
    }

    // assign + capture driver origin in the event geo (used by the movement sim)
    await db.shipment.update({ where: { id: s.id }, data: { driverId: match.driverId, vehicleId: match.vehicleId } });
    const winner = await db.driver.findUnique({ where: { id: match.driverId }, select: { lat: true, lng: true } });
    const assign = await applyTransition(id, "assign", "SYSTEM", {
      label: `Driver matched · ${match.name} · ${match.vehicleName} ${match.registration}`,
      lat: winner?.lat,
      lng: winner?.lng,
    });
    if (!assign.ok) return NextResponse.json({ error: assign.error }, { status: assign.code });

    return NextResponse.json({
      ok: true, matched: true,
      match: { name: match.name, etaMin: match.etaMin, rating: match.rating, trips: match.trips, vehicle: match.vehicleName, registration: match.registration },
      shipment: shipmentDTO((await getShipmentFull({ id }))!),
    });
  }

  // ── driver accepts the offer — assigned driver only ──
  if (action === "driver-accept") {
    const deny = asDriver("Only the assigned driver can accept this job.");
    if (deny) return deny;
    const t = await applyTransition(id, "driver-accept", "DRIVER");
    if (!t.ok) return NextResponse.json({ error: t.error }, { status: t.code });
    return NextResponse.json({ ok: true, shipment: shipmentDTO((await getShipmentFull({ id }))!) });
  }
  if (action === "decline") {
    const deny = asDriver("Only the assigned driver can decline this job.");
    if (deny) return deny;
    // driver declines: shipment returns to matching (simplified: assign next)
    const match = await reassign(s.id, s.category.key);
    if (!match) {
      const fail = await applyTransition(id, "matching-failed", "SYSTEM");
      if (!fail.ok) return NextResponse.json({ error: fail.error }, { status: fail.code });
      return NextResponse.json({ ok: true, matched: false, shipment: shipmentDTO((await getShipmentFull({ id }))!) });
    }
    return NextResponse.json({ ok: true, matched: true, match, shipment: shipmentDTO((await getShipmentFull({ id }))!) });
  }

  // ── settings-backed cancellation economics (Uber pattern: fee quoted before cancel) ──
  async function feeSettings() {
    const [feeRow, graceRow] = await Promise.all([
      db.platformSetting.findUnique({ where: { key: "cancellationFeeKes" } }),
      db.platformSetting.findUnique({ where: { key: "cancelGraceMinutes" } }),
    ]);
    return { feeKes: Number(feeRow?.value ?? 200), graceMinutes: Number(graceRow?.value ?? 2) };
  }

  // ── cancellation fee preview — shown BEFORE the customer confirms (never after) ──
  if (action === "cancel-quote") {
    if (!isCustomer && !isDriver && !isAdmin) return NextResponse.json({ error: "You don't have access to this delivery." }, { status: 403 });
    const q = await (async () => {
      const { feeKes, graceMinutes } = await feeSettings();
      const live = simulateLive(s);
      return cancellationQuote({
        status: s.status, fareTotal: s.fareTotal, paymentStatus: s.paymentStatus,
        events: s.events.map((e) => ({ type: e.type, createdAt: e.createdAt })),
        liveProgress: live && live.leg === "TO_PICKUP" ? live.progress : null,
        feeKes, graceMinutes,
      });
    })();
    return NextResponse.json({ ok: true, quote: q });
  }

  // ── generic guarded transitions (driver stations + cancel) ──
  const map: Record<string, { action: string; role: "CUSTOMER" | "DRIVER" | "ADMIN"; label?: string }> = {
    arrive: { action: "arrive", role: "DRIVER" },
    "start-loading": { action: "start-loading", role: "DRIVER" },
    loaded: { action: "loaded", role: "DRIVER" },
    "start-trip": { action: "start-trip", role: "DRIVER" },
    arriving: { action: "arriving", role: "DRIVER" },
    deliver: { action: "deliver", role: "DRIVER" },
    pod: { action: "pod", role: "DRIVER" },
    complete: { action: "complete", role: "DRIVER" },
    cancel: { action: "cancel", role: isDriver ? "DRIVER" : isAdmin ? "ADMIN" : "CUSTOMER" },
  };
  const m = map[action];
  if (m) {
    if (m.action !== "cancel") {
      const deny = asDriver("Only the assigned driver can run this step.");
      if (deny) return deny;
    }
    const meta: { label?: string; reason?: string; cancelledBy?: string; lat?: number; lng?: number } = {};
    if (body.reason) meta.reason = capStr(body.reason, 200);
    if (action === "cancel") meta.cancelledBy = isDriver ? "DRIVER" : isAdmin ? "ADMIN" : "CUSTOMER";
    // ── GPS-mismatch arrival gate (Bolt Driver pattern — the server refuses
    // an arrive/deliver claim when the driver's fresh app-GPS sits far from
    // the target point; the driver app answers the 409 with an explicit
    // confirm, which lands here as gpsMismatchConfirmed and is recorded on
    // the timeline. Null distance (no/stale GPS — every sandbox/demo flow)
    // never blocks.)
    if (action === "arrive" || action === "deliver") {
      const d = s.driverId
        ? await db.driver.findUnique({ where: { id: s.driverId }, select: { lat: true, lng: true, gpsReportedAt: true } })
        : null;
      const target = action === "arrive"
        ? { lat: s.pickupLat, lng: s.pickupLng }
        : { lat: s.dropoffLat, lng: s.dropoffLng };
      const dist = gpsMismatchMeters(d, target);
      if (dist != null && dist > GPS_MISMATCH_METERS && body.gpsMismatchConfirmed !== true) {
        return NextResponse.json({
          error: `Your GPS looks about ${dist}m from the ${action === "arrive" ? "pickup point" : "drop-off point"}. Confirm you're at the right place before continuing.`,
          code: "GPS_MISMATCH",
          distanceM: dist,
          thresholdM: GPS_MISMATCH_METERS,
        }, { status: 409 });
      }
      if (dist != null && dist > GPS_MISMATCH_METERS) {
        meta.label = `${action === "arrive" ? "Driver arrived" : "Arrived at destination"} · GPS ${dist}m away (confirmed)`;
      }
    }
    // cancellation economics: compute the fee BEFORE the transition applies it
    let cancelFee = 0;
    let refundKes = s.fareTotal;
    if (action === "cancel") {
      const { feeKes, graceMinutes } = await feeSettings();
      const live = simulateLive(s);
      const q = cancellationQuote({
        status: s.status, fareTotal: s.fareTotal, paymentStatus: s.paymentStatus,
        events: s.events.map((e) => ({ type: e.type, createdAt: e.createdAt })),
        liveProgress: live && live.leg === "TO_PICKUP" ? live.progress : null,
        feeKes, graceMinutes,
      });
      cancelFee = q.feeKes;
      refundKes = q.refundKes;
      if (q.waived) meta.label = `Delivery cancelled · fee waived — ${q.waiverReason}`;
      else if (cancelFee > 0) meta.label = `Delivery cancelled · KES ${cancelFee} fee withheld · KES ${refundKes.toLocaleString()} refunded`;
    }
    if (action === "pod" && body.recipient) {
      meta.label = `Proof of delivery · ${capStr(body.recipient, 60)} · OTP ${body.otp ? "verified" : "captured"}`;
    }
    if (body.photo) meta.label = capStr(body.label, 200);
    // the drop-off handshake is BLOCKING: the driver cannot close a delivery
    // without the customer's 4-digit code (Bolt pickup-code pattern)
    if (m.action === "pod" && s.deliveryCode) {
      if (!body.otp) {
        return NextResponse.json({ error: "Ask the customer for their 4-digit delivery code to complete this delivery." }, { status: 400 });
      }
      if (String(body.otp) !== s.deliveryCode) {
        return NextResponse.json({ error: "That delivery code doesn't match. Ask the customer to read it from their app." }, { status: 400 });
      }
    }
    const t = await applyTransition(id, m.action, m.role, meta);
    if (!t.ok) return NextResponse.json({ error: t.error }, { status: t.code });
    // record the withheld fee on the shipment (receipt + trips list show it)
    if (action === "cancel" && cancelFee > 0) {
      await db.shipment.update({ where: { id }, data: { cancelFee } });
    }
    // real money: refund the customer's share (full fare minus the withheld
    // fee) through the provider — the refund.processed webhook finalises it.
    // MOCK mode is a no-op (the state machine already labels the sandbox refund).
    if (action === "cancel" && s.paymentStatus === "CONFIRMED" && refundKes > 0) {
      const refund = await refundShipmentPayment(id, refundKes);
      if (!refund.ok && refund.note !== "no confirmed paystack payment") {
        console.error("[refund] provider refund not sent", refund.note);
      }
    }
    // POD data
    if (action === "pod") {
      await db.shipment.update({
        where: { id },
        data: { podRecipient: capStr(body.recipient ?? "Recipient", 60), podOtp: body.otp ? capStr(body.otp, 8) : null, podPhotoTaken: !!body.photo, podVerifiedAt: new Date(), podLat: s.dropoffLat, podLng: s.dropoffLng },
      });
      // hold-then-payout: the driver's share moves after POD is proven —
      // failure-tolerant (a blocked payout lands in the admin Payouts queue,
      // it never blocks the delivery itself). Tips added later by the rating
      // flow ride on the NEXT withdrawal instead (wallet math covers them).
      const payout = await initiatePodPayout(id, "SYSTEM");
      if (!payout.ok) console.error("[payout] POD payout not started", payout.note);
    }
    return NextResponse.json({ ok: true, shipment: shipmentDTO((await getShipmentFull({ id }))!) });
  }

  // ── rating (two-way) — one rating per shipment per role ──
  if (action === "rate") {
    const ratingRole: "DRIVER" | "CUSTOMER" = isDriver && !isCustomer ? "DRIVER" : "CUSTOMER";
    if (ratingRole === "CUSTOMER" && !isCustomer && !isAdmin) {
      return NextResponse.json({ error: "Only the customer can rate this delivery." }, { status: 403 });
    }
    if (ratingRole === "DRIVER" && !isDriver && !isAdmin) {
      return NextResponse.json({ error: "Only the assigned driver can rate this customer." }, { status: 403 });
    }
    const already = await db.rating.findFirst({ where: { shipmentId: id, byRole: ratingRole } });
    if (already) return NextResponse.json({ error: "This delivery has already been rated." }, { status: 409 });
    const stars = Math.max(1, Math.min(5, Number(body.stars) || 5));
    // Bolt pattern: the tip is offered after a 4–5★ rating, 100% to the driver
    const tip = Math.max(0, Math.min(5_000, clampInt(body.tip, 0, 5_000, 0)));
    await db.rating.create({ data: { shipmentId: id, byRole: ratingRole, stars, tip: tip > 0 ? tip : null, tags: JSON.stringify(Array.isArray(body.tags) ? body.tags.slice(0, 6).map((t: unknown) => capStr(t, 40)) : []), comment: body.comment ? capStr(body.comment, 280) : null } });
    if (tip > 0 && ratingRole === "CUSTOMER" && s.driverId) {
      // the tip rides on top of the locked fare — the driver's wallet derives from driverEarnings
      await db.shipment.update({ where: { id }, data: { driverEarnings: { increment: tip } } });
      await db.shipmentEvent.create({ data: { shipmentId: id, type: "TIP_ADDED", label: `Tip · KES ${tip.toLocaleString()} · 100% to the driver`, actor: "CUSTOMER" } });
      const d = await db.driver.findUnique({ where: { id: s.driverId }, include: { user: true } });
      if (d?.userId) await db.notification.create({ data: { userId: d.userId, role: "DRIVER", title: "You received a tip", body: `KES ${tip.toLocaleString()} from ${s.code} — asante!`, shipmentCode: s.code } });
    }
    if (ratingRole !== "DRIVER" && s.driverId) {
      // update driver rating as rolling average
      const d = await db.driver.findUnique({ where: { id: s.driverId } });
      if (d) {
        const total = d.tripsCompleted || 1;
        const newRating = Math.round(((d.rating * total + stars) / (total + 1)) * 100) / 100;
        await db.driver.update({ where: { id: d.id }, data: { rating: newRating } });
      }
    }
    if (ratingRole === "DRIVER") {
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

  // ── dispute — the customer or the driver can open one ──
  if (action === "dispute") {
    await db.dispute.create({ data: { shipmentId: id, type: capStr(body.type ?? "OTHER", 40), notes: capStr(body.notes ?? "", 400) } });
    if (["DELIVERED", "POD_CONFIRMED", "COMPLETED", "CANCELLED"].includes(s.status)) {
      await applyTransition(id, "dispute-open", isDriver ? "SYSTEM" : "CUSTOMER", { reason: capStr(body.type ?? "Dispute", 40) }).catch(() => null);
    } else if (s.status !== "COMPLETED") {
      await applyTransition(id, "cancel", "SYSTEM", { reason: "Dispute opened" }).catch(() => null);
    }
    return NextResponse.json({ ok: true });
  }

  // ── safety alerts (Uber SOS / Bolt Emergency Assist pattern, scoped to what a
  // small platform can actually run: ops callback + event trail + admin queue) ──
  if (action === "safety-alert") {
    if (!isCustomer && !isDriver && !isAdmin) return NextResponse.json({ error: "You don't have access to this delivery." }, { status: 403 });
    const reporter = isDriver ? "DRIVER" : "CUSTOMER";
    const note = body.note ? ` · ${capStr(body.note, 80)}` : "";
    const livePos = simulateLive(s);
    await db.shipmentEvent.create({
      data: { shipmentId: id, type: "SAFETY_ALERT", label: `Safety alert raised by ${reporter.toLowerCase()}${note}`, actor: reporter, lat: body.lat != null ? Number(body.lat) : livePos?.lat ?? null, lng: body.lng != null ? Number(body.lng) : livePos?.lng ?? null },
    });
    // every admin gets paged — the ops queue is the ack surface
    const admins = await db.user.findMany({ where: { role: "ADMIN" }, select: { id: true } });
    if (admins.length) {
      await db.notification.createMany({
        data: admins.map((a) => ({ userId: a.id, role: "ADMIN", title: "Safety alert", body: `${s.code} · ${reporter === "DRIVER" ? "Driver" : "Customer"} needs help — call back now`, shipmentCode: s.code })),
      });
    }
    // the other party is notified too — they may be the first to help
    if (reporter === "CUSTOMER" && s.driverId) {
      const d = await db.driver.findUnique({ where: { id: s.driverId }, include: { user: true } });
      if (d?.userId) await db.notification.create({ data: { userId: d.userId, role: "DRIVER", title: "Safety alert on your delivery", body: `The customer raised a safety alert on ${s.code}.`, shipmentCode: s.code } });
    } else if (reporter === "DRIVER") {
      await db.notification.create({ data: { userId: s.customerId, role: "CUSTOMER", title: "Safety alert on your delivery", body: `The driver raised a safety alert on ${s.code}.`, shipmentCode: s.code } });
    }
    return NextResponse.json({ ok: true, shipment: shipmentDTO((await getShipmentFull({ id }))!) });
  }

  if (action === "safety-checkin") {
    if (!isCustomer && !isDriver && !isAdmin) return NextResponse.json({ error: "You don't have access to this delivery." }, { status: 403 });
    const reporter = isDriver ? "DRIVER" : "CUSTOMER";
    await db.shipmentEvent.create({ data: { shipmentId: id, type: "SAFETY_CHECKIN", label: `${reporter === "DRIVER" ? "Driver" : "Customer"} checked in · safe`, actor: reporter } });
    return NextResponse.json({ ok: true, shipment: shipmentDTO((await getShipmentFull({ id }))!) });
  }

  if (action === "safety-ack") {
    // admin-only: the ops queue ack — tells everyone the alert is being handled
    if (!isAdmin) return NextResponse.json({ error: "Only ops can acknowledge safety alerts." }, { status: 403 });
    await db.shipmentEvent.create({ data: { shipmentId: id, type: "SAFETY_ACK", label: `Ops acknowledged the alert · calling ${s.driver ? "both parties" : "the customer"} back`, actor: "ADMIN" } });
    await db.notification.create({ data: { userId: s.customerId, role: "CUSTOMER", title: "Ops is on it", body: `We received your safety alert on ${s.code}. A team member is calling you now.`, shipmentCode: s.code } });
    if (s.driverId) {
      const d = await db.driver.findUnique({ where: { id: s.driverId }, include: { user: true } });
      if (d?.userId) await db.notification.create({ data: { userId: d.userId, role: "DRIVER", title: "Ops is on it", body: `We received the safety alert on ${s.code}. A team member is calling you now.`, shipmentCode: s.code } });
    }
    return NextResponse.json({ ok: true, shipment: shipmentDTO((await getShipmentFull({ id }))!) });
  }

  // ── mint a fresh recipient tracking link (v1 lesson: raw tokens never stored) ──
  if (action === "share-link") {
    const deny = asCustomer("Only the customer can share this delivery.");
    if (deny) return deny;
    // 24 random bytes, base64url — a real capability; only its sha256 is persisted
    const { raw, hash } = await newShareTokenHashed();
    // Bolt pattern: the link is short-lived — 48 h from minting, one delivery
    await db.shipment.update({ where: { id }, data: { shareToken: hash, shareTokenExpiresAt: new Date(Date.now() + 48 * 3600_000) } });
    return NextResponse.json({ ok: true, token: raw, url: `/?view=track&token=${raw}`, expiresAt: new Date(Date.now() + 48 * 3600_000).toISOString() });
  }

  // ── customer ↔ driver chat (plan §77: quick messages first, numbers masked) ──
  if (action === "chat") {
    const text = capStr(body.body ?? "", 280).trim();
    if (!text) return NextResponse.json({ error: "Message required" }, { status: 400 });
    const role: "DRIVER" | "CUSTOMER" = isDriver && !isCustomer ? "DRIVER" : "CUSTOMER";
    if (role === "CUSTOMER" && !isCustomer && !isAdmin) {
      return NextResponse.json({ error: "You can't message on this delivery." }, { status: 403 });
    }
    if (role === "DRIVER" && !isDriver && !isAdmin) {
      return NextResponse.json({ error: "You can't message on this delivery." }, { status: 403 });
    }
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
    const deny = asCustomer("Only the customer can request quotes.");
    if (deny) return deny;
    const t = await applyTransition(id, "request-quotes", isAdmin ? "ADMIN" : "CUSTOMER", { label: "Driver quotes requested" });
    if (!t.ok) return NextResponse.json({ error: t.error }, { status: t.code });
    await db.shipment.update({ where: { id }, data: { pricingMode: "QUOTE" } });
    return NextResponse.json({ ok: true, shipment: shipmentDTO((await getShipmentFull({ id }))!) });
  }

  if (action === "driver-quote") {
    // QUOTED marketplace jobs have no assigned driver yet — any driver (session
    // driver profile) may quote; the driver app lists only matching categories.
    if (!session.did && !isAdmin) {
      return NextResponse.json({ error: "Only drivers can quote on this job." }, { status: 403 });
    }
    if (s.status !== "QUOTED") return NextResponse.json({ error: "This job is not open for quotes" }, { status: 409 });
    // the quote is submitted under the session's own driver profile
    const driverId = session.did!;
    const amount = clampInt(body.amount, 0, 2_000_000, 0);
    if (amount < 500) return NextResponse.json({ error: "Quote must be at least KES 500." }, { status: 400 });
    const already = await db.quote.findFirst({ where: { shipmentId: id, driverId, status: "PENDING" } });
    if (already) return NextResponse.json({ error: "You already quoted this job." }, { status: 409 });
    const expiryMin = Number((await db.platformSetting.findUnique({ where: { key: "quoteExpiryMinutes" } }))?.value ?? 60);
    const q = await db.quote.create({ data: { shipmentId: id, driverId, amount, etaText: capStr(body.etaText ?? "Tomorrow 08:00", 40), message: body.message ? capStr(body.message, 120) : null, expiresAt: new Date(Date.now() + expiryMin * 60_000) } });
    await db.shipmentEvent.create({ data: { shipmentId: id, type: "QUOTE_RECEIVED", label: `Quote received · KES ${amount.toLocaleString()}`, actor: "DRIVER" } });
    await db.notification.create({ data: { userId: s.customerId, role: "CUSTOMER", title: "Driver submitted a quote", body: `KES ${amount.toLocaleString()} for ${s.code}`, shipmentCode: s.code } });
    return NextResponse.json({ ok: true, quote: q, shipment: shipmentDTO((await getShipmentFull({ id }))!) });
  }

  if (action === "accept-quote") {
    const deny = asCustomer("Only the customer can accept a quote.");
    if (deny) return deny;
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
    const t = await applyTransition(id, "accept-quote", isAdmin ? "ADMIN" : "CUSTOMER", { label: `Quote accepted · KES ${q.amount.toLocaleString()} · fare locked` });
    if (!t.ok) return NextResponse.json({ error: t.error }, { status: t.code });
    return NextResponse.json({ ok: true, shipment: shipmentDTO((await getShipmentFull({ id }))!) });
  }

  // ── multi-stop: driver marks an intermediate stop complete (plan §35) ──
  if (action === "stop-done") {
    const deny = asDriver("Only the assigned driver can complete stops.");
    if (deny) return deny;
    const idx = clampInt(body.stopIndex, -1, 20, -1);
    const stops = JSON.parse(s.stops || "[]") as { name: string; lat?: number; lng?: number }[];
    if (idx < 0 || idx >= stops.length) return NextResponse.json({ error: "Stop not found" }, { status: 404 });
    await db.shipmentEvent.create({ data: { shipmentId: id, type: "STOP_COMPLETED", label: `Stop ${idx + 1} complete · ${stops[idx].name}`, actor: "DRIVER", lat: stops[idx].lat, lng: stops[idx].lng } });
    return NextResponse.json({ ok: true, shipment: shipmentDTO((await getShipmentFull({ id }))!) });
  }

  // ── driver reports cargo mismatch at pickup ──
  if (action === "report-mismatch") {
    const deny = asDriver("Only the assigned driver can report cargo issues.");
    if (deny) return deny;
    await db.shipmentEvent.create({
      data: { shipmentId: id, type: "MISMATCH_REPORTED", label: `Driver reported: ${capStr(body.reason ?? "cargo differs from booking", 120)}`, actor: "DRIVER", lat: s.pickupLat, lng: s.pickupLng },
    });
    await db.notification.create({ data: { userId: s.customerId, role: "CUSTOMER", title: "Driver reported an issue", body: capStr(body.reason ?? "Cargo differs from booking", 60), shipmentCode: s.code } });
    return NextResponse.json({ ok: true, shipment: shipmentDTO((await getShipmentFull({ id }))!) });
  }

  return NextResponse.json({ error: `Unknown action ${action}` }, { status: 400 });
}

async function reassign(shipmentId: string, categoryKey: string) {
  const s = await getShipmentFull({ id: shipmentId });
  if (!s || !s.driverId) return null;
  const excluded = s.driverId;
  // same H3 ring path as the request action, with the displaced driver excluded
  const baseFetch = ringFetcher();
  const { match } = await matchDriverRing({
    fetchByCells: async (cells) => (await baseFetch.fetchByCells(cells)).filter((d) => d.id !== excluded),
    fetchAll: async () => (await baseFetch.fetchAll()).filter((d) => d.id !== excluded),
    pickup: { lat: s.pickupLat, lng: s.pickupLng },
    need: { categoryKey, weightKg: 300 },
  });
  if (!match) return null;
  await db.shipment.update({ where: { id: shipmentId }, data: { driverId: match.driverId, vehicleId: match.vehicleId, status: "MATCHING", stateEnteredAt: new Date() } });
  const winner = await db.driver.findUnique({ where: { id: match.driverId }, select: { lat: true, lng: true } });
  await applyTransition(shipmentId, "assign", "SYSTEM", {
    label: `Driver matched · ${match.name} · ${match.vehicleName} ${match.registration}`,
    lat: winner?.lat,
    lng: winner?.lng,
  });
  return { name: match.name, etaMin: match.etaMin, rating: match.rating, vehicle: match.vehicleName, registration: match.registration };
}
