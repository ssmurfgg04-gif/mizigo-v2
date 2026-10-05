// POST /api/shipments — create a PRICED shipment (idempotent by draftId).
// Supports promo codes, scheduled bookings and QUOTE pricing mode.
// GET /api/shipments?userId= — customer trip history.
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { ensureDB } from "@/lib/db-ready";
import { newShipmentCode, newShareToken, getShipmentFull, shipmentDTO } from "@/lib/shipments";
import { priceFor, estimateWeight, recommendCategory, isNightHour } from "@/lib/pricing";
import { routeDistanceKm, routeDurationMin } from "@/lib/geo";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  await ensureDB();
  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Invalid body" }, { status: 400 });

  const { draftId, customerId, pickup, dropoff, stops, cargo, categoryKey, paymentMethod, scheduledAt, promoCode, pricingMode } = body;
  if (!draftId || !customerId || !pickup?.lat || !dropoff?.lat || !categoryKey) {
    return NextResponse.json({ error: "Missing booking details." }, { status: 400 });
  }

  // scheduled bookings: admin controls how far ahead is allowed (plan §34)
  if (scheduledAt) {
    const when = new Date(scheduledAt);
    if (!Number.isNaN(when.getTime())) {
      const advanceDays = Number((await db.platformSetting.findUnique({ where: { key: "advanceBookingDays" } }))?.value ?? 14);
      const maxAt = new Date(Date.now() + advanceDays * 86400_000);
      if (when < new Date(Date.now() - 3600_000) || when > maxAt) {
        return NextResponse.json({ error: `Scheduled deliveries must be within the next ${advanceDays} days.` }, { status: 400 });
      }
    }
  }

  // idempotency: same draft returns the same shipment
  const existing = await db.shipment.findFirst({ where: { paymentRef: `DRAFT:${draftId}`, status: { in: ["PRICED", "PAYMENT_PENDING", "PAYMENT_CONFIRMED", "MATCHING"] } } });
  if (existing) {
    const full = await getShipmentFull({ id: existing.id });
    return NextResponse.json({ ok: true, shipment: shipmentDTO(full!) });
  }

  const [zone, category] = await Promise.all([
    db.pricingZone.findFirst({ where: { key: "nairobi" } }),
    db.vehicleCategory.findUnique({ where: { key: categoryKey } }),
  ]);
  if (!zone || !category) return NextResponse.json({ error: "Vehicle category unavailable" }, { status: 400 });

  const waypoints = [pickup, ...(stops ?? []), dropoff].map((p: { lat: number; lng: number }) => ({ lat: p.lat, lng: p.lng }));
  let distanceKm = 0;
  for (let i = 0; i < waypoints.length - 1; i++) distanceKm += routeDistanceKm(waypoints[i], waypoints[i + 1]);
  distanceKm = Math.round(distanceKm * 10) / 10;
  const durationMin = routeDurationMin(distanceKm);
  const weightKg = estimateWeight(cargo.items ?? [], cargo.load ?? "MEDIUM");
  const extraStops = Math.max(0, waypoints.length - 2);
  // v1 pricing factors: night surcharge + planned-delivery discount
  const scheduledDate = scheduledAt ? new Date(scheduledAt) : null;
  const night = isNightHour(scheduledDate ?? new Date());
  let fare = priceFor(category, zone, { distanceKm, durationMin, helpers: cargo.helpers ?? 0, extraStops, night, scheduled: !!scheduledDate });

  // ── promo validation + server-side discount (plan §75) ──
  let discount = 0;
  let appliedPromo: string | null = null;
  let promoError: string | null = null;
  const rawPromo = String(promoCode ?? "").trim().toUpperCase();
  if (rawPromo) {
    const promo = await db.promoCode.findUnique({ where: { code: rawPromo } });
    const customer = await db.user.findUnique({ where: { id: customerId } });
    const firstTrip = !(await db.shipment.count({ where: { customerId, status: { in: ["COMPLETED", "IN_TRANSIT", "ARRIVING", "DELIVERED", "POD_CONFIRMED"] } } }));
    if (!promo || !promo.active) promoError = "That promo code isn't valid.";
    else if (promo.expiresAt && promo.expiresAt < new Date()) promoError = "That promo code has expired.";
    else if (promo.minFare > fare.total) promoError = `Promo needs a minimum fare of KES ${promo.minFare.toLocaleString()}.`;
    else if (promo.firstBookingOnly && !firstTrip) promoError = "That promo is only for first deliveries.";
    else if (promo.businessOnly && customer?.accountType !== "BUSINESS") promoError = "That promo is for business accounts.";
    else {
      discount = promo.kind === "PERCENT" ? Math.round((fare.total * promo.value) / 100) : promo.value;
      discount = Math.min(discount, fare.total);
      appliedPromo = promo.code;
    }
  }
  const finalTotal = Math.max(0, fare.total - discount);
  const finalEarnings = Math.max(0, finalTotal - Math.round(finalTotal * (zone.commissionRate ?? 0.15)));
  const commission = finalTotal - finalEarnings;
  if (promoError) return NextResponse.json({ error: promoError }, { status: 400 });
  fare = { ...fare, total: finalTotal, driverEarnings: finalEarnings, commission };

  const code = await newShipmentCode();
  const token = await newShareToken(); // { raw, hash } — only the hash is stored (v1 lesson)

  const s = await db.shipment.create({
    data: {
      code, shareToken: token.hash, customerId, status: "PRICED", stateEnteredAt: new Date(),
      scheduledAt: scheduledAt ? new Date(scheduledAt) : null,
      pickupName: pickup.name, pickupArea: pickup.area ?? "", pickupLat: pickup.lat, pickupLng: pickup.lng,
      pickupNote: pickup.note ?? null, pickupContact: pickup.contact ?? null, pickupPhone: pickup.phone ?? null,
      dropoffName: dropoff.name, dropoffArea: dropoff.area ?? "", dropoffLat: dropoff.lat, dropoffLng: dropoff.lng,
      dropoffNote: dropoff.note ?? null, dropoffContact: dropoff.contact ?? null, dropoffPhone: dropoff.phone ?? null,
      stops: JSON.stringify(stops ?? []),
      distanceKm, durationMin,
      cargoCategory: cargo.category ?? "other", cargoLoad: cargo.load ?? "MEDIUM",
      helpers: cargo.helpers ?? 0, specialHandling: JSON.stringify(cargo.special ?? []), notes: cargo.notes ?? null,
      categoryId: category.id,
      pricingMode: pricingMode === "QUOTE" ? "QUOTE" : "INSTANT",
      promoCode: appliedPromo, fareDiscount: discount,
      fareBase: fare.base, fareDistance: fare.distance, fareDuration: fare.duration,
      fareLoading: fare.loading, fareStops: fare.stops, fareNight: fare.night, fareSchedule: fare.schedule, farePlatform: fare.platform,
      fareTotal: fare.total, driverEarnings: fare.driverEarnings, commission: fare.commission,
      paymentMethod: paymentMethod ?? "MPESA", paymentStatus: "PENDING",
      paymentRef: `DRAFT:${draftId}`, // reserved until payment; replaced by MPESA receipt
      items: { create: (cargo.items ?? []).map((i: { name: string; qty: number; weightKg?: number }) => ({ name: i.name, qty: i.qty, weightKg: i.weightKg ?? 0 })) },
      events: { create: [{ type: "BOOKING_CREATED", label: "Booking created · fare locked", actor: "CUSTOMER", lat: pickup.lat, lng: pickup.lng }] },
    },
  });

  const full = await getShipmentFull({ id: s.id });
  return NextResponse.json({ ok: true, shipment: shipmentDTO(full!) });
}

export async function GET(req: Request) {
  await ensureDB();
  const { searchParams } = new URL(req.url);
  const userId = searchParams.get("userId");
  if (!userId) return NextResponse.json({ error: "userId required" }, { status: 400 });
  const rows = await db.shipment.findMany({
    where: { customerId: userId },
    include: { category: true, vehicle: true, driver: { include: { user: true } }, customer: true, items: true, events: true, ratings: true, quotes: { include: { driver: { include: { user: true, vehicles: true } } } }, messages: { orderBy: { createdAt: "asc" } } },
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json({ shipments: rows.map(shipmentDTO) });
}
