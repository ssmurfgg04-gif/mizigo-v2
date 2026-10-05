"use client";
// Return-load deals (v1 goodness: "Use the empty leg").
// Vehicles already travelling back across the network sell their spare
// capacity at a discount. Customers reserve a leg in one confirmation.

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, BadgePercent, Info, Loader2, MapPin, Package, ShieldCheck, X } from "lucide-react";
import { api } from "@/lib/api-client";
import { kes } from "@/lib/format";
import { useSession } from "@/store/session";
import { t } from "@/lib/i18n";
import { Button, SectionTitle, Stars } from "@/components/mizigo/shared/ui";
import VehicleAvatar from "@/components/mizigo/shared/VehicleAvatar";
import { toast } from "@/hooks/use-toast";

export interface ReturnLeg {
  id: string;
  from: { name: string; area: string; lat: number; lng: number };
  to: { name: string; area: string; lat: number; lng: number };
  categoryKey: string;
  cargoNote: string;
  maxWeightKg: number;
  priceKes: number;
  normalPriceKes: number;
  savingsKes: number;
  savingsPct: number;
  status: string;
  availableUntil: string | null;
  booked: boolean;
  createdAt: string;
  driver: { name: string; rating: number; trips: number } | null;
  vehicle: { name: string; registration: string } | null;
}

