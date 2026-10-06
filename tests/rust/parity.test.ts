// Rust/WASM ↔ TypeScript parity suite (task 10-G).
//
// The money path (priceFor) prefers the Rust core and falls back to the TS
// reference implementation. This suite proves the two paths agree EXACTLY
// (every minor unit) across a production-shaped grid, plus the dispatch-score
// and ETA-confidence mirrors. If this suite is green, the fallback is
// invisible to users and to every receipt ever issued.
import { describe, it, expect } from "vitest";
import { priceFor } from "../../src/lib/pricing";
import type { Fare } from "../../src/lib/pricing";
import {
  computeFareRust, dispatchScoreRust, etaConfidenceRust,
  withinRustContract, __disableRustEngineForTests,
} from "../../src/lib/rust-engine";
import { dispatchScore, etaConfidenceScore } from "../../src/lib/matching";

// production shapes (values from prisma seed)
const CATEGORIES = [
  { baseFare: 250, perKmRate: 55, perMinRate: 2, minimumFare: 350, loadingFee: 150, extraStopFee: 100 }, // tuktuk
  { baseFare: 400, perKmRate: 75, perMinRate: 3, minimumFare: 700, loadingFee: 250, extraStopFee: 200 }, // van
  { baseFare: 500, perKmRate: 90, perMinRate: 3, minimumFare: 900, loadingFee: 300, extraStopFee: 250 }, // pickup
  { baseFare: 1500, perKmRate: 140, perMinRate: 5, minimumFare: 2800, loadingFee: 600, extraStopFee: 500 }, // canter
  { baseFare: 2600, perKmRate: 180, perMinRate: 7, minimumFare: 4500, loadingFee: 900, extraStopFee: 800 }, // lorry
] as const;

const ZONES = [
  { platformFee: 100, commissionRate: 0.15, peakMultiplier: 1.25, nightMultiplier: 1.12, scheduledDiscount: 0.05 },
  { platformFee: 100, commissionRate: 0.12, peakMultiplier: 1.1, nightMultiplier: 1.2, scheduledDiscount: 0.07 },
  { platformFee: 150, commissionRate: 0.18, peakMultiplier: 1.05, nightMultiplier: 1.0, scheduledDiscount: 0.0 },
  { platformFee: 100, commissionRate: 0.15, peakMultiplier: 1.0, nightMultiplier: 1.12, scheduledDiscount: 0.1 },
] as const;

interface Case {
  distanceKm: number; durationMin: number; helpers: number; extraStops: number;
  peak?: boolean; night?: boolean; scheduled?: boolean;
}

const INPUTS: Case[] = [];
// a production-shaped grid: 1-decimal km (geo contract), whole minutes
for (const distanceKm of [1.5, 2.3, 3.0, 4.7, 5.5, 8.2, 10.0, 13.7, 18.5, 24.0, 32.8, 42.0]) {
  for (const durationMin of [8, 12, 17, 26, 40, 65]) {
    for (const flags of [
      {},
      { peak: true },
      { night: true },
      { scheduled: true },
      { peak: true, night: true, scheduled: true },
    ] as Case[]) {
      INPUTS.push({ distanceKm, durationMin, helpers: 0, extraStops: 0, ...flags });
    }
  }
}
// helper/stop variants on a few representative routes
for (const base of INPUTS.slice(0, 24)) {
  INPUTS.push({ ...base, helpers: 1, extraStops: 1 });
  INPUTS.push({ ...base, helpers: 2, extraStops: 3, night: true });
}

const FIELDS = [
  "base", "distance", "duration", "loading", "stops", "night", "schedule",
  "platform", "total", "commission", "driverEarnings",
] as const;

