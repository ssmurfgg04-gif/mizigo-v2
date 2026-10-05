// MIZIGO — Shipment service: server-authoritative transitions, chain-of-custody
// events, notifications, and the dev-mode GPS movement simulation (the same
// simulated position is served to customer, driver and admin surfaces).

import { db } from "./db";
import { canTransition, type Role } from "./state-machine";
import { buildRoute, alongPolyline, routeLengthKm, haversineKm, SPEED } from "./geo";
import { shareToken, shipmentCode } from "./format";
import { hashToken } from "./tokens";
import type { Prisma, Shipment, VehicleCategory, Vehicle, Driver, User, Quote } from "@prisma/client";

type ShipmentWithRelations = Shipment & {
  category: VehicleCategory;
  vehicle: Vehicle | null;
  driver: (Driver & { user: User | null }) | null;
  customer: User;
  items: { id: string; name: string; qty: number; weightKg: number }[];
  events: { id: string; type: string; label: string; actor: string; lat: number | null; lng: number | null; createdAt: Date }[];
  ratings: { id: string; byRole: string; stars: number; tags: string; comment: string | null; createdAt: Date }[];
  quotes?: (Quote & { driver: (Driver & { user: User | null; vehicles: Vehicle[] }) | null })[];
  messages?: { id: string; senderRole: string; body: string; createdAt: Date }[];
};

export interface LivePosition {
  lat: number; lng: number; heading: number;
  progress: number; // 0..1 over current leg
  etaMin: number | null; // ETA to end of current leg
  leg: "TO_PICKUP" | "TO_DROPOFF" | "IDLE";
  lastPingMin: number;
}

// DEV-MODE time compression: the simulated GPS runs 12× real time so a
// 20-minute leg plays out in ~100 seconds in the sandbox.
export const SIM_TIME_SCALE = 12;

// Simulated movement: position derived from state + elapsed time. The pickup
// origin of the driver leg is captured as the geo of the DRIVER_ASSIGNED event.
export function simulateLive(s: ShipmentWithRelations): LivePosition | null {
  const driver = s.driver;
  if (!driver) return null;
  const elapsedMin = ((Date.now() - new Date(s.stateEnteredAt).getTime()) / 60000) * SIM_TIME_SCALE;
  const lastPingMin = Math.max(0, Math.round((Date.now() - new Date(driver.lastPingAt).getTime()) / 60000));

  const pickup = { lat: s.pickupLat, lng: s.pickupLng };
  const dropoff = { lat: s.dropoffLat, lng: s.dropoffLng };

  if (s.status === "DRIVER_EN_ROUTE") {
    const assignEv = s.events.find((e) => e.type === "DRIVER_ASSIGNED");
    const origin = assignEv?.lat != null && assignEv?.lng != null ? { lat: assignEv.lat, lng: assignEv.lng } : { lat: driver.lat, lng: driver.lng };
    const route = buildRoute(origin, pickup);
    const km = routeLengthKm(route);
    const legMin = (km / SPEED.toPickup) * 60;
    const t = Math.min(1, elapsedMin / Math.max(legMin, 2));
    const pos = alongPolyline(route, t);
    const remainingKm = km * (1 - t);
    return { ...pos, heading: heading(route, t), progress: t, etaMin: Math.max(1, Math.round((remainingKm / SPEED.toPickup) * 60)), leg: "TO_PICKUP", lastPingMin };
  }
  if (s.status === "IN_TRANSIT" || s.status === "ARRIVING" || s.status === "DELIVERED" || s.status === "POD_CONFIRMED") {
    const route = buildRoute(pickup, dropoff);
    const km = routeLengthKm(route);
    const legMin = (km / SPEED.inTransit) * 60;
    const t = Math.min(1, elapsedMin / Math.max(legMin, 3));
    const pos = alongPolyline(route, t);
    const remainingKm = km * (1 - t);
    return { ...pos, heading: heading(route, t), progress: t, etaMin: t >= 1 ? 0 : Math.max(1, Math.round((remainingKm / SPEED.inTransit) * 60)), leg: "TO_DROPOFF", lastPingMin };
  }
  if (s.status === "DRIVER_ARRIVED" || s.status === "LOADING" || s.status === "LOADED") {
    return { lat: pickup.lat, lng: pickup.lng, heading: 90, progress: 1, etaMin: 0, leg: "IDLE", lastPingMin };
  }
  return { lat: driver.lat, lng: driver.lng, heading: 90, progress: 0, etaMin: null, leg: "IDLE", lastPingMin };
}