export default function ReturnLoadDeals() {
  const { user, setFocusShipment, setBookingStep, lang } = useSession();
  const [open, setOpen] = useState<ReturnLeg | null>(null);

  const q = useQuery({
    queryKey: ["return-loads"],
    queryFn: () => api<{ returnLoads: ReturnLeg[] }>("/api/return-loads"),
    refetchInterval: 20000,
  });
  const legs = (q.data?.returnLoads ?? []).slice(0, 6);
  if (!q.isLoading && legs.length === 0) return null; // no rail when the market is empty

  return (
    <section>
      <SectionTitle>{t("deals.title", lang)}</SectionTitle>
      <p className="mt-1 text-[12px] font-medium text-[var(--ink-3)]">{t("deals.sub", lang)}</p>
      <div className="mt-3 flex gap-3 overflow-x-auto pb-1 thin-scrollbar" style={{ scrollbarWidth: "none" }}>
        {q.isLoading
          ? [0, 1, 2].map((i) => <div key={i} className="h-[118px] w-[220px] shrink-0 animate-pulse rounded-[14px] bg-[var(--surface-2)]" />)
          : legs.map((leg) => (
              <button
                key={leg.id}
                onClick={() => setOpen(leg)}
                className="group w-[220px] shrink-0 rounded-[14px] border border-[var(--line)] bg-[var(--surface)] p-3.5 text-left transition hover:border-[var(--ink-3)] active:translate-y-px"
              >
                <div className="flex items-center justify-between">
                  <span className="rounded-full bg-[var(--success-soft)] px-2 py-0.5 text-[10px] font-extrabold text-[var(--success)]">
                    −{leg.savingsPct}%
                  </span>
                  <VehicleAvatar category={leg.categoryKey} size={44} />
                </div>
                <p className="mt-2 flex items-center gap-1 truncate text-[13.5px] font-extrabold tracking-tight">
                  <MapPin size={12} className="shrink-0 text-[var(--brand)]" />
                  {leg.from.area} → {leg.to.area}
                </p>
                <p className="mt-0.5 truncate text-[11.5px] font-medium text-[var(--ink-3)]">
                  Up to {leg.maxWeightKg.toLocaleString()} kg · {leg.cargoNote}
                </p>
                <p className="mt-1.5 flex items-baseline gap-1.5">
                  <span className="tnum text-[16px] font-extrabold">{kes(leg.priceKes, { compact: true }).replace("KES ", "")}</span>
                  <span className="tnum text-[11.5px] font-semibold text-[var(--ink-3)] line-through">{leg.normalPriceKes.toLocaleString()}</span>
                </p>
              </button>
            ))}
      </div>
      {open && <BookSheet leg={open} onClose={() => setOpen(null)} user={user} onBooked={(id) => { setFocusShipment(id); setBookingStep("active"); }} />}
    </section>
  );
}
function BookSheet({ leg, onClose, user, onBooked }: { leg: ReturnLeg; onClose: () => void; user: { id: string } | null; onBooked: (shipmentId: string) => void }) {
  const qc = useQueryClient();
  const { lang } = useSession();
  const [method, setMethod] = useState<"MPESA" | "CASH">("MPESA");
  const [busy, setBusy] = useState(false);

  const reserve = async () => {
    if (!user) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/return-loads/${leg.id}/book`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ paymentMethod: method }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not reserve this leg.");
      toast({ title: "Return load reserved", description: `${data.shipment.code} · ${leg.from.area} → ${leg.to.area}. Track it from your trips.` });
      qc.invalidateQueries({ queryKey: ["return-loads"] });
      qc.invalidateQueries({ queryKey: ["customer-home"] });
      onClose();
      onBooked(data.shipment.id);
    } catch (e) {
      toast({ title: "Reservation failed", description: e instanceof Error ? e.message : "Try again.", variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center bg-black/45" onClick={onClose} role="dialog" aria-modal="true" aria-label="Reserve return load">
      <div
        className="w-full max-w-[480px] rounded-t-[22px] bg-[var(--surface)] p-5 pb-[max(env(safe-area-inset-bottom),20px)] shadow-2xl animate-mz-slide-up"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between">
          <div>
            <p className="text-[10.5px] font-extrabold uppercase tracking-widest text-[var(--brand)]">{t("deals.badge", lang)}</p>
            <h3 className="mt-1 text-[19px] font-extrabold tracking-tight">{leg.from.area} → {leg.to.area}</h3>
          </div>
          <button onClick={onClose} className="flex h-9 w-9 items-center justify-center rounded-full bg-[var(--surface-2)]" aria-label="Close"><X size={16} /></button>
        </div>

        <div className="mt-3 flex items-center gap-3 rounded-[12px] border border-[var(--line)] bg-[var(--surface-2)] p-3">
          <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-[var(--surface)]"><VehicleAvatar category={leg.categoryKey} size={36} /></span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13.5px] font-bold">{leg.vehicle?.name ?? "Vehicle"} · {leg.categoryKey.replace("_", " ").toLowerCase()}</p>
            <p className="mt-0.5 flex items-center gap-1.5 text-[12px] font-semibold text-[var(--ink-2)]">
              {leg.driver && <><Stars value={leg.driver.rating} size={11} /> {leg.driver.name} · {leg.driver.trips} trips</>}
            </p>
          </div>
          <span className="rounded-full bg-[var(--success-soft)] px-2 py-1 text-[10.5px] font-extrabold text-[var(--success)]">−{leg.savingsPct}%</span>
        </div>

        <div className="mt-3 space-y-2 text-[12.5px] font-semibold">
          <p className="flex items-center gap-2 text-[var(--ink-2)]"><MapPin size={13} className="text-[var(--ink-3)]" /> {leg.from.name} → {leg.to.name}</p>
          <p className="flex items-center gap-2 text-[var(--ink-2)]"><Package size={13} className="text-[var(--ink-3)]" /> {t("deals.capacity", lang)}: {leg.maxWeightKg.toLocaleString()} kg · {leg.cargoNote}</p>
          <p className="flex items-center gap-2 text-[var(--ink-2)]"><ShieldCheck size={13} className="text-[var(--ink-3)]" /> {t("deals.verified", lang)} · {leg.driver?.name ?? "Driver"}</p>
        </div>

        <div className="mt-3 rounded-[12px] border border-dashed border-[var(--line)] bg-[var(--surface-2)] p-3">
          <div className="flex items-center justify-between text-[12.5px] font-semibold text-[var(--ink-3)]">
            <span>Normal fare</span><span className="tnum line-through">{kes(leg.normalPriceKes)}</span>
          </div>
          <div className="mt-1 flex items-center justify-between">
            <span className="text-[13px] font-bold">{t("deals.emptyLegPrice", lang)}</span>
            <span className="tnum text-[20px] font-extrabold text-[var(--success)]">{kes(leg.priceKes)}</span>
          </div>
          <p className="mt-1.5 flex items-center gap-1.5 text-[11px] font-medium text-[var(--ink-3)]">
            <Info size={11} /> {t("deals.explain", lang)}
          </p>
        </div>

        <div className="mt-3 grid grid-cols-2 gap-2.5">
          {(["MPESA", "CASH"] as const).map((m) => (
            <button
              key={m}
              onClick={() => setMethod(m)}
              className={`rounded-[12px] border-2 px-3 py-2.5 text-left transition ${method === m ? "border-[var(--brand)] bg-[var(--brand-soft)]" : "border-[var(--line)] bg-[var(--surface)]"}`}
            >
              <span className="block text-[12.5px] font-extrabold">{m === "MPESA" ? "M-Pesa" : "Cash on delivery"}</span>
              <span className="block text-[11px] font-semibold text-[var(--ink-3)]">{m === "MPESA" ? "Confirmed instantly (sandbox)" : "Pay the driver on pickup"}</span>
            </button>
          ))}
        </div>

        <Button variant="brand" className="mt-4 w-full" onClick={reserve} disabled={busy || !user}>
          {busy ? <Loader2 size={16} className="animate-spin" /> : <BadgePercent size={16} />}
          {busy ? "Reserving…" : `${t("deals.reserve", lang)} · ${kes(leg.priceKes, { compact: true })}`}
          {!busy && <ArrowRight size={15} strokeWidth={2.6} />}
        </Button>
      </div>
    </div>
  );
}
