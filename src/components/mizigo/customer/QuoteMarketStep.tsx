"use client";
// Quote marketplace (plan §33/§36) — "3 available quotes" comparison for
// larger/commercial loads. Quotes stream in (drivers quote from their app;
// the sandbox also simulates a few), the customer picks one, fare locks.

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { BadgeCheck, Clock3, MessageSquareQuote, Star, X } from "lucide-react";
import { api, post } from "@/lib/api-client";
import type { ShipmentDTO } from "@/lib/types";
import { useSession } from "@/store/session";
import { Button, Row, StatusBadge } from "@/components/mizigo/shared/ui";
import MapCanvas from "@/components/mizigo/shared/MapCanvas";
import VehicleAvatar from "@/components/mizigo/shared/VehicleAvatar";
import { kes, fmtKm } from "@/lib/format";
import { toast } from "@/hooks/use-toast";

export default function QuoteMarketStep() {
  const { focusShipmentId, setBookingStep, setFocusShipment, resetDraft, patchDraft } = useSession();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [cancelOpen, setCancelOpen] = useState(false);

  const { data } = useQuery({
    queryKey: ["shipment", focusShipmentId, "quotes"],
    queryFn: () => api<{ shipment: ShipmentDTO }>(`/api/shipments/${focusShipmentId}?demo=auto`),
    enabled: !!focusShipmentId,
    refetchInterval: 2500,
  });
  const s = data?.shipment;

  const accept = async (quoteId: string) => {
    if (!s) return;
    setBusyId(quoteId);
    try {
      const r = await post<{ shipment: ShipmentDTO }>(`/api/shipments/${s.id}/action`, { action: "accept-quote", actor: "CUSTOMER", quoteId });
      setFocusShipment(r.shipment.id);
      patchDraft({ selectedVehicle: r.shipment.category.key, quoteMode: true });
      toast({ title: "Quote accepted", description: `${kes(r.shipment.fare.total)} · fare locked` });
      setBookingStep("payment");
    } catch (e) {
      toast({ title: "Couldn't accept quote", description: (e as Error).message, variant: "destructive" });
    } finally {
      setBusyId(null);
    }
  };

  const cancel = async () => {
    if (!s) return;
    await post(`/api/shipments/${s.id}/action`, { action: "cancel", actor: "CUSTOMER", reason: "Cancelled while collecting quotes" }).catch(() => null);
    resetDraft();
    setFocusShipment(null);
    setCancelOpen(false);
    setBookingStep("idle");
  };

  if (!s) return <div className="h-full animate-pulse bg-[var(--surface-2)]" />;

  const pending = s.quotes.filter((q) => q.status === "PENDING");
  const itemCount = s.cargo.items.reduce((a, i) => a + i.qty, 0);

  return (
    <div className="flex min-h-full flex-col bg-[var(--paper)] pb-8">
      {/* header */}
      <div className="sticky top-0 z-20 bg-[var(--paper)]/95 px-5 pb-3 pt-4 backdrop-blur">
        <div className="flex items-center gap-3">
          <button
            onClick={() => setCancelOpen(true)}
            className="flex h-11 w-11 items-center justify-center rounded-[10px] border border-[var(--line)] bg-[var(--surface)]"
            aria-label="Cancel quote request"
          >
            <X size={18} />
          </button>
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-[18px] font-extrabold tracking-tight">Choose your driver&apos;s quote</h1>
            <p className="tnum text-[12px] font-semibold text-[var(--ink-3)]">{s.code} · {s.category.name} job</p>
          </div>
        </div>
      </div>

      <div className="space-y-4 px-5">
        {/* job summary */}
        <div className="overflow-hidden rounded-[16px] border border-[var(--line)] bg-[var(--surface)]">
          <div className="relative h-36">
            <MapCanvas
              route={s.route.polyline}
              markers={[
                { kind: "pickup", lat: s.route.pickup.lat, lng: s.route.pickup.lng },
                { kind: "dropoff", lat: s.route.dropoff.lat, lng: s.route.dropoff.lng },
              ]}
              showLabels={false}
              className="absolute inset-0"
              fitPad={130}
            />
          </div>
          <div className="p-4">
            <Row label="Pickup" value={s.route.pickup.name} />
            <Row label="Destination" value={s.route.dropoff.name} />
            <Row label="Cargo" value={`${itemCount} items · ${fmtKm(s.route.distanceKm)}`} />
            <Row label="Instant estimate" value={kes(s.fare.total)} />
          </div>
        </div>

        {/* quotes */}
        {pending.length === 0 ? (
          <div className="rounded-[16px] border border-dashed border-[var(--line)] bg-[var(--surface)] px-5 py-8 text-center">
            <div className="relative mx-auto h-14 w-14">
              <span className="absolute inset-0 animate-mz-radar rounded-full bg-[var(--brand)] opacity-20" />
              <span className="relative flex h-14 w-14 items-center justify-center rounded-full bg-[var(--brand-soft)] text-[var(--brand)]">
                <MessageSquareQuote size={22} />
              </span>
            </div>
            <p className="mt-3 text-[15px] font-extrabold tracking-tight">Requesting driver quotes…</p>
            <p className="mt-1 text-[13px] font-medium text-[var(--ink-2)]">
              Verified transporters for {s.category.name}s are reviewing your job. Quotes usually arrive within a minute.
            </p>
            <div className="mt-4 space-y-2">
              {[0, 1, 2].map((i) => (
                <div key={i} className="h-[86px] animate-pulse rounded-[14px] bg-[var(--surface-2)]" />
              ))}
            </div>
          </div>
        ) : (
          <>
            <p className="px-1 text-[11.5px] font-extrabold uppercase tracking-widest text-[var(--ink-3)]">
              {pending.length} quote{pending.length === 1 ? "" : "s"} · lowest first
            </p>
            <div className="space-y-2.5">
              {pending.map((q) => (
                <div key={q.id} className="animate-mz-slide-up rounded-[16px] border border-[var(--line)] bg-[var(--surface)] p-4">
                  <div className="flex items-center gap-3.5">
                    <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-[var(--surface-2)]">
                      <VehicleAvatar category={s.category.key} size={38} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="flex items-center gap-1.5 text-[15px] font-extrabold tracking-tight">
                        {q.driver?.name.split(" ")[0]} {q.driver?.name.split(" ")[1]?.[0]}.
                        <BadgeCheck size={14} className="text-[var(--success)]" />
                      </p>
                      <p className="flex items-center gap-1 text-[12px] font-semibold text-[var(--ink-2)]">
                        <Star size={11} className="fill-[var(--brand)] text-[var(--brand)]" /> {q.driver?.rating.toFixed(1)} · {q.driver?.trips} cargo trips
                      </p>
                      <p className="truncate text-[12px] font-medium text-[var(--ink-3)]">
                        {q.vehicle ? `${q.vehicle.make} ${q.vehicle.model} · ${q.vehicle.registration}` : s.category.name}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="tnum text-[19px] font-extrabold tracking-tight">{kes(q.amount)}</p>
                      <p className="flex items-center justify-end gap-1 text-[11px] font-semibold text-[var(--ink-3)]"><Clock3 size={10} /> {q.etaText}</p>
                    </div>
                  </div>
                  {q.message && (
                    <p className="mt-2.5 rounded-[10px] bg-[var(--surface-2)] px-3.5 py-2 text-[12.5px] font-medium text-[var(--ink-2)]">“{q.message}”</p>
                  )}
                  <Button variant="brand" className="mt-3 w-full" loading={busyId === q.id} onClick={() => accept(q.id)}>
                    Select quote · {kes(q.amount)}
                  </Button>
                </div>
              ))}
            </div>
            <p className="px-1 pb-2 text-center text-[12px] font-medium text-[var(--ink-3)]">
              {(() => {
                const soonest = pending.map((q) => new Date(q.expiresAt).getTime()).sort((a, b) => a - b)[0];
                const mins = soonest ? Math.max(0, Math.ceil((soonest - Date.now()) / 60000)) : null;
                return mins != null
                  ? `Quotes expire in ${mins} min. Your price locks the moment you select.`
                  : "Your price locks the moment you select.";
              })()}
            </p>
          </>
        )}
      </div>

      {cancelOpen && (
        <div className="fixed inset-0 z-50 flex items-end bg-[rgba(23,24,28,0.4)]" onClick={() => setCancelOpen(false)}>
          <div className="w-full animate-mz-slide-up rounded-t-[18px] bg-[var(--surface)] px-5 pb-6 pt-5" onClick={(e) => e.stopPropagation()}>
            <p className="text-[17px] font-extrabold tracking-tight">Cancel this quote request?</p>
            <p className="mt-1.5 text-[13px] font-medium leading-relaxed text-[var(--ink-2)]">Nothing has been charged yet. You can always book again.</p>
            <div className="mt-4 space-y-2.5">
              <Button variant="danger" className="w-full" onClick={cancel}>Yes, cancel request</Button>
              <Button variant="ghost" className="w-full" onClick={() => setCancelOpen(false)}>Keep collecting quotes</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