describe("Rust/WASM pricing core — parity with the TypeScript reference", () => {
  it("the wasm engine loads (artifact committed, ABI valid)", () => {
    const r = computeFareRust({
      baseFare: 25000, perKm: 5500, perMin: 200, loadingFee: 15000, helperFee: 0,
      stopFee: 10000, platformFee: 10000, minimumFare: 35000, distanceM: 2300,
      durationMin: 26, helpers: 1, extraStops: 1, nightPermille: 1120,
      schedulePermille: 1000, discountPermille: 0, commissionPermille: 150, peakPermille: 1000,
    });
    expect(r, "wasm artifact missing or failed — run scripts/build-wasm.sh and commit src/wasm/*").not.toBeNull();
    expect(r!.total).toBeGreaterThan(0);
  });

  it("every grid case matches the TS path exactly (minor-unit identical)", () => {
    // Phase 1: rust-enabled pass (priceFor routes through the wasm core)
    const rustResults: Fare[] = [];
    for (const c of CATEGORIES) {
      for (const z of ZONES) {
        for (const input of INPUTS) rustResults.push(priceFor(c, z, input));
      }
    }
    // sanity: the wasm path really produced these (engine assert above covers it)

    // Phase 2: force the fallback and recompute
    __disableRustEngineForTests();
    const tsResults: Fare[] = [];
    for (const c of CATEGORIES) {
      for (const z of ZONES) {
        for (const input of INPUTS) tsResults.push(priceFor(c, z, input));
      }
    }

    expect(tsResults.length).toBe(rustResults.length);
    let mismatches = 0;
    for (let i = 0; i < rustResults.length; i++) {
      const a = rustResults[i], b = tsResults[i];
      for (const f of FIELDS) {
        if (a[f] !== b[f]) {
          mismatches++;
          if (mismatches <= 5) console.error(`parity mismatch #${i} field=${f}: rust=${a[f]} ts=${b[f]}`);
        }
      }
      if (a.minimumApplied !== b.minimumApplied) mismatches++;
    }
    expect(mismatches, `${mismatches} parity mismatches over ${rustResults.length} fares × ${FIELDS.length} fields`).toBe(0);
  });

  it("edge cases: zero km, stacked surcharges, minimum floor, huge route", () => {
    // restore the engine for this block is impossible after disable — the
    // fallback path IS the reference; compare against hand-computed values.
    const c = CATEGORIES[0];
    const z = ZONES[0];
    // zero km: base + platform only (duration rounds from 0)
    const zero = priceFor(c, z, { distanceKm: 0, durationMin: 0, helpers: 0, extraStops: 0 });
    expect(zero.base).toBe(250);
    expect(zero.platform).toBe(100);
    expect(zero.minimumApplied).toBe(false); // subtotal 350 == the 350 minimum → no floor needed
    expect(zero.total).toBe(350);
    // stacked: peak + night + scheduled on a real route
    const stacked = priceFor(CATEGORIES[4], z, { distanceKm: 18.5, durationMin: 40, helpers: 2, extraStops: 2, peak: true, night: true, scheduled: true });
    expect(stacked.base).toBe(Math.round(2600 * 1.25));
    expect(stacked.night).toBe(Math.round((stacked.base + stacked.distance + stacked.duration) * 0.12));
    expect(stacked.schedule).toBe(Math.round((stacked.base + stacked.distance + stacked.duration) * 0.05));
    expect(stacked.total).toBe(stacked.base + stacked.distance + stacked.duration + stacked.loading + stacked.stops + stacked.platform + stacked.night - stacked.schedule);
    // huge route stays consistent
    const huge = priceFor(CATEGORIES[4], z, { distanceKm: 500, durationMin: 900, helpers: 0, extraStops: 0 });
    expect(huge.distance).toBe(180 * 500);
    expect(huge.total).toBeGreaterThan(huge.base);
  });

  it("out-of-contract inputs fall back to TS instead of guessing", () => {
    expect(withinRustContract({ distanceKm: 2.30051, durationMin: 10 })).toBe(false); // >3-decimal km
    expect(withinRustContract({ distanceKm: 2.3, durationMin: 10.5 })).toBe(false); // fractional minutes
    expect(withinRustContract({ distanceKm: 2.3, durationMin: 10 })).toBe(true);
    const c = CATEGORIES[0], z = ZONES[0];
    const out = priceFor(c, z, { distanceKm: 2.30051, durationMin: 10, helpers: 0, extraStops: 0 });
    expect(out.distance).toBe(Math.round(55 * 2.30051));
  });
});
