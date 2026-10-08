// GPS-mismatch arrival gate tests (Bolt Driver pattern — DECOMPILE_FINDINGS
// §Deep Dive 2). Pure math + freshness semantics, zero I/O.
import { describe, it, expect } from "vitest";
import { GPS_MISMATCH_METERS, GPS_FRESH_WINDOW_MS, gpsMismatchMeters } from "../../src/lib/geo";

const NOW = new Date("2026-10-08T10:00:00Z");
// ~111 m per 0.001° of latitude in Nairobi
const pickup = { lat: -1.2841, lng: 36.8265 };

describe("gpsMismatchMeters (arrive/deliver gate)", () => {
  it("null when the driver has no GPS report at all (never gates sandbox/demo flows)", () => {
    expect(gpsMismatchMeters(null, pickup, NOW)).toBeNull();
    expect(gpsMismatchMeters({ lat: -1.28, lng: 36.82, gpsReportedAt: null }, pickup, NOW)).toBeNull();
  });

  it("null when the report is stale (older than the freshness window)", () => {
    const stale = new Date(NOW.getTime() - GPS_FRESH_WINDOW_MS - 60_000);
    expect(gpsMismatchMeters({ lat: -1.2, lng: 36.8, gpsReportedAt: stale }, pickup, NOW)).toBeNull();
  });

  it("accepts a report exactly at the freshness boundary", () => {
    const edge = new Date(NOW.getTime() - GPS_FRESH_WINDOW_MS + 1000);
    const d = gpsMismatchMeters({ lat: -1.284, lng: 36.8265, gpsReportedAt: edge }, pickup, NOW);
    expect(d).not.toBeNull();
    expect(d!).toBeLessThanOrEqual(GPS_MISMATCH_METERS);
  });

  it("returns ~111m for a 0.001° latitude offset (haversine sanity)", () => {
    const d = gpsMismatchMeters({ lat: pickup.lat + 0.001, lng: pickup.lng, gpsReportedAt: NOW }, pickup, NOW);
    expect(d).toBeGreaterThanOrEqual(105);
    expect(d).toBeLessThanOrEqual(117);
  });

  it("a fresh on-site report returns a small distance (gate stays open)", () => {
    const d = gpsMismatchMeters({ lat: pickup.lat + 0.0002, lng: pickup.lng + 0.0002, gpsReportedAt: NOW }, pickup, NOW);
    expect(d!).toBeLessThanOrEqual(GPS_MISMATCH_METERS);
  });

  it("a fresh far-away report returns a distance beyond the gate threshold", () => {
    // ~0.01° latitude ≈ 1.1 km — clearly off-site
    const d = gpsMismatchMeters({ lat: pickup.lat + 0.01, lng: pickup.lng, gpsReportedAt: NOW }, pickup, NOW);
    expect(d!).toBeGreaterThan(GPS_MISMATCH_METERS);
  });
});
