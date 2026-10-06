// MIZIGO — Pricing engine. All rates come from the DB (PricingZone + VehicleCategory).
// Nothing is hard-coded: the admin can edit every input and the next quote picks it up.

import type { VehicleCategory, PricingZone } from "@prisma/client";
import { computeFareRust, withinRustContract } from "@/lib/rust-engine";

export interface QuoteInput {
  distanceKm: number;
  durationMin: number;
  helpers: number; // loading assistance
  extraStops: number;
  peak?: boolean;
  night?: boolean; // v1: night transport (19:00–06:00) carries a surcharge
  scheduled?: boolean; // v1: planned loads cost less than instant ones
}

export interface FareLine { key: string; label: string; amount: number }
export interface Fare {
  base: number; distance: number; duration: number; loading: number; stops: number; night: number; schedule: number; platform: number;
  total: number; minimumApplied: boolean;
  lines: FareLine[];
  driverEarnings: number; commission: number;
}

export function isNightHour(d: Date): boolean {
  const h = d.getHours();
  return h >= 19 || h < 6;
}

// Money-path multiplier helper: floats from the DB (≤3 decimals by contract)
// become permille integers for the Rust core (1120 = ×1.12).
const permille = (x: number) => Math.round(x * 1000);

export function priceFor(category: Pick<VehicleCategory, "baseFare" | "perKmRate" | "perMinRate" | "minimumFare" | "loadingFee" | "extraStopFee">, zone: Pick<PricingZone, "platformFee" | "commissionRate" | "peakMultiplier" | "nightMultiplier" | "scheduledDiscount">, input: QuoteInput): Fare {
  // Money path: prefer the Rust/WASM core (bit-exact port — see rust/ +
  // tests/rust/parity.test.ts) and fall back to the TypeScript reference
  // implementation below whenever the wasm is unavailable or the input is
  // outside the documented bit-exact contract. Both paths produce identical
  // results by construction; the parity suite proves it on every push.
  if (withinRustContract(input)) {
    const rust = computeFareRust({
      baseFare: category.baseFare * 100,
      perKm: category.perKmRate * 100,
      perMin: category.perMinRate * 100,
      loadingFee: category.loadingFee * 100,
      helperFee: 0, // TS has no second helper fee — ABI contract keeps it 0
      stopFee: category.extraStopFee * 100,
      platformFee: zone.platformFee * 100,
      minimumFare: category.minimumFare * 100,
      distanceM: Math.round(input.distanceKm * 1000),
      durationMin: input.durationMin,
      helpers: input.helpers,
      extraStops: input.extraStops,
      nightPermille: input.night ? permille(zone.nightMultiplier ?? 1.12) : 1000,
      schedulePermille: input.scheduled ? permille(1 - (zone.scheduledDiscount ?? 0.05)) : 1000,
      discountPermille: 0, // promos are applied by the quote route, not the engine
      commissionPermille: permille(zone.commissionRate),
      peakPermille: input.peak ? permille(zone.peakMultiplier) : 1000,
    });
    if (rust) {
      const K = (minor: number) => minor / 100; // minor units → whole KES (exact: every component is ×100)
      const base = K(rust.base), distance = K(rust.distance), duration = K(rust.duration);
      const loading = K(rust.loading), stops = K(rust.stops), night = K(rust.night);
      const schedule = K(rust.schedule), platform = K(rust.platform);
      const total = K(rust.total), commission = K(rust.commission), driverEarnings = K(rust.driverEarnings);
      const nightMult = input.night ? (zone.nightMultiplier ?? 1.12) : 1;
      const lines: FareLine[] = [
        { key: "base", label: "Base transport", amount: base },
        { key: "distance", label: `Distance · ${input.distanceKm.toFixed(1)} km`, amount: distance },
        { key: "duration", label: "Time on road", amount: duration },
      ];
      if (loading > 0) lines.push({ key: "loading", label: `Loading assistance × ${input.helpers}`, amount: loading });
      if (stops > 0) lines.push({ key: "stops", label: `Extra stops × ${input.extraStops}`, amount: stops });
      if (night > 0) lines.push({ key: "night", label: `Night transport × ${nightMult.toFixed(2)}`, amount: night });
      if (schedule > 0) lines.push({ key: "schedule", label: "Planned delivery discount", amount: -schedule });
      lines.push({ key: "platform", label: "Platform fee", amount: platform });
      if (rust.minimumApplied) lines.push({ key: "minimum", label: "Minimum fare applied", amount: 0 });
      return { base, distance, duration, loading, stops, night, schedule, platform, total, minimumApplied: rust.minimumApplied, lines, driverEarnings, commission };
    }
  }
  const peak = input.peak ? zone.peakMultiplier : 1;
  const base = Math.round(category.baseFare * peak);
  const distance = Math.round(category.perKmRate * input.distanceKm);
  const duration = Math.round(category.perMinRate * input.durationMin);
  const loading = input.helpers > 0 ? category.loadingFee * input.helpers : 0;
  const stops = input.extraStops > 0 ? category.extraStopFee * input.extraStops : 0;
  const nightMult = input.night ? (zone.nightMultiplier ?? 1.12) : 1;
  const night = Math.round((base + distance + duration) * (nightMult - 1));
  const schedule = input.scheduled ? Math.round((base + distance + duration) * (zone.scheduledDiscount ?? 0.05)) : 0;
  const platform = zone.platformFee;
  let subtotal = base + distance + duration + loading + stops + platform + night - schedule;
  const minimumApplied = subtotal < category.minimumFare;
  if (minimumApplied) subtotal = category.minimumFare;
  const total = subtotal;
  const commission = Math.round(total * zone.commissionRate);
  const driverEarnings = total - platform - commission;

  const lines: FareLine[] = [
    { key: "base", label: "Base transport", amount: base },
    { key: "distance", label: `Distance · ${input.distanceKm.toFixed(1)} km`, amount: distance },
    { key: "duration", label: "Time on road", amount: duration },
  ];
  if (loading > 0) lines.push({ key: "loading", label: `Loading assistance × ${input.helpers}`, amount: loading });
  if (stops > 0) lines.push({ key: "stops", label: `Extra stops × ${input.extraStops}`, amount: stops });
  if (night > 0) lines.push({ key: "night", label: `Night transport × ${nightMult.toFixed(2)}`, amount: night });
  if (schedule > 0) lines.push({ key: "schedule", label: "Planned delivery discount", amount: -schedule });
  lines.push({ key: "platform", label: "Platform fee", amount: platform });
  if (minimumApplied) lines.push({ key: "minimum", label: "Minimum fare applied", amount: 0 });

  return { base, distance, duration, loading, stops, night, schedule, platform, total, minimumApplied, lines, driverEarnings, commission };
}

