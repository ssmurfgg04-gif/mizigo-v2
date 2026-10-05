"use client";
// Review step — WHO / WHAT / WHERE / HOW MUCH on one confirm screen.
// Schedule selector (plan §34), multi-stop summary (plan §35), promo preview
// (plan §75) and the quote-marketplace path for large loads (plan §33/§36).

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Banknote, CalendarClock, CreditCard, Lock, Plus, Smartphone, Tag, X } from "lucide-react";
import { post } from "@/lib/api-client";
import type { QuoteResponse } from "@/lib/types";
import { useSession } from "@/store/session";
import { Button, Row } from "@/components/mizigo/shared/ui";
import VehicleAvatar from "@/components/mizigo/shared/VehicleAvatar";
import { kes, fmtKm, fmtDateTimeEAT, atEAT, toDatetimeLocalEAT, fromDatetimeLocalEAT } from "@/lib/format";
import { CARGO_CATEGORIES } from "@/lib/pricing";
import { t } from "@/lib/i18n";
import { toast } from "@/hooks/use-toast";

const METHODS = [
  { key: "MPESA", label: "M-PESA", desc: "Pay instantly from your phone", icon: Smartphone },
  { key: "CASH", label: "Cash", desc: "Pay the driver on completion", icon: Banknote },
  { key: "CARD", label: "Card", desc: "Visa · Mastercard", icon: CreditCard },
];

// vehicles that price through the quote marketplace (plan §9: large lorry = "Get quote")
const QUOTE_VEHICLES = ["lorry_7t", "lorry_10t"];

function scheduleOptions(): { label: string; sub: string; at: Date }[] {
  const now = new Date();
  const today430 = atEAT(now, 16, 30);
  const tomorrow8 = atEAT(new Date(now.getTime() + 86400_000), 8, 0);
  const tomorrow1430 = atEAT(new Date(now.getTime() + 86400_000), 14, 30);
  const list = [
    { label: "Today", sub: "4:30 PM", at: today430 },
    { label: "Tomorrow", sub: "8:00 AM", at: tomorrow8 },
    { label: "Tomorrow", sub: "2:30 PM", at: tomorrow1430 },
  ];
  return list.filter((o) => o.at > now);
}

