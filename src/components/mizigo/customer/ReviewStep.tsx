"use client";
// Review step — WHO / WHAT / WHERE / HOW MUCH on one confirm screen.

import { useQuery } from "@tanstack/react-query";
import { Banknote, CreditCard, Lock, Smartphone } from "lucide-react";
import { post } from "@/lib/api-client";
import type { QuoteResponse } from "@/lib/types";
import { useSession } from "@/store/session";
import { Button, Row } from "@/components/mizigo/shared/ui";
import VehicleAvatar from "@/components/mizigo/shared/VehicleAvatar";
import { kes, fmtKm } from "@/lib/format";
import { CARGO_CATEGORIES } from "@/lib/pricing";
import { toast } from "@/hooks/use-toast";

const METHODS = [
  { key: "MPESA", label: "M-PESA", desc: "Pay instantly from your phone", icon: Smartphone },
  { key: "CASH", label: "Cash", desc: "Pay the driver on completion", icon: Banknote },
  { key: "CARD", label: "Card", desc: "Visa · Mastercard", icon: CreditCard },
];

export default function ReviewStep() {
  const { draft, patchDraft, setBookingStep, user } = useSession();
  const selectedKey = draft.selectedVehicle;

  const { data: q } = useQuery({
    queryKey: ["quote", draft.draftId, draft.pickup?.name, draft.dropoff?.name, draft.helpers, draft.load],
    queryFn: () =>
      post<QuoteResponse>("/api/quote", {
        pickup: draft.pickup!, dropoff: draft.dropoff!,
        cargo: { category: draft.category, items: draft.items, load: draft.load, helpers: draft.helpers, special: draft.special },
      }),
    enabled: !!draft.pickup && !!draft.dropoff,
  });

  const vehicle = q?.quotes.find((x) => x.key === selectedKey) ?? q?.quotes.find((x) => x.recommended);

  const createAndPay = async () => {
    if (!vehicle) return;
    setBookingStep("payment");
  };

  if (!q || !vehicle) {
    return <div className="h-64 animate-pulse rounded-[16px] bg-[var(--surface-2)]" />;
  }

  const itemCount = draft.items.reduce((a, i) => a + i.qty, 0);
  const catLabel = CARGO_CATEGORIES.find((c) => c.key === draft.category)?.label ?? "Cargo";

  return (
    <div className="space-y-4">
      {/* route */}
      <div className="rounded-[16px] border border-[var(--line)] bg-[var(--surface)] p-4">
        <div className="flex items-start gap-3">
          <div className="mt-1.5 flex flex-col items-center">
            <span className="h-3 w-3 rounded-full border-[3px] border-[var(--success)] bg-[var(--surface)]" />
            <span className="my-1 h-8 w-[2px] rounded bg-[var(--line)]" />
            <span className="h-3 w-3 rounded-full border-[3px] border-[var(--brand)] bg-[var(--surface)]" />
          </div>
          <div className="min-w-0 flex-1 space-y-5">
            <div>
              <p className="text-[10.5px] font-extrabold uppercase tracking-widest text-[var(--ink-3)]">Pickup</p>
              <p className="truncate text-[14.5px] font-bold">{draft.pickup?.name}</p>
              {draft.pickupNote && <p className="text-[12px] font-medium text-[var(--ink-2)]">{draft.pickupNote}</p>}
            </div>
            <div>
              <p className="text-[10.5px] font-extrabold uppercase tracking-widest text-[var(--ink-3)]">Drop-off</p>
              <p className="truncate text-[14.5px] font-bold">{draft.dropoff?.name}</p>
              {draft.dropoffNote && <p className="text-[12px] font-medium text-[var(--ink-2)]">{draft.dropoffNote}</p>}
            </div>
          </div>
        </div>
        <div className="mt-3 flex items-center gap-2 border-t border-[var(--line)] pt-3 text-[12.5px] font-semibold text-[var(--ink-2)]">
          <span className="tnum">{fmtKm(q.distanceKm)}</span>·<span>~{q.durationMin} min</span>·<span>{catLabel}</span>
          {itemCount > 0 && <><span>·</span><span className="tnum">{itemCount} item{itemCount === 1 ? "" : "s"}</span></>}
        </div>
      </div>

      {/* vehicle */}
      <div className="flex items-center gap-4 rounded-[16px] border border-[var(--line)] bg-[var(--surface)] p-4">
        <span className="flex h-14 w-14 items-center justify-center rounded-xl bg-[var(--surface-2)]">
          <VehicleAvatar category={vehicle.key} size={44} />
        </span>
        <div className="flex-1">
          <p className="text-[15.5px] font-extrabold">{vehicle.name}</p>
          <p className="text-[12.5px] font-semibold text-[var(--ink-2)]">Arrives in about {vehicle.etaMin} min</p>
        </div>
        <button onClick={() => setBookingStep("vehicle")} className="text-[13px] font-bold text-[var(--brand)]">Change</button>
      </div>

      {/* fare */}
      <div className="rounded-[16px] border border-[var(--line)] bg-[var(--surface)] p-4">
        <div className="divide-y divide-[var(--line)]">
          {vehicle.fare.lines.map((l) => (
            <Row key={l.key} label={l.label} value={kes(l.amount)} />
          ))}
        </div>
        <div className="mt-2 flex items-baseline justify-between border-t-2 border-[var(--ink)] pt-3">
          <span className="text-[15px] font-extrabold">Total</span>
          <span className="tnum text-[24px] font-extrabold tracking-tight">{kes(vehicle.fare.total)}</span>
        </div>
        <p className="mt-1 flex items-center gap-1.5 text-[12px] font-bold text-[var(--success)]">
          <Lock size={12} /> Price locked at booking
        </p>
      </div>

      {/* payment method */}
      <div>
        <p className="px-1 text-[11.5px] font-extrabold uppercase tracking-widest text-[var(--ink-3)]">Payment method</p>
        <div className="mt-2 space-y-2">
          {METHODS.map((m) => {
            const on = draft.paymentMethod === m.key;
            const disabled = m.key === "CARD";
            return (
              <button
                key={m.key}
                disabled={disabled}
                onClick={() => patchDraft({ paymentMethod: m.key as "MPESA" | "CASH" | "CARD" })}
                className={`flex w-full items-center gap-3.5 rounded-[12px] border-2 px-4 py-3.5 text-left transition disabled:opacity-40 ${on ? "border-[var(--brand)] bg-[var(--brand-soft)]" : "border-[var(--line)] bg-[var(--surface)] hover:border-[var(--ink-3)]"}`}
              >
                <span className={`flex h-10 w-10 items-center justify-center rounded-full ${on ? "bg-[var(--brand)] text-white" : "bg-[var(--surface-2)] text-[var(--ink-2)]"}`}><m.icon size={17} /></span>
                <span className="flex-1">
                  <span className="block text-[14.5px] font-extrabold">{m.label}</span>
                  <span className="block text-[12px] font-medium text-[var(--ink-2)]">{m.desc}</span>
                </span>
                {disabled && <span className="text-[11px] font-bold text-[var(--ink-3)]">Soon</span>}
              </button>
            );
          })}
        </div>
      </div>

      <p className="text-center text-[12.5px] font-medium text-[var(--ink-2)]">Your trip is tracked from pickup to delivery.</p>

      <div className="sticky bottom-4">
        <Button variant="brand" className="w-full" onClick={createAndPay}>
          {draft.paymentMethod === "CASH" ? "Request vehicle" : `Continue to ${draft.paymentMethod === "MPESA" ? "M-PESA" : "payment"}`}
        </Button>
      </div>
    </div>
  );
}
