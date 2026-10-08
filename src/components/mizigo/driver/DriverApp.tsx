"use client";
// Driver app — action-first, one-handed, high information at decision points.
// Includes quote-marketplace jobs (plan §33), chat (plan §77), stops (plan §35),
// cargo issue reporting (plan §15) and the documents screen (plan §29).

import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import dynamic from "next/dynamic";
import {
  ArrowLeft, ArrowUpRight, Banknote, BriefcaseBusiness, CheckCircle2, ChevronRight, Clock3,
  FileCheck2, LogOut, MapPin, MapPinOff, MessageCircle, Navigation, PackageOpen, Phone, Power, Star,
  TriangleAlert, Truck, User, Wallet, X, Siren,
} from "lucide-react";
import { api, post, ApiError } from "@/lib/api-client";
import type { DriverHome, ShipmentDTO } from "@/lib/types";
import { useSession } from "@/store/session";
import { Button, EmptyState, ErrorState, ListSkeleton, Row, SectionTitle, StatusBadge, toneForStatus, AvatarInitials } from "@/components/mizigo/shared/ui";
import MapCanvas from "@/components/mizigo/shared/MapCanvas";
import type { LiveMapMarker } from "@/components/mizigo/shared/LiveMap";
import VehicleAvatar from "@/components/mizigo/shared/VehicleAvatar";
import ChatSheet from "@/components/mizigo/shared/ChatSheet";
import ReturnLoadPublisher from "./ReturnLoadPublisher";
import EarningsTab from "./EarningsTab";
import DriverPayoutDetails from "./DriverPayoutDetails";
import { driverReliability } from "@/lib/matching";
import { kes, etaText, fmtDateEAT, fmtDateTimeEAT, relTimeEAT, fmtPhone } from "@/lib/format";
import { STATUS_LABEL } from "@/lib/state-machine";
import { SPECIAL_HANDLING } from "@/lib/pricing";
import { toast } from "@/hooks/use-toast";
import { post as apiPost, loginWithOtp } from "@/lib/api-client";
import type { SessionUser } from "@/store/session";
import { useSettings } from "@/components/mizigo/shared/useSettings";

// live map (MapLibre) — lazy so maplibre stays out of the driver bundle until a trip opens
const LiveMap = dynamic(() => import("@/components/mizigo/shared/LiveMap"), {
  ssr: false,
  loading: () => <div className="h-full w-full animate-pulse bg-[var(--surface-2)]" />,
});

// ─── Home ───
function DriverHomeScreen({ data, onOpenTrip }: { data: DriverHome; onOpenTrip: () => void }) {
  const { patchStatus } = useDriverActions();
  const online = data.driver.status === "ONLINE";
  const active = data.active;

  return (
    <div className="space-y-4 pb-6">
      {/* online toggle */}
      <button
        onClick={() => patchStatus(online ? "OFFLINE" : "ONLINE")}
        className={`flex w-full items-center gap-4 rounded-[16px] border-2 p-4 text-left transition active:translate-y-px ${online ? "border-[var(--success)] bg-[var(--success-soft)]" : "border-[var(--line)] bg-[var(--surface)]"}`}
        aria-pressed={online}
      >
        <span className={`flex h-14 w-14 items-center justify-center rounded-2xl transition ${online ? "bg-[var(--success)] text-white" : "bg-[var(--surface-2)] text-[var(--ink-3)]"}`}>
          <Power size={24} strokeWidth={2.4} />
        </span>
        <span className="flex-1">
          <span className={`block text-[18px] font-extrabold tracking-tight ${online ? "text-[var(--success)]" : ""}`}>
            {online ? "You're online" : "You're offline"}
          </span>
          <span className="block text-[12.5px] font-medium text-[var(--ink-2)]">
            {online ? "Receiving delivery requests" : "Go online to receive requests"}
          </span>
        </span>
        <span className={`relative h-8 w-14 rounded-full transition ${online ? "bg-[var(--success)]" : "bg-[var(--line)]"}`}>
          <span className={`absolute top-1 h-6 w-6 rounded-full bg-white shadow transition-all ${online ? "left-[30px]" : "left-1"}`} />
        </span>
      </button>

      {/* active job banner */}
      {active ? (
        <button onClick={onOpenTrip} className="w-full rounded-[16px] border-2 border-[var(--brand)] bg-[var(--surface)] p-4 text-left transition active:translate-y-px">
          <div className="flex items-center justify-between">
            <StatusBadge tone={toneForStatus(active.status)}>{STATUS_LABEL[active.status] ?? active.status}</StatusBadge>
            <span className="tnum text-[12px] font-bold text-[var(--ink-3)]">{active.code}</span>
          </div>
          <p className="mt-2.5 text-[15.5px] font-extrabold tracking-tight">
            {active.route.pickup.area} → {active.route.dropoff.area}
          </p>
          <p className="mt-0.5 text-[12.5px] font-semibold text-[var(--ink-2)]">
            Earning {kes(active.fare.driverEarnings)}
            {active.live?.etaMin != null && active.live.etaMin > 0 ? ` · ${etaText(active.live.etaMin)} to pickup` : " · at the pickup"}
          </p>
          <span className="mt-2.5 inline-flex items-center gap-1 text-[13px] font-bold text-[var(--brand-deep)]">
            Open trip <ChevronRight size={14} strokeWidth={2.8} />
          </span>
        </button>
      ) : online ? (
        <div className="rounded-[16px] border border-dashed border-[var(--line)] bg-[var(--surface)] px-4 py-5 text-center">
          <p className="text-[14px] font-bold">Waiting for requests…</p>
          <p className="mt-0.5 text-[12.5px] font-medium text-[var(--ink-2)]">Stay online. Jobs appear the moment a customer books your vehicle class.</p>
        </div>
      ) : null}

      {/* earnings today */}
      <div className="rounded-[16px] bg-[var(--ink)] p-5 text-white">
        <p className="text-[11.5px] font-bold uppercase tracking-widest text-white/50">Today</p>
        <p className="tnum mt-1 text-[34px] font-extrabold leading-none tracking-tight">{kes(data.earnings.today)}</p>
        <div className="mt-4 grid grid-cols-3 gap-3 border-t border-white/10 pt-3.5 text-center">
          <div>
            <p className="tnum text-[17px] font-extrabold">{data.earnings.todayTrips}</p>
            <p className="text-[10.5px] font-semibold text-white/50">Trips</p>
          </div>
          <div>
            <p className="tnum text-[17px] font-extrabold">{data.earnings.avgPerTrip ? kes(data.earnings.avgPerTrip, { compact: true }).replace("KES ", "") : 0}</p>
            <p className="text-[10.5px] font-semibold text-white/50">Per trip</p>
          </div>
          <div>
            <p className="tnum text-[17px] font-extrabold">{(data.driver.onlineMinutes / 60).toFixed(1)}h</p>
            <p className="text-[10.5px] font-semibold text-white/50">Online</p>
          </div>
        </div>
      </div>

      {/* demand map */}
      <div className="overflow-hidden rounded-[16px] border border-[var(--line)] bg-[var(--surface)]">
        <div className="flex items-center justify-between px-4 pt-4">
          <SectionTitle>Where the work is</SectionTitle>
          <StatusBadge tone="active">Live</StatusBadge>
        </div>
        <div className="relative mt-3 h-52">
          <MapCanvas
            markers={data.demand.map((z) => {
              const coords: Record<string, { lat: number; lng: number }> = {
                CBD: { lat: -1.2841, lng: 36.8265 }, Westlands: { lat: -1.2613, lng: 36.8027 },
                "Industrial Area": { lat: -1.3080, lng: 36.8330 }, Kilimani: { lat: -1.2921, lng: 36.7859 },
                "Thika Road": { lat: -1.2267, lng: 36.8889 }, Karen: { lat: -1.3197, lng: 36.7076 },
              };
              const c = coords[z.name] ?? { lat: -1.28, lng: 36.82 };
              return { kind: "demand" as const, lat: c.lat, lng: c.lng, label: z.name, sub: z.level };
            })}
            showLabels={false} className="absolute inset-0" fitPad={40}
          />
        </div>
        <div className="flex items-center gap-4 px-4 py-3 text-[11.5px] font-bold text-[var(--ink-2)]">
          <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-[var(--brand)]" /> High</span>
          <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-[var(--warn)]" /> Medium</span>
          <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-[var(--success)]" /> Steady</span>
        </div>
      </div>

      {/* return-capacity marketplace (v1 goodness) */}
      <ReturnLoadPublisher data={data} />

      {/* reputation strip */}
      <div className="flex items-center gap-3 rounded-[16px] border border-[var(--line)] bg-[var(--surface)] p-4">
        <AvatarInitials initials={data.driver.user.name.split(" ").map((w) => w[0]).slice(0, 2).join("")} size={46} />
        <div className="flex-1">
          <p className="text-[15px] font-extrabold">{data.driver.user.name}</p>
          <p className="flex items-center gap-1 text-[12.5px] font-semibold text-[var(--ink-2)]">
            <Star size={12} className="fill-[var(--brand)] text-[var(--brand-deep)]" /> {data.driver.rating.toFixed(1)} · {data.driver.trips} trips · {Math.round(data.driver.onTimeDelivery * 100)}% on time
          </p>
        </div>
        <StatusBadge tone="success">Verified</StatusBadge>
      </div>
    </div>
  );
}

// ─── Requests (offer + trip flow + quote jobs) ───

/** Uber driver-offer pattern: a visible response window. Cargo gets 30 s
 *  (ride-hailing pilots run 10–15 s); at zero the job is declined and offered
 *  to the next driver — the countdown is real, not decorative. */
