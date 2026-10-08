// MIZIGO — H3 hex-grid helpers for dispatch (Uber-pattern, clean-room).
// Source: docs/research/UBER_BOLT_ARCHITECTURE.md §1 — Uber's own grid system
// ("we use H3 as the grid system for analysis and optimization throughout our
// marketplaces") with hexes chosen because they "approximate radiuses easily":
// all 6 neighbors are equidistant, so `gridDisk(k)` rings ARE a pickup radius.
// h3-js v4 API (h3geo.org): latLngToCell, gridDisk, cellToLatLng.
// Cells are an INDEX over supply, never a replacement for raw lat/lng —
// drivers keep exact coordinates and refresh their cell on every write.

import { gridDisk, isValidCell, latLngToCell } from "h3-js";

// Res 8 ≈ 0.74 km² cells / ~0.53 km edges (h3geo.org restable) — the
// "Matching + surge cell (default)" choice from the research doc §1.4: a
// gridDisk ring at res 8 spans a credible Nairobi pickup band (~0.92 km
// center-to-center per step), fine enough for estate-level supply, coarse
// enough that ring queries stay tiny.
export const MATCHING_RESOLUTION = 8;

// Expanding-ring search depth: one ring step ≈ 0.74 km, so k = 0..3 covers a
// ~2.2 km pickup disk — the dense-city band where a cargo match should be
// found. Beyond ring 3 the caller falls back to the full haversine scan
// (matchDriver's 18 km service area) instead of widening rings further.
export const MATCHING_MAX_RINGS = 3;

/**
 * H3 cell (res 8, lowercased) containing a lat/lng point — the key drivers are
 * indexed by (Driver.h3Cell, @@index) and matching expands rings from.
 *
 * Returns "" for any input that cannot index a real cell (non-finite numbers,
 * null/undefined — JS coercion would silently turn null into lat 0/lng 0 —
 * and coordinates outside Earth's ±90/±180 domain, which the C library would
 * otherwise wrap into a plausible-looking but garbage cell). Callers treat ""
 * as "not indexed" and fall back to the full scan.
 *
 * Source: docs/research/UBER_BOLT_ARCHITECTURE.md §1.3 (latLngToCell, v4 API).
 */
export function cellOf(lat: number, lng: number): string {
  // Guard BEFORE the library call: h3-js coerces (null → 0) instead of throwing,
  // and wraps out-of-domain degrees into wrong-but-valid-looking cells.
  if (
    !Number.isFinite(lat) || !Number.isFinite(lng) ||
    Math.abs(lat) > 90 || Math.abs(lng) > 180
  ) {
    return "";
  }
  try {
    return latLngToCell(lat, lng, MATCHING_RESOLUTION).toLowerCase();
  } catch {
    return ""; // defensive: latLngToCell throws on library-level range errors
  }
}

/**
 * All cells within grid distance k of an origin cell (gridDisk, the
 * expanding-ring primitive from the research doc §1.3) — i.e. ring k's query
 * set INCLUDES the inner rings, mirroring how Uber's search disk widens.
 *
 * Deduped, never contains "" entries. Returns [] for an invalid origin cell
 * or k < 0 (gridDisk throws on negative k, unlike its ""-origin behavior).
 *
 * Pentagon-safe by construction: gridDisk (not the Unsafe variant) includes
 * the 12 pentagon cells like any other — see research doc §1.3.
 */
export function ringCells(originCell: string, k: number): string[] {
  if (!originCell || !isValidCell(originCell) || !Number.isFinite(k) || k < 0) {
    return [];
  }
  try {
    // gridDisk returns unique cells, but dedupe anyway so the contract holds
    // regardless of library version (some 4.x builds returned Sets).
    return [...new Set(gridDisk(originCell, Math.floor(k)))].filter((c) => c !== "");
  } catch {
    return []; // pentagon/edge overflow defense — never fatal to matching
  }
}
