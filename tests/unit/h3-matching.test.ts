// H3 hex-grid matching (task 16-a): the cellOf/ringCells primitives plus the
// expanding-ring matchDriverRing over INJECTED fetchers — no DB in unit tests
// (plain closures over arrays). Geometry facts from
// docs/research/UBER_BOLT_ARCHITECTURE.md §1: res-8 indexes are 15-char
// lowercased hex; gridDisk sizes are 1/7/19/37 cells for k = 0..3.
import { describe, it, expect } from "vitest";
import { cellToLatLng } from "h3-js";
import { MATCHING_MAX_RINGS, MATCHING_RESOLUTION, cellOf, ringCells } from "../../src/lib/h3";
import { matchDriverRing } from "../../src/lib/matching";
import type { MatchCandidate } from "../../src/lib/matching";

const PICKUP = { lat: -1.2864, lng: 36.8172 }; // Nairobi CBD default (Driver model default)
const pickupCell = cellOf(PICKUP.lat, PICKUP.lng);
const NEED = { categoryKey: "pickup", weightKg: 300 };

// ── test doubles ─────────────────────────────────────────────────────────────

const BASE_VEHICLE = {
  id: "v1", driverId: "d1", categoryId: "c1", make: "Toyota", model: "Hilux", registration: "KDA 001",
  bodyType: "open", capacityKg: 1200, photos: "[]", docRegistration: "VERIFIED", docInsurance: "VERIFIED",
  docInspection: "VERIFIED", insuranceExpiry: null, inspectionExpiry: null, active: true, createdAt: new Date(),
  category: { id: "c1", key: "pickup", name: "Pickup", description: "", capacityKg: 1200, volumeM3: 2.4, bodyType: "open", lengthM: 2, widthM: 1.5, heightM: 1, baseFare: 350, perKmRate: 62, perMinRate: 4, minimumFare: 500, loadingFee: 100, extraStopFee: 150, sortOrder: 1, active: true, supportedCargo: "[]" },
};

// same factory shape as tests/unit/matching.test.ts (house style, cast to the
// Prisma-derived MatchCandidate type without a database)
function candidate(over: Record<string, unknown> = {}): MatchCandidate {
  const base = {
    id: "d1", userId: "u1", status: "ONLINE", rating: 4.8, tripsCompleted: 120,
    acceptanceRate: 0.92, onTimePickup: 0.94, onTimeDelivery: 0.96, cancellationRate: 0.02,
    incidents: 0, licenceClass: "BCE", licenceExpiry: null, verification: "VERIFIED",
    lat: PICKUP.lat, lng: PICKUP.lng, lastPingAt: new Date(), onlineMinutes: 10, createdAt: new Date(),
    user: { name: "Peter Kamau" },
    vehicles: [{ ...BASE_VEHICLE }],
    ...over,
  };
  return base as unknown as MatchCandidate;
}

// wrong-category variant for the hard-filter test (matchDriver must reject it)
function wrongCategoryCandidate(over: Record<string, unknown> = {}): MatchCandidate {
  return candidate({
    ...over,
    vehicles: [{ ...BASE_VEHICLE, id: "vw", category: { ...BASE_VEHICLE.category, id: "cx", key: "canter", name: "Canter" } }],
  });
}

// cells at EXACTLY grid distance k (outer band of the disk) + a driver
// position at the first such cell's center (cellToLatLng center → same cell)
function ringK(k: number): string[] {
  if (k === 0) return [pickupCell];
  const inner = new Set(ringCells(pickupCell, k - 1));
  return ringCells(pickupCell, k).filter((c) => !inner.has(c));
}
function atRing(k: number): { lat: number; lng: number } {
  const [lat, lng] = cellToLatLng(ringK(k)[0]);
  return { lat, lng };
}

// fake ringFetcher: cell → candidates map + call logs (plain closures, no DB)
function makeFetchers(byCell: Map<string, MatchCandidate[]>, all: MatchCandidate[] = []) {
  const ringCalls: string[][] = [];
  let allCalls = 0;
  return {
    fetchByCells: async (cells: string[]) => {
      ringCalls.push(cells);
      return cells.flatMap((c) => byCell.get(c) ?? []);
    },
    fetchAll: async () => {
      allCalls += 1;
      return all;
    },
    ringCalls,
    allCalls: () => allCalls,
  };
}

// ── cellOf ───────────────────────────────────────────────────────────────────

describe("cellOf (res-8 indexing)", () => {
  it("keeps the specced constants (res 8, 3 rings)", () => {
    expect(MATCHING_RESOLUTION).toBe(8);
    expect(MATCHING_MAX_RINGS).toBe(3);
  });

  it("is deterministic and returns a valid 15-char lowercase hex index for Nairobi coords", () => {
    const a = cellOf(PICKUP.lat, PICKUP.lng);
    expect(a).toBe(cellOf(PICKUP.lat, PICKUP.lng)); // deterministic
    expect(a).toMatch(/^[0-9a-f]{15}$/); // res-8 H3 index, lowercased
    expect(a[0]).toBe("8"); // resolution marker nibble
    // distinct neighborhoods land in distinct cells (CBD vs Westlands)
    expect(cellOf(-1.2841, 36.8265)).not.toBe(cellOf(-1.2613, 36.8027));
  });

  it("returns \"\" for anything that cannot index a real cell", () => {
    expect(cellOf(NaN, 36.8)).toBe("");
    expect(cellOf(-1.28, Infinity)).toBe("");
    expect(cellOf(null as unknown as number, null as unknown as number)).toBe(""); // JS would coerce null → 0/0
    expect(cellOf(undefined as unknown as number, 36.8)).toBe("");
    expect(cellOf(999, 999)).toBe(""); // outside ±90/±180 — garbage in, "" out
  });
});

