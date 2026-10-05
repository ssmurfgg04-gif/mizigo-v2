// POST /api/return-loads/[id]/book — reserve a published empty leg (v1 goodness).
// Creates a real shipment at the discounted return price with the publishing
// driver pre-assigned: the vehicle is already travelling that way, so there is
// no matching round — the leg is locked the moment the customer confirms.
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { mpesaRef } from "@/lib/format";
import { newShipmentCode, newShareToken, getShipmentFull, shipmentDTO } from "@/lib/shipments";
import { routeDistanceKm, routeDurationMin } from "@/lib/geo";
import { ensureDB } from "@/lib/db-ready";
import { requireSession, isResponse, rateLimit, capStr } from "@/lib/security";

export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  await ensureDB();
  const session = requireSession(req);
  if (isResponse(session)) return session;
  const limited = rateLimit(req, "returnload:book", 15, 60_000);
  if (limited) return limited;
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const customerId = session.uid; // the booking belongs to the signed-in customer

  const load = await db.returnLoad.findUnique({ where: { id } });
  if (!load || load.status !== "AVAILABLE" || (load.availableUntil && load.availableUntil < new Date())) {
    return NextResponse.json({ error: "This return load is no longer available." }, { status: 409 });
  }

  const driver = await db.driver.findUnique({ where: { id: load.driverId }, include: { user: true, vehicles: { include: { category: true } } } });
  if (!driver) return NextResponse.json({ error: "The driver for this leg is no longer on the network." }, { status: 409 });

  // the vehicle the leg was published with (falls back to the driver's first vehicle)
  const vehicle = driver.vehicles.find((v) => v.category?.key === load.categoryKey) ?? driver.vehicles.find((v) => v.active) ?? null;
  const category = vehicle?.category ?? (await db.vehicleCategory.findUnique({ where: { key: load.categoryKey } }));
  if (!category) return NextResponse.json({ error: "Vehicle category unavailable." }, { status: 409 });

  const customer = await db.user.findUnique({ where: { id: customerId } });
  if (!customer) return NextResponse.json({ error: "Customer not found." }, { status: 404 });

  // lock the leg first (atomic claim — two customers can't reserve the same leg)
  const claimed = await db.returnLoad.updateMany({
    where: { id, status: "AVAILABLE" },
    data: { status: "BOOKED", bookedById: customerId },
  });
  if (!claimed.count) return NextResponse.json({ error: "This return load was just reserved by someone else." }, { status: 409 });

  const distanceKm = Math.round(routeDistanceKm(
    { lat: load.fromLat, lng: load.fromLng },
    { lat: load.toLat, lng: load.toLng }
  ) * 10) / 10;
  const durationMin = routeDurationMin(distanceKm);
  const zone = await db.pricingZone.findFirst({ where: { key: "nairobi" } });
  const commissionRate = zone?.commissionRate ?? 0.15;
  const total = load.priceKes;
  const commission = Math.round(total * commissionRate);
  const driverEarnings = total - commission;

  const paymentMethod = ["MPESA", "CASH", "CARD"].includes(body.paymentMethod) ? body.paymentMethod : "MPESA";
  const paid = paymentMethod === "MPESA"; // sandbox: M-Pesa confirms instantly
  const code = await newShipmentCode();
  const token = await newShareToken(); // { raw, hash } — only the hash is stored (v1 lesson)
  const deliveryCode = String(1000 + Math.floor(Math.random() * 9000));

  const s = await db.shipment.create({
    data: {
      code, shareToken: token.hash, deliveryCode, customerId, status: "DRIVER_ASSIGNED", stateEnteredAt: new Date(),
      pickupName: load.fromName, pickupArea: load.fromArea, pickupLat: load.fromLat, pickupLng: load.fromLng,
      dropoffName: load.toName, dropoffArea: load.toArea, dropoffLat: load.toLat, dropoffLng: load.toLng,
      stops: "[]", distanceKm, durationMin,
      cargoCategory: "other", cargoLoad: "MEDIUM", helpers: 0, specialHandling: "[]",
      notes: capStr(`Return load · ${load.cargoNote}`, 400),
      categoryId: category.id, vehicleId: vehicle?.id ?? null, driverId: driver.id,
      pricingMode: "INSTANT", returnLoadId: load.id,
      fareBase: total, fareDistance: 0, fareDuration: 0, fareLoading: 0, fareStops: 0, fareNight: 0, fareSchedule: 0,
      farePlatform: 0, fareTotal: total, driverEarnings, commission,
      paymentMethod, paymentStatus: paid ? "PAID" : "PENDING",
      paymentRef: paid ? mpesaRef() : null, paidAt: paid ? new Date() : null,
      items: { create: [{ name: load.cargoNote, qty: 1, weightKg: 0 }] },
      events: {
        create: [
          { type: "BOOKING_CREATED", label: "Return load booked · empty-leg price locked", actor: "CUSTOMER", lat: load.fromLat, lng: load.fromLng },
          { type: "DRIVER_ASSIGNED", label: `${driver.user.name.split(" ")[0]} is already heading your way`, actor: "SYSTEM", lat: load.fromLat, lng: load.fromLng },
        ],
      },
    },
  });

  await db.returnLoad.update({ where: { id }, data: { bookedShipmentId: s.id } });
  await db.notification.create({
    data: {
      userId: driver.userId, role: "DRIVER", title: "Return load reserved",
      body: `A customer reserved your ${load.fromArea} → ${load.toArea} leg · ${code}`, shipmentCode: code,
    },
  });

  const full = await getShipmentFull({ id: s.id });
  return NextResponse.json({ ok: true, shipment: shipmentDTO(full!) });
}
