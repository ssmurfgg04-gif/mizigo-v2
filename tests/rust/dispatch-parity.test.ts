// Dispatch-score + ETA-confidence Rust↔TS mirrors (task 10-G).
// Separate file from the fare parity suite: that one force-disables the
// wasm engine to exercise the fallback, and the disable is sticky per
// process — this file gets a fresh worker (and a fresh engine).
import { describe, it, expect } from "vitest";
import { dispatchScoreRust, etaConfidenceRust } from "../../src/lib/rust-engine";
import { dispatchScore, etaConfidenceScore } from "../../src/lib/matching";

describe("dispatch score + ETA confidence mirrors", () => {
  it("dispatchScoreRust matches the TS formula across the case grid", () => {
    const cases: Array<[number, number, number, number, number, number, number, number]> = [];
    for (const distanceKm of [0.3, 1.2, 3.2, 5.0, 8.7, 14.0]) {
      for (const eta of [2, 9, 18, 30, 45]) {
        for (const rating of [3.2, 4.0, 4.4, 4.7, 5.0]) {
          cases.push([distanceKm, eta, rating, 310, 0.92, 0.81, 420, 0.03]);
        }
      }
    }
    cases.push([14, 30, 4.0, 0, 0, 0, 0, 0]); // zero-everything
    cases.push([0.1, 1, 5, 1000, 1, 1, 2000, 0]); // perfect driver next door
    cases.push([1.0, 5, 3.2, 10, 0.4, 0.2, 5000, 0.9]); // extreme penalty
    for (const [distanceKm, etaMin, rating, trips, acceptance, reliability, headroom, cancel] of cases) {
      const rust = dispatchScoreRust(distanceKm, etaMin, rating, trips, acceptance, reliability, headroom, cancel);
      const ts = dispatchScore({
        distanceKm, etaMin, rating, tripsCompleted: trips,
        acceptanceRate: acceptance, reliability, capacityHeadroom: headroom, cancellationRate: cancel,
      });
      expect(rust).not.toBeNull();
      expect(Math.abs(rust! - ts)).toBeLessThan(1e-12);
    }
  });

  it("etaConfidenceRust matches the TS formula", () => {
    for (const [eta, km] of [[9, 3.2], [0, 0], [60, 25], [20, 0], [5, 12], [40, 18]] as const) {
      const rust = etaConfidenceRust(eta, km);
      expect(Math.abs(rust! - etaConfidenceScore(eta, km))).toBeLessThan(1e-12);
    }
  });
});
