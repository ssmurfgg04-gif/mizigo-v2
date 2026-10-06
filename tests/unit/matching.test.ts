// Golden vectors for the v2 dispatch ranking + ETA confidence (task 10-E).
// Values verified by hand against the closed-form weights in src/lib/matching.ts.
import { describe, it, expect } from "vitest";
import { dispatchScore, etaConfidenceScore, reliabilityScore, matchDriver, nearbyDrivers } from "../../src/lib/matching";
import type { MatchCandidate } from "../../src/lib/matching";

const round = (v: number, digits = 6): number => Math.round(v * 10 ** digits) / 10 ** digits;

describe("etaConfidenceScore", () => {
  it("is ~0.97 at minimum ETA from 0 km, exactly 1 only at (0, 0)", () => {
    expect(etaConfidenceScore(3, 0)).toBe(0.96625); // 0.55·1 + 0.45·(1 − 3/40)
    expect(etaConfidenceScore(0, 0)).toBe(1);
  });

  it("decays to 0 at the service-area edge (18 km / 40 min)", () => {
    expect(etaConfidenceScore(40, 18)).toBe(0);
    expect(etaConfidenceScore(60, 25)).toBe(0);
  });

  it("half-trusts a mid-range arrival", () => {
    // 0.55·(1 − 5/18) + 0.45·(1 − 10/40) = 0.397222… + 0.3375 = 0.734722…
    expect(round(etaConfidenceScore(10, 5))).toBe(0.734722);
  });

  it("never leaves [0, 1] for wild inputs", () => {
    expect(etaConfidenceScore(-5, -3)).toBe(1); // weights clamp to 1 each
    expect(etaConfidenceScore(1000, 1000)).toBe(0);
  });
});

describe("dispatchScore golden vectors", () => {
  it("near-perfect driver (0 km, top marks, no cancellations) = 0.986", () => {
    const s = dispatchScore({
      distanceKm: 0, etaMin: 3, rating: 5, tripsCompleted: 250,
      acceptanceRate: 1, reliability: 1, capacityHeadroom: 1000, cancellationRate: 0,
    });
    // 1·.23 + .9·.14 + 1·.16 + 1·.08 + 1·.12 + 1·.09 + 1·.18 − 0 = 0.986
    expect(round(s)).toBe(0.986);
  });

  it("distance 14 km zeroes the distance term but not the whole score", () => {
    const s = dispatchScore({
      distanceKm: 14, etaMin: 30, rating: 4.5, tripsCompleted: 100,
      acceptanceRate: 0.9, reliability: 0.8, capacityHeadroom: 400, cancellationRate: 0,
    });
    // rating .5·.16=.08 · trips .4·.08=.032 · acc .9·.12=.108 · capacity .4·.09=.036 · rel .8·.18=.144 → 0.4
    expect(round(s)).toBe(0.4);
    expect(s).toBeGreaterThan(0);
  });

  it("rating 4.0 → 0 and 5.0 → 1 rating term; below 4 clamps to 0", () => {
    const base = { distanceKm: 7, etaMin: 15, tripsCompleted: 125, acceptanceRate: 0.9, reliability: 0.7, capacityHeadroom: 500, cancellationRate: 0.04 };
    const at40 = dispatchScore({ ...base, rating: 4.0 });
    const at50 = dispatchScore({ ...base, rating: 5.0 });
    const below = dispatchScore({ ...base, rating: 3.2 });
    expect(round(at50 - at40)).toBe(0.16); // exactly the rating weight
    expect(below).toBe(at40); // clamped: identical to rating 4.0
  });

  it("cancellation 0 → no penalty; cancellation 0.4 → full −0.08 penalty", () => {
    const base = { distanceKm: 7, etaMin: 15, rating: 4.5, tripsCompleted: 125, acceptanceRate: 0.9, reliability: 0.7, capacityHeadroom: 500 };
    const calm = dispatchScore({ ...base, cancellationRate: 0 });
    const flaky = dispatchScore({ ...base, cancellationRate: 0.4 }); // 0.4·2.5 = 1 (full penalty)
    expect(round(calm - flaky)).toBe(0.08);
  });

  it("mid-range driver lands on the hand-computed blend (0.576)", () => {
    const s = dispatchScore({
      distanceKm: 7, etaMin: 15, rating: 4.5, tripsCompleted: 125,
      acceptanceRate: 0.9, reliability: 0.7, capacityHeadroom: 500, cancellationRate: 0.04,
    });
    // .5·.23 + .5·.14 + .5·.16 + .5·.08 + .9·.12 + .5·.09 + .7·.18 − .1·.08 = 0.576
    expect(round(s)).toBe(0.576);
  });

  it("saturating inputs (huge trips, huge headroom) clamp instead of exploding", () => {
    const s = dispatchScore({
      distanceKm: 0, etaMin: 0, rating: 5, tripsCompleted: 10_000,
      acceptanceRate: 5, reliability: 2, capacityHeadroom: 99_999, cancellationRate: 0,
    });
    expect(round(s)).toBe(0.23 + 0.14 + 0.16 + 0.08 + 0.12 + 0.09 + 0.18); // = 1 at clamp
  });
});

