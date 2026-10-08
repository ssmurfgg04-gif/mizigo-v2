// Weekly-statement date math for the driver Earnings tab (task 16-b).
// Golden vectors pinned to real 2026 calendar weeks: 2 Nov 2026 is a Monday,
// 8 Nov a Sunday. EAT = UTC+3, so Monday 00:00 Nairobi = Sunday 21:00 UTC.
import { describe, it, expect } from "vitest";
import {
  weekBoundsEAT, weekLabelEAT, resolveWeekAnchor, weekParamForOffset, MAX_WEEKS_BACK,
} from "../../src/lib/earnings";

const iso = (d: Date) => d.toISOString();

describe("weekBoundsEAT (Mon 00:00 → Sun 23:59:59.999 Nairobi)", () => {
  it("mid-week EAT maps back to that Monday 00:00 EAT", () => {
    // Wed 4 Nov 2026 13:30 EAT = 10:30 UTC
    const { start, end } = weekBoundsEAT(new Date("2026-11-04T10:30:00Z"));
    expect(iso(start)).toBe("2026-11-01T21:00:00.000Z"); // Mon 2 Nov 00:00 EAT
    expect(iso(end)).toBe("2026-11-08T20:59:59.999Z"); // Sun 8 Nov 23:59:59.999 EAT
  });

  it("Sunday 23:30 EAT still belongs to the week that started 6 days earlier", () => {
    const { start, end } = weekBoundsEAT(new Date("2026-11-08T20:30:00Z"));
    expect(iso(start)).toBe("2026-11-01T21:00:00.000Z");
    expect(iso(end)).toBe("2026-11-08T20:59:59.999Z");
  });

  it("Monday 00:00 EAT is the first instant of a brand-new week", () => {
    const { start, end } = weekBoundsEAT(new Date("2026-11-08T21:00:00Z")); // Mon 9 Nov 00:00 EAT
    expect(iso(start)).toBe("2026-11-08T21:00:00.000Z");
    expect(iso(end)).toBe("2026-11-15T20:59:59.999Z");
  });

  it("weeks are exactly 7 days and every instant lands in one", () => {
    for (let t = Date.UTC(2026, 10, 1); t <= Date.UTC(2026, 10, 16); t += 3_600_000) {
      const { start, end } = weekBoundsEAT(new Date(t));
      expect(end.getTime() - start.getTime()).toBe(7 * 86_400_000 - 1);
      expect(start.getTime()).toBeLessThanOrEqual(t);
      expect(end.getTime()).toBeGreaterThanOrEqual(t);
      // start is always Monday 00:00 in EAT wall-clock (UTC+3 shift)
      expect(new Date(start.getTime() + 3 * 3_600_000).getUTCDay()).toBe(1);
      expect(new Date(start.getTime() + 3 * 3_600_000).getUTCHours()).toBe(0);
    }
  });
});

describe("weekLabelEAT", () => {
  it("renders the Mon–Sun statement cycle label", () => {
    const { start, end } = weekBoundsEAT(new Date("2026-11-04T10:30:00Z"));
    expect(weekLabelEAT(start, end)).toBe("Mon 2 Nov – Sun 8 Nov");
  });

  it("labels a week that straddles a month boundary with both months", () => {
    const { start, end } = weekBoundsEAT(new Date("2026-10-28T10:30:00Z")); // Wed 28 Oct
    expect(weekLabelEAT(start, end)).toBe("Mon 26 Oct – Sun 1 Nov");
  });
});

describe("resolveWeekAnchor (?week= param safety)", () => {
  const NOW = new Date("2026-11-04T10:30:00Z"); // Wed 4 Nov 2026, mid-week

  it("passes a valid in-range date through (any time inside the week works)", () => {
    const a = resolveWeekAnchor("2026-10-30", NOW); // Fri 30 Oct → week of Mon 26 Oct
    expect(weekBoundsEAT(a).start.toISOString()).toBe("2026-10-25T21:00:00.000Z");
  });

  it("falls back to now on malformed input", () => {
    expect(resolveWeekAnchor("not-a-date", NOW).getTime()).toBe(NOW.getTime());
    expect(resolveWeekAnchor("2026-13-99", NOW).getTime()).toBe(NOW.getTime());
    expect(resolveWeekAnchor(null, NOW).getTime()).toBe(NOW.getTime());
  });

  it("clamps requests older than 8 weeks into the oldest allowed week", () => {
    // 2026-07-01 is 18 weeks back → clamped to the week starting 8 weeks before this week
    const a = resolveWeekAnchor("2026-07-01", NOW);
    const oldestStart = weekBoundsEAT(NOW).start.getTime() - MAX_WEEKS_BACK * 7 * 86_400_000;
    const { start, end } = weekBoundsEAT(a);
    expect(start.getTime()).toBe(oldestStart);
    expect(a.getTime()).toBeGreaterThanOrEqual(start.getTime());
    expect(a.getTime()).toBeLessThanOrEqual(end.getTime());
  });
});

describe("weekParamForOffset (client picker → ?week= value)", () => {
  it("returns today for the current week and 7-day steps back", () => {
    const today = new Date().toISOString().slice(0, 10);
    expect(weekParamForOffset(0)).toBe(today);
    const expected = new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 10);
    expect(weekParamForOffset(1)).toBe(expected);
  });

  it("clamps to the 8-week bound and rejects negatives", () => {
    expect(weekParamForOffset(99)).toBe(weekParamForOffset(MAX_WEEKS_BACK));
    expect(weekParamForOffset(-3)).toBe(weekParamForOffset(0));
  });
});
