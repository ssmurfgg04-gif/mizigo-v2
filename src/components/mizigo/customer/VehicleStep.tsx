"use client";
// Vehicle step — the recommendation engine surface. "We found the right vehicle"
// plus alternatives with DB-driven prices and honest fit warnings.

import { useQuery } from "@tanstack/react-query";
import { ChevronDown, Users, Zap } from "lucide-react";
import { post, api } from "@/lib/api-client";
import type { QuoteResponse } from "@/lib/types";
import { useSession } from "@/store/session";
import { Button, StatusBadge, VehicleSkeleton } from "@/components/mizigo/shared/ui";
import VehicleAvatar from "@/components/mizigo/shared/VehicleAvatar";
import { kes, fmtKm, etaText } from "@/lib/format";
import { useState } from "react";
import { toast } from "@/hooks/use-toast";

export default function VehicleStep() {
  const { draft, patchDraft, setBookingStep } = useSession();
  const [breakdown, setBreakdown] = useState<string | null>(null);

  const { data: q, isLoading, error } = useQuery({
    queryKey: ["quote", draft.draftId, draft.pickup?.name, draft.dropoff?.name, draft.helpers, draft.load],
    queryFn: () =>
      post<QuoteResponse>("/api/quote", {
        pickup: draft.pickup!,
        dropoff: draft.dropoff!,
        cargo: { category: draft.category, items: draft.items, load: draft.load, helpers: draft.helpers, special: draft.special },
      }),
    enabled: !!draft.pickup && !!draft.dropoff,
  });

  if (!draft.pickup || !draft.dropoff) {
    return (
      <div className="py-10 text-center">
        <p className="text-[14px] font-semibold text-[var(--ink-2)]">Set your pickup and destination first.</p>
        <Button variant="outline" className="mt-4" onClick={() => setBookingStep("pickup")}>Back to locations</Button>
      </div>
    );
  }

  const recommended = q?.quotes.find((x) => x.recommended);
  const alternatives = q?.quotes.filter((x) => !x.recommended) ?? [];

  const select = (key: string) => {
    const choice = q?.quotes.find((x) => x.key === key);
    if (choice?.oversized) {
      toast({ title: "Your load may not fit this vehicle", description: "Pick a larger vehicle or edit your cargo.", variant: "destructive" });
    }
    patchDraft({ selectedVehicle: key });
    setBookingStep("review");
  };

  return (
    <div className="space-y-4">
      {/* trip strip */}
      <div className="flex items-center justify-between rounded-[12px] bg-[var(--ink)] px-4 py-3 text-white">
        <div>
          <p className="text-[10.5px] font-bold uppercase tracking-widest text-white/50">From</p>
          <p className="text-[13.5px] font-bold">{draft.pickup.area}</p>
        </div>
        <div className="px-3 text-center">
          <p className="tnum text-[14px] font-extrabold">{q ? fmtKm(q.distanceKm) : "…"}</p>
          <p className="text-[11px] font-semibold text-white/50">{q ? `~${q.durationMin} min` : ""}</p>
        </div>
        <div className="text-right">
          <p className="text-[10.5px] font-bold uppercase tracking-widest text-white/50">To</p>
          <p className="text-[13.5px] font-bold">{draft.dropoff.area}</p>
        </div>
      </div>

      {isLoading && (
        <div className="space-y-3">
          {[0, 1, 2, 3].map((i) => <VehicleSkeleton key={i} />)}
        </div>
      )}

      {error && (
        <div className="rounded-[12px] bg-[var(--danger-soft)] px-4 py-3 text-[13.5px] font-semibold text-[var(--danger)]">
          We couldn&apos;t price this route. Please try again.
        </div>
      )}

      {q && recommended && (
        <>
          {/* recommended hero card */}
          <div className="animate-mz-slide-up overflow-hidden rounded-[16px] border-2 border-[var(--brand)] bg-[var(--surface)]">
            <div className="flex items-center justify-between bg-[var(--brand-soft)] px-4 py-2">
              <span className="flex items-center gap-1.5 text-[11.5px] font-extrabold uppercase tracking-widest text-[var(--brand-ink)]">
                <Zap size={12} strokeWidth={2.8} /> Best match for your cargo
              </span>
              <StatusBadge tone="active">{recommended.supply} nearby</StatusBadge>
            </div>
            <div className="p-4">
              <div className="flex items-center gap-4">
                <span className="flex h-16 w-16 items-center justify-center rounded-2xl bg-[var(--surface-2)]">
                  <VehicleAvatar category={recommended.key} size={52} />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-[18px] font-extrabold tracking-tight">{recommended.name}</p>
                  <p className="text-[12.5px] font-semibold text-[var(--ink-2)]">{recommended.description}</p>
                  <p className="mt-1 text-[12px] font-medium text-[var(--ink-3)]">
                    Up to {recommended.capacityKg.toLocaleString()} kg · {recommended.dimensions}
                  </p>
                </div>
                <div className="text-right">
                  <p className="tnum text-[22px] font-extrabold tracking-tight">{kes(recommended.fare.total)}</p>
                  <p className="text-[11.5px] font-semibold text-[var(--ink-3)]">fixed price</p>
                </div>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12.5px] font-semibold text-[var(--ink-2)]">
                <span>Arrives in {etaText(recommended.etaMin)}</span>
                <span>·</span>
                <span>Fits your ~{q.weightKg} kg load</span>
              </div>
              <button
                onClick={() => setBreakdown(breakdown === recommended.key ? null : recommended.key)}
                className="mt-2 inline-flex items-center gap-1 text-[12.5px] font-bold text-[var(--brand-deep)]"
              >
                Price breakdown <ChevronDown size={13} className={breakdown === recommended.key ? "rotate-180 transition" : "transition"} />
              </button>
              {breakdown === recommended.key && (
                <div className="mt-2 animate-mz-fade-in divide-y divide-[var(--line)] rounded-[10px] border border-[var(--line)] px-4 py-1">
                  {recommended.fare.lines.map((l) => (
                    <div key={l.key} className="flex justify-between py-2 text-[13px]">
                      <span className="font-medium text-[var(--ink-2)]">{l.label}</span>
                      <span className="tnum font-bold">{kes(l.amount)}</span>
                    </div>
                  ))}
                  <div className="flex justify-between py-2 text-[14px]">
                    <span className="font-extrabold">Total · price locked at booking</span>
                    <span className="tnum font-extrabold">{kes(recommended.fare.total)}</span>
                  </div>
                  {/* Uber pattern: the “i” sheet ends with what can change the price */}
                  <p className="py-2.5 text-[11.5px] font-medium leading-relaxed text-[var(--ink-3)]">
                    What can change this price: extra stops, loading help and night moves (19:00–06:00) are priced in before you book — the lines above show exactly what you're paying. Waiting past 20 free minutes costs KES 10/min. Your booked price is locked — it only changes if the job changes.
                  </p>
                </div>
              )}
              <Button variant="brand" className="mt-4 w-full" onClick={() => select(recommended.key)}>
                Book {recommended.name} · {kes(recommended.fare.total)}
              </Button>
            </div>
          </div>

          {/* alternatives */}
          <p className="px-1 text-[11.5px] font-extrabold uppercase tracking-widest text-[var(--ink-3)]">Other vehicles</p>
          <div className="space-y-2.5">
            {alternatives.map((a) => (
              <div key={a.key} className="rounded-[14px] border border-[var(--line)] bg-[var(--surface)] p-4 transition hover:border-[var(--ink-3)]">
                <div className="flex items-center gap-4">
                  <button onClick={() => select(a.key)} className="flex min-w-0 flex-1 items-center gap-4 text-left" aria-label={`Book ${a.name} for ${kes(a.fare.total)}`}>
                    <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-[var(--surface-2)]">
                      <VehicleAvatar category={a.key} size={44} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2">
                        <span className="text-[15px] font-extrabold">{a.name}</span>
                        {a.oversized && <StatusBadge tone="warn">Too small</StatusBadge>}
                      </span>
                      <span className="block text-[12px] font-semibold text-[var(--ink-2)]">Up to {a.capacityKg.toLocaleString()} kg · arrives {etaText(a.etaMin)}</span>
                      {a.oversized && <span className="block text-[11.5px] font-bold text-[var(--warn)]">Your load may not fit</span>}
                    </span>
                    <span className="tnum text-right text-[16px] font-extrabold">{kes(a.fare.total)}</span>
                  </button>
                  {/* same “i” breakdown affordance as the recommended card */}
                  <button
                    onClick={() => setBreakdown(breakdown === a.key ? null : a.key)}
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[var(--ink-3)] transition hover:bg-[var(--surface-2)]"
                    aria-label={`Price breakdown for ${a.name}`}
                    aria-expanded={breakdown === a.key}
                  >
                    <span className="flex h-5 w-5 items-center justify-center rounded-full border border-[var(--line)] text-[11px] font-extrabold">i</span>
                  </button>
                </div>
                {breakdown === a.key && (
                  <div className="mt-2 animate-mz-fade-in divide-y divide-[var(--line)] rounded-[10px] border border-[var(--line)] px-4 py-1">
                    {a.fare.lines.map((l) => (
                      <div key={l.key} className="flex justify-between py-2 text-[13px]">
                        <span className="font-medium text-[var(--ink-2)]">{l.label}</span>
                        <span className="tnum font-bold">{kes(l.amount)}</span>
                      </div>
                    ))}
                    <div className="flex justify-between py-2 text-[14px]">
                      <span className="font-extrabold">Total · price locked at booking</span>
                      <span className="tnum font-extrabold">{kes(a.fare.total)}</span>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
          <p className="px-1 pb-2 text-center text-[12px] font-medium text-[var(--ink-3)]">
            Prices come from the live Nairobi tariff. Waiting time is KES 10/min after 20 included minutes.
          </p>
        </>
      )}
    </div>
  );
}
