// MIZIGO — Matching engine (server-side). Never just "closest driver":
// filters by suitability, then ranks by distance, rating, acceptance history,
// completed trips and vehicle capacity headroom.

import type { Driver, Vehicle, VehicleCategory } from "@prisma/client";
import { haversineKm } from "./geo";

export interface MatchCandidate extends Driver {
  user: { name: string } | null;
  vehicles: (Vehicle & { category: VehicleCategory | null })[]
}

export interface ScoredDriver {
  driverId: string;
  name: string;
  score: number;
  distanceKm: number;
  etaMin: number;
  rating: number;
  trips: number;
  vehicleId: string;
  vehicleName: string;
  registration: string;
  capacityKg: number;
}

export function matchDriver(
  candidates: MatchCandidate[],
  pickup: { lat: number; lng: number },
  need: { categoryKey: string; weightKg: number }
): ScoredDriver | null {
  const pool: ScoredDriver[] = [];

  for (const d of candidates) {
    // ── hard filters ──
    if (d.status !== "ONLINE") continue; // availability
    if (d.verification !== "VERIFIED") continue; // compliance
    const v = d.vehicles?.find(
      (vv) => vv.active && vv.category?.key === need.categoryKey &&
        vv.docRegistration === "VERIFIED" && vv.docInsurance === "VERIFIED" && vv.docInspection === "VERIFIED" &&
        vv.capacityKg >= need.weightKg
    );
    if (!v) continue; // vehicle suitability + capacity + documents

    const distanceKm = haversineKm({ lat: d.lat, lng: d.lng }, pickup);
    if (distanceKm > 18) continue; // service area
    const etaMin = Math.max(3, Math.round((distanceKm / 26) * 60) + 2);

    // ── ranking score (higher is better) ──
    const distanceScore = Math.max(0, 1 - distanceKm / 12); // closer is better
    const ratingScore = (d.rating - 4) / 1; // 4.0 → 0, 5.0 → 1
    const acceptanceScore = d.acceptanceRate; // history
    const experienceScore = Math.min(1, d.tripsCompleted / 400); // reliability
    const etaScore = Math.max(0, 1 - etaMin / 30);
    const score =
      distanceScore * 0.32 + etaScore * 0.18 + ratingScore * 0.2 +
      acceptanceScore * 0.15 + experienceScore * 0.15;

    pool.push({
      driverId: d.id,
      name: d.user?.name ?? "Driver",
      score,
      distanceKm: Math.round(distanceKm * 10) / 10,
      etaMin,
      rating: d.rating,
      trips: d.tripsCompleted,
      vehicleId: v.id,
      vehicleName: `${v.make} ${v.model}`,
      registration: v.registration,
      capacityKg: v.capacityKg,
    });
  }

  if (pool.length === 0) return null;
  pool.sort((a, b) => b.score - a.score);
  return pool[0];
}

// Nearby online drivers for the "vehicles nearby" indicators
export function nearbyDrivers(candidates: MatchCandidate[], origin: { lat: number; lng: number }, radiusKm = 8) {
  return candidates
    .filter((d) => d.status === "ONLINE" && d.verification === "VERIFIED")
    .map((d) => ({
      driverId: d.id,
      name: d.user?.name ?? "Driver",
      lat: d.lat, lng: d.lng,
      rating: d.rating,
      vehicle: d.vehicles?.[0] ? `${d.vehicles[0].make} ${d.vehicles[0].model}` : "",
      categoryKey: d.vehicles?.[0]?.category?.key ?? "pickup",
      distanceKm: Math.round(haversineKm({ lat: d.lat, lng: d.lng }, origin) * 10) / 10,
    }))
    .filter((d) => d.distanceKm <= radiusKm);
}

// Demand zones for the driver home map (simple, honest indicators)
export const DEMAND_ZONES = [
  { name: "CBD", level: "high" },
  { name: "Westlands", level: "high" },
  { name: "Industrial Area", level: "medium" },
  { name: "Kilimani", level: "medium" },
  { name: "Thika Road", level: "high" },
  { name: "Karen", level: "low" },
];
