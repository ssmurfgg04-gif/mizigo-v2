"use client";
// Driver Earnings tab — the Uber weekly-statement pattern (task 16-b;
// docs/UBER_BOLT_TEARDOWN.md §3.16 + copy row #11, DECOMPILE_FINDINGS.md §2.6/§4.4):
// weekly tracker card (Mon 00:00 → Sun 23:59 EAT) → week picker → breakdown
// with the standing commission disclaimer → per-trip drill-down sheet →
// goal card → payout history. Copy is paraphrased clean-room — no Uber/Bolt
// strings. Money is whole KES via kes(), tabular numerals via tnum/Money.

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Banknote, ChevronLeft, ChevronRight, Target, Wallet } from "lucide-react";
import { api, post } from "@/lib/api-client";
import { useSession } from "@/store/session";
import { Button, ChevronLink, EmptyState, ErrorState, Row, SectionTitle, StatusBadge, cx } from "@/components/mizigo/shared/ui";
import { kes, fmtDateTimeEAT } from "@/lib/format";
import { MAX_WEEKS_BACK, weekParamForOffset, type StatementTrip, type WeeklyStatement } from "@/lib/earnings";
import { toast } from "@/hooks/use-toast";

// money is always tabular — one component so every figure in this tab renders alike
function Money({ amount, className = "" }: { amount: number; className?: string }) {
  return <span className={cx("tnum", className)}>{kes(amount)}</span>;
}

function paymentLabel(method: string): string {
  if (method === "MPESA") return "M-PESA";
  if (method === "CASH") return "Cash";
  if (method === "CARD") return "Card";
  return method;
}

function payoutMethodLabel(method: string): string {
  if (method.includes("BANK")) return "Bank";
  if (method.includes("MPESA")) return "M-PESA";
  return method;
}

// payout statuses speak in outcomes, not state-machine keys
const PAYOUT_STATUS: Record<string, { tone: "success" | "active" | "danger" | "warn" | "neutral"; label: string }> = {
  PENDING: { tone: "active", label: "Processing" },
  PROCESSING: { tone: "active", label: "Processing" },
  PAID: { tone: "success", label: "Paid" },
  FAILED: { tone: "danger", label: "Failed" },
  REVERSED: { tone: "warn", label: "Reversed" },
};

// ── per-trip drill-down (bottom sheet, the app's standing sheet pattern) ──────
function TripSheet({ trip, onClose }: { trip: StatementTrip; onClose: () => void }) {
  const fareAccepted = trip.netKes - trip.tipKes; // the number on the offer card
  const keepPct = trip.grossKes > 0 ? Math.round((trip.netKes / trip.grossKes) * 100) : 100;
  return (
    <div className="fixed inset-0 z-50 flex items-end bg-[rgba(23,24,28,0.45)]" onClick={onClose}>
      <div
        className="max-h-[85%] w-full animate-mz-slide-up overflow-y-auto rounded-t-[18px] bg-[var(--surface)] px-5 pb-6 pt-5 thin-scrollbar"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label={`Trip ${trip.code} earnings`}
      >
        <div className="flex items-center justify-between">
          <p className="text-[17px] font-extrabold tracking-tight">Trip <span className="tnum">{trip.code}</span></p>
          <button onClick={onClose} className="flex h-10 w-10 items-center justify-center rounded-full bg-[var(--surface-2)] text-[13px] font-extrabold" aria-label="Close">✕</button>
        </div>
        <p className="mt-1 truncate text-[13.5px] font-bold text-[var(--ink-2)]">{trip.pickupName} → {trip.dropoffName}</p>
        <p className="mt-0.5 text-[12px] font-semibold text-[var(--ink-3)]">
          Completed {fmtDateTimeEAT(trip.completedAt)} · {paymentLabel(trip.paymentMethod)}
        </p>

        {/* the money story, accepted → final → where every shilling went */}
        <div className="mt-3.5 rounded-[12px] bg-[var(--surface-2)] px-4 py-3">
          <Row label="Fare you accepted" value={kes(fareAccepted)} />
          {trip.tipKes > 0 && <Row label="Customer tip — 100% yours" value={`+ ${kes(trip.tipKes)}`} />}
          <Row label="Final net" value={kes(trip.netKes)} strong />
          <div className="my-2 border-t border-dashed border-[var(--line)]" />
          <Row label="Customer paid" value={kes(trip.grossKes)} />
          <Row label="MIZIGO commission" value={`− ${kes(trip.commissionKes)}`} />
          <Row label="Platform fee" value={`− ${kes(trip.platformFeeKes)}`} />
        </div>
        <p className="mt-2.5 text-[11.5px] font-medium leading-relaxed text-[var(--ink-2)]">
          You keep {keepPct}% of this fare — commission and the platform fee are the only deductions.
        </p>
        <p className="mt-1 text-[11.5px] font-medium leading-relaxed text-[var(--ink-2)]">
          Proof of delivery confirmed {fmtDateTimeEAT(trip.podVerifiedAt)} · received by {trip.podRecipient ?? "the recipient"}.
        </p>
      </div>
    </div>
  );
}

