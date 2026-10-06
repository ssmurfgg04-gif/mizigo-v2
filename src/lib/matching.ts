// MIZIGO — Matching engine (server-side). Never just "closest driver":
// filters by suitability, then ranks by distance, rating, acceptance history,
// completed trips, vehicle capacity headroom and v1's reliability score.

import type { Driver, Vehicle, VehicleCategory } from "@prisma/client";
import { haversineKm } from "./geo";

export interface MatchCandidate extends Driver {
  user: { name: string } | null;
  vehicles: (Vehicle & { category: VehicleCategory | null })[]
}

// v1 goodness: reputation as one comparable number.
// reliability = 0.45·completion + 0.35·rating + 0.20·onTime − disputePenalty
export function reliabilityScore(s: {
  completed: number; cancelled: number; disputes: number;
  rating: number; onTime: number;
}): number {
  const total = s.completed + s.cancelled;
  const completion = total ? s.completed / total : 1;
  const disputePenalty = Math.min(0.25, (s.disputes / Math.max(1, s.completed)) * 0.5);
  const rating = Math.max(0, Math.min(1, s.rating / 5));
  return Math.max(0, Math.min(1, 0.45 * completion + 0.35 * rating + 0.2 * s.onTime - disputePenalty));
}

export function driverReliability(d: Pick<Driver, "tripsCompleted" | "cancellationRate" | "incidents" | "rating" | "onTimeDelivery">): number {
  const completed = d.tripsCompleted;
  const cancelled = Math.round(d.tripsCompleted * d.cancellationRate);
  return reliabilityScore({
    completed,
    cancelled,
    disputes: d.incidents,
    rating: d.rating,
    onTime: d.onTimeDelivery,
  });
}

export interface ScoredDriver {
  driverId: string;
  name: string;
  score: number;
  distanceKm: number;
  etaMin: number;
  rating: number;
  trips: number;
  reliability: number;
  vehicleId: string;
  vehicleName: string;
  registration: string;
  capacityKg: number;
}

// ETA confidence — how much to trust the arrival estimate. Falls with distance
// (dispatch radius) and with the ETA itself (traffic/time risk).
export function etaConfidenceScore(etaMin: number, distanceKm: number): number {
  const distanceWeight = Math.max(0, 1 - distanceKm / 18);
  const etaWeight = Math.max(0, 1 - etaMin / 40);
  return Math.max(0, Math.min(1, 0.55 * distanceWeight + 0.45 * etaWeight));
}

// v2 dispatch ranking — one comparable number per candidate.
// distance/eta dominate (customer wait), then reliability + rating (trust),
// then acceptance history + capacity headroom; cancellations subtract.
export function dispatchScore(input: {
  distanceKm: number;
  etaMin: number;
  rating: number;
  tripsCompleted: number;
  acceptanceRate: number;
  reliability: number;
  capacityHeadroom: number;
  cancellationRate: number;
}): number {
  const distanceScore = Math.max(0, 1 - input.distanceKm / 14);
  const etaScore = Math.max(0, 1 - input.etaMin / 30);
  const ratingScore = Math.max(0, Math.min(1, (input.rating - 4) / 1));
  const tripScore = Math.min(1, input.tripsCompleted / 250);
  const acceptanceScore = Math.max(0, Math.min(1, input.acceptanceRate));
  const capacityScore = Math.max(0, Math.min(1, input.capacityHeadroom / 1000));
  const reliabilityScoreValue = Math.max(0, Math.min(1, input.reliability));
  const cancellationPenalty = Math.max(0, input.cancellationRate * 2.5);

  return (
    distanceScore * 0.23 +
    etaScore * 0.14 +
    ratingScore * 0.16 +
    tripScore * 0.08 +
    acceptanceScore * 0.12 +
    capacityScore * 0.09 +
    reliabilityScoreValue * 0.18 -
    cancellationPenalty * 0.08
  );
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
    const reliability = driverReliability(d);
    const capacityHeadroom = Math.max(0, v.capacityKg - need.weightKg);
    const score = dispatchScore({
      distanceKm,
      etaMin,
      rating: d.rating,
      tripsCompleted: d.tripsCompleted,
      acceptanceRate: d.acceptanceRate,
      reliability,
      capacityHeadroom,
      cancellationRate: d.cancellationRate,
    });

    pool.push({
      driverId: d.id,
      name: d.user?.name ?? "Driver",
      score,
      distanceKm: Math.round(distanceKm * 10) / 10,
      etaMin,
      rating: d.rating,
      trips: d.tripsCompleted,
      reliability: Math.round(reliability * 100) / 100,
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
      etaConfidence: etaConfidenceScore(
        Math.max(3, Math.round((haversineKm({ lat: d.lat, lng: d.lng }, origin) / 26) * 60) + 2),
        haversineKm({ lat: d.lat, lng: d.lng }, origin)
      ),
    }))
    .filter((d) => d.distanceKm <= radiusKm)
    .sort((a, b) => b.etaConfidence - a.etaConfidence);
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