export default function ReviewStep() {
  const { draft, patchDraft, setBookingStep, setFocusShipment, user, lang } = useSession();
  const selectedKey = draft.selectedVehicle;
  const [promoOpen, setPromoOpen] = useState(false);
  const [promoInput, setPromoInput] = useState("");
  const [busy, setBusy] = useState(false);

  const { data: q } = useQuery({
    queryKey: ["quote", draft.draftId, draft.pickup?.name, draft.dropoff?.name, draft.helpers, draft.load, draft.promoCode, draft.stops.length],
    queryFn: () =>
      post<QuoteResponse>("/api/quote", {
        pickup: draft.pickup!, dropoff: draft.dropoff!,
        stops: draft.stops.map((s) => ({ name: s.name, lat: s.lat, lng: s.lng })),
        cargo: { category: draft.category, items: draft.items, load: draft.load, helpers: draft.helpers, special: draft.special },
        promoCode: draft.promoCode || undefined,
        customerId: user?.id,
      }),
    enabled: !!draft.pickup && !!draft.dropoff,
  });

  const vehicle = q?.quotes.find((x) => x.key === selectedKey) ?? q?.quotes.find((x) => x.recommended);
  const promoError = q?.promo && "error" in q.promo ? q.promo.error : null;
  const promoApplied = q?.promo && "discount" in q.promo ? q.promo : null;
  const quoteVehicle = !!selectedKey && QUOTE_VEHICLES.includes(selectedKey);

  const startQuotes = async () => {
    if (!vehicle || !user) return;
    setBusy(true);
    try {
      const created = await post<{ shipment: import("@/lib/types").ShipmentDTO }>("/api/shipments", {
        draftId: draft.draftId, customerId: user.id,
        pickup: draft.pickup, dropoff: draft.dropoff,
        stops: draft.stops.map((s) => ({ name: s.name, lat: s.lat, lng: s.lng })),
        cargo: { category: draft.category, items: draft.items, load: draft.load, helpers: draft.helpers, special: draft.special, notes: draft.notes },
        categoryKey: vehicle.key, paymentMethod: draft.paymentMethod,
        scheduledAt: draft.when === "SCHEDULE" ? draft.scheduledAt : null,
        promoCode: draft.promoCode || undefined,
        pricingMode: "QUOTE",
      });
      const r = await post<{ shipment: import("@/lib/types").ShipmentDTO }>(`/api/shipments/${created.shipment.id}/action`, { action: "request-quotes", actor: "CUSTOMER" });
      setFocusShipment(r.shipment.id);
      patchDraft({ quoteMode: true });
      setBookingStep("quotes");
    } catch (e) {
      toast({ title: "Couldn't open quote requests", description: (e as Error).message, variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  if (!q || !vehicle) {
    return <div className="h-64 animate-pulse rounded-[16px] bg-[var(--surface-2)]" />;
  }

  const itemCount = draft.items.reduce((a, i) => a + i.qty, 0);
  const catLabel = CARGO_CATEGORIES.find((c) => c.key === draft.category)?.label ?? "Cargo";
  const scheduleOpts = scheduleOptions();

  return (
    <div className="space-y-4">
      {/* route */}
      <div className="rounded-[16px] border border-[var(--line)] bg-[var(--surface)] p-4">
        <div className="flex items-start gap-3">
          <div className="mt-1.5 flex flex-col items-center">
            <span className="h-3 w-3 rounded-full border-[3px] border-[var(--success)] bg-[var(--surface)]" />
            <span className="my-1 h-6 w-[2px] rounded bg-[var(--line)]" />
            {draft.stops.map((_, i) => (
              <span key={i} className="my-0.5 flex flex-col items-center">
                <span className="h-2.5 w-2.5 rounded-full border-2 border-[var(--ink-3)] bg-[var(--surface)]" />
                <span className="my-1 h-5 w-[2px] rounded bg-[var(--line)]" />
              </span>
            ))}
            <span className="my-1 h-6 w-[2px] rounded bg-[var(--line)]" />
            <span className="h-3 w-3 rounded-full border-[3px] border-[var(--brand)] bg-[var(--surface)]" />
          </div>
          <div className="min-w-0 flex-1 space-y-4">
            <div>
              <p className="text-[10.5px] font-extrabold uppercase tracking-widest text-[var(--ink-3)]">Pickup</p>
              <p className="truncate text-[14.5px] font-bold">{draft.pickup?.name}</p>
              {draft.pickupNote && <p className="text-[12px] font-medium text-[var(--ink-2)]">{draft.pickupNote}</p>}
            </div>
            {draft.stops.map((s, i) => (
              <div key={i}>
                <p className="text-[10.5px] font-extrabold uppercase tracking-widest text-[var(--ink-3)]">Stop {i + 1}</p>
                <p className="truncate text-[14.5px] font-bold">{s.name}</p>
                <button onClick={() => patchDraft({ stops: draft.stops.filter((_, j) => j !== i) })} className="mt-0.5 flex items-center gap-1 text-[11.5px] font-bold text-[var(--danger)]">
                  <X size={11} /> Remove stop
                </button>
              </div>
            ))}
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
          {draft.stops.length > 0 && <><span>·</span><span>{draft.stops.length} stop{draft.stops.length === 1 ? "" : "s"}</span></>}
        </div>
      </div>

      {/* schedule (plan §34) */}
      <div className="rounded-[16px] border border-[var(--line)] bg-[var(--surface)] p-4">
        <p className="flex items-center gap-1.5 text-[14.5px] font-extrabold tracking-tight"><CalendarClock size={15} /> How soon?</p>
        <div className="mt-2.5 grid grid-cols-2 gap-2.5">
          <button
            onClick={() => patchDraft({ when: "NOW", scheduledAt: null })}
            className={`rounded-[12px] border-2 px-4 py-3 text-left transition ${draft.when === "NOW" ? "border-[var(--brand)] bg-[var(--brand-soft)]" : "border-[var(--line)] bg-[var(--surface)]"}`}
          >
            <span className="block text-[13.5px] font-extrabold">Now</span>
            <span className="block text-[11.5px] font-semibold text-[var(--ink-2)]">Find a vehicle right away</span>
          </button>
          <button
            onClick={() => patchDraft({ when: "SCHEDULE", scheduledAt: draft.scheduledAt ?? scheduleOpts[1]?.at.toISOString() ?? null })}
            className={`rounded-[12px] border-2 px-4 py-3 text-left transition ${draft.when === "SCHEDULE" ? "border-[var(--brand)] bg-[var(--brand-soft)]" : "border-[var(--line)] bg-[var(--surface)]"}`}
          >
            <span className="block text-[13.5px] font-extrabold">Schedule</span>
            <span className="block text-[11.5px] font-semibold text-[var(--ink-2)]">Pick a date &amp; time</span>
          </button>
        </div>
        {draft.when === "SCHEDULE" && (
          <div className="mt-3 animate-mz-fade-in space-y-2.5">
            <div className="grid grid-cols-3 gap-2">
              {scheduleOpts.map((o, i) => {
                const iso = o.at.toISOString();
                const on = draft.scheduledAt === iso;
                return (
                  <button
                    key={i}
                    onClick={() => patchDraft({ scheduledAt: iso })}
                    className={`rounded-[10px] border px-2.5 py-2.5 text-center transition ${on ? "border-[var(--brand)] bg-[var(--brand-soft)]" : "border-[var(--line)] bg-[var(--surface-2)]"}`}
                  >
                    <span className="block text-[12.5px] font-extrabold">{o.label}</span>
                    <span className="tnum block text-[12px] font-bold text-[var(--ink-2)]">{o.sub}</span>
                  </button>
                );
              })}
            </div>
            <label className="block">
              <span className="text-[11px] font-bold uppercase tracking-widest text-[var(--ink-3)]">Or pick any date &amp; time (within 14 days)</span>
              <input
                type="datetime-local"
                value={draft.scheduledAt ? toDatetimeLocalEAT(draft.scheduledAt) : ""}
                onChange={(e) => patchDraft({ scheduledAt: e.target.value ? fromDatetimeLocalEAT(e.target.value) : null })}
                className="mt-1.5 h-12 w-full rounded-[10px] border border-[var(--line)] bg-[var(--surface)] px-3.5 text-[14px] font-semibold outline-none focus:border-[var(--brand)]"
              />
            </label>
            {draft.scheduledAt && (
              <p className="text-[12.5px] font-bold text-[var(--success)]">Scheduled for {fmtDateTimeEAT(draft.scheduledAt)} · drivers are notified ahead of time</p>
            )}
          </div>
        )}
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
        <button onClick={() => setBookingStep("vehicle")} className="text-[13px] font-bold text-[var(--brand-deep)]">Change</button>
      </div>

      {/* fare */}
      <div className="rounded-[16px] border border-[var(--line)] bg-[var(--surface)] p-4">
        <div className="divide-y divide-[var(--line)]">
          {vehicle.fare.lines.map((l) => (
            <Row key={l.key} label={l.label} value={kes(l.amount)} />
          ))}
          {(vehicle.fare.discount ?? 0) > 0 && (
            <Row label={`Promo ${vehicle.fare.promoCode}`} value={`- ${kes(vehicle.fare.discount ?? 0)}`} />
          )}
        </div>
        <div className="mt-2 flex items-baseline justify-between border-t-2 border-[var(--ink)] pt-3">
          <span className="text-[15px] font-extrabold">Total</span>
          <span className="tnum text-[24px] font-extrabold tracking-tight">{kes(vehicle.fare.total)}</span>
        </div>
        <p className="mt-1 flex items-center gap-1.5 text-[12px] font-bold text-[var(--success)]">
          <Lock size={12} /> {t("booking.priceLocked", lang)}
        </p>
        <p className="mt-1 text-[11.5px] font-semibold text-[var(--ink-3)]">
          Covered in transit — goods-in-transit cover rides with every booked delivery.
        </p>

        {/* promo (plan §75) */}
        <div className="mt-2.5 border-t border-[var(--line)] pt-2.5">
          {promoApplied ? (
            <div className="flex items-center gap-2 rounded-[10px] bg-[var(--success-soft)] px-3.5 py-2.5">
              <Tag size={14} className="text-[var(--success)]" />
              <span className="flex-1 text-[12.5px] font-bold text-[var(--success)]">{promoApplied.code} applied</span>
              <button onClick={() => { patchDraft({ promoCode: "" }); setPromoInput(""); }} className="text-[11.5px] font-bold text-[var(--ink-3)] underline">Remove</button>
            </div>
          ) : promoOpen ? (
            <div className="flex gap-2">
              <input
                value={promoInput}
                onChange={(e) => setPromoInput(e.target.value.toUpperCase())}
                placeholder="Promo code e.g. MOVE200"
                className="h-11 flex-1 rounded-[10px] border border-[var(--line)] bg-[var(--paper)] px-3.5 text-[13.5px] font-bold tracking-wide outline-none focus:border-[var(--brand)]"
                aria-label="Promo code"
              />
              <Button variant="outline" className="h-11" onClick={() => { patchDraft({ promoCode: promoInput.trim() }); }}>Apply</Button>
            </div>
          ) : (
            <button onClick={() => setPromoOpen(true)} className="flex items-center gap-1.5 text-[12.5px] font-bold text-[var(--brand-deep)]">
              <Plus size={13} /> Add promo code
            </button>
          )}
          {promoError && <p className="mt-1.5 text-[12px] font-bold text-[var(--danger)]">{promoError}</p>}
        </div>
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

      <p className="text-center text-[12.5px] font-medium text-[var(--ink-2)]">{t("booking.trustNote", lang)}</p>

      <div className="sticky bottom-4 space-y-2.5">
        {quoteVehicle ? (
          <>
            <Button variant="brand" className="w-full" onClick={startQuotes} loading={busy}>
              Request driver quotes
            </Button>
            <p className="text-center text-[11.5px] font-semibold text-[var(--ink-3)]">
              {vehicle.name} jobs are priced by transporters. Or{" "}
              <button onClick={() => setBookingStep("payment")} className="font-extrabold text-[var(--brand-deep)] underline">pay the instant estimate</button>.
            </p>
          </>
        ) : (
          <Button variant="brand" className="w-full" onClick={() => setBookingStep("payment")}>
            {draft.paymentMethod === "CASH" ? t("booking.requestVehicle", lang) : `Continue to ${draft.paymentMethod === "MPESA" ? "M-PESA" : "payment"}`}
          </Button>
        )}
      </div>
    </div>
  );
}
