// Unit tests — cancellation economics (docs/UBER_BOLT_TEARDOWN.md §3.11 pattern).
import { describe, expect, it } from "vitest";
import { cancellationQuote, CANCEL_REASONS } from "@/lib/cancellation";

const T0 = new Date("2026-10-07T10:00:00Z");
const at = (min: number) => new Date(T0.getTime() + min * 60_000);
const ev = (type: string, createdAt: Date) => ({ type, createdAt });
const base = {
  status: "MATCHING",
  fareTotal: 3_000,
  paymentStatus: "CONFIRMED",
  events: [] as { type: string; createdAt: Date }[],
  liveProgress: null as number | null,
  feeKes: 200,
  graceMinutes: 2,
};

describe("cancellationQuote", () => {
  it("is free before the driver accepts (no DRIVER_ACCEPTED event)", () => {
    const q = cancellationQuote({ ...base, status: "MATCHING", events: [ev("DRIVER_ASSIGNED", T0)], now: at(30) });
    expect(q.free).toBe(true);
    expect(q.feeKes).toBe(0);
    expect(q.refundKes).toBe(3_000);
  });

  it("is free inside the grace window and reports the remaining minutes", () => {
    const q = cancellationQuote({
      ...base, status: "DRIVER_EN_ROUTE",
      events: [ev("DRIVER_ACCEPTED", T0)], now: at(1),
    });
    expect(q.free).toBe(true);
    expect(q.graceRemainingMin).toBe(1);
    expect(q.refundKes).toBe(3_000);
  });

  it("charges the fee after the grace window and reduces the refund", () => {
    const q = cancellationQuote({
      ...base, status: "DRIVER_EN_ROUTE",
      events: [ev("DRIVER_ACCEPTED", T0)], now: at(5),
    });
    expect(q.free).toBe(false);
    expect(q.feeKes).toBe(200);
    expect(q.refundKes).toBe(2_800);
    expect(q.graceRemainingMin).toBe(0);
  });

  it("waives the fee when the driver has made no progress toward the pickup", () => {
    const q = cancellationQuote({
      ...base, status: "DRIVER_EN_ROUTE", liveProgress: 0.02,
      events: [ev("DRIVER_ACCEPTED", T0)], now: at(12),
    });
    expect(q.waived).toBe(true);
    expect(q.free).toBe(true);
    expect(q.waiverReason).toMatch(/hasn't made progress/i);
    expect(q.refundKes).toBe(3_000);
  });

  it("does not waive when the driver is progressing (progress above threshold)", () => {
    const q = cancellationQuote({
      ...base, status: "DRIVER_EN_ROUTE", liveProgress: 0.4,
      events: [ev("DRIVER_ACCEPTED", T0)], now: at(12),
    });
    expect(q.free).toBe(false);
    expect(q.feeKes).toBe(200);
  });

  it("charges nothing when payment was not confirmed (cash / pending)", () => {
    const q = cancellationQuote({
      ...base, paymentStatus: "PENDING", status: "DRIVER_EN_ROUTE",
      events: [ev("DRIVER_ACCEPTED", T0)], now: at(5),
    });
    expect(q.free).toBe(true);
    expect(q.feeKes).toBe(0);
    expect(q.refundKes).toBe(3_000);
  });

  it("never charges more than the fare (fee capped at the paid total)", () => {
    const q = cancellationQuote({
      ...base, fareTotal: 150,
      events: [ev("DRIVER_ACCEPTED", T0)], now: at(5),
    });
    expect(q.feeKes).toBe(150);
    expect(q.refundKes).toBe(0);
  });

  it("exposes a non-empty reason picker", () => {
    expect(CANCEL_REASONS.length).toBeGreaterThanOrEqual(4);
    expect(CANCEL_REASONS).toContain("Other");
  });
});