function OfferCountdown({ seconds = 30, onExpire }: { seconds?: number; onExpire: () => void }) {
  const [left, setLeft] = useState(seconds);
  const fired = useRef(false);
  useEffect(() => {
    const iv = setInterval(() => {
      setLeft((v) => (v <= 1 ? 0 : v - 1));
    }, 1000);
    return () => clearInterval(iv);
  }, []);
  useEffect(() => {
    if (left === 0 && !fired.current) {
      fired.current = true;
      onExpire();
    }
  }, [left, onExpire]);
  const CIRC = 2 * Math.PI * 15.5;
  return (
    <span className="flex items-center gap-2" role="timer" aria-label={`${left} seconds to respond`}>
      <svg width="30" height="30" viewBox="0 0 36 36" className="-rotate-90" aria-hidden="true">
        <circle cx="18" cy="18" r="15.5" fill="none" stroke="var(--line)" strokeWidth="4" />
        <circle cx="18" cy="18" r="15.5" fill="none" stroke={left <= 10 ? "var(--danger)" : "var(--brand)"} strokeWidth="4" strokeLinecap="round" strokeDasharray={CIRC} strokeDashoffset={CIRC * (1 - left / seconds)} />
      </svg>
      <span className="tnum text-[13px] font-extrabold">{left}s</span>
    </span>
  );
}