// Cargo volume model for the recommendation engine
export interface CargoItem { name: string; qty: number; weightKg?: number }
export const CARGO_CATEGORIES = [
  { key: "furniture", label: "Furniture", items: ["Sofa", "Dining table", "Bed", "Mattress", "Wardrobe", "Chairs", "Coffee table", "Bookshelf"] },
  { key: "appliances", label: "Appliances", items: ["Fridge", "Cooker", "Washing machine", "TV", "Microwave", "Water dispenser"] },
  { key: "household", label: "Household goods", items: ["Boxes", "Suitcases", "Buckets", "Utensils crate", "Carpet"] },
  { key: "construction", label: "Construction materials", items: ["Bags of cement", "Ballast (wheelbarrows)", "Steel bars", "Tiles (cartons)", "Timber (lengths)", "Sand (tonnes)"] },
  { key: "farm", label: "Farm produce", items: ["Sacks of maize", "Crates of tomatoes", "Bunches of bananas", "Sacks of potatoes", "Vegetable crates"] },
  { key: "retail", label: "Business stock", items: ["Cartons of stock", "Shop shelves", "Drink crates", "Bales"] },
  { key: "electronics", label: "Electronics", items: ["Fridges", "Solar equipment", "Computers", "Printers"] },
  { key: "machinery", label: "Machinery", items: ["Generator", "Water pump", "Welding machine", "Chaff cutter"] },
  { key: "other", label: "General cargo", items: ["Buckets", "Pallets", "Drums", "Miscellaneous items"] },
] as const;

export const LOAD_SIZES = [
  { key: "SMALL", label: "Small", hint: "A few items · under 150 kg", weightKg: 120, loadFactor: 0.28 },
  { key: "MEDIUM", label: "Medium", hint: "Several items · around 300 kg", weightKg: 300, loadFactor: 0.5 },
  { key: "LARGE", label: "Large", hint: "Roomful of items · around 700 kg", weightKg: 700, loadFactor: 0.72 },
  { key: "VERY_LARGE", label: "Very large", hint: "Full house or shop · over 1,000 kg", weightKg: 1400, loadFactor: 1 },
] as const;

export const SPECIAL_HANDLING = [
  { key: "fragile", label: "Fragile" },
  { key: "upright", label: "Keep upright" },
  { key: "dry", label: "Keep dry" },
  { key: "temperature", label: "Temperature-sensitive" },
  { key: "high_value", label: "High-value" },
  { key: "covered", label: "Needs covered vehicle" },
  { key: "open_bed", label: "Needs open-bed vehicle" },
  { key: "load_help", label: "Loading assistance" },
  { key: "unload_help", label: "Offloading assistance" },
] as const;

export function estimateWeight(items: CargoItem[], loadKey: string): number {
  const fromItems = items.reduce((s, i) => s + (i.weightKg || 0) * i.qty, 0);
  const fromLoad = LOAD_SIZES.find((l) => l.key === loadKey)?.weightKg ?? 300;
  return Math.max(fromItems, fromLoad);
}

// Recommendation: smallest category whose capacity fits the weight with headroom.
// Kenyan reality: furniture and machinery move in open-bed pickups by default.
export function recommendCategory(weightKg: number, categories: { key: string; capacityKg: number; active: boolean; sortOrder: number }[], cargoCategory?: string): string | null {
  const sorted = [...categories].filter((c) => c.active).sort((a, b) => a.capacityKg - b.capacityKg);
  if (cargoCategory && ["furniture", "machinery", "construction"].includes(cargoCategory)) {
    const pickup = sorted.find((c) => c.key === "pickup" && c.capacityKg >= weightKg);
    if (pickup) return pickup.key;
  }
  const fit = sorted.find((c) => c.capacityKg >= weightKg * 1.15);
  return (fit ?? sorted[sorted.length - 1])?.key ?? null;
}
