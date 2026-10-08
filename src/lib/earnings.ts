// MIZIGO — driver weekly earnings statement math (Uber Earnings-tab pattern,
// docs/UBER_BOLT_TEARDOWN.md §3.16 + copy row #11; DECOMPILE_FINDINGS.md §2.6/§4.4).
//
// The statement cycle is the Bolt/Uber week: Monday 00:00:00 → Sunday 23:59:59
// East Africa Time (UTC+3). All date math here is offset-based — no Intl
// timezone data (same approach as the EAT helpers in src/lib/format.ts) — so
// it works identically in the API route, the client and vitest.

export const EAT_OFFSET_MS = 3 * 60 * 60 * 1000;
export const MAX_WEEKS_BACK = 8; // the week picker is bounded to 8 weeks back
const DAY_MS = 86_400_000;

const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * Monday 00:00:00 EAT → Sunday 23:59:59.999 EAT for the week containing `at`.
 * Shift to EAT wall-clock (treat it as UTC), back up to Monday midnight, shift
 * back — the inverse of fmtTimeEAT in src/lib/format.ts.
 */
export function weekBoundsEAT(at: Date): { start: Date; end: Date } {
  const eat = new Date(at.getTime() + EAT_OFFSET_MS);
  const monday = new Date(eat);
  monday.setUTCDate(eat.getUTCDate() - ((eat.getUTCDay() + 6) % 7)); // Monday = 0
  monday.setUTCHours(0, 0, 0, 0);
  const start = new Date(monday.getTime() - EAT_OFFSET_MS);
  return { start, end: new Date(start.getTime() + 7 * DAY_MS - 1) };
}

/** "Mon 3 Nov – Sun 9 Nov" — EAT wall-clock on both ends of the week. */
export function weekLabelEAT(start: Date, end: Date): string {
  const s = new Date(start.getTime() + EAT_OFFSET_MS);
  const e = new Date(end.getTime() + EAT_OFFSET_MS);
  return `${DOW[s.getUTCDay()]} ${s.getUTCDate()} ${MONTHS[s.getUTCMonth()]} – ${DOW[e.getUTCDay()]} ${e.getUTCDate()} ${MONTHS[e.getUTCMonth()]}`;
}

/**
 * Resolve the `?week=YYYY-MM-DD` statement param (any date inside the target
 * week) to a safe anchor: invalid/future dates fall back to now, and dates
 * older than MAX_WEEKS_BACK weeks clamp to the oldest allowed week.
 */
export function resolveWeekAnchor(weekParam: string | null, now: Date = new Date()): Date {
  if (weekParam) {
    // YYYY-MM-DD parses as UTC midnight — a safe "any time that day" anchor
    if (/^\d{4}-\d{2}-\d{2}$/.test(weekParam)) {
      const d = new Date(`${weekParam}T00:00:00Z`);
      if (!Number.isNaN(d.getTime())) {
        const oldest = weekBoundsEAT(now).start.getTime() - MAX_WEEKS_BACK * 7 * DAY_MS;
        if (d.getTime() >= oldest) return d;
        return new Date(oldest + DAY_MS / 2); // inside the oldest allowed week
      }
    }
  }
  return now;
}

/** `?week=` param for the week `offset` weeks back from now (0 = this week). */
export function weekParamForOffset(offset: number): string {
  const weeksBack = Math.max(0, Math.min(MAX_WEEKS_BACK, Math.round(offset)));
  return new Date(Date.now() - weeksBack * 7 * DAY_MS).toISOString().slice(0, 10);
}

// ── Statement DTO (GET /api/driver?earnings=1&week=…) ────────────────────────
// Money is whole KES everywhere (kes() renders it). Tips are 100% the driver's
// and already ride inside driverEarnings/netKes (the rate action increments
// Shipment.driverEarnings) — tipKes is broken out for the transparency rows.

export interface StatementTrip {
  id: string;
  code: string;
  completedAt: string; // entered COMPLETED (stateEnteredAt)
  podVerifiedAt: string; // POD handshake confirmed — the statement's week key
  pickupName: string;
  dropoffName: string;
  grossKes: number; // fareTotal — what the customer paid
  netKes: number; // driverEarnings (includes the tip)
  commissionKes: number;
  platformFeeKes: number;
  tipKes: number; // from the customer's Rating row (0 when none)
  paymentMethod: string;
  podRecipient: string | null;
}

export interface StatementPayout {
  id: string;
  amount: number;
  status: string; // PENDING | PROCESSING | PAID | FAILED | REVERSED
  method: string; // MPESA | PAYSTACK_MPESA | PAYSTACK_BANK
  ref: string | null;
  createdAt: string;
  processedAt: string | null;
  failureReason: string | null;
}

export interface WeeklyStatement {
  weekStart: string; // Monday 00:00:00 EAT (ISO)
  weekEnd: string; // Sunday 23:59:59 EAT (ISO)
  weekLabel: string; // "Mon 3 Nov – Sun 9 Nov"
  isCurrentWeek: boolean;
  trips: number; // completed trips in the week
  grossKes: number;
  netKes: number;
  commissionKes: number;
  platformFeeKes: number;
  tipsKes: number;
  cashCollectedKes: number; // gross on CASH trips — paid to the driver in person
  tripList: StatementTrip[];
  payouts: StatementPayout[];
  pendingBalanceKes: number; // withdrawable now (mirrors /api/driver/action withdraw)
  earningsGoal: number | null;
}
