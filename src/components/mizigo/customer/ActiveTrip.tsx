"use client";
// Active trip — the signature "cargo command center": live map, status,
// timeline, driver, price locked, share tracking, cancel policy, POD reveal.
// Chat + help centre wired in (plan §37/§77), stops shown (plan §35).

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { BadgeCheck, ChevronDown, LifeBuoy, MessageCircle, Phone, Share2, ShieldCheck, TriangleAlert, X } from "lucide-react";
import { api, post } from "@/lib/api-client";
import type { ShipmentDTO } from "@/lib/types";
import { useSession } from "@/store/session";
import { Button, Row, StatusBadge, toneForStatus } from "@/components/mizigo/shared/ui";
import MapCanvas from "@/components/mizigo/shared/MapCanvas";
import ChatSheet from "@/components/mizigo/shared/ChatSheet";
import { CUSTOMER_TIMELINE, STATUS_LABEL } from "@/lib/state-machine";
import { etaText, fmtDateTimeEAT, fmtPhone, kes, minutesAgoEAT } from "@/lib/format";
import { toast } from "@/hooks/use-toast";
import { CARGO_CATEGORIES } from "@/lib/pricing";

export default function ActiveTrip() {
  const { focusShipmentId, setBookingStep, setCustomerTab, setTrackToken } = useSession();
  const [expanded, setExpanded] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);

  const { data } = useQuery({
    queryKey: ["shipment", focusShipmentId, "auto"],
    queryFn: () => api<{ shipment: ShipmentDTO }>(`/api/shipments/${focusShipmentId}?demo=auto`),
    enabled: !!focusShipmentId,
    refetchInterval: 2000,
  });
  const s = data?.shipment;

  // auto-advance to rating/receipt once POD is confirmed
  useEffect(() => {
    if (!s) return;
    const rated = s.ratings.some((r) => r.byRole === "CUSTOMER");
    if (s.status === "COMPLETED" && !rated) {
      setBookingStep("rate");
    } else if (s.status === "COMPLETED" && rated) {
      setBookingStep("receipt");
    } else if (s.status === "POD_CONFIRMED" && !rated) {
      setBookingStep("rate");
    }
  }, [s?.status]);

  if (!s) return <div className="h-full animate-pulse bg-[var(--surface-2)]" />;

  const doneTypes = new Set(s.events.map((e) => e.type));
  const activeIdx = CUSTOMER_TIMELINE.findIndex((t) => !doneTypes.has(t.key) && !isDone(t, s.status));
  const catLabel = CARGO_CATEGORIES.find((c) => c.key === s.cargo.category)?.label ?? "Cargo";
  const itemCount = s.cargo.items.reduce((a, i) => a + i.qty, 0);
  const lastPing = s.live?.lastPingMin ?? 0;

  return (
    <div className="relative flex h-full flex-col overflow-hidden bg-[var(--paper)]">
      {/* status header over map */}
      <div className="relative z-20 bg-gradient-to-b from-[rgba(23,24,28,0.82)] to-transparent px-5 pb-8 pt-4">
        <div className="flex items-center justify-between">
          <button onClick={() => setCustomerTab("home")} className="flex h-10 w-10 items-center justify-center rounded-full bg-white/15 text-white backdrop-blur" aria-label="Minimise">
            <ChevronDown size={18} />
          </button>
          <span className="tnum rounded-full bg-white/15 px-3 py-1 text-[11.5px] font-extrabold tracking-wide text-white backdrop-blur">{s.code}</span>
          <button onClick={() => setCancelOpen(true)} className="flex h-10 w-10 items-center justify-center rounded-full bg-white/15 text-white backdrop-blur" aria-label="Cancel delivery">
            <X size={18} />
          </button>
        </div>
        <p className="mt-3 text-[13px] font-bold uppercase tracking-widest text-white/70">Delivery in progress</p>
        <h1 className="text-[22px] font-extrabold leading-tight tracking-tight text-white">
          {statusHeadline(s)}
        </h1>
      </div>

      {/* map */}
      <div className="absolute inset-x-0 bottom-0 top-0">
        <MapCanvas
          route={s.route.polyline}
          markers={[
            ...(s.live ? [{ kind: "vehicle" as const, lat: s.live.lat, lng: s.live.lng, heading: s.live.heading }] : []),
            { kind: "pickup", lat: s.route.pickup.lat, lng: s.route.pickup.lng },
            { kind: "dropoff", lat: s.route.dropoff.lat, lng: s.route.dropoff.lng },
          ]}
          showLabels={false}
          className="absolute inset-0"
        />
      </div>

      {/* bottom sheet */}
      <div className="relative z-10 mt-auto max-h-[68%] overflow-y-auto rounded-t-[18px] bg-[var(--surface)] px-5 pb-5 pt-3.5 sheet-shadow thin-scrollbar">
        <div className="mx-auto mb-3 h-1.5 w-10 rounded-full bg-[var(--line)]" />
        {/* driver row */}
        <div className="flex items-center gap-3.5">
          <span className="flex h-13 w-13 shrink-0 items-center justify-center rounded-full bg-[var(--ink)] text-[16px] font-extrabold text-white" style={{ height: 52, width: 52 }}>
            {s.driver?.initials ?? "—"}
          </span>
          <div className="min-w-0 flex-1">
            <p className="flex items-center gap-1.5 text-[15.5px] font-extrabold tracking-tight">
              {s.driver?.name.split(" ")[0]} {s.driver?.name.split(" ")[1]?.[0]}.
              <BadgeCheck size={15} className="text-[var(--success)]" />
            </p>
            <p className="truncate text-[12.5px] font-semibold text-[var(--ink-2)]">
              {s.vehicle?.make} {s.vehicle?.model} · <span className="font-extrabold text-[var(--ink)]">{s.vehicle?.registration}</span> · ★ {s.driver?.rating.toFixed(1)}
            </p>
          </div>
          {s.live && s.live.leg !== "IDLE" && (
            <div className="text-right">
              <p className="text-[10.5px] font-bold uppercase tracking-widest text-[var(--ink-3)]">ETA</p>
              <p className="tnum text-[18px] font-extrabold text-[var(--brand)]">{etaText(s.live.etaMin ?? 0)}</p>
            </div>
          )}
        </div>

        {lastPing >= 3 && s.live && (
          <p className="mt-2 rounded-[10px] bg-[var(--surface-2)] px-3.5 py-2 text-[12px] font-semibold text-[var(--ink-2)]">
            Last location received {lastPing} min ago (weak network on the road)
          </p>
        )}

        {/* actions */}
        <div className="mt-3 grid grid-cols-3 gap-2.5">
          <Button variant="outline" className="h-12 px-0 text-[13px]" onClick={() => toast({ title: "Calling driver", description: `Connecting to ${fmtPhone(s.driver!.phone)} (sandbox)` })}>
            <Phone size={15} /> Call
          </Button>
          <Button variant="outline" className="h-12 px-0 text-[13px]" onClick={() => setChatOpen(true)}>
            <MessageCircle size={15} /> Chat
          </Button>
          <Button variant="outline" className="h-12 px-0 text-[13px]" onClick={() => { setTrackToken(s.shareToken); toast({ title: "Tracking link copied", description: "Anyone with the link can follow this delivery. No account needed." }); setTimeout(() => useSession.getState().setSurface("customer"), 50); navigator.clipboard?.writeText(`${location.origin}/?view=track&token=${s.shareToken}`).catch(() => {}); }}>
            <Share2 size={15} /> Share
          </Button>
        </div>
        {(s.messages?.length ?? 0) > 0 && (
          <button onClick={() => setChatOpen(true)} className="mt-2 w-full rounded-[10px] bg-[var(--brand-soft)] px-3.5 py-2 text-left text-[12.5px] font-bold text-[var(--brand-ink)]">
            {s.driver?.name.split(" ")[0]}: “{s.messages![s.messages!.length - 1].body}”
          </button>
        )}

        {/* timeline */}
        <div className="mt-3 border-t border-[var(--line)] pt-3.5">
          {CUSTOMER_TIMELINE.map((t, i) => {
            const done = isDone(t, s.status) || doneTypes.has(t.key);
            const active = !done && (activeIdx === -1 || i === activeIdx);
            return (
              <div key={t.key} className="flex items-center gap-3 py-1.5">
                <span
                  className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 ${
                    done ? "border-[var(--success)] bg-[var(--success)] text-white" : active ? "border-[var(--brand)]" : "border-[var(--line)]"
                  }`}
                >
                  {done && (
                    <svg width="10" height="10" viewBox="0 0 12 12"><path d="M2 6.5 L4.8 9 L10 3.5" fill="none" stroke="white" strokeWidth="2.2" strokeLinecap="round" /></svg>
                  )}
                  {active && <span className="h-2.5 w-2.5 animate-mz-pulse rounded-full bg-[var(--brand)]" />}
                </span>
                <span className={`text-[13.5px] ${done ? "font-bold text-[var(--ink)]" : active ? "font-extrabold text-[var(--ink)]" : "font-medium text-[var(--ink-3)]"}`}>{t.label}</span>
              </div>
            );
          })}
        </div>

        {/* quick facts */}
        <div className="mt-3 flex items-center justify-between rounded-[12px] bg-[var(--surface-2)] px-4 py-3">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-widest text-[var(--ink-3)]">Cargo</p>
            <p className="text-[13.5px] font-bold">{itemCount} item{itemCount === 1 ? "" : "s"} · {catLabel}</p>
          </div>
          <div className="text-right">
            <p className="text-[11px] font-bold uppercase tracking-widest text-[var(--ink-3)]">Fare · locked</p>
            <p className="tnum text-[15px] font-extrabold">{kes(s.fare.total)}</p>
          </div>
        </div>

        {/* expandable details */}
        <button onClick={() => setExpanded(!expanded)} className="mt-3 flex w-full items-center justify-center gap-1 text-[13px] font-bold text-[var(--ink-2)]">
          Delivery details <ChevronDown size={14} className={expanded ? "rotate-180 transition" : "transition"} />
        </button>
        {expanded && (
          <div className="mt-2 animate-mz-fade-in space-y-3 border-t border-[var(--line)] pt-3">
            <div>
              <p className="text-[11.5px] font-extrabold uppercase tracking-widest text-[var(--ink-3)]">Items</p>
              {s.cargo.items.map((i) => (
                <Row key={i.name} label={`${i.name} × ${i.qty}`} value={i.weightKg ? `${i.weightKg} kg` : "—"} />
              ))}
            </div>
            {s.route.pickup.note && <Row label="Pickup note" value={s.route.pickup.note} />}
            {s.route.dropoff.note && <Row label="Drop-off note" value={s.route.dropoff.note} />}
            {s.route.stops?.length > 0 && (
              <div>
                <p className="mt-1 text-[11.5px] font-extrabold uppercase tracking-widest text-[var(--ink-3)]">Stops</p>
                {s.route.stops.map((st, i) => {
                  const done = s.events.some((e) => e.type === "STOP_COMPLETED" && e.label.includes(st.name));
                  return <Row key={i} label={`${done ? "✓" : "○"} Stop ${i + 1}`} value={st.name} />;
                })}
              </div>
            )}
            <Row label="Payment" value={s.payment.method === "MPESA" ? `M-PESA · ${s.payment.status === "CONFIRMED" ? "PAID" : s.payment.status}` : "Cash on delivery"} />
            {s.fare.promoCode && <Row label="Promo" value={`${s.fare.promoCode} · -${kes(s.fare.discount)}`} />}
            {s.scheduledAt && <Row label="Scheduled" value={fmtDateTimeEAT(s.scheduledAt)} />}
            <Row label="Booked" value={fmtDateTimeEAT(s.createdAt)} />
            <Row label="Delivery ID" value={s.code} strong />
          </div>
        )}

        <p className="mt-3 flex items-center justify-center gap-1.5 text-[11.5px] font-semibold text-[var(--ink-3)]">
          <ShieldCheck size={12} /> Your trip is tracked from pickup to delivery.
        </p>
        <button onClick={() => setHelpOpen(true)} className="mt-1.5 flex w-full items-center justify-center gap-1.5 text-[12.5px] font-bold text-[var(--brand)]">
          <LifeBuoy size={13} /> Get help with this delivery
        </button>
      </div>

      {/* chat sheet (plan §77) */}
      {chatOpen && <ChatSheet shipmentId={s.id} role="CUSTOMER" onClose={() => setChatOpen(false)} />}

      {/* help centre (plan §37/§76) */}
      {helpOpen && (
        <div className="absolute inset-0 z-30 flex items-end bg-[rgba(23,24,28,0.45)]" onClick={() => setHelpOpen(false)}>
          <div className="w-full animate-mz-slide-up rounded-t-[18px] bg-[var(--surface)] px-5 pb-6 pt-5" onClick={(e) => e.stopPropagation()}>
            <p className="text-[17px] font-extrabold tracking-tight">Get help</p>
            <p className="tnum mt-0.5 text-[12px] font-semibold text-[var(--ink-3)]">Booking {s.code} · {s.route.pickup.area} → {s.route.dropoff.area} · {s.driver ? s.driver.name : "driver pending"}</p>
            <div className="mt-4 space-y-2.5">
              <button onClick={() => { setHelpOpen(false); toast({ title: "Calling support", description: "0800 000 000 · free from Safaricom lines (sandbox)" }); }} className="flex w-full items-center gap-3.5 rounded-[12px] bg-[var(--surface-2)] px-4 py-3.5 text-left">
                <span className="flex h-10 w-10 items-center justify-center rounded-full bg-[var(--brand-soft)] text-[var(--brand)]"><Phone size={16} /></span>
                <span className="flex-1">
                  <span className="block text-[14px] font-extrabold">Call support</span>
                  <span className="block text-[12px] font-medium text-[var(--ink-2)]">0800 000 000 · 24/7</span>
                </span>
              </button>
              <button onClick={() => { setHelpOpen(false); setChatOpen(true); }} className="flex w-full items-center gap-3.5 rounded-[12px] bg-[var(--surface-2)] px-4 py-3.5 text-left">
                <span className="flex h-10 w-10 items-center justify-center rounded-full bg-[var(--brand-soft)] text-[var(--brand)]"><MessageCircle size={16} /></span>
                <span className="flex-1">
                  <span className="block text-[14px] font-extrabold">Message your driver</span>
                  <span className="block text-[12px] font-medium text-[var(--ink-2)]">Quick messages · numbers stay private</span>
                </span>
              </button>
              <button onClick={() => { setHelpOpen(false); setBookingStep("problem"); }} className="flex w-full items-center gap-3.5 rounded-[12px] bg-[var(--surface-2)] px-4 py-3.5 text-left">
                <span className="flex h-10 w-10 items-center justify-center rounded-full bg-[var(--warn-soft)] text-[var(--warn)]"><TriangleAlert size={16} /></span>
                <span className="flex-1">
                  <span className="block text-[14px] font-extrabold">Report a problem</span>
                  <span className="block text-[12px] font-medium text-[var(--ink-2)]">Damaged or missing cargo · wrong delivery</span>
                </span>
              </button>
            </div>
            <Button variant="ghost" className="mt-3 w-full" onClick={() => setHelpOpen(false)}>Close</Button>
          </div>
        </div>
      )}

      {/* cancel sheet */}
      {cancelOpen && (
        <div className="absolute inset-0 z-30 flex items-end bg-[rgba(23,24,28,0.4)] backdrop-blur-[2px]" onClick={() => setCancelOpen(false)}>
          <div className="w-full animate-mz-slide-up rounded-t-[18px] bg-[var(--surface)] px-5 pb-6 pt-5" onClick={(e) => e.stopPropagation()}>
            <p className="text-[17px] font-extrabold tracking-tight">Cancel this delivery?</p>
            <p className="mt-1.5 text-[13px] font-medium leading-relaxed text-[var(--ink-2)]">
              {["MATCHING", "DRIVER_ASSIGNED"].includes(s.status)
                ? "Cancelling now is free. Your M-PESA payment is refunded automatically."
                : s.status === "DRIVER_EN_ROUTE"
                  ? "Cancelling after the driver is on the way may attract a KES 200 fee. M-PESA refunds take up to 24 hours."
                  : "The cargo is already being handled. Call support for help with this delivery."}
            </p>
            <div className="mt-4 space-y-2.5">
              <Button variant="danger" className="w-full" onClick={async () => {
                await post(`/api/shipments/${s.id}/action`, { action: "cancel", actor: "CUSTOMER", reason: "Cancelled by customer" });
                toast({ title: "Delivery cancelled" });
                setCancelOpen(false);
                setBookingStep("idle");
                setCustomerTab("home");
              }}>
                Yes, cancel delivery
              </Button>
              <Button variant="ghost" className="w-full" onClick={() => setCancelOpen(false)}>Keep my delivery</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function statusHeadline(s: ShipmentDTO): string {
  const first = s.driver?.name.split(" ")[0] ?? "Your driver";
  switch (s.status) {
    case "MATCHING": return "Finding your vehicle…";
    case "DRIVER_ASSIGNED": return `${first} accepts in a moment`;
    case "DRIVER_EN_ROUTE": return `${first} is on the way`;
    case "DRIVER_ARRIVED": return `${first} has arrived`;
    case "LOADING": return "Loading your cargo";
    case "LOADED": return "Cargo loaded and verified";
    case "IN_TRANSIT": return "Your delivery is on the way";
    case "ARRIVING": return "Arriving at the destination";
    case "DELIVERED": return "Arrived · unloading";
    case "POD_CONFIRMED": return "Delivery confirmed";
    default: return STATUS_LABEL[s.status] ?? s.status;
  }
}

function isDone(t: { key: string }, status: string): boolean {
  const order = ["MATCHING", "DRIVER_ASSIGNED", "DRIVER_EN_ROUTE", "DRIVER_ARRIVED", "LOADING", "LOADED", "IN_TRANSIT", "ARRIVING", "DELIVERED", "POD_CONFIRMED", "COMPLETED"];
  const map: Record<string, string[]> = {
    PAYMENT_CONFIRMED: ["DRIVER_ASSIGNED", ...order.slice(2)],
    DRIVER_ASSIGNED: ["DRIVER_EN_ROUTE", ...order.slice(3)],
    DRIVER_ACCEPTED: ["DRIVER_ARRIVED", ...order.slice(3)],
    DRIVER_ARRIVED: ["LOADING", "LOADED", ...order.slice(5)],
    CARGO_LOADED: ["IN_TRANSIT", "ARRIVING", "DELIVERED", "POD_CONFIRMED", "COMPLETED"],
    TRIP_STARTED: ["ARRIVING", "DELIVERED", "POD_CONFIRMED", "COMPLETED"],
    ARRIVING: ["DELIVERED", "POD_CONFIRMED", "COMPLETED"],
    COMPLETED: [],
  };
  return (map[t.key] ?? []).includes(status);
}
