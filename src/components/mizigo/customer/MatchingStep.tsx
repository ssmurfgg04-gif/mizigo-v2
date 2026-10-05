"use client";
// Matching — "Looking for the best match near you" → driver found.
// Shows nearby vehicles, then the matched driver card with verify-plate safety.

import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { BadgeCheck, MessageCircle, Phone, ShieldCheck, X } from "lucide-react";
import { api, post } from "@/lib/api-client";
import type { ShipmentDTO } from "@/lib/types";
import { useSession } from "@/store/session";
import { Button, StatusBadge } from "@/components/mizigo/shared/ui";
import MapCanvas from "@/components/mizigo/shared/MapCanvas";
import VehicleAvatar from "@/components/mizigo/shared/VehicleAvatar";
import ChatSheet from "@/components/mizigo/shared/ChatSheet";
import { etaText, kes } from "@/lib/format";
import { toast } from "@/hooks/use-toast";
import { t } from "@/lib/i18n";

export default function MatchingStep() {
  const { user, focusShipmentId, setBookingStep, setFocusShipment, resetDraft, lang } = useSession();

function setCustomerTabHome() { useSession.getState().setCustomerTab("home"); }
  const [requested, setRequested] = useState(false);
  const [noDrivers, setNoDrivers] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const requestedRef = useRef(false);

  // the shipment is created in PaymentStep; if missing (e.g. cash flow skipped) request directly
  useEffect(() => {
    if (!focusShipmentId || requestedRef.current) return;
    (async () => {
      const s = await api<{ shipment: ShipmentDTO }>(`/api/shipments/${focusShipmentId}`);
      if (s.shipment.status === "PAYMENT_CONFIRMED" || s.shipment.status === "PRICED") {
        requestedRef.current = true;
        setRequested(true);
        const r = await post<{ matched: boolean }>(`/api/shipments/${focusShipmentId}/action`, { action: "request", actor: "CUSTOMER" });
        if (!r.matched) setNoDrivers(true);
        setRequested(false);
      }
    })();
  }, [focusShipmentId]);

  const { data } = useQuery({
    queryKey: ["shipment", focusShipmentId],
    queryFn: () => api<{ shipment: ShipmentDTO }>(`/api/shipments/${focusShipmentId}`),
    enabled: !!focusShipmentId,
    refetchInterval: (q) => {
      const st = q.state.data?.shipment.status;
      // keep polling until the driver accepts (auto-accept sim) or matching fails
      return st === "PAYMENT_CONFIRMED" || st === "MATCHING" || st === "DRIVER_ASSIGNED" ? 2000 : false;
    },
  });

  const s = data?.shipment;

  // transition to active view once matched and the offer stands
  useEffect(() => {
    if (s && s.status === "DRIVER_ASSIGNED") {
      const t = setTimeout(() => setBookingStep("active"), 2600);
      return () => clearTimeout(t);
    }
  }, [s?.status]);

  if (!s) {
    return <div className="h-full animate-pulse bg-[var(--surface-2)]" />;
  }

  const matched = ["DRIVER_ASSIGNED", "DRIVER_EN_ROUTE", "DRIVER_ARRIVED", "LOADING", "LOADED", "IN_TRANSIT", "ARRIVING"].includes(s.status);

  return (
    <div className="relative flex h-full flex-col overflow-hidden bg-[var(--paper)]">
      {/* map 65% */}
      <div className="relative min-h-0 flex-[1.9]">
        <MapCanvas
          route={matched ? s.route.polyline : undefined}
          markers={[
            { kind: "pickup", lat: s.route.pickup.lat, lng: s.route.pickup.lng, label: s.route.pickup.area },
            { kind: "dropoff", lat: s.route.dropoff.lat, lng: s.route.dropoff.lng, label: s.route.dropoff.area },
            ...(matched && s.live ? [{ kind: "vehicle" as const, lat: s.live.lat, lng: s.live.lng, heading: s.live.heading }] : []),
          ]}
          showLabels={false}
          className="absolute inset-0"
        />
      </div>

      {/* bottom sheet */}
      <div className="relative z-10 -mt-6 flex-[1.1] rounded-t-[18px] bg-[var(--surface)] px-5 pb-5 pt-4 sheet-shadow">
        {!matched && !noDrivers && (
          <div className="animate-mz-slide-up">
            <div className="flex items-center gap-3">
              <span className="relative flex h-3 w-3">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[var(--brand)] opacity-60" />
                <span className="relative inline-flex h-3 w-3 rounded-full bg-[var(--brand)]" />
              </span>
              <p className="text-[18px] font-extrabold tracking-tight">{requested ? t("booking.requestVehicle", lang) : t("matching.finding", lang)}</p>
            </div>
            <p className="mt-1 text-[13px] font-medium text-[var(--ink-2)]">Looking for the best match near {s.route.pickup.area}.</p>
            <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-[var(--surface-2)]">
              <div className="h-full rounded-full bg-[var(--brand)]" style={{ animation: "mz-pulse 1.4s ease-in-out infinite", width: "62%" }} />
            </div>
            <button
              onClick={async () => {
                await post(`/api/shipments/${s.id}/action`, { action: "cancel", actor: "CUSTOMER", reason: "Cancelled while searching" });
                toast({ title: "Delivery cancelled", description: "Your M-PESA payment will be refunded." });
                resetDraft();
                setFocusShipment(null);
                setBookingStep("idle");
              }}
              className="mt-5 w-full text-[13.5px] font-bold text-[var(--ink-3)] underline underline-offset-4"
            >
              Cancel this delivery
            </button>
          </div>
        )}

        {noDrivers && (
          <div className="animate-mz-slide-up text-center">
            <StatusBadge tone="warn">No vehicle available</StatusBadge>
            <p className="mt-3 text-[17px] font-extrabold tracking-tight">We couldn&apos;t find a vehicle nearby</p>
            <p className="mt-1 text-[13px] font-medium text-[var(--ink-2)]">Your payment is safe and will be refunded automatically.</p>
            <Button variant="brand" className="mt-4 w-full" onClick={() => { resetDraft(); setFocusShipment(null); setBookingStep("idle"); setCustomerTabHome(); }}>
              Change vehicle or time
            </Button>
          </div>
        )}

        {matched && s.driver && (
          <div className="animate-mz-slide-up">
            <div className="flex items-center justify-between">
              <StatusBadge tone="success"><BadgeCheck size={13} /> {t("matching.driverFound", lang)}</StatusBadge>
              <span className="tnum text-[12px] font-bold text-[var(--ink-3)]">{s.code}</span>
            </div>
            <div className="mt-3 flex items-center gap-3.5">
              <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-[var(--ink)] text-[17px] font-extrabold text-white">
                {s.driver.initials}
              </span>
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-1.5 text-[16.5px] font-extrabold tracking-tight">
                  {s.driver.name.split(" ")[0]} {s.driver.name.split(" ")[1]?.[0]}.
                  <span className="tnum text-[13px] font-bold text-[var(--ink-2)]">★ {s.driver.rating.toFixed(1)}</span>
                </p>
                <p className="text-[13px] font-semibold text-[var(--ink-2)]">{s.vehicle?.make} {s.vehicle?.model} · {s.category.name}</p>
                <p className="mt-0.5 flex items-center gap-1.5 text-[13.5px] font-extrabold tracking-wide text-[var(--ink)]">
                  {s.vehicle?.registration}
                </p>
              </div>
              <div className="text-right">
                <p className="text-[11px] font-bold uppercase tracking-widest text-[var(--ink-3)]">Arrives in</p>
                <p className="tnum text-[19px] font-extrabold text-[var(--brand-deep)]">{etaText(s.live?.etaMin ?? 7)}</p>
              </div>
            </div>
            <div className="mt-3 flex items-center gap-1.5 rounded-[10px] bg-[var(--warn-soft)] px-3.5 py-2.5 text-[12.5px] font-semibold text-[var(--warn)]">
              <ShieldCheck size={14} /> Verify the vehicle plate before loading: {s.vehicle?.registration}
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2.5">
              <Button variant="outline" onClick={() => toast({ title: "Calling driver", description: `Connecting you to ${s.driver!.name.split(" ")[0]}… (sandbox)` })}>
                <Phone size={16} /> {t("matching.call", lang)}
              </Button>
              <Button variant="outline" onClick={() => setChatOpen(true)}>
                <MessageCircle size={16} /> {t("matching.message", lang)}
              </Button>
            </div>
            {focusShipmentId && chatOpen && <ChatSheet shipmentId={focusShipmentId} role="CUSTOMER" onClose={() => setChatOpen(false)} />}
          </div>
        )}
      </div>
    </div>
  );
}
