// MIZIGO — Cancellation economics. Structure borrowed from Uber's documented
// policy (see docs/UBER_BOLT_TEARDOWN.md §3.11): a short grace window after
// the driver accepts, the fee always shown *before* the customer confirms,
// and automatic waivers when the driver is at fault. All money decisions are
// made server-side; the client only renders what this module returns.

export interface CancellationEvent {
  type: string;
  createdAt: Date;
}

export interface CancellationInput {
  status: string;
  fareTotal: number;
  paymentStatus: string;
  events: CancellationEvent[];
  liveProgress: number | null; // 0..1 on the TO_PICKUP leg, null otherwise
  now?: Date;
  feeKes: number; // platform setting `cancellationFeeKes`
  graceMinutes: number; // platform setting `cancelGraceMinutes`
}

export interface CancellationQuote {
  feeKes: number;
  free: boolean; // no fee: before driver acceptance, inside the grace window, or waived
  graceRemainingMin: number | null; // > 0 while the free window is open
  waived: boolean;
  waiverReason: string | null;
  refundKes: number; // what the customer gets back (fareTotal − fee)
}

// The grace window only starts mattering once the driver has ACCEPTED — before
// that (MATCHING / DRIVER_ASSIGNED) the driver has not committed fuel or time.
const DRIVER_ACCEPTED = "DRIVER_ACCEPTED";

// Waiver: no-progress rule. If the driver accepted but hasn't meaningfully
// moved toward the pickup for this long, the fee is waived (Uber documents
// waivers for "made no progress"; our threshold is our own product decision).
export const NO_PROGRESS_MINUTES = 10;
export const NO_PROGRESS_THRESHOLD = 0.08;

export function cancellationQuote(input: CancellationInput): CancellationQuote {
  const now = input.now ?? new Date();
  const accepted = input.events.find((e) => e.type === DRIVER_ACCEPTED);

  // never charged before the driver accepts — the driver has nothing at stake
  if (!accepted) {
    return { feeKes: 0, free: true, graceRemainingMin: null, waived: false, waiverReason: null, refundKes: input.fareTotal };
  }

  const acceptedAt = new Date(accepted.createdAt);
  const minutesSinceAccept = (now.getTime() - acceptedAt.getTime()) / 60_000;
  const graceRemainingMin = Math.max(0, Math.round(input.graceMinutes - minutesSinceAccept));

  if (graceRemainingMin > 0) {
    return { feeKes: 0, free: true, graceRemainingMin, waived: false, waiverReason: null, refundKes: input.fareTotal };
  }

  // automatic waiver: the driver hasn't made progress toward the pickup
  if (input.status === "DRIVER_EN_ROUTE" && input.liveProgress != null && minutesSinceAccept >= NO_PROGRESS_MINUTES && input.liveProgress < NO_PROGRESS_THRESHOLD) {
    return {
      feeKes: 0, free: true, graceRemainingMin: 0, waived: true,
      waiverReason: "Your driver hasn't made progress toward the pickup — no fee applies.",
      refundKes: input.fareTotal,
    };
  }

  // fee applies — never more than what was paid, refunds never go negative
  const feeKes = input.paymentStatus === "CONFIRMED" ? Math.min(input.feeKes, input.fareTotal) : 0;
  if (feeKes === 0) {
    // unpaid (cash / pending) or nothing to withhold — nothing to charge
    return { feeKes: 0, free: true, graceRemainingMin: 0, waived: false, waiverReason: null, refundKes: input.fareTotal };
  }
  return { feeKes, free: false, graceRemainingMin: 0, waived: false, waiverReason: null, refundKes: Math.max(0, input.fareTotal - feeKes) };
}

// The customer-facing reason picker (fee screen, Uber shows reasons before the
// fee confirm). Plain English by design — the i18n track owns translations.
export const CANCEL_REASONS = [
  "Booked by mistake",
  "Found another transporter",
  "Taking too long to match",
  "Change of plans",
  "Other",
] as const;