function heading(route: { lat: number; lng: number }[], t: number): number {
  const a = alongPolyline(route, Math.max(0, t - 0.02));
  const b = alongPolyline(route, Math.min(1, t + 0.02));
  return (Math.atan2(b.lng - a.lng, b.lat - a.lat) * 180) / Math.PI;
}

export function routePolyline(s: ShipmentWithRelations): { lat: number; lng: number }[] {
  if (s.status === "DRIVER_EN_ROUTE") {
    const assignEv = s.events.find((e) => e.type === "DRIVER_ASSIGNED");
    const origin = assignEv?.lat != null && assignEv?.lng != null ? { lat: assignEv.lat, lng: assignEv.lng } : (s.driver ? { lat: s.driver.lat, lng: s.driver.lng } : { lat: s.pickupLat, lng: s.pickupLng });
    return buildRoute(origin, { lat: s.pickupLat, lng: s.pickupLng });
  }
  return buildRoute({ lat: s.pickupLat, lng: s.pickupLng }, { lat: s.dropoffLat, lng: s.dropoffLng });
}

export async function getShipmentFull(where: Prisma.ShipmentWhereUniqueInput): Promise<ShipmentWithRelations | null> {
  return db.shipment.findUnique({
    where,
    include: {
      category: true, vehicle: true,
      driver: { include: { user: true } },
      customer: true,
      items: true,
      events: { orderBy: { createdAt: "asc" } },
      ratings: true,
      quotes: { orderBy: { amount: "asc" }, include: { driver: { include: { user: true, vehicles: true } } } },
      messages: { orderBy: { createdAt: "asc" } },
    },
  });
}

// ── Server-authoritative transition ─────────────────────────────────────────
export type TransitionResult = { ok: true; status: string } | { ok: false; error: string; code: number };

export async function applyTransition(
  shipmentId: string, action: string, actor: Role, meta?: { lat?: number; lng?: number; label?: string; cancelledBy?: string; reason?: string }
): Promise<TransitionResult> {
  const s = await getShipmentFull({ id: shipmentId });
  if (!s) return { ok: false, error: "Shipment not found", code: 404 };
  const rule = canTransition(s.status, action, actor);
  if (!rule) return { ok: false, error: `Cannot ${action.replace(/-/g, " ")} while ${s.status}`, code: 409 };

  const data: Prisma.ShipmentUpdateInput = { status: rule.to, stateEnteredAt: new Date() };
  if (rule.to === "CANCELLED") {
    data.cancelledBy = meta?.cancelledBy ?? actor;
    data.cancelReason = meta?.reason ?? null;
    if (s.paymentStatus === "CONFIRMED") {
      data.paymentStatus = "REFUNDED";
      await db.paymentEvent.updateMany({ where: { shipmentId: s.id, status: "CONFIRMED" }, data: { status: "REFUNDED" } });
    }
  }

  const [updated] = await db.$transaction([
    db.shipment.update({ where: { id: s.id }, data }),
    db.shipmentEvent.create({
      data: {
        shipmentId: s.id, type: rule.type, label: meta?.label ?? rule.label, actor,
        lat: meta?.lat ?? (rule.to === "DRIVER_ARRIVED" ? s.pickupLat : rule.type === "POD_CONFIRMED" ? s.dropoffLat : null),
        lng: meta?.lng ?? (rule.to === "DRIVER_ARRIVED" ? s.pickupLng : rule.type === "POD_CONFIRMED" ? s.dropoffLng : null),
      },
    }),
  ]);

  // side effects on driver state
  if (rule.to === "DRIVER_EN_ROUTE" && s.driverId) {
    await db.driver.update({ where: { id: s.driverId }, data: { status: "BUSY" } });
  }
  if ((rule.to === "COMPLETED" || rule.to === "CANCELLED" || rule.to === "NO_DRIVERS") && s.driverId) {
    await db.driver.update({ where: { id: s.driverId }, data: { status: "ONLINE", lastPingAt: new Date(), lat: rule.to === "COMPLETED" ? s.dropoffLat : undefined, lng: rule.to === "COMPLETED" ? s.dropoffLng : undefined } });
    if (rule.to === "COMPLETED") {
      await db.driver.update({ where: { id: s.driverId }, data: { tripsCompleted: { increment: 1 } } });
    }
  }

  // notify the other party
  if (actor === "DRIVER" || actor === "SYSTEM") {
    if (s.customerId) await notify(s.customerId, "CUSTOMER", rule.type, updated);
  } else if (actor === "CUSTOMER" && s.driverId) {
    const d = await db.driver.findUnique({ where: { id: s.driverId }, include: { user: true } });
    if (d?.userId) await notify(d.userId, "DRIVER", rule.type, updated);
  }

  return { ok: true, status: rule.to };
}

