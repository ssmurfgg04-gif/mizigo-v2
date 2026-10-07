// MIZIGO — Seed. Believable Kenyan demo data: drivers, vehicles, categories,
// zones, places, historical shipments with event chains, ratings, payouts.
// Idempotent: skips if already seeded.

import { db } from "./db";
import { PLACES } from "./geo";
import { shareToken, shipmentCode, mpesaRef } from "./format";
import { hashToken } from "./tokens";

const H = 3600_000, M = 60_000, D = 24 * H;
const ago = (ms: number) => new Date(Date.now() - ms);

export async function isSeeded(): Promise<boolean> {
  const n = await db.vehicleCategory.count();
  return n > 0;
}

export async function ensureSeed(): Promise<void> {
  if (await isSeeded()) return;
  await seedAll();
}

export async function seedAll(): Promise<void> {
  // wipe (dev convenience)
  await db.$transaction([
    db.shipmentEvent.deleteMany(), db.shipmentItem.deleteMany(), db.quote.deleteMany(), db.chatMessage.deleteMany(),
    db.paymentEvent.deleteMany(), db.rating.deleteMany(), db.dispute.deleteMany(),
    db.payout.deleteMany(), db.notification.deleteMany(), db.savedPlace.deleteMany(),
    db.auditLog.deleteMany(), db.shipment.deleteMany(), db.vehicle.deleteMany(),
    db.driver.deleteMany(), db.user.deleteMany(), db.vehicleCategory.deleteMany(),
    db.pricingZone.deleteMany(), db.place.deleteMany(), db.promoCode.deleteMany(), db.platformSetting.deleteMany(),
    db.returnLoad.deleteMany(),
  ]);

  // ── Vehicle categories (rates calibrated against Oct 2026 Nairobi broker /
  // listing benchmarks — see docs/research/KENYA_MARKET_PLAYBOOK.md §11; admin-editable) ──
  const catDefs = [
    { key: "boda", name: "Boda boda", description: "Motorbike courier for parcels and small loads", capacityKg: 60, volumeM3: 0.3, bodyType: "open", lengthM: 1.1, widthM: 0.7, heightM: 0.8, baseFare: 60, perKmRate: 20, perMinRate: 1, minimumFare: 120, loadingFee: 50, extraStopFee: 50, sortOrder: 0, supportedCargo: ["household", "retail", "farm", "other"] },
    { key: "tuktuk", name: "Tuk-tuk", description: "Best for small cargo around town", capacityKg: 300, volumeM3: 1.2, bodyType: "open", lengthM: 1.6, widthM: 1.3, heightM: 1.2, baseFare: 250, perKmRate: 55, perMinRate: 2, minimumFare: 500, loadingFee: 150, extraStopFee: 100, sortOrder: 1, supportedCargo: ["household", "retail", "other"] },
    { key: "van", name: "Van", description: "Covered van for protected loads", capacityKg: 800, volumeM3: 4.5, bodyType: "covered", lengthM: 2.4, widthM: 1.5, heightM: 1.5, baseFare: 400, perKmRate: 75, perMinRate: 3, minimumFare: 700, loadingFee: 250, extraStopFee: 200, sortOrder: 2, supportedCargo: ["household", "retail", "electronics", "farm", "other"] },
    { key: "pickup", name: "Pickup", description: "Best for furniture and small business loads", capacityKg: 1000, volumeM3: 5.8, bodyType: "open", lengthM: 2.3, widthM: 1.6, heightM: 0.6, baseFare: 500, perKmRate: 90, perMinRate: 3, minimumFare: 2200, loadingFee: 300, extraStopFee: 250, sortOrder: 3, supportedCargo: ["furniture", "appliances", "household", "retail", "construction", "farm", "electronics", "machinery", "other"] },
    { key: "canter", name: "Canter", description: "3.5T for serious shop and site loads", capacityKg: 3500, volumeM3: 14, bodyType: "open", lengthM: 4.3, widthM: 2.0, heightM: 1.2, baseFare: 1500, perKmRate: 200, perMinRate: 5, minimumFare: 6500, loadingFee: 600, extraStopFee: 500, sortOrder: 4, supportedCargo: ["furniture", "construction", "retail", "farm", "machinery", "other"] },
    { key: "lorry_7t", name: "7-Tonne Lorry", description: "For bulk commercial cargo", capacityKg: 7000, volumeM3: 26, bodyType: "covered", lengthM: 5.5, widthM: 2.2, heightM: 2.0, baseFare: 2800, perKmRate: 190, perMinRate: 7, minimumFare: 9500, loadingFee: 1000, extraStopFee: 800, sortOrder: 5, supportedCargo: ["construction", "retail", "farm", "machinery", "other"] },
    { key: "lorry_10t", name: "10-Tonne Lorry", description: "Large commercial and inter-town loads", capacityKg: 10000, volumeM3: 38, bodyType: "covered", lengthM: 6.5, widthM: 2.3, heightM: 2.2, baseFare: 4200, perKmRate: 240, perMinRate: 9, minimumFare: 15000, loadingFee: 1500, extraStopFee: 1200, sortOrder: 6, supportedCargo: ["construction", "retail", "farm", "machinery", "other"] },
  ];
  // Deterministic ids: every serverless instance seeds the SAME ids, so a
  // session cookie minted on one instance validates on any other (sandbox
  // mode runs per-instance /tmp SQLite — see docs/NETLIFY_PRODUCTION.md).
  const cats = await Promise.all(catDefs.map(({ supportedCargo, ...c }) => db.vehicleCategory.create({ data: { id: `seed-cat-${c.key}`, ...c, supportedCargo: JSON.stringify(supportedCargo) } })));
  const CAT = Object.fromEntries(cats.map((c) => [c.key, c]));

  // ── Pricing zone ──
  await db.pricingZone.create({
    data: { id: "seed-zone-nairobi", key: "nairobi", name: "Nairobi", basePrice: 500, pricePerKm: 90, pricePerMin: 3, minimumPrice: 900, waitingRateMin: 10, loadingFee: 300, extraStopFee: 250, peakMultiplier: 1.25, nightMultiplier: 1.12, scheduledDiscount: 0.05, platformFee: 100, commissionRate: 0.15, active: true },
  });

  // ── Places ──
  await db.place.createMany({ data: PLACES.map(({ name, area, category, lat, lng, popular }) => ({ name, area, category, lat, lng, popular: !!popular })) });

  // ── People ──
  const customer = await db.user.create({ data: { id: "seed-user-john", phone: "0712000001", email: "customer@mizigo.demo", name: "John Kariuki", role: "CUSTOMER", accountType: "PERSONAL", avatarSeed: "john", rating: 4.9, verified: true } });
  const bizUser = await db.user.create({ data: { id: "seed-user-zainab", phone: "0722000033", email: "business@mizigo.demo", name: "Zainab Mabuyu", role: "CUSTOMER", accountType: "BUSINESS", businessName: "ABC Traders Ltd", avatarSeed: "zainab", rating: 4.8, verified: true } });
  const admin = await db.user.create({ data: { id: "seed-user-ops", phone: "0733000011", email: "admin@mizigo.demo", name: "Ops Control", role: "ADMIN", accountType: "PERSONAL", avatarSeed: "ops", verified: true } });

  const driverDefs = [
    { phone: "0712000002", email: "driver@mizigo.demo", name: "Peter Kamau", status: "OFFLINE", rating: 4.9, tripsCompleted: 438, acceptanceRate: 0.96, onTimePickup: 0.94, onTimeDelivery: 0.97, cancellationRate: 0.012, incidents: 0, lat: -1.2630, lng: 36.8050, vehicle: { make: "Toyota", model: "Dyna", registration: "KDA 123X", category: "pickup", capacityKg: 1000 }, licenceExpiry: ago(-400 * D) },
    { phone: "0722000044", name: "Amina Wanjiku", status: "ONLINE", rating: 4.8, tripsCompleted: 291, acceptanceRate: 0.93, onTimePickup: 0.91, onTimeDelivery: 0.95, cancellationRate: 0.02, incidents: 0, lat: -1.2930, lng: 36.7840, vehicle: { make: "Isuzu", model: "Canter 3.5T", registration: "KDG 456Y", category: "canter", capacityKg: 3500 }, licenceExpiry: ago(-300 * D) },
    { phone: "0733000055", name: "Brian Mwangi", status: "ONLINE", rating: 4.7, tripsCompleted: 176, acceptanceRate: 0.9, onTimePickup: 0.89, onTimeDelivery: 0.93, cancellationRate: 0.03, incidents: 1, lat: -1.3080, lng: 36.8330, vehicle: { make: "Toyota", model: "Hilux", registration: "KCY 789B", category: "pickup", capacityKg: 1000 }, licenceExpiry: ago(-200 * D) },
    { phone: "0744000066", name: "Kevin Otieno", status: "ONLINE", rating: 4.8, tripsCompleted: 122, acceptanceRate: 0.92, onTimePickup: 0.93, onTimeDelivery: 0.91, cancellationRate: 0.025, incidents: 0, lat: -1.2840, lng: 36.8330, vehicle: { make: "Piaggio", model: "Tuk-tuk", registration: "KCT 234M", category: "tuktuk", capacityKg: 300 }, licenceExpiry: ago(-250 * D) },
    { phone: "0755000077", name: "James Mutua", status: "ONLINE", rating: 4.9, tripsCompleted: 502, acceptanceRate: 0.97, onTimePickup: 0.96, onTimeDelivery: 0.97, cancellationRate: 0.01, incidents: 0, lat: -1.3155, lng: 36.8230, vehicle: { make: "Mitsubishi", model: "Fuso 7T", registration: "KBX 567K", category: "lorry_7t", capacityKg: 7000 }, licenceExpiry: ago(-500 * D) },
    { phone: "0766000088", name: "Faith Chebet", status: "ONLINE", rating: 4.6, tripsCompleted: 88, acceptanceRate: 0.88, onTimePickup: 0.9, onTimeDelivery: 0.88, cancellationRate: 0.04, incidents: 0, lat: -1.2613, lng: 36.8027, vehicle: { make: "Nissan", model: "Vanette", registration: "KCF 890L", category: "van", capacityKg: 800 }, licenceExpiry: ago(-150 * D) },
    { phone: "0777000099", email: "samuel@mizigo.demo", name: "Samuel Kiprop", status: "ONLINE", rating: 4.8, tripsCompleted: 341, acceptanceRate: 0.94, onTimePickup: 0.95, onTimeDelivery: 0.96, cancellationRate: 0.015, incidents: 0, lat: -1.2990, lng: 36.8760, vehicle: { make: "Isuzu", model: "FVR 10T", registration: "KCA 234N", category: "lorry_10t", capacityKg: 10000 }, licenceExpiry: ago(-350 * D) },
    { phone: "0788000010", name: "Evans Ochieng", status: "ONLINE", rating: 4.7, tripsCompleted: 254, acceptanceRate: 0.95, onTimePickup: 0.92, onTimeDelivery: 0.9, cancellationRate: 0.02, incidents: 0, lat: -1.2860, lng: 36.8220, vehicle: { make: "Boxer", model: "Boda 125", registration: "KMD 345P", category: "boda", capacityKg: 60 }, licenceExpiry: ago(-180 * D) },
  ];
  const drivers = await Promise.all(driverDefs.map(async (d, i) => {
    const u = await db.user.create({ data: { id: `seed-user-d${i + 1}`, phone: d.phone, email: d.email, name: d.name, role: "DRIVER", accountType: "PERSONAL", avatarSeed: d.name.split(" ")[0].toLowerCase(), rating: d.rating, verified: true } });
    return db.driver.create({ data: { id: `seed-driver-d${i + 1}`, userId: u.id, status: d.status, rating: d.rating, tripsCompleted: d.tripsCompleted, acceptanceRate: d.acceptanceRate, onTimePickup: d.onTimePickup, onTimeDelivery: d.onTimeDelivery, cancellationRate: d.cancellationRate, incidents: d.incidents, lat: d.lat, lng: d.lng, licenceClass: "BCE", licenceExpiry: d.licenceExpiry, verification: "VERIFIED", lastPingAt: ago(2 * M), onlineMinutes: 320 } });
  }));
  const DRV = Object.fromEntries(drivers.map((d) => [d.id, d]));

  const vehicles = await Promise.all(driverDefs.map((d, i) =>
    db.vehicle.create({ data: { id: `seed-vehicle-d${i + 1}`, driverId: drivers[i].id, categoryId: CAT[d.vehicle.category].id, make: d.vehicle.make, model: d.vehicle.model, registration: d.vehicle.registration, bodyType: CAT[d.vehicle.category].bodyType, capacityKg: d.vehicle.capacityKg, docRegistration: "VERIFIED", docInsurance: "VERIFIED", docInspection: "VERIFIED", insuranceExpiry: ago(-90 * D), inspectionExpiry: ago(-180 * D), active: true } })
  ));

  // Peter's second vehicle? no — one per driver is fine.
  const peter = drivers[0];

  // ── Saved places for the demo customer ──
  await db.savedPlace.createMany({
    data: [
      { userId: customer.id, label: "Home", name: "Kilimani Wood Avenue", area: "Kilimani", lat: -1.2900, lng: 36.7830 },
      { userId: customer.id, label: "Shop", name: "ABC Industrial Area Godown 47", area: "Industrial Area", lat: -1.3080, lng: 36.8330 },
    ],
  });

  // ── Historical shipments (event chains + ratings + payments) ──
  interface HistSpec {
    customer: string; status: string; catKey: string; driverIdx: number;
    pickupName: string; pickupArea: string; pLat: number; pLng: number;
    dropName: string; dropArea: string; dLat: number; dLng: number;
    dist: number; dur: number; total: number; driverEarn: number; commission: number;
    items: { name: string; qty: number; weightKg?: number }[]; cargo: string; helpers?: number;
    hoursAgo: number; rating?: number; cancelled?: boolean;
  }

  const hist: HistSpec[] = [
    { customer: customer.id, status: "COMPLETED", catKey: "pickup", driverIdx: 0, pickupName: "ABC Industrial Area Godown 47", pickupArea: "Industrial Area", pLat: -1.3080, pLng: 36.8330, dropName: "Riverside Drive, Westlands", dropArea: "Westlands", dLat: -1.2670, dLng: 36.8010, dist: 9.2, dur: 34, total: 4850, driverEarn: 4023, commission: 728, items: [{ name: "Sofa", qty: 2, weightKg: 60 }, { name: "Dining table", qty: 1, weightKg: 45 }, { name: "Boxes", qty: 6, weightKg: 20 }], cargo: "furniture", helpers: 1, hoursAgo: 26, rating: 5 },
    { customer: customer.id, status: "COMPLETED", catKey: "tuktuk", driverIdx: 3, pickupName: "Gikomba Market", pickupArea: "CBD East", pLat: -1.2841, pLng: 36.8329, dropName: "Kawangware Market", dropArea: "Kawangware", dLat: -1.2862, dLng: 36.7528, dist: 8.4, dur: 32, total: 1420, driverEarn: 1107, commission: 213, items: [{ name: "Bales", qty: 3, weightKg: 45 }], cargo: "retail", hoursAgo: 74, rating: 4 },
    { customer: bizUser.id, status: "COMPLETED", catKey: "canter", driverIdx: 1, pickupName: "Mombasa Road Godowns", pickupArea: "Industrial Area", pLat: -1.3120, pLng: 36.8420, dropName: "Garden City Mall", dropArea: "Thika Road", dLat: -1.2267, dLng: 36.8889, dist: 15.8, dur: 47, total: 9750, driverEarn: 8188, commission: 1462, items: [{ name: "Cartons of stock", qty: 48, weightKg: 22 }], cargo: "retail", helpers: 2, hoursAgo: 98, rating: 5 },
    { customer: customer.id, status: "COMPLETED", catKey: "pickup", driverIdx: 0, pickupName: "Sarit Centre", pickupArea: "Westlands", pLat: -1.2613, pLng: 36.8027, dropName: "Yaya Centre", dropArea: "Kilimani", dLat: -1.2921, dLng: 36.7859, dist: 7.1, dur: 26, total: 3210, driverEarn: 2629, commission: 482, items: [{ name: "Fridge", qty: 1, weightKg: 70 }, { name: "Boxes", qty: 4, weightKg: 15 }], cargo: "appliances", hoursAgo: 52, rating: 5 },
    { customer: customer.id, status: "CANCELLED", catKey: "van", driverIdx: 5, pickupName: "CBD · Kenyatta Avenue", pickupArea: "Nairobi CBD", pLat: -1.2841, pLng: 36.8265, dropName: "Karen Hardy Shopping Centre", dropArea: "Karen", dLat: -1.3197, dLng: 36.7076, dist: 19.3, dur: 52, total: 6480, driverEarn: 5458, commission: 972, items: [{ name: "Suitcases", qty: 5, weightKg: 18 }], cargo: "household", hoursAgo: 120, cancelled: true },
    { customer: customer.id, status: "COMPLETED", catKey: "pickup", driverIdx: 2, pickupName: "Toi Market", pickupArea: "Kibera Drive", pLat: -1.2970, pLng: 36.7790, dropName: "Kileleshwa Laikipia Road", dropArea: "Kileleshwa", dLat: -1.2734, dLng: 36.7827, dist: 4.2, dur: 18, total: 1980, driverEarn: 1583, commission: 297, items: [{ name: "Carpet", qty: 1, weightKg: 25 }, { name: "Buckets", qty: 6, weightKg: 4 }], cargo: "household", hoursAgo: 6, rating: 4 },
    // Peter's week (earnings chart): one more yesterday + two today
    { customer: bizUser.id, status: "COMPLETED", catKey: "pickup", driverIdx: 0, pickupName: "ABC Industrial Area Godown 47", pickupArea: "Industrial Area", pLat: -1.3080, pLng: 36.8330, dropName: "South B Shopping Centre", dropArea: "South B", dLat: -1.3100, dLng: 36.8350, dist: 5.6, dur: 22, total: 2890, driverEarn: 2357, commission: 434, items: [{ name: "Cartons of stock", qty: 12, weightKg: 20 }], cargo: "retail", hoursAgo: 8, rating: 5 },
    { customer: bizUser.id, status: "COMPLETED", catKey: "pickup", driverIdx: 0, pickupName: "Mombasa Road Godowns", pickupArea: "Industrial Area", pLat: -1.3120, pLng: 36.8420, dropName: "Buru Buru Phase 1", dropArea: "Buru Buru", dLat: -1.2990, dLng: 36.8760, dist: 8.9, dur: 30, total: 3560, driverEarn: 2926, commission: 534, items: [{ name: "Drink crates", qty: 30, weightKg: 14 }], cargo: "retail", hoursAgo: 3, rating: 5 },
  ];

  for (const [hi, h] of hist.entries()) {
    const code = shipmentCode();
    const created = ago(h.hoursAgo * H);
    const cat = CAT[h.catKey];
    const s = await db.shipment.create({
      data: {
        id: `seed-ship-h${hi}`, code, shareToken: hashToken(shareToken()), customerId: h.customer, status: h.status,
        stateEnteredAt: ago((h.hoursAgo - 2) * H), createdAt: created, updatedAt: ago((h.hoursAgo - 2) * H),
        pickupName: h.pickupName, pickupArea: h.pickupArea, pickupLat: h.pLat, pickupLng: h.pLng,
        dropoffName: h.dropName, dropoffArea: h.dropArea, dropoffLat: h.dLat, dropoffLng: h.dLng,
        distanceKm: h.dist, durationMin: h.dur,
        cargoCategory: h.cargo, cargoLoad: "MEDIUM", helpers: h.helpers ?? 0,
        categoryId: cat.id, vehicleId: vehicles[h.driverIdx].id, driverId: drivers[h.driverIdx].id,
        fareBase: cat.baseFare, fareDistance: Math.round(cat.perKmRate * h.dist), fareDuration: Math.round(cat.perMinRate * h.dur),
        fareLoading: h.helpers ? cat.loadingFee * h.helpers : 0, fareStops: 0, farePlatform: 100,
        fareTotal: h.total, driverEarnings: h.driverEarn, commission: h.commission,
        paymentMethod: "MPESA", paymentStatus: h.cancelled ? "REFUNDED" : "CONFIRMED",
        paymentRef: mpesaRef(), paidAt: h.cancelled ? null : ago((h.hoursAgo - 2.5) * H),
        podRecipient: h.cancelled ? null : "Mary Wanjiru", podVerifiedAt: h.cancelled ? null : ago((h.hoursAgo - 2) * H),
        podLat: h.cancelled ? null : h.dLat, podLng: h.cancelled ? null : h.dLng,
        cancelledBy: h.cancelled ? "CUSTOMER" : null, cancelReason: h.cancelled ? "Changed my mind" : null,
        items: { create: h.items.map((i) => ({ name: i.name, qty: i.qty, weightKg: i.weightKg ?? 0 })) },
      },
    });

    const evs: { type: string; label: string; mins: number; actor: string }[] = [
      { type: "BOOKING_CREATED", label: "Booking created", mins: 150, actor: "CUSTOMER" },
      { type: "PAYMENT_CONFIRMED", label: "Payment confirmed · M-PESA", mins: 149, actor: "SYSTEM" },
      { type: "DRIVER_ASSIGNED", label: `Driver assigned · ${driverDefs[h.driverIdx].name}`, mins: 148, actor: "SYSTEM" },
    ];
    if (!h.cancelled) {
      evs.push(
        { type: "DRIVER_ARRIVED", label: "Driver arrived at pickup", mins: 132, actor: "DRIVER" },
        { type: "CARGO_LOADED", label: "Cargo loaded and verified", mins: 126, actor: "DRIVER" },
        { type: "TRIP_STARTED", label: "Delivery started", mins: 124, actor: "DRIVER" },
        { type: "POD_CONFIRMED", label: "Recipient confirmed delivery · OTP verified", mins: 120, actor: "DRIVER" },
        { type: "COMPLETED", label: "Delivery completed · receipt ready", mins: 120, actor: "SYSTEM" },
      );
    } else {
      evs.push({ type: "CANCELLED", label: "Cancelled by customer · payment refunded", mins: 140, actor: "CUSTOMER" });
    }
    await db.shipmentEvent.createMany({
      data: evs.map((e) => ({ shipmentId: s.id, type: e.type, label: e.label, actor: e.actor, createdAt: ago(h.hoursAgo * H + e.mins * M), lat: e.type === "DRIVER_ARRIVED" ? h.pLat : e.type === "POD_CONFIRMED" ? h.dLat : null, lng: e.type === "DRIVER_ARRIVED" ? h.pLng : e.type === "POD_CONFIRMED" ? h.dLng : null })),
    });

    if (!h.cancelled && h.rating) {
      await db.rating.create({ data: { shipmentId: s.id, byRole: "CUSTOMER", stars: h.rating, tags: JSON.stringify(h.rating >= 5 ? ["Arrived on time", "Careful with cargo"] : ["Good communication"]), createdAt: ago((h.hoursAgo - 2) * H) } });
      await db.paymentEvent.create({ data: { shipmentId: s.id, checkoutReqId: `ws_CO_${s.code}`, method: "MPESA", amount: h.total, status: "CONFIRMED", mpesaReceipt: mpesaRef(), createdAt: ago((h.hoursAgo - 2.4) * H) } });
    }
  }

  // ── Platform settings (admin-editable, plan §34/§41) ──
  await db.platformSetting.createMany({
    data: [
      { key: "advanceBookingDays", value: "14" },   // how far ahead scheduled bookings are allowed
      { key: "autoDispatch", value: "true" },        // false → MATCHING waits for manual dispatch
      { key: "quoteExpiryMinutes", value: "60" },    // quote marketplace expiry
      { key: "supportPhone", value: "0800 724 343" },
      { key: "cancellationFeeKes", value: "200" },   // Uber pattern: fee after the grace window (docs/UBER_BOLT_TEARDOWN.md §3.11)
      { key: "cancelGraceMinutes", value: "2" },     // free cancel within 2 min of driver acceptance
    ],
  });

  // ── Demo promo codes (plan §75) ──
  await db.promoCode.createMany({
    data: [
      { code: "WELCOME500", kind: "FLAT", value: 500, minFare: 1500, firstBookingOnly: true, active: true, expiresAt: ago(-60 * D) },
      { code: "BIZ10", kind: "PERCENT", value: 10, minFare: 3000, businessOnly: true, active: true, expiresAt: ago(-90 * D) },
      { code: "MOVE200", kind: "FLAT", value: 200, minFare: 1000, active: true, expiresAt: ago(-30 * D) },
      { code: "RAMADHAN", kind: "PERCENT", value: 15, minFare: 2000, active: false, expiresAt: ago(10 * D) },
    ],
  });

  // ── Driver payouts (withdrawal history) ──
  await db.payout.createMany({
    data: [
      { driverId: peter.id, amount: 4200, method: "MPESA", status: "PAID", ref: mpesaRef(), createdAt: ago(2 * D) },
      { driverId: peter.id, amount: 3500, method: "MPESA", status: "PAID", ref: mpesaRef(), createdAt: ago(4 * D) },
      { driverId: peter.id, amount: 2800, method: "MPESA", status: "PAID", ref: mpesaRef(), createdAt: ago(6 * D) },
    ],
  });

  // ── Return-load marketplace (v1 goodness: empty legs at a discount) ──
  // normalPriceKes mirrors the live tariff math for the same leg so the
  // savings badge is honest, not marketing.
  const soon = (h: number) => new Date(Date.now() + h * 3600_000);
  await db.returnLoad.createMany({
    data: [
      {
        driverId: drivers[1].id, // Amina · Canter 3.5T
        fromName: "Gikomba Market", fromArea: "CBD East", fromLat: -1.2841, fromLng: 36.8329,
        toName: "Runda Estate", toArea: "Runda", toLat: -1.2245, toLng: 36.7985,
        categoryKey: "canter", cargoNote: "Market stock", maxWeightKg: 2000,
        priceKes: 1900, normalPriceKes: 3300, status: "AVAILABLE", availableUntil: soon(5),
      },
      {
        driverId: drivers[4].id, // James · Fuso 7T
        fromName: "ABC Industrial Area Godown 47", fromArea: "Industrial Area", fromLat: -1.3080, fromLng: 36.8330,
        toName: "Karen Hardy Shopping Centre", toArea: "Karen", toLat: -1.3197, toLng: 36.7076,
        categoryKey: "lorry_7t", cargoNote: "Building materials", maxWeightKg: 4500,
        priceKes: 3900, normalPriceKes: 6500, status: "AVAILABLE", availableUntil: soon(8),
      },
      {
        driverId: drivers[3].id, // Kevin · Tuk-tuk
        fromName: "Wakulima Market", fromArea: "CBD", fromLat: -1.2830, fromLng: 36.8270,
        toName: "Donholm Phase 5", toArea: "Donholm", toLat: -1.2982, toLng: 36.8899,
        categoryKey: "tuktuk", cargoNote: "Farm produce", maxWeightKg: 250,
        priceKes: 550, normalPriceKes: 900, status: "AVAILABLE", availableUntil: soon(3),
      },
      {
        driverId: drivers[6].id, // Samuel · Isuzu FVR 10T
        fromName: "Sameer Business Park", fromArea: "Mombasa Road", fromLat: -1.3230, fromLng: 36.8750,
        toName: "Garden City Mall", toArea: "Thika Road", toLat: -1.2267, toLng: 36.8889,
        categoryKey: "lorry_10t", cargoNote: "Retail cartons", maxWeightKg: 7000,
        priceKes: 5600, normalPriceKes: 9400, status: "AVAILABLE", availableUntil: soon(10),
      },
    ],
  });

  // ── Notifications ──
  await db.notification.createMany({
    data: [
      { userId: customer.id, role: "CUSTOMER", title: "Your receipt is ready", body: "Delivery MZG completed. Tap to view your receipt.", shipmentCode: "recent", createdAt: ago(4 * H) },
      { userId: customer.id, role: "CUSTOMER", title: "Rate your driver", body: "How was your delivery with Peter K.?", createdAt: ago(4 * H) },
    ],
  });

  await db.auditLog.createMany({
    data: [
      { actor: "admin@mizigo.demo", action: "PRICING_ZONE_UPDATED", target: "zone:nairobi", detail: "Peak multiplier set to 1.25", createdAt: ago(3 * D) },
      { actor: "admin@mizigo.demo", action: "DRIVER_APPROVED", target: "driver:amina", detail: "Documents verified", createdAt: ago(9 * D) },
    ],
  });

  return;
}