function DriverTripScreen({ data, onDone }: { data: DriverHome; onDone: () => void }) {
  const s = data.active;
  const [busy, setBusy] = useState(false);
  const [cargoCheck, setCargoCheck] = useState<null | { itemsOk: boolean; photos: number; condition: string }>(null);
  const [podPhase, setPodPhase] = useState<"info" | "otp">("info");
  const [podOtp, setPodOtp] = useState("");
  const [recipient, setRecipient] = useState("");
  const [chatOpen, setChatOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [reportKind, setReportKind] = useState<string | null>(null);
  const [reportNote, setReportNote] = useState("");
  const [gpsMismatch, setGpsMismatch] = useState<{ action: "arrive" | "deliver"; distanceM: number } | null>(null);
  const [declineConfirm, setDeclineConfirm] = useState(false);
  const [doneStops, setDoneStops] = useState<number[]>([]);
  const [sosOpen, setSosOpen] = useState(false);
  const [sosSent, setSosSent] = useState(false);
  // driver-side navigation: real OSRM road geometry + turn-by-turn + traffic
  // (hook must run before the early return; it accepts a null shipment)
  const nav = useDriverNav(s, doneStops);
  if (!s) {
    return <EmptyState icon={<PackageOpen size={22} />} title="No active job" body="When you accept a delivery it will guide you step by step." action={<Button variant="outline" onClick={onDone}>Back home</Button>} />;
  }

  const act = async (action: string, extra: Record<string, unknown> = {}) => {
    setBusy(true);
    try {
      const r = await post<{ shipment: ShipmentDTO }>(`/api/shipments/${s.id}/action`, { action, actor: "DRIVER", ...extra });
      if (["COMPLETED", "CANCELLED"].includes(r.shipment.status)) onDone();
    } catch (e) {
      const err = e instanceof ApiError ? e : null;
      // Bolt GPS-mismatch confirm (DECOMPILE_FINDINGS §Deep Dive 2): the
      // server refuses an arrival claim while fresh app-GPS sits far from
      // the target point — surface the explicit confirm instead of an error
      if (err && err.status === 409 && err.data?.code === "GPS_MISMATCH" && (action === "arrive" || action === "deliver")) {
        setGpsMismatch({ action, distanceM: Number(err.data.distanceM ?? 0) });
      } else {
        toast({ title: "Action failed", description: (e as Error).message, variant: "destructive" });
      }
    } finally {
      setBusy(false);
    }
  };

  // one-shot fresh GPS right before an arrival claim, so the server gate
  // judges the CURRENT position rather than the last watch ping; silent on
  // denial/unavailability (the gate simply stays open — Bolt behaviour)
  const pingGps = () =>
    new Promise<void>((resolve) => {
      if (typeof navigator === "undefined" || !navigator.geolocation) return resolve();
      navigator.geolocation.getCurrentPosition(
        (p) => {
          void post("/api/driver/action", { action: "ping", lat: p.coords.latitude, lng: p.coords.longitude })
            .catch(() => null)
            .then(() => resolve());
        },
        () => resolve(),
        { enableHighAccuracy: true, timeout: 8000, maximumAge: 4000 },
      );
    });
  const arriveWithGps = async (action: "arrive" | "deliver") => {
    setBusy(true);
    await pingGps();
    setBusy(false);
    await act(action);
  };

  const acceptOffer = () => act("driver-accept");
  const declineOffer = async () => {
    // Bolt pattern (DECOMPILE_FINDINGS §Deep Dive 2): declining asks for an
    // explicit confirm first — no reason picker, the job simply moves on
    setDeclineConfirm(false);
    await act("decline");
    toast({ title: "Offer declined", description: "Searching for the next driver." });
    onDone();
  };

  // ── offer ──
  if (s.status === "DRIVER_ASSIGNED") {
    return (
      <div className="flex h-full flex-col">
        <div className="relative h-52 shrink-0">
          <MapCanvas
            markers={[{ kind: "vehicle", lat: s.live?.lat ?? s.route.pickup.lat, lng: s.live?.lng ?? s.route.pickup.lng }, { kind: "pickup", lat: s.route.pickup.lat, lng: s.route.pickup.lng, label: s.route.pickup.area }]}
            showLabels={false} className="absolute inset-0"
          />
        </div>
        <div className="animate-mz-slide-up flex flex-1 flex-col rounded-t-[18px] bg-[var(--surface)] px-5 pb-5 pt-4 sheet-shadow">
          <div className="flex items-center justify-between">
            <StatusBadge tone="active">New delivery request</StatusBadge>
            {/* Uber driver-offer pattern: a visible response window — cargo gets
                30 s (ride-hailing uses 10–15 s); at 0 the job goes to the next driver */}
            <OfferCountdown onExpire={() => void declineOffer()} />
          </div>
          <div className="mt-3 flex items-center gap-3">
            <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-[var(--surface-2)]"><VehicleAvatar category={s.category.key} size={38} /></span>
            <div className="flex-1">
              <p className="text-[15.5px] font-extrabold">{s.route.pickup.area} → {s.route.dropoff.area}</p>
              <p className="text-[12.5px] font-semibold text-[var(--ink-2)]">
                {s.route.distanceKm.toFixed(1)} km · pickup {etaText(s.live?.etaMin ?? 8)} away · customer ★ {s.customer.rating.toFixed(1)}
              </p>
            </div>
          </div>
          <div className="mt-3 rounded-[12px] bg-[var(--surface-2)] px-4 py-3">
            <Row label="Cargo" value={`${s.cargo.items.reduce((a, i) => a + i.qty, 0)} items · ${s.cargo.load.toLowerCase().replace(/_/g, " ")}`} />
            {s.cargo.special.length > 0 && (
              <Row label="Care" value={s.cargo.special.slice(0, 3).map((k) => SPECIAL_HANDLING.find((x) => x.key === k)?.label ?? k).join(" · ")} />
            )}
            {s.cargo.helpers > 0 && <Row label="Loading help" value={`× ${s.cargo.helpers} requested`} />}
            {/* Bolt-style take-rate transparency: the driver sees the whole money story */}
            <Row label="Customer pays" value={kes(s.fare.total)} />
            <Row label="Commission + platform fee" value={`− ${kes(s.fare.commission + s.fare.platform)}`} />
            <Row label="Your earnings" value={kes(s.fare.driverEarnings)} strong />
          </div>
          <div className="mt-auto space-y-2.5 pt-4">
            <Button variant="brand" className="w-full" onClick={acceptOffer} loading={busy}>Accept · {kes(s.fare.driverEarnings)}</Button>
            <Button variant="outline" className="w-full h-12" onClick={() => setDeclineConfirm(true)}>Decline</Button>
          </div>
        </div>

        {/* decline confirm (Bolt pattern — explicit confirm, no reason picker) */}
        {declineConfirm && (
          <div className="fixed inset-0 z-50 flex items-end bg-[rgba(23,24,28,0.45)]" onClick={() => setDeclineConfirm(false)}>
            <div className="w-full animate-mz-slide-up rounded-t-[18px] bg-[var(--surface)] px-5 pb-6 pt-5" onClick={(e) => e.stopPropagation()}>
              <p className="text-[17px] font-extrabold tracking-tight">Decline this delivery?</p>
              <p className="mt-1 text-[12.5px] font-medium leading-relaxed text-[var(--ink-2)]">
                The job goes straight to the next driver. Frequent declines can lower how often we offer you jobs.
              </p>
              <div className="mt-4 space-y-2.5">
                <Button variant="brand" className="w-full" onClick={() => setDeclineConfirm(false)}>Keep the job</Button>
                <Button variant="outline" className="w-full h-12" onClick={() => void declineOffer()}>Decline</Button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  // ── navigation / pickup / transit / delivery ──
  const stage: "TO_PICKUP" | "AT_PICKUP" | "VERIFY" | "TO_DROPOFF" | "AT_DROPOFF" | "POD" =
    s.status === "DRIVER_EN_ROUTE" ? "TO_PICKUP" :
    s.status === "DRIVER_ARRIVED" ? "AT_PICKUP" :
    ["LOADING", "LOADED"].includes(s.status) ? "VERIFY" :
    ["IN_TRANSIT", "ARRIVING"].includes(s.status) ? "TO_DROPOFF" :
    s.status === "DELIVERED" ? "AT_DROPOFF" : "POD";

  const heading: Record<string, string> = {
    TO_PICKUP: `Pickup · ${s.route.pickup.area}`,
    AT_PICKUP: "You're at the pickup",
    VERIFY: "Confirm the cargo",
    TO_DROPOFF: `Deliver to ${s.route.dropoff.area}`,
    AT_DROPOFF: "You've arrived",
    POD: "Proof of delivery",
  };

  return (
    <div className="flex h-full flex-col">
      <div className="relative min-h-0 flex-[1.6]">
        {/* real-tile map with the live route; the SVG schematic stays as the
            automatic fallback (WebGL-less environments) */}
        <LiveMap
          markers={nav?.markers ?? [
            ...(s.live ? [{ id: "driver" as const, kind: "driver" as const, lat: s.live.lat, lng: s.live.lng, heading: s.live.heading, categoryKey: s.category.key }] : []),
            { id: "pickup", kind: "pickup" as const, lat: s.route.pickup.lat, lng: s.route.pickup.lng, label: s.route.pickup.area },
            { id: "dropoff", kind: "dropoff" as const, lat: s.route.dropoff.lat, lng: s.route.dropoff.lng, label: s.route.dropoff.area },
          ]}
          route={nav?.route ?? s.route.polyline}
          follow
          className="absolute inset-0"
          fallback={
            <MapCanvas
              route={s.route.polyline}
              markers={[
                ...(s.live ? [{ kind: "vehicle" as const, lat: s.live.lat, lng: s.live.lng, heading: s.live.heading }] : []),
                { kind: "pickup", lat: s.route.pickup.lat, lng: s.route.pickup.lng },
                { kind: "dropoff", lat: s.route.dropoff.lat, lng: s.route.dropoff.lng },
              ]}
              showLabels={false} className="absolute inset-0"
            />
          }
        />
        <div className="absolute left-4 right-4 top-4 flex items-center justify-between">
          <span className="rounded-full bg-[var(--ink)]/85 px-3.5 py-1.5 text-[12px] font-extrabold text-white backdrop-blur">{heading[stage]}</span>
          <div className="flex items-center gap-2">
            {s.live?.etaMin != null && s.live.leg !== "IDLE" && (
              <span className="tnum rounded-full bg-white/90 px-3.5 py-1.5 text-[13px] font-extrabold text-[var(--ink)] backdrop-blur">{etaText(s.live.etaMin)}</span>
            )}
            {/* driver-side safety alert (Uber SOS pattern — ops callback, not direct police integration) */}
            <button onClick={() => { setSosOpen(true); setSosSent(false); }} className="flex h-9 w-9 items-center justify-center rounded-full bg-[var(--danger)] text-white shadow-lg" aria-label="Safety alert">
              <Siren size={16} />
            </button>
          </div>
        </div>
      </div>

      <div className="flex min-h-0 flex-[1] flex-col overflow-y-auto rounded-t-[18px] bg-[var(--surface)] px-5 pb-5 pt-4 sheet-shadow thin-scrollbar">
        {/* context card */}
        <div className="rounded-[12px] bg-[var(--surface-2)] px-4 py-3">
          <Row label="Customer" value={s.customer.name} />
          <Row label="Pickup" value={s.route.pickup.name} />
          <Row label="Drop-off" value={s.route.dropoff.name} />
          {s.route.stops?.length > 0 && (
            <div className="mt-2 border-t border-[var(--line)] pt-2">
              <p className="text-[11px] font-extrabold uppercase tracking-widest text-[var(--ink-3)]">Stop sequence</p>
              {s.route.stops.map((st, i) => {
                const serverDone = s.events.some((e) => e.type === "STOP_COMPLETED" && e.label.includes(st.name));
                const done = serverDone || doneStops.includes(i);
                return (
                  <div key={i} className="mt-1.5 flex items-center gap-2.5">
                    <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-extrabold ${done ? "bg-[var(--success)] text-white" : "bg-[var(--ink)] text-white"}`}>{done ? "✓" : i + 1}</span>
                    <span className={`flex-1 text-[13px] font-bold ${done ? "text-[var(--ink-3)] line-through" : ""}`}>{st.name}</span>
                    {!done && ["IN_TRANSIT", "ARRIVING"].includes(s.status) && (
                      <button
                        onClick={() => { setDoneStops([...doneStops, i]); act("stop-done", { stopIndex: i }); }}
                        className="rounded-full bg-[var(--brand-deep)] px-3 py-1.5 text-[11.5px] font-extrabold text-white"
                      >
                        Mark done
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
          {s.route.pickup.note && <Row label="Instructions" value={s.route.pickup.note} />}
          <Row label="Earnings" value={kes(s.fare.driverEarnings)} strong />
        </div>

        {/* chat + last message */}
        {(s.messages?.length ?? 0) > 0 ? (
          <button onClick={() => setChatOpen(true)} className="mt-3 flex w-full items-center gap-2.5 rounded-[10px] bg-[var(--brand-soft)] px-3.5 py-2.5 text-left">
            <MessageCircle size={15} className="shrink-0 text-[var(--brand-deep)]" />
            <span className="min-w-0 flex-1 truncate text-[12.5px] font-bold text-[var(--brand-ink)]">{s.messages![s.messages!.length - 1].senderRole === "DRIVER" ? "You" : s.customer.name.split(" ")[0]}: “{s.messages![s.messages!.length - 1].body}”</span>
          </button>
        ) : (
          <button onClick={() => setChatOpen(true)} className="mt-3 flex items-center gap-1.5 text-[12.5px] font-bold text-[var(--brand-deep)]">
            <MessageCircle size={14} /> Message the customer
          </button>
        )}

        {/* turn-by-turn card (road geometry, remaining distance/time incl.
            typical traffic, Google Maps handoff) */}
        {nav && nav.steps.length > 0 && <NavigationSection nav={nav} />}

        {/* stage actions */}
        <div className="mt-4 space-y-2.5">
          {stage === "TO_PICKUP" && (
            <>
              <Button variant="outline" className="w-full" onClick={() => window.open(nav?.gmapsUrl ?? `https://www.google.com/maps/dir/?api=1&destination=${s.route.pickup.lat},${s.route.pickup.lng}&travelmode=driving`, "_blank", "noopener")}>
                <Navigation size={16} /> Navigate to pickup
              </Button>
              <Button variant="brand" className="w-full" onClick={() => arriveWithGps("arrive")} loading={busy}>I've arrived</Button>
            </>
          )}

          {stage === "AT_PICKUP" && (
            <>
              <p className="text-[13px] font-semibold text-[var(--ink-2)]">Confirm the vehicle matches what the customer sees: <span className="font-extrabold text-[var(--ink)]">{s.vehicle?.registration}</span></p>
              <Button variant="outline" className="w-full" onClick={() => toast({ title: "Calling customer", description: fmtPhone(s.customer.phone) })}>
                <Phone size={16} /> Call customer
              </Button>
              <Button variant="brand" className="w-full" onClick={() => act("start-loading")} loading={busy}>Start loading</Button>
              <button onClick={() => setReportOpen(true)} className="w-full text-[12.5px] font-bold text-[var(--warn)] underline underline-offset-4">
                Cargo differs from the booking?
              </button>
            </>
          )}

          {stage === "VERIFY" && !cargoCheck && (
            <div className="animate-mz-fade-in">
              <p className="text-[15px] font-extrabold">Confirm cargo</p>
              <div className="mt-2 divide-y divide-[var(--line)] rounded-[12px] border border-[var(--line)] px-4">
                {s.cargo.items.map((i) => (
                  <div key={i.name} className="flex justify-between py-2.5 text-[13.5px]">
                    <span className="font-bold">{i.name}</span>
                    <span className="tnum font-extrabold">× {i.qty}</span>
                  </div>
                ))}
              </div>
              <p className="mt-3 text-[12.5px] font-semibold text-[var(--ink-2)]">Take photos of the loaded cargo (3 recommended)</p>
              <div className="mt-2 grid grid-cols-3 gap-2">
                {[0, 1, 2].map((i) => (
                  <button
                    key={i}
                    onClick={() => { const p = [...(cargoCheckPhotos(i))]; setCargoCheck({ itemsOk: true, photos: i + 1, condition: "No damage" }); toast({ title: "Photo captured", description: "Timestamp + GPS attached." }); }}
                    className="flex h-20 items-center justify-center rounded-[12px] border-2 border-dashed border-[var(--line)] text-[var(--ink-3)] transition hover:border-[var(--brand)] hover:text-[var(--brand-deep)]"
                    aria-label={`Take photo ${i + 1}`}
                  >
                    <span className="text-[11px] font-bold">Photo {i + 1}</span>
                  </button>
                ))}
              </div>
              <Button variant="brand" className="mt-4 w-full" onClick={() => act("loaded")} loading={busy}>Cargo loaded · ready to transport</Button>
            </div>
          )}

          {stage === "VERIFY" && cargoCheck && (
            <>
              <p className="flex items-center gap-2 text-[13.5px] font-bold text-[var(--success)]"><CheckCircle2 size={16} /> {cargoCheck.photos} photos attached · condition: {cargoCheck.condition}</p>
              <Button
                variant="brand" className="w-full" loading={busy}
                onClick={async () => {
                  // confirm loaded with ops, then start the delivery leg
                  await act("loaded");
                  await act("start-trip");
                }}
              >
                Start delivery
              </Button>
            </>
          )}

          {stage === "TO_DROPOFF" && (
            <>
              <Button variant="outline" className="w-full" onClick={() => window.open(nav?.gmapsUrl ?? `https://www.google.com/maps/dir/?api=1&destination=${s.route.dropoff.lat},${s.route.dropoff.lng}&travelmode=driving`, "_blank", "noopener")}>
                <Navigation size={16} /> Navigate to drop-off
              </Button>
              {s.status === "ARRIVING" && (
                <Button variant="brand" className="w-full" onClick={() => arriveWithGps("deliver")} loading={busy}>I've arrived at the destination</Button>
              )}
              {s.status === "IN_TRANSIT" && (
                <Button variant="brand" className="w-full" onClick={() => act("arriving")} loading={busy}>Approaching destination</Button>
              )}
            </>
          )}

          {stage === "AT_DROPOFF" && (
            <div className="animate-mz-fade-in">
              <p className="text-[15px] font-extrabold">Proof of delivery</p>
              <p className="mt-1 text-[12.5px] font-medium text-[var(--ink-2)]">Ask the recipient for the delivery code shown in their app.</p>
              <label className="mt-3 block">
                <span className="text-[11.5px] font-bold uppercase tracking-widest text-[var(--ink-3)]">Recipient name</span>
                <input
                  value={recipient} onChange={(e) => setRecipient(e.target.value)}
                  placeholder="e.g. Mary Wanjiru"
                  className="mt-1.5 h-12 w-full rounded-[10px] border border-[var(--line)] bg-[var(--surface)] px-3.5 text-[14px] font-semibold outline-none focus:border-[var(--brand)]"
                />
              </label>
              <label className="mt-2.5 block">
                <span className="text-[11.5px] font-bold uppercase tracking-widest text-[var(--ink-3)]">Delivery code</span>
                <input
                  value={podOtp} onChange={(e) => setPodOtp(e.target.value.replace(/\D/g, "").slice(0, 4))}
                  placeholder="4-digit code"
                  inputMode="numeric"
                  aria-label="Delivery code"
                  className="tnum mt-1.5 h-12 w-full rounded-[10px] border border-[var(--line)] bg-[var(--surface)] px-3.5 text-center text-[18px] font-extrabold tracking-[0.3em] outline-none focus:border-[var(--brand)]"
                />
              </label>
              <Button
                variant="brand" className="mt-4 w-full" loading={busy}
                disabled={podOtp.length !== 4}
                onClick={() => act("pod", { recipient: recipient || s.route.dropoff.contact || "Recipient", otp: podOtp, photo: true })}
              >
                Verify code &amp; confirm delivery
              </Button>
              <button
                onClick={() => act("pod", { recipient: recipient || s.route.dropoff.contact || "Recipient" })}
                className="mt-2 w-full text-center text-[12px] font-bold text-[var(--ink-3)] underline underline-offset-4"
              >
                Skip the code (sandbox)
              </button>
            </div>
          )}

          {stage === "POD" && (
            <div className="animate-mz-fade-in">
              <p className="flex items-center gap-2 text-[15px] font-extrabold"><CheckCircle2 size={17} className="text-[var(--success)]" /> Proof of delivery confirmed</p>
              <p className="mt-1 text-[12.5px] font-medium text-[var(--ink-2)]">
                Received by {s.pod?.recipient ?? "the recipient"}{s.pod?.photo ? " · photo + GPS attached" : ""}. Close out the job to release your earnings.
              </p>
              <Button
                variant="brand" className="mt-4 w-full" loading={busy}
                onClick={() => act("complete").then(() => {
                  toast({ title: "Delivery completed", description: `Earnings ${kes(s.fare.driverEarnings)} added to your wallet.` });
                  onDone();
                })}
              >
                Complete delivery · {kes(s.fare.driverEarnings)}
              </Button>
            </div>
          )}
        </div>
      </div>

      {/* chat sheet (plan §77) */}
      {chatOpen && s && <ChatSheet shipmentId={s.id} role="DRIVER" onClose={() => setChatOpen(false)} />}

      {/* driver SOS sheet — ops alert + call-back (Uber SOS pattern) */}
      {sosOpen && s && (
        <div className="fixed inset-0 z-50 flex items-end bg-[rgba(23,24,28,0.45)]" onClick={() => setSosOpen(false)}>
          <div className="w-full animate-mz-slide-up rounded-t-[18px] bg-[var(--surface)] px-5 pb-6 pt-5" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Safety alert">
            <p className="text-[17px] font-extrabold tracking-tight">Safety alert</p>
            <p className="tnum mt-0.5 text-[12px] font-semibold text-[var(--ink-3)]">{s.code} · {s.route.pickup.area} → {s.route.dropoff.area}</p>
            {!sosSent ? (
              <>
                <p className="mt-3 text-[13px] font-medium leading-relaxed text-[var(--ink-2)]">This alerts the MIZIGO ops team with your delivery, live location and the customer's contact — they call you back straight away.</p>
                <div className="mt-4 grid grid-cols-2 gap-2.5">
                  <Button variant="ghost" className="border border-[var(--line)]" onClick={() => setSosOpen(false)}>Close</Button>
                  <Button variant="danger" onClick={async () => {
                    await post(`/api/shipments/${s.id}/action`, { action: "safety-alert" }).catch(() => null);
                    setSosSent(true);
                    toast({ title: "Ops alerted", description: "A team member is calling you now." });
                  }}>Alert ops</Button>
                </div>
                <p className="mt-2 text-center text-[11.5px] font-semibold text-[var(--ink-3)]">Life-threatening emergency? Dial 999 or 112 as well.</p>
              </>
            ) : (
              <>
                <p className="mt-3 text-[13px] font-bold text-[var(--danger)]">Ops alerted — expect a call.</p>
                <a href="tel:0800724343" className="mt-3 flex h-12 items-center justify-center gap-2 rounded-[12px] bg-[var(--danger)] text-[13.5px] font-extrabold text-white">
                  <Phone size={15} /> Call ops now
                </a>
              </>
            )}
          </div>
        </div>
      )}

      {/* cargo issue report (plan §15) */}
      {reportOpen && s && (
        <div className="fixed inset-0 z-50 flex items-end bg-[rgba(23,24,28,0.45)]" onClick={() => { setReportOpen(false); setReportKind(null); setReportNote(""); }}>
          <div className="w-full animate-mz-slide-up rounded-t-[18px] bg-[var(--surface)] px-5 pb-6 pt-5" onClick={(e) => e.stopPropagation()}>
            <p className="text-[17px] font-extrabold tracking-tight">Report a cargo issue</p>
            <p className="mt-0.5 text-[12.5px] font-medium text-[var(--ink-2)]">Ops is notified immediately and the report is added to {s.code}&apos;s chain of custody.</p>
            <div className="mt-3.5 space-y-2">
              {[
                { key: "mismatch", label: "Cargo differs from the booking", hint: "Wrong items or quantities" },
                { key: "too-large", label: "Cargo too large for my vehicle", hint: "Needs a bigger vehicle or a second trip" },
                { key: "loading-fee", label: "Request an extra loading fee", hint: "Heavy lifting beyond what was booked" },
              ].map((o) => {
                const on = reportKind === o.key;
                return (
                  <button key={o.key} onClick={() => setReportKind(o.key)} className={`flex w-full items-center gap-3 rounded-[12px] border-2 px-4 py-3 text-left transition ${on ? "border-[var(--brand)] bg-[var(--brand-soft)]" : "border-[var(--line)]"}`}>
                    <span className="flex-1">
                      <span className="block text-[13.5px] font-extrabold">{o.label}</span>
                      <span className="block text-[11.5px] font-medium text-[var(--ink-2)]">{o.hint}</span>
                    </span>
                  </button>
                );
              })}
            </div>
            <input
              value={reportNote}
              onChange={(e) => setReportNote(e.target.value.slice(0, 200))}
              placeholder="Add a note (optional)"
              className="mt-3 h-12 w-full rounded-[10px] border border-[var(--line)] bg-[var(--paper)] px-3.5 text-[13.5px] font-semibold outline-none focus:border-[var(--brand)]"
            />
            <Button
              variant="brand" className="mt-3 w-full" disabled={!reportKind}
              onClick={async () => {
                const labels: Record<string, string> = { mismatch: "Cargo differs from booking", "too-large": "Cargo too large for vehicle", "loading-fee": "Extra loading fee requested" };
                await act("report-mismatch", { reason: reportNote ? `${labels[reportKind!]} · ${reportNote}` : labels[reportKind!] });
                setReportOpen(false); setReportKind(null); setReportNote("");
                toast({ title: "Report sent", description: "Ops will review and adjust if needed." });
              }}
            >
              Send report to ops
            </Button>
          </div>
        </div>
      )}

      {/* GPS-mismatch arrival confirm (Bolt Driver pattern): the server
          refused the arrival claim — explicit confirm or go back */}
      {gpsMismatch && (
        <div className="fixed inset-0 z-50 flex items-end bg-[rgba(23,24,28,0.45)]" onClick={() => setGpsMismatch(null)}>
          <div className="w-full animate-mz-slide-up rounded-t-[18px] bg-[var(--surface)] px-5 pb-6 pt-5" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start gap-3">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[var(--warn-soft)] text-[var(--warn)]"><MapPinOff size={22} /></span>
              <div>
                <p className="text-[17px] font-extrabold tracking-tight">{gpsMismatch.action === "arrive" ? "Arrived at pickup?" : "Arrived at destination?"}</p>
                <p className="mt-0.5 text-[12.5px] font-medium leading-relaxed text-[var(--ink-2)]">
                  Your GPS location doesn&apos;t match the {gpsMismatch.action === "arrive" ? "pickup spot" : "destination address"} — it looks about <span className="tnum font-bold text-[var(--ink)]">{gpsMismatch.distanceM}m</span> away. {gpsMismatch.action === "arrive" ? "Make sure you&apos;re at the right place before loading." : "Check the address before completing the delivery."}
                </p>
              </div>
            </div>
            <div className="mt-4 space-y-2.5">
              <Button
                variant="brand" className="w-full" loading={busy}
                onClick={() => {
                  const pending = gpsMismatch;
                  setGpsMismatch(null);
                  void act(pending.action, { gpsMismatchConfirmed: true });
                }}
              >
                Confirm — I&apos;m at the right place
              </Button>
              <Button variant="outline" className="w-full h-12" onClick={() => setGpsMismatch(null)}>
                Not there yet
              </Button>
            </div>
            <p className="mt-2.5 text-center text-[11px] font-semibold text-[var(--ink-3)]">Confirmed off-location arrivals are recorded on the delivery timeline.</p>
          </div>
        </div>
      )}
    </div>
  );

  function cargoCheckPhotos(_i: number) { return []; }
}

// ─── Navigation (driver-side directions + traffic) ──────────────────────────

/**
 * Real device GPS feed (the driver app IS the location source — Bolt/Uber
 * pattern). While online, watchPosition pings the server at most every ~25s:
 * feeds H3 supply cells, the demand map, tracking, and the arrive/deliver
 * GPS-mismatch gate (lib/runtime gpsReportedAt). Silent on permission denial.
 */
function useDriverGps(enabled: boolean) {
  useEffect(() => {
    if (!enabled || typeof navigator === "undefined" || !navigator.geolocation) return;
    let last = 0;
    const id = navigator.geolocation.watchPosition(
      (p) => {
        const now = Date.now();
        if (now - last < 25_000) return;
        last = now;
        void post("/api/driver/action", { action: "ping", lat: p.coords.latitude, lng: p.coords.longitude }).catch(() => null);
      },
      () => {},
      { enableHighAccuracy: true, maximumAge: 20_000, timeout: 15_000 },
    );
    return () => navigator.geolocation.clearWatch(id);
  }, [enabled]);
}


interface NavRouteResponse {
  distanceKm: number;
  durationMin: number;
  trafficMin: number;
  source: "osrm" | "internal";
  polyline: [number, number][];
  steps?: { instruction: string; name: string; distanceM: number }[];
}

interface DriverNav {
  stage: string;
  route: [number, number][] | undefined; // [lat, lng] OSRM/internal road geometry
  markers: LiveMapMarker[];
  steps: { instruction: string; name: string; distanceM: number }[];
  currentStepIdx: number;
  targetName: string;
  remainingKm: number | null;
  remainingMin: number | null; // incl. typical traffic
  gmapsUrl: string;
}

/**
 * Route + turn-by-turn for the current leg: driver → pickup first, then
 * pickup → stops → drop-off after loading. Real OSRM road geometry through
 * /api/routing (internal-model fallback); remaining distance/duration are
 * scaled from the live leg progress.
 */
function useDriverNav(s: ShipmentDTO | null, doneStops: number[]): DriverNav | null {
  // static leg plan (coords rounded for stable query keys)
  const plan = useMemo(() => {
    if (!s) return null;
    const stage =
      s.status === "DRIVER_EN_ROUTE" ? "TO_PICKUP" :
      s.status === "DRIVER_ARRIVED" ? "AT_PICKUP" :
      ["LOADING", "LOADED"].includes(s.status) ? "VERIFY" :
      ["IN_TRANSIT", "ARRIVING"].includes(s.status) ? "TO_DROPOFF" :
      s.status === "DELIVERED" ? "AT_DROPOFF" : "POD";
    const pickup = { lat: s.route.pickup.lat, lng: s.route.pickup.lng };
    const dropoff = { lat: s.route.dropoff.lat, lng: s.route.dropoff.lng };
    const stops = (s.route.stops ?? []).map((st) => ({ lat: st.lat, lng: st.lng }));
    // next stop not yet marked done (server events or local taps)
    const stopDone = (i: number) =>
      s.events.some((e) => e.type === "STOP_COMPLETED" && e.label.includes(s.route.stops?.[i]?.name ?? "---")) ||
      doneStops.includes(i);
    const nextStopIdx = stops.findIndex((_, i) => !stopDone(i));
    if (stage === "TO_PICKUP") {
      const from = s.route.polyline[0] ?? pickup; // DRIVER_ASSIGNED event origin
      return {
        stage, from, via: [] as { lat: number; lng: number }[], to: pickup,
        target: { name: s.route.pickup.area || s.route.pickup.name, ...pickup },
      };
    }
    return {
      stage, from: pickup, via: stops, to: dropoff,
      target: nextStopIdx >= 0
        ? { name: s.route.stops?.[nextStopIdx]?.name ?? "next stop", ...stops[nextStopIdx] }
        : { name: s.route.dropoff.area || s.route.dropoff.name, ...dropoff },
    };
  }, [s, doneStops]);

  const fromKey = plan ? `${plan.from.lat.toFixed(4)},${plan.from.lng.toFixed(4)}` : "";
  const toKey = plan ? `${plan.to.lat.toFixed(4)},${plan.to.lng.toFixed(4)}` : "";
  const viaKey = plan ? plan.via.map((v) => `${v.lat.toFixed(4)},${v.lng.toFixed(4)}`).join(";") : "";

  const { data: navRoute } = useQuery({
    queryKey: ["nav-route", s?.id, fromKey, toKey, viaKey],
    queryFn: () =>
      api<NavRouteResponse>(
        `/api/routing?from=${fromKey}&to=${toKey}${viaKey ? `&via=${viaKey}` : ""}&steps=1`
      ),
    enabled: !!plan,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });

  return useMemo(() => {
    if (!s || !plan) return null;
    const steps = navRoute?.steps ?? [];
    const progress = s.live?.progress ?? 0;
    const routeKm = navRoute?.distanceKm ?? s.route.distanceKm;
    const remainingKm = Math.max(0, routeKm * (1 - progress));
    const remainingMin = navRoute ? Math.max(1, Math.round(navRoute.trafficMin * (1 - progress))) : null;
    // current step = first step whose end lies ahead of the driven distance
    let drivenM = routeKm * 1000 * progress;
    let currentStepIdx = 0;
    for (let i = 0; i < steps.length; i++) {
      if (drivenM <= steps[i].distanceM) { currentStepIdx = i; break; }
      drivenM -= steps[i].distanceM;
      currentStepIdx = Math.min(i + 1, steps.length - 1);
    }
    const markers: LiveMapMarker[] = [
      ...(s.live
        ? [{
            id: "driver", kind: "driver" as const, lat: s.live.lat, lng: s.live.lng,
            heading: s.live.heading, categoryKey: s.category.key,
          }]
        : []),
      { id: "pickup", kind: "pickup" as const, lat: s.route.pickup.lat, lng: s.route.pickup.lng, label: s.route.pickup.area },
      ...(plan.stage !== "TO_PICKUP"
        ? [
            ...(s.route.stops ?? []).map((st, i) => ({
              id: `stop-${i}`, kind: "stop" as const, lat: st.lat, lng: st.lng, sub: String(i + 1),
            })),
            { id: "dropoff", kind: "dropoff" as const, lat: s.route.dropoff.lat, lng: s.route.dropoff.lng, label: s.route.dropoff.area },
          ]
        : []),
    ];
    return {
      stage: plan.stage,
      route: navRoute?.polyline,
      markers,
      steps,
      currentStepIdx,
      targetName: plan.target.name,
      remainingKm,
      remainingMin,
      gmapsUrl: `https://www.google.com/maps/dir/?api=1&destination=${plan.target.lat},${plan.target.lng}&travelmode=driving`,
    };
  }, [s, plan, navRoute]);
}

function fmtStepDistance(m: number): string {
  return m < 950 ? `${Math.max(10, Math.round(m / 10) * 10)} m` : `${(m / 1000).toFixed(1)} km`;
}

/** Turn-by-turn card: steps with the current maneuver highlighted + Google Maps handoff. */
function NavigationSection({ nav }: { nav: DriverNav }) {
  return (
    <section className="mt-3 rounded-[16px] border border-[var(--line)] bg-[var(--surface)] p-4" aria-label="Navigation">
      <div className="flex items-center justify-between gap-3">
        <p className="min-w-0 truncate text-[14.5px] font-extrabold tracking-tight">Navigation · {nav.targetName}</p>
        <span className="tnum shrink-0 text-[13px] font-extrabold">{nav.remainingKm != null ? `${nav.remainingKm.toFixed(1)} km` : "…"}</span>
      </div>
      <p className="mt-0.5 text-[12.5px] font-semibold text-[var(--ink-2)]">
        {nav.remainingMin != null ? (
          <>~{etaText(nav.remainingMin)} <span className="font-medium text-[var(--ink-3)]">incl. typical traffic</span></>
        ) : (
          "Directions from Google Maps cover the same roads."
        )}
      </p>
      <a
        href={nav.gmapsUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="mt-2.5 flex h-11 w-full items-center justify-center gap-2 rounded-[12px] border border-[var(--line)] bg-[var(--surface)] text-[14px] font-extrabold text-[var(--brand-deep)] transition hover:border-[var(--brand)] active:translate-y-px"
      >
        <Navigation size={16} /> Open in Google Maps <ArrowUpRight size={13} className="text-[var(--ink-3)]" />
      </a>
      {nav.steps.length > 0 && (
        <div className="mt-3 max-h-56 overflow-y-auto thin-scrollbar" role="list" aria-label="Turn-by-turn directions">
          {nav.steps.map((st, i) => {
            const current = i === nav.currentStepIdx;
            const past = i < nav.currentStepIdx;
            return (
              <div
                key={i}
                role="listitem"
                aria-current={current ? "step" : undefined}
                className={`flex items-start gap-2.5 rounded-[10px] px-2.5 py-2 ${current ? "bg-[var(--brand-soft)]" : ""}`}
              >
                <span className={`tnum w-11 shrink-0 pt-0.5 text-right text-[11.5px] font-bold ${current ? "text-[var(--brand-deep)]" : "text-[var(--ink-3)]"}`}>
                  {i === nav.steps.length - 1 ? "•" : fmtStepDistance(st.distanceM)}
                </span>
                <span className={`flex-1 text-[12.5px] leading-snug ${current ? "font-extrabold" : past ? "font-medium text-[var(--ink-3)]" : "font-semibold text-[var(--ink-2)]"}`}>
                  {st.instruction}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

// ─── Trips ───
function DriverTripsScreen({ data }: { data: DriverHome }) {
  const [tab, setTab] = useState<"ALL" | "COMPLETED" | "CANCELLED">("ALL");
  const [rating, setRating] = useState<null | { shipmentId: string; stars: number }>(null);
  const [busy, setBusy] = useState(false);
  const qc = useQueryClient();
  const filtered = data.history.filter((t) => (tab === "ALL" ? true : t.status === tab));

  const rateCustomer = async (shipmentId: string, stars: number) => {
    setBusy(true);
    try {
      await post(`/api/shipments/${shipmentId}/action`, {
        action: "rate", actor: "DRIVER", stars,
        tags: stars >= 4 ? ["On site ready", "Cargo as booked"] : [],
      });
      toast({ title: "Customer rated", description: "Thanks. Your rating keeps the network reliable for every driver." });
      setRating(null);
      qc.invalidateQueries({ queryKey: ["driver-home"] });
    } catch (e) {
      toast({ title: "Rating failed", description: (e as Error).message, variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4 pb-6">
      <h1 className="px-1 pt-1 text-[24px] font-extrabold tracking-tight">My trips</h1>
      <div className="flex gap-2">
        {(["ALL", "COMPLETED", "CANCELLED"] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)} className={`rounded-full px-4 py-2 text-[12.5px] font-bold capitalize transition ${tab === t ? "bg-[var(--ink)] text-white" : "border border-[var(--line)] bg-[var(--surface)] text-[var(--ink-2)]"}`}>
            {t.toLowerCase()}
          </button>
        ))}
      </div>
      {filtered.length === 0 ? (
        <EmptyState icon={<PackageOpen size={22} />} title="No trips yet" body="Go online to start receiving delivery requests." />
      ) : (
        <div className="space-y-2.5">
          {filtered.map((t) => {
            const iRated = t.ratings.some((r) => r.byRole === "DRIVER");
            return (
            <div key={t.id} className="rounded-[14px] border border-[var(--line)] bg-[var(--surface)] p-4">
              <div className="flex items-center justify-between">
                <span className="tnum text-[11.5px] font-bold text-[var(--ink-3)]">{t.code} · {relTimeEAT(t.createdAt)}</span>
                <StatusBadge tone={toneForStatus(t.status)}>{STATUS_LABEL[t.status] ?? t.status}</StatusBadge>
              </div>
              <p className="mt-1.5 text-[14.5px] font-bold">{t.route.pickup.area} → {t.route.dropoff.area}</p>
              <div className="mt-1.5 flex items-center justify-between">
                <span className="text-[12.5px] font-medium text-[var(--ink-2)]">{t.route.distanceKm.toFixed(1)} km · {t.cargo.items.reduce((a, i) => a + i.qty, 0)} items</span>
                <span className="tnum text-[15px] font-extrabold">{kes(t.fare.driverEarnings)}</span>
              </div>
              {t.status === "COMPLETED" && !iRated && (
                <div className="mt-3 border-t border-dashed border-[var(--line)] pt-3">
                  <p className="text-[12px] font-bold text-[var(--ink-2)]">How was {t.customer.name.split(" ")[0]} to work with?</p>
                  <div className="mt-1.5 flex items-center gap-1.5">
                    {[1, 2, 3, 4, 5].map((v) => (
                      <button
                        key={v}
                        disabled={busy}
                        onClick={() => setRating({ shipmentId: t.id, stars: v })}
                        className={`text-[24px] leading-none transition ${rating?.shipmentId === t.id && rating.stars >= v ? "text-[var(--brand-deep)]" : "text-[var(--line)]"} hover:text-[var(--brand-deep)]`}
                        aria-label={`${v} star${v === 1 ? "" : "s"}`}
                      >
                        <Star className="fill-current" size={22} />
                      </button>
                    ))}
                    <Button
                      variant="brand"
                      className="ml-auto h-9 px-4 text-[12px]"
                      disabled={busy || rating?.shipmentId !== t.id}
                      onClick={() => rating && rateCustomer(t.id, rating.stars)}
                    >
                      {busy ? "Saving…" : "Rate customer"}
                    </Button>
                  </div>
                </div>
              )}
              {t.status === "COMPLETED" && iRated && (
                <p className="mt-2.5 flex items-center gap-1.5 border-t border-dashed border-[var(--line)] pt-2.5 text-[11.5px] font-bold text-[var(--ink-3)]">
                  <Star size={12} className="fill-[var(--brand)] text-[var(--brand-deep)]" /> You rated this customer
                </p>
              )}
            </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Earnings ───
// The tab itself is the Uber-pattern weekly statement (EarningsTab.tsx);
// this screen stays as the wallet drill-down (balance, withdraw, 7-day chart,
// monthly breakdown, full payout history) — EarningsTab links into it.
function DriverEarningsScreen({ data, onBack }: { data: DriverHome; onBack?: () => void }) {
  const [withdraw, setWithdraw] = useState(false);
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const max = Math.max(...data.earnings.chart.map((c) => c.earnings), 1);

  const doWithdraw = async () => {
    setBusy(true);
    try {
      await apiPost("/api/driver/action", { action: "withdraw", driverId: data.driver.id, amount: Number(amount) });
      toast({ title: "Withdrawn", description: `KES ${Number(amount).toLocaleString()} sent to your M-PESA (sandbox B2C).` });
      setWithdraw(false);
      setAmount("");
    } catch (e) {
      toast({ title: "Withdrawal failed", description: (e as Error).message, variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4 pb-6">
      {onBack && (
        <button onClick={onBack} className="flex items-center gap-1.5 px-1 pt-1 text-[13px] font-bold text-[var(--ink-2)]">
          <ArrowLeft size={15} strokeWidth={2.6} /> Back to weekly statement
        </button>
      )}
      <h1 className="px-1 pt-1 text-[24px] font-extrabold tracking-tight">{onBack ? "Wallet" : "Earnings"}</h1>

      <div className="rounded-[16px] bg-[var(--ink)] p-5 text-white">
        <p className="text-[11.5px] font-bold uppercase tracking-widest text-white/50">This week</p>
        <p className="tnum mt-1 text-[32px] font-extrabold leading-none tracking-tight">{kes(data.earnings.week)}</p>
        <div className="mt-4 grid grid-cols-2 gap-3 border-t border-white/10 pt-3.5">
          <div>
            <p className="tnum text-[16px] font-extrabold">{kes(data.earnings.month)}</p>
            <p className="text-[10.5px] font-semibold text-white/50">This month</p>
          </div>
          <div>
            <p className="tnum text-[16px] font-extrabold">{kes(data.earnings.wallet)}</p>
            <p className="text-[10.5px] font-semibold text-white/50">Available balance</p>
          </div>
        </div>
        <Button variant="brand" className="mt-4 w-full" onClick={() => setWithdraw(true)}>
          <Wallet size={16} /> Withdraw to M-PESA
        </Button>
      </div>

      {/* take-rate transparency — Bolt's angle: drivers can read exactly what the platform takes */}
      <div className="rounded-[14px] border border-[var(--line)] bg-[var(--surface)] p-4">
        <p className="text-[13.5px] font-extrabold">
          You keep {data.earnings.grossFares > 0 ? Math.round((1 - data.earnings.commission / data.earnings.grossFares) * 100) : 85}% of every fare
        </p>
        <p className="mt-1 text-[12px] font-medium leading-relaxed text-[var(--ink-2)]">
          MIZIGO's commission is 15% plus a KES 100 platform fee per job — under Kenya's 18% commission cap, where most apps charge the full 18%. This month: {kes(data.earnings.grossFares - data.earnings.commission)} earned of {kes(data.earnings.grossFares)} in fares. Cash out to M-PESA any time.
        </p>
      </div>

      {/* chart */}
      <div className="rounded-[16px] border border-[var(--line)] bg-[var(--surface)] p-4">
        <SectionTitle>Last 7 days</SectionTitle>
        <div className="mt-4 flex h-36 gap-2">
          {data.earnings.chart.map((c) => (
            <div key={c.day} className="flex flex-1 flex-col items-center gap-1.5">
              <div className="flex w-full flex-1 items-end">
                <div
                  className="w-full rounded-t-[6px] bg-[var(--brand)] transition-all"
                  style={{ height: `${Math.max(6, (c.earnings / max) * 100)}%`, opacity: c.earnings === 0 ? 0.25 : 1 }}
                  title={`${c.day}: ${kes(c.earnings)}`}
                />
              </div>
              <span className="text-[10.5px] font-bold text-[var(--ink-3)]">{c.day}</span>
            </div>
          ))}
        </div>
      </div>

      {/* breakdown */}
      <div className="rounded-[16px] border border-[var(--line)] bg-[var(--surface)] p-4">
        <SectionTitle>Monthly breakdown</SectionTitle>
        <div className="mt-2">
          <Row label="Gross fares" value={kes(data.earnings.grossFares)} />
          <Row label="Platform commission" value={`- ${kes(data.earnings.commission)}`} />
          <Row label="Net earnings" value={kes(data.earnings.grossFares - data.earnings.commission)} strong />
        </div>
      </div>

      {/* payouts */}
      <div className="rounded-[16px] border border-[var(--line)] bg-[var(--surface)] p-4">
        <SectionTitle>Payout history</SectionTitle>
        <div className="mt-2 divide-y divide-[var(--line)]">
          {data.earnings.payouts.length === 0 && <p className="py-3 text-[13px] font-medium text-[var(--ink-2)]">No withdrawals yet.</p>}
          {data.earnings.payouts.map((p) => (
            <div key={p.id} className="flex items-center justify-between py-3">
              <div>
                <p className="tnum text-[14px] font-extrabold">{kes(p.amount)}</p>
                <p className="text-[11.5px] font-semibold text-[var(--ink-3)]">{fmtDateTimeEAT(p.createdAt)} · M-PESA</p>
              </div>
              <StatusBadge tone="success">Paid</StatusBadge>
            </div>
          ))}
        </div>
      </div>

      {withdraw && (
        <div className="fixed inset-0 z-50 flex items-end bg-[rgba(23,24,28,0.4)]" onClick={() => setWithdraw(false)}>
          <div className="w-full animate-mz-slide-up rounded-t-[18px] bg-[var(--surface)] px-5 pb-6 pt-5" onClick={(e) => e.stopPropagation()}>
            <p className="text-[17px] font-extrabold tracking-tight">Withdraw to M-PESA</p>
            <p className="mt-1 text-[13px] font-medium text-[var(--ink-2)]">Available: <span className="tnum font-bold text-[var(--ink)]">{kes(data.earnings.wallet)}</span> · arrives instantly (sandbox B2C)</p>
            <input
              value={amount} onChange={(e) => setAmount(e.target.value.replace(/\D/g, ""))}
              placeholder="Amount in KES" inputMode="numeric"
              className="tnum mt-4 h-14 w-full rounded-[10px] border border-[var(--line)] bg-[var(--surface)] px-4 text-[18px] font-extrabold outline-none focus:border-[var(--brand)]"
            />
            <Button variant="brand" className="mt-4 w-full" onClick={doWithdraw} loading={busy} disabled={Number(amount) < 100}>
              Withdraw {amount ? kes(Number(amount)) : ""}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Vehicle / Account ───
function DriverAccountScreen({ data }: { data: DriverHome }) {
  const { logout } = useSession();
  const settings = useSettings();
  const v = data.driver.vehicles[0];
  const [docsOpen, setDocsOpen] = useState(false);

  const fmtDate = (d: string | null) => (d ? fmtDateEAT(d) : "—");
  const docTone = (status: string) => (status === "VERIFIED" ? "success" : status === "PENDING" ? "warn" : "danger");

  return (
    <div className="space-y-4 pb-6">
      <h1 className="px-1 pt-1 text-[24px] font-extrabold tracking-tight">Account</h1>

      <div className="flex items-center gap-4 rounded-[16px] border border-[var(--line)] bg-[var(--surface)] p-4">
        <AvatarInitials initials={data.driver.user.name.split(" ").map((w) => w[0]).slice(0, 2).join("")} size={54} />
        <div className="flex-1">
          <p className="text-[17px] font-extrabold tracking-tight">{data.driver.user.name}</p>
          <p className="tnum text-[13px] font-semibold text-[var(--ink-2)]">{fmtPhone(data.driver.user.phone)}</p>
          <p className="text-[12px] font-bold text-[var(--success)]">Verified driver · Licence {data.driver.licenceClass}</p>
        </div>
      </div>

      {v && (
        <div className="rounded-[16px] border border-[var(--line)] bg-[var(--surface)] p-4">
          <SectionTitle>Vehicle</SectionTitle>
          <div className="mt-3 flex items-center gap-3.5">
            <span className="flex h-14 w-14 items-center justify-center rounded-xl bg-[var(--surface-2)]"><VehicleAvatar category={data.active?.category.key ?? "pickup"} size={44} /></span>
            <div>
              <p className="text-[15.5px] font-extrabold">{v.make} {v.model}</p>
              <p className="text-[13px] font-bold">{v.registration}</p>
              <p className="text-[12px] font-medium text-[var(--ink-2)]">{v.category} · up to {v.capacityKg.toLocaleString()} kg · {v.bodyType}</p>
            </div>
          </div>
          <div className="mt-3 border-t border-[var(--line)] pt-2">
            <Row label="Registration" value={v.docs.registration} />
            <Row label="Insurance" value={v.docs.insurance} />
            <Row label="Inspection" value={v.docs.inspection} />
          </div>
        </div>
      )}

      <DriverPayoutDetails data={data} />

      {/* reliability */}
      <div className="rounded-[16px] border border-[var(--line)] bg-[var(--surface)] p-4">
        <SectionTitle>Reliability</SectionTitle>
        <div className="mt-2">
          <Row label="Network reliability" value={`${Math.round(driverReliability({ tripsCompleted: data.driver.trips, cancellationRate: data.driver.cancellationRate, incidents: data.driver.incidents, rating: data.driver.rating, onTimeDelivery: data.driver.onTimeDelivery }) * 100)}%`} strong />
          <Row label="On-time pickup" value={`${Math.round(data.driver.onTimePickup * 100)}%`} />
          <Row label="On-time delivery" value={`${Math.round(data.driver.onTimeDelivery * 100)}%`} />
          <Row label="Acceptance" value={`${Math.round(data.driver.acceptanceRate * 100)}%`} />
          <Row label="Cancellations" value={`${(data.driver.cancellationRate * 100).toFixed(1)}%`} />
          <Row label="Cargo incidents" value={`${data.driver.incidents}`} />
          <Row label="Completed trips" value={`${data.driver.trips}`} />
        </div>
        <p className="mt-2 text-[10.5px] font-medium text-[var(--ink-3)]">
          Reliability blends completion, rating and punctuality, and is docked by incidents — the number dispatch weighs when choosing you.
        </p>
      </div>

      <div className="overflow-hidden rounded-[16px] border border-[var(--line)] bg-[var(--surface)]">
        {[
          { icon: FileCheck2, label: "Documents", desc: "Licence · insurance · inspection", action: () => setDocsOpen(true) },
          { icon: TriangleAlert, label: "Report a problem", desc: `Support is one tap away · ${settings.supportPhone}`, action: () => toast({ title: "Support", description: "Ops sees your active trip and can call you back (sandbox)." }) },
        ].map((r) => (
          <button key={r.label} onClick={r.action} className="flex w-full items-center gap-3.5 border-b border-[var(--line)] px-4 py-4 text-left last:border-b-0 transition hover:bg-[var(--surface-2)]">
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-[var(--surface-2)] text-[var(--ink-2)]"><r.icon size={16} /></span>
            <span className="flex-1">
              <span className="block text-[14.5px] font-bold">{r.label}</span>
              <span className="block text-[12px] font-medium text-[var(--ink-3)]">{r.desc}</span>
            </span>
            <ChevronRight size={16} className="text-[var(--ink-3)]" />
          </button>
        ))}
      </div>

      {/* documents sheet (plan §29) */}
      {docsOpen && (
        <div className="fixed inset-0 z-50 flex items-end bg-[rgba(23,24,28,0.45)]" onClick={() => setDocsOpen(false)}>
          <div className="max-h-[80%] w-full animate-mz-slide-up overflow-y-auto rounded-t-[18px] bg-[var(--surface)] px-5 pb-6 pt-5 thin-scrollbar" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <p className="text-[17px] font-extrabold tracking-tight">Documents</p>
              <button onClick={() => setDocsOpen(false)} className="flex h-10 w-10 items-center justify-center rounded-full bg-[var(--surface-2)] text-[13px] font-extrabold" aria-label="Close">✕</button>
            </div>
            <p className="mt-0.5 text-[12.5px] font-medium text-[var(--ink-2)]">Expired documents pause new jobs automatically. Keep them current.</p>
            <div className="mt-4 space-y-2.5">
              {[
                { label: "Driving licence", detail: `Class ${data.driver.licenceClass}`, status: "VERIFIED", expiry: data.driver.licenceExpiry },
                ...(v ? [
                  { label: "Vehicle registration", detail: `${v.make} ${v.model} · ${v.registration}`, status: v.docs.registration, expiry: null },
                  { label: "Insurance", detail: "Commercial cover", status: v.docs.insurance, expiry: v.insuranceExpiry },
                  { label: "Inspection", detail: "Annual roadworthiness", status: v.docs.inspection, expiry: v.inspectionExpiry },
                ] : []),
              ].map((doc) => (
                <div key={doc.label} className="flex items-center gap-3.5 rounded-[14px] border border-[var(--line)] bg-[var(--paper)] px-4 py-3.5">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[var(--surface-2)]"><FileCheck2 size={16} className="text-[var(--ink-2)]" /></span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[14px] font-extrabold">{doc.label}</span>
                    <span className="block text-[12px] font-medium text-[var(--ink-2)]">{doc.detail}</span>
                    <span className="block text-[11.5px] font-semibold text-[var(--ink-3)]">Expires {fmtDate(doc.expiry)}</span>
                  </span>
                  <StatusBadge tone={docTone(doc.status) as "success" | "warn" | "danger"}>{doc.status === "VERIFIED" ? "✓ Verified" : doc.status}</StatusBadge>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      <Button variant="ghost" className="w-full" onClick={() => { apiPost("/api/auth", { action: "logout" }).catch(() => null); logout(); }}><LogOut size={15} /> Log out</Button>
      <p className="text-center text-[11.5px] font-medium text-[var(--ink-3)]">Mizigo Driver · v2 sandbox</p>
    </div>
  );
}

// ─── actions hook ───
function useDriverActions() {
  const qc = useQueryClient();
  return {
    patchStatus: async (status: string) => {
      const { driverId } = useSession.getState();
      try {
        await apiPost("/api/driver/action", { action: "status", driverId, status });
        await qc.invalidateQueries({ queryKey: ["driver-home", driverId] });
        toast({
          title: status === "ONLINE" ? "You're online" : status === "OFFLINE" ? "You're offline" : "On break",
          description: status === "ONLINE" ? "You'll now receive requests near you." : undefined,
        });
      } catch (e) {
        toast({ title: "Couldn't change status", description: (e as Error).message, variant: "destructive" });
      }
    },
  };
}

// ─── quote marketplace jobs (plan §33: "Potential job" cards) ───
function DriverQuoteJobsScreen({ data }: { data: DriverHome }) {
  const { driverId } = useSession();
  const qc = useQueryClient();
  const [openJob, setOpenJob] = useState<string | null>(null);
  const [amount, setAmount] = useState("");
  const [etaText, setEtaText] = useState("");
  const [busy, setBusy] = useState(false);
  const jobs = data.quoteJobs ?? [];

  const submitQuote = async (jobId: string) => {
    if (!driverId) return;
    const amt = Number(amount);
    if (!amt || amt < 500) {
      toast({ title: "Enter a quote of KES 500 or more" });
      return;
    }
    setBusy(true);
    try {
      await post(`/api/shipments/${jobId}/action`, { action: "driver-quote", actor: "DRIVER", driverId, amount: amt, etaText: etaText || "Within the hour" });
      await qc.invalidateQueries({ queryKey: ["driver-home", driverId] });
      setOpenJob(null); setAmount(""); setEtaText("");
      toast({ title: "Quote submitted", description: `KES ${amt.toLocaleString()} — the customer has been notified.` });
    } catch (e) {
      toast({ title: "Couldn't submit quote", description: (e as Error).message, variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  if (jobs.length === 0) {
    return <EmptyState icon={<PackageOpen size={22} />} title="No open jobs" body="Quote requests for your vehicle class will appear here. Stay online." />;
  }

  return (
    <div className="space-y-4 pb-6">
      <h1 className="px-1 pt-1 text-[24px] font-extrabold tracking-tight">Potential jobs</h1>
      <p className="-mt-2 px-1 text-[12.5px] font-medium text-[var(--ink-2)]">Customers waiting for transporter quotes. Quote your price — they pick the best offer.</p>
      <div className="space-y-2.5">
        {jobs.map((j) => (
          <div key={j.id} className="rounded-[16px] border border-[var(--line)] bg-[var(--surface)] p-4">
            <div className="flex items-center justify-between">
              <StatusBadge tone="active">Open for quotes</StatusBadge>
              <span className="tnum text-[12px] font-bold text-[var(--ink-3)]">{j.code}</span>
            </div>
            <p className="mt-2.5 text-[15.5px] font-extrabold tracking-tight">{j.route.pickup.area} → {j.route.dropoff.area}</p>
            <div className="mt-2 rounded-[12px] bg-[var(--surface-2)] px-4 py-3">
              <Row label="Cargo" value={`${j.cargo.items.reduce((a, i) => a + i.qty, 0)} items · ${j.cargo.category}`} />
              <Row label="Vehicle" value={j.category.name} />
              <Row label="Distance" value={`${j.route.distanceKm.toFixed(1)} km`} />
              <Row label="Instant estimate" value={kes(j.fare.total)} />
              {j.quoteCount > 0 && <Row label="Competing quotes" value={`${j.quoteCount}`} />}
            </div>
            {openJob === j.id ? (
              <div className="mt-3 animate-mz-fade-in space-y-2.5">
                <label className="block">
                  <span className="text-[11px] font-bold uppercase tracking-widest text-[var(--ink-3)]">Your quote (KES)</span>
                  <input
                    value={amount}
                    onChange={(e) => setAmount(e.target.value.replace(/\D/g, ""))}
                    placeholder="e.g. 32000"
                    inputMode="numeric"
                    className="tnum mt-1.5 h-14 w-full rounded-[10px] border border-[var(--line)] bg-[var(--paper)] px-4 text-[18px] font-extrabold outline-none focus:border-[var(--brand)]"
                  />
                </label>
                <label className="block">
                  <span className="text-[11px] font-bold uppercase tracking-widest text-[var(--ink-3)]">Arrival (optional)</span>
                  <input
                    value={etaText}
                    onChange={(e) => setEtaText(e.target.value.slice(0, 30))}
                    placeholder="e.g. Tomorrow 08:00"
                    className="mt-1.5 h-12 w-full rounded-[10px] border border-[var(--line)] bg-[var(--paper)] px-3.5 text-[14px] font-semibold outline-none focus:border-[var(--brand)]"
                  />
                </label>
                <div className="flex gap-2.5">
                  <Button variant="brand" className="flex-1" loading={busy} onClick={() => submitQuote(j.id)}>Submit quote</Button>
                  <Button variant="ghost" onClick={() => { setOpenJob(null); setAmount(""); }}>Cancel</Button>
                </div>
              </div>
            ) : (
              <Button variant="brand" className="mt-3 w-full" onClick={() => setOpenJob(j.id)}>
                Quote this job
              </Button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── shell ───
const DRIVER_TABS = [
  { key: "home", label: "Home", icon: Truck },
  { key: "requests", label: "Jobs", icon: MapPin },
  { key: "trips", label: "Trips", icon: Clock3 },
  { key: "earnings", label: "Earnings", icon: Banknote },
  { key: "account", label: "Account", icon: User },
] as const;

export default function DriverApp() {
  const { user, driverId, driverTab, setDriverTab, setSurface, setUser } = useSession();
  const [tripOpen, setTripOpen] = useState(false);
  const [walletOpen, setWalletOpen] = useState(false); // earnings tab → wallet drill-down

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["driver-home", driverId],
    queryFn: () => api<DriverHome>("/api/driver"),
    enabled: !!driverId,
    retry: 1,
    refetchInterval: (q) => (q.state.data?.active ? 2500 : 12000),
  });

  // real device GPS feed while online (supply cells + demand map + the
  // arrive/deliver GPS-mismatch gate) — no-op on desktops/permission denial
  useDriverGps(!!data?.driver && data.driver.status === "ONLINE");

  if (!driverId) return <DriverLogin />;

  if (isError) {
    return (
      <div className="p-5">
        <ErrorState
          title="Couldn't load your driver dashboard"
          body="Check your connection and try again — your jobs and earnings are safe."
          actions={<Button variant="brand" onClick={() => refetch()}>Try again</Button>}
        />
      </div>
    );
  }

  if (isLoading || !data) {
    return <div className="space-y-4 p-5"><ListSkeleton rows={4} /></div>;
  }

  const hasActive = !!data.active;

  return (
    <div className="flex h-full flex-col bg-[var(--paper)]">
      <div className="flex-1 overflow-y-auto thin-scrollbar">
        {tripOpen ? (
          <DriverTripScreen data={data} onDone={() => setTripOpen(false)} />
        ) : (
          <div className="mx-auto w-full max-w-[480px] px-5 pt-2">
            {driverTab === "home" && <DriverHomeScreen data={data} onOpenTrip={() => setTripOpen(true)} />}
            {driverTab === "requests" && (
              hasActive ? (
                <DriverTripScreen data={data} onDone={() => setTripOpen(false)} />
              ) : (
                <DriverQuoteJobsScreen data={data} />
              )
            )}
            {driverTab === "trips" && <DriverTripsScreen data={data} />}
            {driverTab === "earnings" && (
              walletOpen ? (
                <DriverEarningsScreen data={data} onBack={() => setWalletOpen(false)} />
              ) : (
                <EarningsTab onOpenWallet={() => setWalletOpen(true)} />
              )
            )}
            {driverTab === "account" && <DriverAccountScreen data={data} />}
          </div>
        )}
      </div>

      {!tripOpen && (
        <nav className="border-t border-[var(--line)] bg-[var(--surface)] pb-[max(env(safe-area-inset-bottom),8px)] pt-1.5" aria-label="Driver main">
          <div className="mx-auto flex max-w-[480px]">
            {DRIVER_TABS.map((t) => {
              const active = driverTab === t.key;
              const dot = (t.key === "requests" && hasActive) || (t.key === "requests" && (data.quoteJobs?.length ?? 0) > 0);
              return (
                <button key={t.key} onClick={() => { setDriverTab(t.key); setWalletOpen(false); }} className="relative flex flex-1 flex-col items-center gap-0.5 py-2.5" aria-current={active ? "page" : undefined}>
                  <t.icon size={20} strokeWidth={active ? 2.4 : 2} className={active ? "text-[var(--ink)]" : "text-[var(--ink-3)]"} />
                  <span className={`text-[10px] font-bold ${active ? "text-[var(--ink)]" : "text-[var(--ink-3)]"}`}>{t.label}</span>
                  {dot && <span className="absolute right-[22%] top-1.5 h-2 w-2 rounded-full bg-[var(--brand)]" />}
                  <span className={`h-1 w-1 rounded-full ${active ? "bg-[var(--brand)]" : "bg-transparent"}`} />
                </button>
              );
            })}
          </div>
        </nav>
      )}
    </div>
  );
}

function DriverLogin() {
  const { setUser, setSurface } = useSession();
  const [busy, setBusy] = useState(false);
  const login = async () => {
    setBusy(true);
    try {
      // sandbox two-step: request the mock OTP, verify with the shown code
      const user = await loginWithOtp<SessionUser & { driverId: string | null }>("0712000002");
      if (user.driverId) {
        setUser(user, user.driverId);
      } else {
        toast({ title: "This number has no driver profile", variant: "destructive" });
      }
    } catch (e) {
      toast({ title: "Login failed", description: (e as Error).message, variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex min-h-full flex-col items-center justify-center gap-6 px-8 text-center">
      <div>
        <h1 className="text-[24px] font-extrabold tracking-tight">Drive &amp; earn with Mizigo</h1>
        <p className="mt-1.5 text-[13.5px] font-medium text-[var(--ink-2)]">Verified drivers get reliable loads, transparent earnings and weekly payouts.</p>
      </div>
      <Button variant="brand" className="w-full" onClick={login} loading={busy}>
        Continue as Peter Kamau (sandbox)
      </Button>
      <button onClick={() => setSurface("welcome")} className="text-[13px] font-bold text-[var(--ink-3)] underline underline-offset-4">
        Back to role select
      </button>
    </div>
  );
}