const NOTIFY_COPY: Record<string, { title: string; body: string }> = {
  MATCHING_STARTED: { title: "Finding your vehicle", body: "We are looking for the best match near you." },
  DRIVER_ASSIGNED: { title: "Driver found", body: "A driver has been matched to your delivery." },
  DRIVER_ACCEPTED: { title: "Driver accepted", body: "Your driver is on the way to the pickup." },
  DRIVER_ARRIVED: { title: "Your driver has arrived", body: "Check that the vehicle details match the app before loading." },
  LOADING_STARTED: { title: "Loading in progress", body: "Cargo is being loaded." },
  CARGO_LOADED: { title: "Cargo loaded", body: "Your cargo is loaded and verified. Delivery starting soon." },
  TRIP_STARTED: { title: "Delivery started", body: "Your cargo is on the way." },
  ARRIVING: { title: "Almost there", body: "Your delivery is approaching the destination." },
  DESTINATION_REACHED: { title: "Delivery arrived", body: "The vehicle has reached the destination." },
  POD_CONFIRMED: { title: "Delivery confirmed", body: "Proof of delivery captured. Receipt is ready." },
  COMPLETED: { title: "Delivery completed", body: "Your receipt is ready. Rate your driver." },
  CANCELLED: { title: "Delivery cancelled", body: "The delivery was cancelled." },
  MATCHING_FAILED: { title: "No vehicle available", body: "We could not find a suitable vehicle right now." },
};

async function notify(userId: string, role: string, type: string, s: Shipment) {
  const copy = NOTIFY_COPY[type];
  if (!copy) return;
  await db.notification.create({ data: { userId, role, title: copy.title, body: copy.body, shipmentCode: s.code } });
}

export async function newShipmentCode(): Promise<string> {
  let code = shipmentCode();
  while (await db.shipment.findUnique({ where: { code } })) code = shipmentCode();
  return code;
}
export async function newShareToken(): Promise<{ raw: string; hash: string }> {
  // v1 lesson: only the sha256 of the share token is stored.
  let raw = shareToken();
  let hash = hashToken(raw);
  while (await db.shipment.findUnique({ where: { shareToken: hash } })) {
    raw = shareToken();
    hash = hashToken(raw);
  }
  return { raw, hash };
}

