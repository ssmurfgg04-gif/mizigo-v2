// POST /api/shipments — create a PRICED shipment (idempotent by draftId).
// Supports promo codes, scheduled bookings and QUOTE pricing mode.
// GET /api/shipments — the caller's own trip history (session-scoped),
// paginated: ?limit=1..100 (default 50) + ?offset (default 0) + ?status filter.
// Response: { shipments, hasMore, limit, offset } — additive over the original
// { shipments } shape, so existing consumers keep working untouched.
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { ensureDB } from "@/lib/db-ready";
import { newShipmentCode, newShareToken, getShipmentFull, shipmentDTO } from "@/lib/shipments";
import { priceFor, estimateWeight, recommendCategory, isNightHour } from "@/lib/pricing";
import { routeDistanceKm, routeDurationMin } from "@/lib/geo";
import { requireSession, isResponse, rateLimit, capStr, clampInt, validCoord, sanitizeItems, sanitizeStops } from "@/lib/security";
import { cacheGet, cacheSet, invalidatePrefix } from "@/lib/query-cache";
import { record, logEvent } from "@/lib/telemetry";

export const dynamic = "force-dynamic";

// ── GET: session-scoped trip history, cached 15s per scope, invalidated by
// every mutation path (POST here, shipment actions, admin actions).
export async function GET(req: Request) {
  const t0 = Date.now();
  try {
    const res = await handleGet(req);
    record("api:shipments:list", Date.now() - t0, res.ok);
    logEvent({ route: "api:shipments:list", latencyMs: Date.now() - t0, ok: res.ok, status: res.status });
    return res;
  } catch (err) {
    record("api:shipments:list", Date.now() - t0, false);
    logEvent({ level: "error", route: "api:shipments:list", ok: false, extra: { message: (err as Error)?.message } });
    throw err;
  }
}

async function handleGet(req: Request): Promise<NextResponse> {
  await ensureDB();
  const session = requireSession(req);
  if (isResponse(session)) return session;
  const { searchParams } = new URL(req.url);
  // pagination: limit 1..100 (default 50), offset ≥ 0, optional status filter
  const limit = clampInt(searchParams.get("limit"), 1, 100, 50);
  const offset = clampInt(searchParams.get("offset"), 0, 1_000_000, 0);
  const status = searchParams.get("status");
  const statusFilter = status && status !== "ALL" ? { status } : {};
  // customers see their own trips; drivers see assigned ones; admins see all
  const where =
    session.role === "ADMIN" ? (Object.keys(statusFilter).length ? { ...statusFilter } : undefined) :
    session.role === "DRIVER" ? { driverId: session.did!, ...statusFilter } :
    { customerId: session.uid, ...statusFilter };

  // per-scope cache (successful GET payloads only; 15s, prefix "shipments")
  const cacheKey = `shipments:${session.uid}:${session.role}:${status ?? "ALL"}:${limit}:${offset}`;
  const cached = cacheGet<unknown>(cacheKey);
  if (cached !== undefined) return NextResponse.json(cached);

  const rows = await db.shipment.findMany({
    where,
    include: { category: true, vehicle: true, driver: { include: { user: true } }, customer: true, items: true, events: true, ratings: true, quotes: { include: { driver: { include: { user: true, vehicles: true } } } }, messages: { orderBy: { createdAt: "asc" } } },
    orderBy: { createdAt: "desc" },
    take: limit + 1, // +1 probe row → hasMore without a second count query
    skip: offset,
  });
  const hasMore = rows.length > limit;
  const payload = {
    shipments: rows.slice(0, limit).map(shipmentDTO),
    hasMore,
    limit,
    offset,
  };
  cacheSet(cacheKey, payload, 15_000);
  return NextResponse.json(payload);
}

// ── POST: create a priced shipment (idempotent by draftId)
export async function POST(req: Request) {
  const t0 = Date.now();
  try {
    const res = await handlePost(req);
    // a new (or replayed) booking changes every cached list/summary that shows it
    if (res.ok) {
      invalidatePrefix("shipments");
      invalidatePrefix("admin");
    }
    record("api:shipments:create", Date.now() - t0, res.ok);
    logEvent({ route: "api:shipments:create", action: "create", latencyMs: Date.now() - t0, ok: res.ok, status: res.status });
    return res;
  } catch (err) {
    record("api:shipments:create", Date.now() - t0, false);
    logEvent({ level: "error", route: "api:shipments:create", action: "create", ok: false, extra: { message: (err as Error)?.message } });
    throw err;
  }
}

async function handlePost(req: Request): Promise<NextResponse> {
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
  const token = await newShareToken(); // { raw, hash } — only the hash is stored (v1 lesson)
  // 4-digit drop-off handshake — the customer reads it to the driver at POD
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
      paymentRef: `DRAFT:${draftId}`, // reserved until payment; replaced by MPESA receipt
      items: { create: items.map((i) => ({ name: i.name, qty: i.qty, weightKg: i.weightKg })) },
      events: { create: [{ type: "BOOKING_CREATED", label: "Booking created · fare locked", actor: "CUSTOMER", lat: pickupC.lat, lng: pickupC.lng }] },
    },
  });

  const full = await getShipmentFull({ id: s.id });
  return NextResponse.json({ ok: true, shipment: shipmentDTO(full!) });
}
