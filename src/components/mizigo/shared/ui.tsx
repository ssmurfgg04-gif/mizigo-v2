// POST /api/shipments — create a PRICED shipment (idempotent by draftId).
// Supports promo codes, scheduled bookings and QUOTE pricing mode.
// GET /api/shipments — the caller's own trip history (session-scoped).
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { ensureDB } from "@/lib/db-ready";
import { getCached } from "@/lib/query-cache";
import { newShipmentCode, newShareToken, getShipmentFull, shipmentDTO } from "@/lib/shipments";
import { priceFor, estimateWeight, recommendCategory, isNightHour } from "@/lib/pricing";
import { routeDistanceKm, routeDurationMin } from "@/lib/geo";
import { requireSession, isResponse, rateLimit, capStr, clampInt, validCoord, sanitizeItems, sanitizeStops } from "@/lib/security";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  await ensureDB();
  const session = requireSession(req);
  if (isResponse(session)) return session;
  const limited = rateLimit(req, "shipments:create", 15, 60_000);
  if (limited) return limited;
  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Invalid body" }, { status: 400 });

  const { draftId, pickup, dropoff, cargo = {}, categoryKey, paymentMethod, scheduledAt, promoCode, pricingMode } = body;
  // the booking belongs to the signed-in customer (admins may book on behalf)
  const customerId = session.role === "ADMIN" && body.customerId ? String(body.customerId) : session.uid;

  // coordinate sanity: pickup/dropoff/stops must be finite + inside the service region
  const pickupC = validCoord(pickup?.lat, pickup?.lng);
  const dropoffC = validCoord(dropoff?.lat, dropoff?.lng);
  if (!draftId || !pickupC || !dropoffC || !categoryKey) {
    return NextResponse.json({ error: "Missing or invalid booking details." }, { status: 400 });
  }
  const stops = sanitizeStops(body.stops);
  const items = sanitizeItems(cargo.items);

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

  const waypoints = [pickupC, ...stops, dropoffC];
  let distanceKm = 0;
  for (let i = 0; i < waypoints.length - 1; i++) distanceKm += routeDistanceKm(waypoints[i], waypoints[i + 1]);
  distanceKm = Math.round(distanceKm * 10) / 10;
  const durationMin = routeDurationMin(distanceKm);
  const weightKg = estimateWeight(items, cargo.load ?? "MEDIUM");
  const helpers = clampInt(cargo.helpers, 0, 6, 0);
  const extraStops = Math.max(0, waypoints.length - 2);
  // v1 pricing factors: night surcharge + planned-delivery discount
  const scheduledDate = scheduledAt ? new Date(scheduledAt) : null;
  const night = isNightHour(scheduledDate ?? new Date());
  let fare = priceFor(category, zone, { distanceKm, durationMin, helpers, extraStops, night, scheduled: !!scheduledDate });

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
  const token = await newShareToken();
  const deliveryCode = String(1000 + Math.floor(Math.random() * 9000));

  const s = await db.shipment.create({
    data: {
      code, shareToken: token.hash, deliveryCode, customerId, status: "PRICED", stateEnteredAt: new Date(),
      scheduledAt: scheduledAt ? new Date(scheduledAt) : null,
      pickupName: capStr(pickup.name, 90), pickupArea: capStr(pickup.area ?? "", 60), pickupLat: pickupC.lat, pickupLng: pickupC.lng,
      pickupNote: capStr(pickup.note, 200) || null, pickupContact: capStr(pickup.contact, 60) || null, pickupPhone: capStr(pickup.phone, 20) || null,
      dropoffName: capStr(dropoff.name, 90), dropoffArea: capStr(dropoff.area ?? "", 60), dropoffLat: dropoffC.lat, dropoffLng: dropoffC.lng,
      dropoffNote: capStr(dropoff.note, 200) || null, dropoffContact: capStr(dropoff.contact, 60) || null, dropoffPhone: capStr(dropoff.phone, 20) || null,
      stops: JSON.stringify(stops),
      distanceKm, durationMin,
      cargoCategory: cargo.category ?? "other", cargoLoad: cargo.load ?? "MEDIUM",
      helpers, specialHandling: JSON.stringify(Array.isArray(cargo.special) ? cargo.special.slice(0, 8).map((s: unknown) => capStr(s, 24)) : []), notes: capStr(cargo.notes, 400) || null,
      categoryId: category.id,
      pricingMode: pricingMode === "QUOTE" ? "QUOTE" : "INSTANT",
      promoCode: appliedPromo, fareDiscount: discount,
      fareBase: fare.base, fareDistance: fare.distance, fareDuration: fare.duration,
      fareLoading: fare.loading, fareStops: fare.stops, fareNight: fare.night, fareSchedule: fare.schedule, farePlatform: fare.platform,
      fareTotal: fare.total, driverEarnings: fare.driverEarnings, commission: fare.commission,
      paymentMethod: paymentMethod ?? "MPESA", paymentStatus: "PENDING",
      paymentRef: `DRAFT:${draftId}`,
      items: { create: items.map((i) => ({ name: i.name, qty: i.qty, weightKg: i.weightKg })) },
      events: { create: [{ type: "BOOKING_CREATED", label: "Booking created · fare locked", actor: "CUSTOMER", lat: pickupC.lat, lng: pickupC.lng }] },
    },
  });

  const full = await getShipmentFull({ id: s.id });
  return NextResponse.json({ ok: true, shipment: shipmentDTO(full!) });
}

export async function GET(req: Request) {
  await ensureDB();
  const session = requireSession(req);
  if (isResponse(session)) return session;
  const url = new URL(req.url);
  const page = Math.max(1, Number(url.searchParams.get("page") ?? 1));
  const limit = Math.min(50, Math.max(1, Number(url.searchParams.get("limit") ?? 20)));
  const skip = (page - 1) * limit;
  const where =
    session.role === "ADMIN" ? undefined :
    session.role === "DRIVER" ? { driverId: session.did! } :
    { customerId: session.uid };

  const cacheKey = `shipments:${session.role}:${session.uid}:${session.did ?? "-"}:${page}:${limit}`;
  const rows = await getCached(cacheKey, 2000, async () => {
    const [items, total] = await Promise.all([
      db.shipment.findMany({
        where,
        include: {
          category: true,
          vehicle: true,
          driver: { include: { user: true } },
          customer: true,
          items: true,
          events: { orderBy: { createdAt: "asc" }, take: 6 },
          ratings: true,
          quotes: { orderBy: { amount: "asc" }, take: 3, include: { driver: { include: { user: true, vehicles: true } } } },
        },
        orderBy: { createdAt: "desc" },
        skip,
        take: limit,
      }),
      db.shipment.count({ where })
    ]);

    return { items, total };
  });

  const res = NextResponse.json({ shipments: rows.items.map(shipmentDTO), page, limit, total: rows.total });
  res.headers.set("Cache-Control", "no-store");
  return res;
}

