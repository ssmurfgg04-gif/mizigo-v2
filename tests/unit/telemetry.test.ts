// telemetry unit tests — nearest-rank histogram percentiles, error counters,
// ring caps, structured log shape, recent-events ring (task 10-E).
import { describe, it, expect, beforeEach, vi } from "vitest";
import { record, snapshot, percentile, logEvent, recentEvents, resetMetrics } from "../../src/lib/telemetry";

describe("percentile (nearest-rank)", () => {
  it("known series [10,20,30,40,50] → p50=30, p95=50", () => {
    const s = [10, 20, 30, 40, 50];
    expect(percentile(s, 0.5)).toBe(30);
    expect(percentile(s, 0.95)).toBe(50);
  });

  it("series 1..100 → p50=50, p95=95", () => {
    const s = Array.from({ length: 100 }, (_, i) => i + 1);
    expect(percentile(s, 0.5)).toBe(50);
    expect(percentile(s, 0.95)).toBe(95);
  });

  it("degenerate cases", () => {
    expect(percentile([], 0.5)).toBe(0);
    expect(percentile([42], 0.95)).toBe(42);
  });
});

describe("metrics record + snapshot", () => {
  beforeEach(() => resetMetrics());

  it("computes p50/p95 from the recorded series", () => {
    for (const ms of [10, 20, 30, 40, 50]) record("r", ms);
    const snap = snapshot();
    expect(snap.routes["r"]).toMatchObject({ count: 5, p50: 30, p95: 50, max: 50, errors: 0 });
    expect(snap.totalRequests).toBe(5);
    expect(snap.totalErrors).toBe(0);
  });

  it("counts errors separately without polluting latency stats", () => {
    record("r", 100, true);
    record("r", 200, false);
    record("r", 300, false);
    const snap = snapshot();
    expect(snap.routes["r"].count).toBe(3);
    expect(snap.routes["r"].errors).toBe(2);
    expect(snap.routes["r"].p50).toBe(200); // [100,200,300] → nearest-rank p50 = 200
    expect(snap.totalErrors).toBe(2);
  });

  it("keeps only the last 512 samples per route (ring) while count keeps growing", () => {
    for (let i = 1; i <= 600; i++) record("r", i);
    const snap = snapshot();
    expect(snap.routes["r"].count).toBe(600);
    expect(snap.routes["r"].max).toBe(600);
    // ring holds 89..600 → sorted p50 = ceil(0.5·512)th = 256th of 89..600 → 344
    expect(snap.routes["r"].p50).toBe(344);
    expect(snap.routes["r"].p95).toBe(575); // ceil(0.95·512)=487th → 89 + 486
  });

  it("separates routes and rounds latency", () => {
    record("a", 10.4);
    record("b", 20.6);
    const snap = snapshot();
    expect(snap.routes["a"].p50).toBe(10);
    expect(snap.routes["b"].p50).toBe(21);
    expect(Object.keys(snap.routes).sort()).toEqual(["a", "b"]);
  });
});

describe("logEvent + recentEvents", () => {
  beforeEach(() => {
    resetMetrics();
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  it("emits ONE JSON line with ts + traceId + fields", () => {
    const traceId = logEvent({ route: "api:test", actor: "CUSTOMER", latencyMs: 42.4, ok: true });
    expect(traceId).toMatch(/[0-9a-f-]{36}/);
    expect(console.log).toHaveBeenCalledTimes(1);
    const line = JSON.parse((console.log as ReturnType<typeof vi.spyOn>).mock.calls[0][0] as string);
    expect(line.route).toBe("api:test");
    expect(line.actor).toBe("CUSTOMER");
    expect(line.latencyMs).toBe(42); // rounded
    expect(line.ok).toBe(true);
    expect(line.level).toBe("info");
    expect(typeof line.ts).toBe("string");
    expect(new Date(line.ts).toString()).not.toBe("Invalid Date");
    expect(line.traceId).toBe(traceId);
  });

  it("keeps only the last 50 events (ring, newest last)", () => {
    for (let i = 0; i < 60; i++) logEvent({ route: `r${i}` });
    const events = recentEvents();
    expect(events).toHaveLength(50);
    expect(events[0].route).toBe("r10"); // oldest 10 dropped
    expect(events[49].route).toBe("r59");
  });

  it("omits absent optional fields (compact lines)", () => {
    logEvent({ route: "api:min" });
    const line = JSON.parse((console.log as ReturnType<typeof vi.spyOn>).mock.calls[0][0] as string);
    expect(line).not.toHaveProperty("actor");
    expect(line).not.toHaveProperty("shipmentId");
    expect(line).not.toHaveProperty("latencyMs");
  });
});
