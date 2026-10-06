"use client";
// MIZIGO client types — mirrors of server DTOs (src/lib/shipments.ts)

export interface FareLine { key: string; label: string; amount: number }
export interface Fare {
  base: number; distance: number; duration: number; loading: number; stops: number; platform: number;
  total: number; minimumApplied: boolean; lines: FareLine[]; driverEarnings: number; commission: number;
  discount?: number; promoCode?: string | null;
}

export interface PlaceHit {
  name: string; area: string; category: string; lat: number; lng: number; popular?: boolean;
  source?: "search" | "saved"; label?: string;
}

export interface CategoryQuote {
  key: string; name: string; description: string; capacityKg: number; bodyType: string;
  dimensions: string; volumeM3: number; fare: Fare; etaMin: number; supply: number;
  recommended: boolean; fits: boolean; oversized: boolean;
}

export interface QuoteResponse {
  distanceKm: number; durationMin: number; weightKg: number; recommendedKey: string; peak: boolean;
  promo: { code: string; discount: number } | { code: string; error: string } | null;
  quotes: CategoryQuote[];
  nearby: { driverId: string; name: string; lat: number; lng: number; rating: number; vehicle: string; categoryKey: string; distanceKm: number }[];
}

export interface LivePosition {
  lat: number; lng: number; heading: number; progress: number; etaMin: number | null;
  leg: "TO_PICKUP" | "TO_DROPOFF" | "IDLE"; lastPingMin: number;
}

export interface ShipmentDTO {
  id: string; code: string; status: string;
  createdAt: string; stateEnteredAt: string; scheduledAt: string | null;
  route: {
    pickup: { name: string; area: string; lat: number; lng: number; note: string | null; contact: string | null; phone: string | null };
    dropoff: { name: string; area: string; lat: number; lng: number; note: string | null; contact: string | null; phone: string | null };
    stops: { name: string; area?: string; lat: number; lng: number }[];
    polyline: { lat: number; lng: number }[];
    distanceKm: number; durationMin: number;
  };
  cargo: { category: string; load: string; helpers: number; special: string[]; notes: string | null; items: { name: string; qty: number; weightKg: number }[] };
  vehicle: { id: string; make: string; model: string; registration: string; bodyType: string; capacityKg: number } | null;
  category: { key: string; name: string; capacityKg: number; bodyType: string };
  driver: { id: string; name: string; rating: number; trips: number; phone: string; licenceClass: string; initials: string } | null;
  customer: { id: string; name: string; phone: string; rating: number; business: string | null };
  fare: { base: number; distance: number; duration: number; loading: number; stops: number; night: number; schedule: number; platform: number; discount: number; promoCode: string | null; total: number; driverEarnings: number; commission: number; returnLoad: boolean };
  pricingMode: string;
  payment: { method: string; status: string; ref: string | null; paidAt: string | null };
  deliveryCode: string | null; // drop-off handshake shown to the customer
  pod: { recipient: string; verifiedAt: string; lat: number | null; lng: number | null; photo: boolean } | null;
  cancelledBy: string | null; cancelReason: string | null;
  events: { id: string; type: string; label: string; actor: string; lat: number | null; lng: number | null; at: string }[];
  quotes: { id: string; driverId: string; amount: number; etaText: string; message: string | null; status: string; expiresAt: string; driver: { name: string; rating: number; trips: number } | null; vehicle: { make: string; model: string; registration: string } | null }[];
  messages: { id: string; senderRole: string; body: string; at: string }[];
  ratings: { byRole: string; stars: number; tags: string[]; comment: string | null }[];
  live: LivePosition | null;
}

// Notification rows as served by /api/customer: each carries a derived kind
// (per-type icon + deep-link routing) and the linked shipment id when the code
// resolves to one of the customer's own deliveries.
export type NotificationKind = "status" | "rate" | "chat" | "promo" | "system";
export interface NotificationRow {
  id: string; title: string; body: string; createdAt: string; read: boolean;
  shipmentCode: string | null; shipmentId: string | null; kind: NotificationKind;
}

export interface CustomerHome {
  user: { id: string; name: string; phone: string; accountType: string; businessName: string | null; rating: number } | null;
  active: ShipmentDTO | null;
  trips: ShipmentDTO[];
  saved: { id: string; label: string; name: string; area: string; lat: number; lng: number }[];
  notifications: NotificationRow[];
  unread: number;
  invoices: { month: string; deliveries: number; net: number; vat: number; total: number }[];
  stats: { completed: number; spent: number };
}

export interface DriverHome {
  driver: {
    id: string; status: string; rating: number; trips: number; acceptanceRate: number;
    onTimePickup: number; onTimeDelivery: number; cancellationRate: number; incidents: number;
    verification: string; licenceClass: string; licenceExpiry: string | null; onlineMinutes: number;
    user: { id: string; name: string; phone: string; avatarSeed: string };
    vehicles: {
      id: string; make: string; model: string; registration: string; bodyType: string; capacityKg: number;
      category: string; categoryKey: string; docs: { registration: string; insurance: string; inspection: string };
      insuranceExpiry: string | null; inspectionExpiry: string | null;
    }[];
  };
  active: ShipmentDTO | null;
  history: ShipmentDTO[];
  quoteJobs: (ShipmentDTO & { quotedByMe: boolean; quoteCount: number })[];
  earnings: {
    today: number; week: number; month: number; todayTrips: number; avgPerTrip: number;
    chart: { day: string; earnings: number; trips: number }[];
    wallet: number;
    payouts: { id: string; amount: number; status: string; createdAt: string; ref: string | null }[];
    grossFares: number; commission: number;
  };
  demand: { name: string; level: string }[];
  returnLoads?: {
    id: string; fromName: string; fromArea: string; toName: string; toArea: string;
    categoryKey: string; cargoNote: string; maxWeightKg: number; priceKes: number;
    normalPriceKes: number; status: string; availableUntil: string | null; createdAt: string;
  }[];
  notifications: { id: string; title: string; body: string; createdAt: string }[];
}

export interface AdminOverview {
  kpis: {
    activeDeliveries: number; todayBookings: number; revenueToday: number; platformEarningsToday: number;
    onlineDrivers: number; busyDrivers: number; totalDrivers: number; totalVehicles: number;
    cancellationRate: number; avgDeliveryTime: number; completedTotal: number; pendingDisputes: number;
    returnLoadsLive: number; returnLoadsAvgDiscount: number;
  };
  live: ShipmentDTO[];
  drivers: { id: string; name: string; status: string; rating: number; trips: number; verification: string; lat: number; lng: number; vehicle: string | null; registration: string | null; category: string | null }[];
  payments: { id: string; checkoutReqId: string; method: string; amount: number; status: string; mpesaReceipt: string | null; createdAt: string }[];
}

export interface Bootstrap {
  categories: { id: string; key: string; name: string; description: string; capacityKg: number; baseFare: number; perKmRate: number; perMinRate: number; minimumFare: number; loadingFee: number; extraStopFee: number }[];
  zone: { id: string; key: string; name: string; platformFee: number; commissionRate: number; peakMultiplier: number } | null;
  demo: Record<string, { email?: string; phone?: string; name: string; business?: string }>;
}
