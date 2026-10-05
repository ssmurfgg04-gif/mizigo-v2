// POST /api/shipments — create a PRICED shipment (idempotent by draftId).
// GET /api/shipments?userId= — customer trip history.
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { ensureSeed } from "@/lib/seed";
import { newShipmentCode, newShareToken, getShipmentFull, shipmentDTO } from "@/lib/shipments";
import { priceFor, estimateWeight, recommendCategory } from "@/lib/pricing";
import { routeDistanceKm, routeDurationMin } from "@/lib/geo";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  await ensureSeed();
  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Invalid body" }, { status: 400 });

  const { draftId, customerId, pickup, dropoff, stops, cargo, categoryKey, paymentMethod, scheduledAt } = body;
  if (!draftId || !customerId || !pickup?.lat || !dropoff?.lat || !categoryKey) {
    return NextResponse.json({ error: "Missing booking details." }, { status: 400 });
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
  const fare = priceFor(category, zone, { distanceKm, durationMin, helpers: cargo.helpers ?? 0, extraStops });

  const code = await newShipmentCode();
  const token = await newShareToken();

  const s = await db.shipment.create({
    data: {
      code, shareToken: token, customerId, status: "PRICED", stateEnteredAt: new Date(),
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
      fareBase: fare.base, fareDistance: fare.distance, fareDuration: fare.duration,
      fareLoading: fare.loading, fareStops: fare.stops, farePlatform: fare.platform,
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
  await ensureSeed();
  const { searchParams } = new URL(req.url);
  const userId = searchParams.get("userId");
  if (!userId) return NextResponse.json({ error: "userId required" }, { status: 400 });
  const rows = await db.shipment.findMany({
    where: { customerId: userId },
    include: { category: true, vehicle: true, driver: { include: { user: true } }, customer: true, items: true, events: true, ratings: true },
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json({ shipments: rows.map(shipmentDTO) });
}