describe("reliabilityScore (v1 goodness, unchanged)", () => {
  it("perfect record → 1", () => {
    expect(reliabilityScore({ completed: 100, cancelled: 0, disputes: 0, rating: 5, onTime: 1 })).toBe(1);
  });
  it("never negative", () => {
    expect(reliabilityScore({ completed: 0, cancelled: 50, disputes: 40, rating: 1, onTime: 0 })).toBeGreaterThanOrEqual(0);
  });
});

// ── matchDriver rewiring (signature unchanged) ──────────────────────────────

function candidate(over: Record<string, unknown> = {}): MatchCandidate {
  const base = {
    id: "d1", userId: "u1", status: "ONLINE", rating: 4.8, tripsCompleted: 120,
    acceptanceRate: 0.92, onTimePickup: 0.94, onTimeDelivery: 0.96, cancellationRate: 0.02,
    incidents: 0, licenceClass: "BCE", licenceExpiry: null, verification: "VERIFIED",
    lat: -1.2864, lng: 36.8172, lastPingAt: new Date(), onlineMinutes: 10, createdAt: new Date(),
    user: { name: "Peter Kamau" },
    vehicles: [{
      id: "v1", driverId: "d1", categoryId: "c1", make: "Toyota", model: "Hilux", registration: "KDA 001",
      bodyType: "open", capacityKg: 1200, photos: "[]", docRegistration: "VERIFIED", docInsurance: "VERIFIED",
      docInspection: "VERIFIED", insuranceExpiry: null, inspectionExpiry: null, active: true, createdAt: new Date(),
      category: { id: "c1", key: "pickup", name: "Pickup", description: "", capacityKg: 1200, volumeM3: 2.4, bodyType: "open", lengthM: 2, widthM: 1.5, heightM: 1, baseFare: 350, perKmRate: 62, perMinRate: 4, minimumFare: 500, loadingFee: 100, extraStopFee: 150, sortOrder: 1, active: true, supportedCargo: "[]" },
    }],
    ...over,
  };
  return base as unknown as MatchCandidate;
}

describe("matchDriver (rewired onto dispatchScore)", () => {
  const pickup = { lat: -1.2864, lng: 36.8172 };
  const need = { categoryKey: "pickup", weightKg: 300 };

  it("still filters hard (offline / unverified / out of area / expired docs)", () => {
    expect(matchDriver([candidate({ status: "OFFLINE" })], pickup, need)).toBeNull();
    expect(matchDriver([candidate({ verification: "PENDING" })], pickup, need)).toBeNull();
    expect(matchDriver([candidate({ lat: -1.05, lng: 36.9 })], pickup, need)).toBeNull(); // > 18 km
    const noDocs = candidate();
    (noDocs.vehicles[0] as { docInsurance: string }).docInsurance = "EXPIRED";
    expect(matchDriver([noDocs], pickup, need)).toBeNull();
  });

  it("returns the higher dispatchScore of two valid candidates", () => {
    const near = candidate({ id: "near", rating: 5, tripsCompleted: 250, cancellationRate: 0 });
    const far = candidate({ id: "far", lat: -1.2, lng: 36.87, rating: 4.1, tripsCompleted: 10, cancellationRate: 0.3 });
    const best = matchDriver([far, near], pickup, need);
    expect(best?.driverId).toBe("near");
    expect(best?.score).toBeGreaterThan(0);
    expect(best?.vehicleId).toBe("v1");
  });

  it("keeps the exported ScoredDriver shape (backward-compatible)", () => {
    const best = matchDriver([candidate()], pickup, need)!;
    for (const k of ["driverId", "name", "score", "distanceKm", "etaMin", "rating", "trips", "reliability", "vehicleId", "vehicleName", "registration", "capacityKg"]) {
      expect(best).toHaveProperty(k);
    }
  });
});

describe("nearbyDrivers (gains etaConfidence + confidence sort)", () => {
  const origin = { lat: -1.2864, lng: 36.8172 };

  it("exposes etaConfidence in [0,1] and sorts by it", () => {
    const close = candidate({ id: "close", lat: -1.288, lng: 36.819 }); // ~0.3 km
    const farther = candidate({ id: "farther", lat: -1.3, lng: 36.84 }); // ~2.9 km
    const list = nearbyDrivers([farther, close], origin, 8);
    expect(list.map((d) => d.driverId)).toEqual(["close", "farther"]);
    for (const d of list) {
      expect(d.etaConfidence).toBeGreaterThanOrEqual(0);
      expect(d.etaConfidence).toBeLessThanOrEqual(1);
    }
    expect(list[0].etaConfidence).toBeGreaterThan(list[1].etaConfidence);
  });

  it("respects the radius filter", () => {
    const far = candidate({ id: "far", lat: -1.35, lng: 36.9 }); // ~10 km
    expect(nearbyDrivers([far], origin, 8)).toHaveLength(0);
  });
});