// ── ringCells ────────────────────────────────────────────────────────────────

describe("ringCells (gridDisk expanding rings)", () => {
  it("returns the canonical hex disk sizes for a Nairobi cell (1/7/19/37)", () => {
    expect(ringCells(pickupCell, 0)).toHaveLength(1);
    expect(ringCells(pickupCell, 1)).toHaveLength(7);
    expect(ringCells(pickupCell, 2)).toHaveLength(19);
    expect(ringCells(pickupCell, 3)).toHaveLength(37);
  });

  it("k=0 is exactly the origin cell, and each disk contains the previous one", () => {
    expect(ringCells(pickupCell, 0)).toEqual([pickupCell]);
    const disk1 = new Set(ringCells(pickupCell, 1));
    const disk2 = new Set(ringCells(pickupCell, 2));
    for (const c of ringCells(pickupCell, 0)) expect(disk1.has(c)).toBe(true);
    for (const c of ringCells(pickupCell, 1)) expect(disk2.has(c)).toBe(true);
  });

  it("never yields empty or duplicate entries", () => {
    for (let k = 0; k <= MATCHING_MAX_RINGS; k++) {
      const cells = ringCells(pickupCell, k);
      expect(cells.includes("")).toBe(false);
      expect(new Set(cells).size).toBe(cells.length); // deduped
    }
  });

  it("returns [] for an invalid origin or negative k", () => {
    expect(ringCells("", 2)).toEqual([]);
    expect(ringCells("not-a-cell", 1)).toEqual([]);
    expect(ringCells(pickupCell, -1)).toEqual([]); // gridDisk throws on k<0 — guarded
  });
});

// ── matchDriverRing ──────────────────────────────────────────────────────────

describe("matchDriverRing (expanding-ring dispatch)", () => {
  it("returns immediately with ring 0 when the pickup cell holds a driver", async () => {
    const near = candidate({ id: "near", h3Cell: pickupCell });
    const f = makeFetchers(new Map([[pickupCell, [near]]]), [candidate({ id: "far" })]);
    const res = await matchDriverRing({ ...f, pickup: PICKUP, need: NEED });
    expect(res.ring).toBe(0);
    expect(res.match?.driverId).toBe("near");
    expect(f.ringCalls).toEqual([[pickupCell]]); // one query, ring 0's cells only
    expect(f.allCalls()).toBe(0); // never touched the full scan
  });

  it("walks outward: empty rings 0-1, hit in ring 2 → ring 2", async () => {
    const pos2 = atRing(2); // ~1.5 km band — inside matchDriver's 18 km service area
    const outer = candidate({ id: "outer", lat: pos2.lat, lng: pos2.lng, h3Cell: ringK(2)[0] });
    const f = makeFetchers(new Map([[ringK(2)[0], [outer]]]), [candidate({ id: "far" })]);
    const res = await matchDriverRing({ ...f, pickup: PICKUP, need: NEED });
    expect(res.ring).toBe(2);
    expect(res.match?.driverId).toBe("outer");
    expect(f.ringCalls).toHaveLength(3); // k = 0, 1, 2 — stops at the first ring with supply
    expect(f.allCalls()).toBe(0);
  });

  it("falls back to the full scan when all rings are empty", async () => {
    // a driver parked 8 km out (null/stale cell is exactly this case)
    const distant = candidate({ id: "distant", lat: -1.345, lng: 36.88, h3Cell: null });
    const f = makeFetchers(new Map(), [distant]);
    const res = await matchDriverRing({ ...f, pickup: PICKUP, need: NEED });
    expect(res.ring).toBe("fallback");
    expect(res.match?.driverId).toBe("distant");
    expect(f.ringCalls).toHaveLength(MATCHING_MAX_RINGS + 1); // exhausted k = 0..3 first
    expect(f.allCalls()).toBe(1);
  });

  it("keeps expanding past a ring whose candidates all fail the hard filters (wrong category)", async () => {
    // ring 0 has supply, but only a canter while a pickup is needed —
    // matchDriver returns null for that ring, so the search continues outward
    const wrong = wrongCategoryCandidate({ id: "wrong-cat", h3Cell: pickupCell });
    const pos1 = atRing(1);
    const right = candidate({ id: "right-cat", lat: pos1.lat, lng: pos1.lng, h3Cell: ringK(1)[0] });
    const f = makeFetchers(new Map([[pickupCell, [wrong]], [ringK(1)[0], [right]]]));
    const res = await matchDriverRing({ ...f, pickup: PICKUP, need: NEED });
    expect(res.ring).toBe(1);
    expect(res.match?.driverId).toBe("right-cat");
    // the k=1 disk re-fetches ring 0's rejected driver — harmless, it is
    // hard-filtered again; what matters is the search did not stop at ring 0
    expect(f.allCalls()).toBe(0);
  });

  it("reports match: null on the fallback when nothing matches anywhere", async () => {
    const f = makeFetchers(new Map(), [candidate({ id: "off", status: "OFFLINE" })]);
    const res = await matchDriverRing({ ...f, pickup: PICKUP, need: NEED });
    expect(res.ring).toBe("fallback");
    expect(res.match).toBeNull();
  });

  it("skips ring queries entirely for an unindexable pickup (straight to fallback)", async () => {
    const f = makeFetchers(new Map(), [candidate({ id: "any" })]);
    const res = await matchDriverRing({ ...f, pickup: { lat: NaN, lng: 36.8 }, need: NEED });
    expect(res.ring).toBe("fallback");
    expect(f.ringCalls).toHaveLength(0); // no empty `h3Cell IN ()` queries
    expect(f.allCalls()).toBe(1);
  });
});