export function shipmentDTO(s: ShipmentWithRelations) {
  const live = simulateLive(s);
  return {
    id: s.id, code: s.code, shareToken: s.shareToken, status: s.status,
    createdAt: s.createdAt.toISOString(), stateEnteredAt: s.stateEnteredAt.toISOString(),
    scheduledAt: s.scheduledAt?.toISOString() ?? null,
    route: {
      pickup: { name: s.pickupName, area: s.pickupArea, lat: s.pickupLat, lng: s.pickupLng, note: s.pickupNote, contact: s.pickupContact, phone: s.pickupPhone },
      dropoff: { name: s.dropoffName, area: s.dropoffArea, lat: s.dropoffLat, lng: s.dropoffLng, note: s.dropoffNote, contact: s.dropoffContact, phone: s.dropoffPhone },
      stops: JSON.parse(s.stops || "[]") as { name: string; area?: string; lat: number; lng: number }[],
      polyline: routePolyline(s),
      distanceKm: s.distanceKm, durationMin: s.durationMin,
    },
    cargo: { category: s.cargoCategory, load: s.cargoLoad, helpers: s.helpers, special: JSON.parse(s.specialHandling || "[]"), notes: s.notes, items: s.items.map((i) => ({ name: i.name, qty: i.qty, weightKg: i.weightKg })) },
    vehicle: s.vehicle ? { id: s.vehicle.id, make: s.vehicle.make, model: s.vehicle.model, registration: s.vehicle.registration, bodyType: s.vehicle.bodyType, capacityKg: s.vehicle.capacityKg } : null,
    category: { key: s.category.key, name: s.category.name, capacityKg: s.category.capacityKg, bodyType: s.category.bodyType },
    driver: s.driver && s.driver.user ? { id: s.driver.id, name: s.driver.user.name, rating: s.driver.rating, trips: s.driver.tripsCompleted, phone: s.driver.user.phone, licenceClass: s.driver.licenceClass, initials: s.driver.user.name.split(" ").slice(0, 2).map((w) => w[0]).join("") } : null,
    customer: { id: s.customer.id, name: s.customer.name, phone: s.customer.phone, business: s.customer.accountType === "BUSINESS" ? s.customer.businessName : null },
    fare: { base: s.fareBase, distance: s.fareDistance, duration: s.fareDuration, loading: s.fareLoading, stops: s.fareStops, night: s.fareNight, schedule: s.fareSchedule, platform: s.farePlatform, discount: s.fareDiscount, promoCode: s.promoCode, total: s.fareTotal, driverEarnings: s.driverEarnings, commission: s.commission, returnLoad: !!s.returnLoadId },
    pricingMode: s.pricingMode,
    payment: { method: s.paymentMethod, status: s.paymentStatus, ref: s.paymentRef, paidAt: s.paidAt?.toISOString() ?? null },
    pod: s.podVerifiedAt ? { recipient: s.podRecipient, verifiedAt: s.podVerifiedAt.toISOString(), lat: s.podLat, lng: s.podLng, photo: s.podPhotoTaken } : null,
    cancelledBy: s.cancelledBy, cancelReason: s.cancelReason,
    events: s.events.map((e) => ({ id: e.id, type: e.type, label: e.label, actor: e.actor, lat: e.lat, lng: e.lng, at: e.createdAt.toISOString() })),
    quotes: s.quotes?.map((q) => {
      const v = q.driver?.vehicles?.find((x) => x.categoryId === s.categoryId) ?? q.driver?.vehicles?.[0] ?? null;
      return { id: q.id, driverId: q.driverId, amount: q.amount, etaText: q.etaText, message: q.message, status: q.status, expiresAt: q.expiresAt.toISOString(), driver: q.driver?.user ? { name: q.driver.user.name, rating: q.driver.rating, trips: q.driver.tripsCompleted } : null, vehicle: v ? { make: v.make, model: v.model, registration: v.registration } : null };
    }) ?? [],
    messages: s.messages?.map((m) => ({ id: m.id, senderRole: m.senderRole, body: m.body, at: m.createdAt.toISOString() })) ?? [],
    ratings: s.ratings.map((r) => ({ byRole: r.byRole, stars: r.stars, tags: JSON.parse(r.tags || "[]"), comment: r.comment })),
    live,
  };
}

export type ShipmentDTO = ReturnType<typeof shipmentDTO>;

// helpers used by admin live map
export async function activeShipments() {
  const rows = await db.shipment.findMany({
    where: { status: { in: ["MATCHING", "DRIVER_ASSIGNED", "DRIVER_EN_ROUTE", "DRIVER_ARRIVED", "LOADING", "LOADED", "IN_TRANSIT", "ARRIVING", "DELIVERED", "POD_CONFIRMED"] } },
    include: { category: true, vehicle: true, driver: { include: { user: true } }, customer: true, items: true, events: { orderBy: { createdAt: "asc" } }, ratings: true, quotes: { include: { driver: { include: { user: true, vehicles: true } } } }, messages: { orderBy: { createdAt: "asc" } } },
    orderBy: { createdAt: "desc" },
  });
  return rows.map((r) => shipmentDTO(r));
}