// ─── Earnings tab ───
export default function EarningsTab({ onOpenWallet }: { onOpenWallet: () => void }) {
  const { driverId } = useSession();
  const qc = useQueryClient();
  const [offset, setOffset] = useState(0); // weeks back from this week (0..8)
  const [mode, setMode] = useState<"NET" | "GROSS">("NET");
  const [showTrips, setShowTrips] = useState(false);
  const [openTrip, setOpenTrip] = useState<StatementTrip | null>(null);
  const [goalDraft, setGoalDraft] = useState<string | null>(null); // null = not editing
  const [goalBusy, setGoalBusy] = useState(false);

  const { data: wk, isLoading, isError, refetch } = useQuery({
    queryKey: ["driver-earnings", driverId, offset],
    queryFn: () => api<WeeklyStatement>(`/api/driver?earnings=1&week=${weekParamForOffset(offset)}`),
    enabled: !!driverId,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
    retry: 1,
  });

  const editingGoal = goalDraft !== null;
  const goal = wk?.earningsGoal ?? null;
  const goalPct = goal && goal > 0 ? Math.round((wk!.netKes / goal) * 100) : 0;
  const reached = goal != null && goal > 0 && wk!.netKes >= goal;
  const paidThisWeek = (wk?.payouts ?? []).filter((p) => p.status === "PAID").reduce((a, p) => a + p.amount, 0);

  const saveGoal = async (valueKes: number) => {
    setGoalBusy(true);
    try {
      await post("/api/driver", { action: "earnings-goal", goalKes: valueKes });
      await qc.invalidateQueries({ queryKey: ["driver-earnings", driverId] });
      setGoalDraft(null);
      toast({
        title: valueKes === 0 ? "Goal cleared" : "Weekly goal saved",
        description: valueKes === 0 ? undefined : `${kes(valueKes)} a week — this statement tracks your progress.`,
      });
    } catch (e) {
      toast({ title: "Couldn't save the goal", description: (e as Error).message, variant: "destructive" });
    } finally {
      setGoalBusy(false);
    }
  };

  const submitGoalDraft = () => {
    const n = Math.round(Number(goalDraft));
    if (goalDraft !== "" && (!Number.isFinite(n) || n < 0 || n > 1_000_000)) {
      toast({ title: "Enter a goal between KES 0 and KES 1,000,000." });
      return;
    }
    void saveGoal(goalDraft === "" ? 0 : n);
  };

  const pickerLabel = offset === 0 ? "This week" : offset === 1 ? "Last week" : (wk?.weekLabel ?? "…");

  return (
    <div className="space-y-4 pb-6">
      <h1 className="px-1 pt-1 text-[24px] font-extrabold tracking-tight">Earnings</h1>

      {/* week picker — the Mon–Sun statement cycle, bounded to 8 weeks back */}
      <div className="flex items-center justify-between rounded-[12px] border border-[var(--line)] bg-[var(--surface)] px-2 py-1.5">
        <button
          onClick={() => setOffset((o) => Math.min(MAX_WEEKS_BACK, o + 1))}
          disabled={offset >= MAX_WEEKS_BACK}
          className="flex h-9 w-9 items-center justify-center rounded-full text-[var(--ink-2)] transition hover:bg-[var(--surface-2)] disabled:pointer-events-none disabled:opacity-35"
          aria-label="Previous week"
        >
          <ChevronLeft size={18} strokeWidth={2.6} />
        </button>
        <span className="min-w-0 truncate px-2 text-[13px] font-extrabold tracking-tight">{pickerLabel}</span>
        <button
          onClick={() => setOffset((o) => Math.max(0, o - 1))}
          disabled={offset === 0}
          className="flex h-9 w-9 items-center justify-center rounded-full text-[var(--ink-2)] transition hover:bg-[var(--surface-2)] disabled:pointer-events-none disabled:opacity-35"
          aria-label="Next week"
        >
          <ChevronRight size={18} strokeWidth={2.6} />
        </button>
      </div>

      {isLoading || !wk ? (
        // skeleton shaped like the statement it becomes
        <div className="space-y-4">
          <div className="rounded-[16px] bg-[var(--ink)] p-5">
            <div className="h-3 w-24 animate-pulse rounded bg-white/20" />
            <div className="mt-3 h-9 w-44 animate-pulse rounded bg-white/20" />
            <div className="mt-4 space-y-2">
              <div className="h-2.5 w-full animate-pulse rounded bg-white/15" />
              <div className="h-2.5 w-2/3 animate-pulse rounded bg-white/15" />
            </div>
          </div>
          <div className="rounded-[16px] border border-[var(--line)] bg-[var(--surface)] p-4">
            <div className="space-y-3">
              {[0, 1, 2, 3].map((i) => <div key={i} className="h-3.5 animate-pulse rounded bg-[var(--surface-2)]" style={{ width: `${85 - i * 12}%` }} />)}
            </div>
          </div>
        </div>
      ) : isError ? (
        <div className="rounded-[16px] border border-[var(--line)] bg-[var(--surface)]">
          <ErrorState
            title="Couldn't load your earnings"
            body="Don't worry — your trips and earnings are recorded. Check your connection and try again."
            actions={<Button variant="brand" onClick={() => refetch()}>Try again</Button>}
          />
        </div>
      ) : (
        <>
          {/* weekly statement card */}
          <div className="rounded-[16px] bg-[var(--ink)] p-5 text-white">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[11.5px] font-bold uppercase tracking-widest text-white/50">
                  {mode === "NET" ? "Net this week" : "Gross this week"}
                </p>
                <Money amount={mode === "NET" ? wk.netKes : wk.grossKes} className="mt-1 block text-[34px] font-extrabold leading-none tracking-tight" />
                <p className="mt-1.5 text-[12px] font-semibold text-white/60">{wk.weekLabel}</p>
              </div>
              {/* NET/GROSS toggle — Bolt's commission-transparency mode switch */}
              <div className="flex shrink-0 rounded-full bg-white/10 p-1" role="group" aria-label="Net or gross">
                {(["NET", "GROSS"] as const).map((m) => (
                  <button
                    key={m}
                    onClick={() => setMode(m)}
                    className={`rounded-full px-3 py-1 text-[11.5px] font-extrabold transition ${mode === m ? "bg-white text-[var(--ink)]" : "text-white/70"}`}
                    aria-pressed={mode === m}
                  >
                    {m === "NET" ? "Net" : "Gross"}
                  </button>
                ))}
              </div>
            </div>
            {/* standing disclaimer — always on, under the number */}
            <p className="mt-3 text-[11.5px] font-medium leading-relaxed text-white/70">
              {mode === "NET"
                ? "Net is your take-home after MIZIGO's commission and platform fee."
                : "Gross is what customers paid before commission. Switch to Net for your take-home."}
            </p>
            {/* payout status line */}
            <p className="mt-2.5 border-t border-white/10 pt-2.5 text-[12px] font-semibold text-white/60">
              {paidThisWeek > 0
                ? `${kes(paidThisWeek)} withdrawn this week`
                : wk.pendingBalanceKes > 0
                  ? `${kes(wk.pendingBalanceKes)} ready to withdraw`
                  : "No withdrawal yet this week"}
            </p>
          </div>

          {wk.trips === 0 ? (
            <div className="rounded-[16px] border border-[var(--line)] bg-[var(--surface)]">
              <EmptyState
                icon={<Banknote size={22} />}
                title="No earnings this week"
                body="This statement fills in as you complete deliveries. Check another week, or go online to pick up your first job."
              />
            </div>
          ) : (
            <>
              {/* weekly breakdown */}
              <div className="rounded-[16px] border border-[var(--line)] bg-[var(--surface)] p-4">
                <SectionTitle action={<ChevronLink onClick={() => setShowTrips((v) => !v)}>{showTrips ? "Hide trips" : "See details"}</ChevronLink>}>
                  Weekly breakdown
                </SectionTitle>
                <div className="mt-2">
                  <Row label="Trips" value={`${wk.trips}`} />
                  <Row label="Gross fares" value={kes(wk.grossKes)} />
                  <Row label="MIZIGO commission" value={`− ${kes(wk.commissionKes)}`} />
                  <Row label="Platform fee" value={`− ${kes(wk.platformFeeKes)}`} />
                  <Row label="Tips — 100% yours" value={kes(wk.tipsKes)} />
                  <Row label="Cash collected" value={kes(wk.cashCollectedKes)} />
                </div>
                <p className="mt-2 text-[11px] font-medium leading-relaxed text-[var(--ink-3)]">
                  Cash trips are paid to you in person by the customer — they don't add to your M-PESA balance.
                </p>
              </div>

              {/* per-trip drill-down */}
              {showTrips && (
                <div className="space-y-2.5">
                  {wk.tripList.map((t) => (
                    <button
                      key={t.id}
                      onClick={() => setOpenTrip(t)}
                      className="w-full rounded-[14px] border border-[var(--line)] bg-[var(--surface)] p-4 text-left transition hover:bg-[var(--surface-2)] active:translate-y-px"
                    >
                      <div className="flex items-center justify-between gap-3">
                        <span className="tnum min-w-0 truncate text-[11.5px] font-bold text-[var(--ink-3)]">{t.code} · {fmtDateTimeEAT(t.completedAt)}</span>
                        <Money amount={t.netKes} className="shrink-0 text-[15px] font-extrabold" />
                      </div>
                      <p className="mt-1.5 truncate text-[14px] font-bold">{t.pickupName} → {t.dropoffName}</p>
                      <p className="mt-0.5 text-[12px] font-medium text-[var(--ink-2)]">
                        {paymentLabel(t.paymentMethod)}{t.tipKes > 0 ? ` · includes a ${kes(t.tipKes)} tip` : ""}
                      </p>
                    </button>
                  ))}
                </div>
              )}
            </>
          )}

          {/* weekly goal */}
          <div className="rounded-[16px] border border-[var(--line)] bg-[var(--surface)] p-4">
            <SectionTitle>Weekly goal</SectionTitle>
            {goal != null && goal > 0 ? (
              <>
                <div className="mt-3 flex items-center justify-between text-[12.5px] font-bold">
                  <span className="tnum">{kes(wk.netKes)} of {kes(goal)}</span>
                  <span className="tnum text-[var(--ink-2)]">{goalPct}%</span>
                </div>
                <div className="mt-1.5 h-2.5 overflow-hidden rounded-full bg-[var(--surface-2)]">
                  <div
                    className={`h-full rounded-full transition-all ${reached ? "bg-[var(--success)]" : "bg-[var(--brand)]"}`}
                    style={{ width: `${Math.min(100, Math.max(2, goalPct))}%` }}
                    role="progressbar"
                    aria-valuenow={Math.min(100, goalPct)}
                    aria-valuemin={0}
                    aria-valuemax={100}
                  />
                </div>
                <p className={`mt-2 text-[12px] font-bold ${reached ? "text-[var(--success)]" : "text-[var(--ink-2)]"}`}>
                  {reached ? "Goal reached — every extra shilling this week is ahead of target." : `${kes(Math.max(0, goal - wk.netKes))} to go this week.`}
                </p>
              </>
            ) : (
              <p className="mt-1 text-[12.5px] font-medium leading-relaxed text-[var(--ink-2)]">
                Set a weekly target and this statement tracks your progress against it.
              </p>
            )}
            {editingGoal ? (
              <div className="mt-3 flex items-center gap-2.5">
                <input
                  value={goalDraft}
                  onChange={(e) => setGoalDraft(e.target.value.replace(/\D/g, "").slice(0, 7))}
                  placeholder="e.g. 20000"
                  inputMode="numeric"
                  aria-label="Weekly goal in KES"
                  className="tnum h-12 flex-1 rounded-[10px] border border-[var(--line)] bg-[var(--paper)] px-3.5 text-[15px] font-extrabold outline-none focus:border-[var(--brand)]"
                />
                <Button variant="brand" className="h-12 px-5" onClick={submitGoalDraft} loading={goalBusy}>Save</Button>
                <Button variant="ghost" className="h-12" onClick={() => setGoalDraft(null)}>Cancel</Button>
              </div>
            ) : (
              <div className="mt-3 flex items-center gap-3">
                <Button
                  variant="outline"
                  className="h-11 px-4 text-[13px]"
                  onClick={() => setGoalDraft(goal != null && goal > 0 ? String(goal) : "")}
                >
                  <Target size={14} /> {goal != null && goal > 0 ? "Edit goal" : "Set a goal"}
                </Button>
                {goal != null && goal > 0 && (
                  <button
                    onClick={() => void saveGoal(0)}
                    disabled={goalBusy}
                    className="text-[12px] font-bold text-[var(--ink-3)] underline underline-offset-4"
                  >
                    Clear goal
                  </button>
                )}
              </div>
            )}
          </div>

          {/* wallet — the withdraw flow lives in the wallet screen */}
          <button
            onClick={onOpenWallet}
            className="flex w-full items-center gap-3.5 rounded-[16px] border border-[var(--line)] bg-[var(--surface)] p-4 text-left transition hover:bg-[var(--surface-2)] active:translate-y-px"
          >
            <span className="flex h-11 w-11 items-center justify-center rounded-full bg-[var(--surface-2)] text-[var(--ink-2)]"><Wallet size={18} /></span>
            <span className="min-w-0 flex-1">
              <span className="block text-[14.5px] font-extrabold">Wallet</span>
              <span className="block text-[12px] font-medium text-[var(--ink-2)]">
                <Money amount={wk.pendingBalanceKes} className="font-bold" /> ready to withdraw · M-PESA
              </span>
            </span>
            <ChevronRight size={16} className="text-[var(--ink-3)]" />
          </button>

          {/* payout history */}
          <div className="rounded-[16px] border border-[var(--line)] bg-[var(--surface)] p-4">
            <SectionTitle>Payouts this week</SectionTitle>
            <div className="mt-2 divide-y divide-[var(--line)]">
              {wk.payouts.length === 0 && <p className="py-3 text-[13px] font-medium text-[var(--ink-2)]">No withdrawals this week.</p>}
              {wk.payouts.map((p) => {
                const meta = PAYOUT_STATUS[p.status] ?? { tone: "neutral" as const, label: p.status };
                return (
                  <div key={p.id} className="flex items-center justify-between gap-3 py-3">
                    <div className="min-w-0">
                      <p className="tnum text-[14px] font-extrabold">{kes(p.amount)}</p>
                      <p className="truncate text-[11.5px] font-semibold text-[var(--ink-3)]">
                        {fmtDateTimeEAT(p.createdAt)}
                        {p.failureReason ? ` · ${p.failureReason}` : p.ref ? ` · ${p.ref}` : ""}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <span className="rounded-full bg-[var(--surface-2)] px-2.5 py-1 text-[11px] font-bold text-[var(--ink-2)]">{payoutMethodLabel(p.method)}</span>
                      <StatusBadge tone={meta.tone}>{meta.label}</StatusBadge>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </>
      )}

      {openTrip && <TripSheet trip={openTrip} onClose={() => setOpenTrip(null)} />}
    </div>
  );
}
