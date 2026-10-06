"use client";
// Public tracking — no login, no app. Minimal data only (no phones, no notes).
// Map: real-tile LiveMap (MapLibre + OSRM road geometry, internal-model
// fallback) with the driver's vehicle marker dead-reckoned between polls so
// the customer literally watches it approach. Remaining distance + ETA tick
// down client-side and resync on every poll.

import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, BadgeCheck, MapPin, PackageCheck } from "lucide-react";
import { api } from "@/lib/api-client";
import { useSession } from "@/store/session";
import { StatusBadge, toneForStatus, Button } from "@/components/mizigo/shared/ui";
import LiveMap, { type LiveMapMarker } from "@/components/mizigo/shared/LiveMap";
import { alongPolyline, headingAt, routeLengthKm, type LatLng } from "@/lib/geo";
import { etaText, fmtDateTimeEAT } from "@/lib/format";
import { STATUS_LABEL } from "@/lib/state-machine";

interface TrackingData {
  code: string; status: string; statusLabel: string;
  driver: { first: string; rating: number; initials: string } | null;
  vehicle: { model: string; registration: string } | null;
  category: string;
  pickup: { name: string; area: string; lat: number; lng: number };
  dropoff: { name: string; area: string; lat: number; lng: number };
  polyline: { lat: number; lng: number }[];
  etaMin: number | null;
  live: { lat: number; lng: number; progress: number; leg: string } | null;
  distanceKm: number;
  events: { label: string; at: string; type: string }[];
  deliveredAt: string | null;
  cargoSummary: string;
}

interface RoutingResponse {
  distanceKm: number;
  durationMin: number;
  trafficMin: number;
  source: "osrm" | "internal";
  polyline: [number, number][];
}

// category name (public DTO) → vehicle icon key
const CATEGORY_KEY: Record<string, string> = {
  "Tuk-tuk": "tuktuk",
  Van: "van",
  Pickup: "pickup",
  Canter: "canter",
  "7-Tonne Lorry": "lorry_7t",
  "10-Tonne Lorry": "lorry_10t",
};

const TERMINAL = ["COMPLETED", "CANCELLED", "DISPUTED"];

export default function TrackView() {
  const { trackToken, setTrackToken, setSurface } = useSession();

  const { data, isLoading, error } = useQuery({
    queryKey: ["track", trackToken],
    queryFn: () => api<{ tracking: TrackingData }>(`/api/track/${trackToken}`),
    enabled: !!trackToken,
    // stop polling once the delivery reaches a terminal state
    refetchInterval: (q) => {
      const st = q.state.data?.tracking?.status;
      return st === "COMPLETED" || st === "CANCELLED" || st === "DISPUTED" ? false : 2500;
    },
  });

  const t = data?.tracking;

  // ── road-geometry route (OSRM via /api/routing, internal fallback) ────────
  // TO_PICKUP draws the driver's approach (polyline[0] = assignment origin);
  // every other leg draws pickup → drop-off.
  const leg = t?.live?.leg === "TO_PICKUP" ? "TO_PICKUP" : "MAIN";
  const routeFrom: LatLng | null = useMemo(() => {
    if (!t) return null;
    if (leg === "TO_PICKUP" && t.polyline.length > 0) return t.polyline[0];
    return { lat: t.pickup.lat, lng: t.pickup.lng };
  }, [t, leg]);
  const routeTo: LatLng | null = useMemo(() => {
    if (!t) return null;
    return leg === "TO_PICKUP" ? { lat: t.pickup.lat, lng: t.pickup.lng } : { lat: t.dropoff.lat, lng: t.dropoff.lng };
  }, [t, leg]);

  const { data: roadRoute } = useQuery({
    queryKey: ["routing", routeFrom?.lat.toFixed(4), routeFrom?.lng.toFixed(4), routeTo?.lat.toFixed(4), routeTo?.lng.toFixed(4)],
    queryFn: () =>
      api<RoutingResponse>(
        `/api/routing?from=${routeFrom!.lat},${routeFrom!.lng}&to=${routeTo!.lat},${routeTo!.lng}`
      ),
    enabled: !!routeFrom && !!routeTo,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });

  // displayed geometry: OSRM road polyline when available, else the server's
  // internal polyline (geo.ts buildRoute) — the map always has a line.
  const displayRoute: LatLng[] = useMemo(() => {
    if (roadRoute && roadRoute.polyline.length > 1) {
      return roadRoute.polyline.map(([lat, lng]) => ({ lat, lng }));
    }
    return t?.polyline ?? [];
  }, [roadRoute, t?.polyline]);

  // ── dead reckoning between polls (progress + eta rates from the last two) ─
  const liveState = useRef<{ leg: string; progress: number; etaMin: number; at: number; rateP: number; rateE: number } | null>(null);
  const [tick, setTick] = useState(0); // ~2 Hz nudge so the badge + marker advance between polls

  useEffect(() => {
    const lv = t?.live;
    if (!lv) {
      liveState.current = null;
      return;
    }
    const now = Date.now();
    const prev = liveState.current;
    if (prev && prev.leg === lv.leg) {
      const dt = Math.max(0.5, (now - prev.at) / 1000);
      const dP = lv.progress - prev.progress;
      const dE = prev.etaMin - (t?.etaMin ?? prev.etaMin);
      liveState.current = {
        leg: lv.leg,
        progress: lv.progress,
        etaMin: t?.etaMin ?? 0,
        at: now,
        rateP: dP >= 0 ? dP / dt : 0,
        rateE: dE >= 0 ? dE / dt : 0,
      };
    } else {
      liveState.current = { leg: lv.leg, progress: lv.progress, etaMin: t?.etaMin ?? 0, at: now, rateP: 0, rateE: 1 / 60 };
    }
  }, [t?.live, t?.etaMin]);

  const moving = !!t?.live && !TERMINAL.includes(t.status) && (t.live.leg === "TO_PICKUP" || t.live.leg === "TO_DROPOFF");
  useEffect(() => {
    if (!moving) return;
    const id = window.setInterval(() => setTick((n) => n + 1), 500);
    return () => window.clearInterval(id);
  }, [moving]);

  // interpolated position/heading + ticking distance/ETA (recomputed on tick)
  const live = useMemo(() => {
    void tick;
    const ls = liveState.current;
    if (!t?.live || !ls || displayRoute.length < 2) return null;
    const elapsed = Math.max(0, (Date.now() - ls.at) / 1000);
    const progress = Math.min(1, Math.max(0, ls.progress + ls.rateP * elapsed));
    const pos = alongPolyline(displayRoute, progress);
    const heading = headingAt(displayRoute, progress);
    const routeKm = routeLengthKm(displayRoute);
    const remainingKm = Math.max(0, routeKm * (1 - progress));
    const etaNow = t.etaMin != null ? Math.max(0, Math.round(t.etaMin - ls.rateE * elapsed)) : null;
    return { ...pos, heading, remainingKm, etaNow, leg: t.live.leg, progress };
  }, [tick, t?.live, t?.etaMin, displayRoute]);

  const markers: LiveMapMarker[] = useMemo(() => {
    if (!t) return [];
    return [
      ...(live
        ? [{
            id: "driver", kind: "driver" as const, lat: live.lat, lng: live.lng,
            heading: live.heading, categoryKey: CATEGORY_KEY[t.category] ?? "pickup",
          }]
        : []),
      { id: "pickup", kind: "pickup" as const, lat: t.pickup.lat, lng: t.pickup.lng, label: t.pickup.area },
      { id: "dropoff", kind: "dropoff" as const, lat: t.dropoff.lat, lng: t.dropoff.lng, label: t.dropoff.area },
    ];
  }, [t, live]);

  return (
    <div className="mx-auto flex min-h-full max-w-[560px] flex-col bg-[var(--paper)]">
      <div className="flex items-center gap-3 px-5 pt-5">
        <button onClick={() => { setTrackToken(null); setSurface("welcome"); }} className="flex h-11 w-11 items-center justify-center rounded-[10px] border border-[var(--line)] bg-[var(--surface)]" aria-label="Back">
          <ArrowLeft size={18} />
        </button>
        <div>
          <p className="text-[11px] font-extrabold uppercase tracking-widest text-[var(--ink-3)]">Mizigo tracking</p>
          <h1 className="tnum text-[19px] font-extrabold tracking-tight">{t?.code ?? (isLoading ? "Loading…" : "Link not found")}</h1>
        </div>
      </div>

      {isLoading && <div className="mx-5 mt-4 h-72 animate-pulse rounded-[16px] bg-[var(--surface-2)]" />}

      {error && (
        <div className="mx-5 mt-4 rounded-[16px] border border-[var(--line)] bg-[var(--surface)] p-8 text-center">
          <p className="text-[16px] font-bold">This tracking link isn&apos;t valid</p>
          <p className="mt-1 text-[13px] font-medium text-[var(--ink-2)]">Ask the sender for a fresh link.</p>
        </div>
      )}

      {t && (
        <div className="flex flex-1 flex-col gap-4 px-5 pb-8 pt-4">
          {/* map — real tiles, live driver marker */}
          <div className="relative h-64 overflow-hidden rounded-[16px] border border-[var(--line)]">
            <LiveMap
              route={displayRoute}
              markers={markers}
              follow={moving}
              className="absolute inset-0"
              fitPad={70}
            />
            <div className="absolute left-3 top-3">
              <StatusBadge tone={toneForStatus(t.status)}>{t.statusLabel}</StatusBadge>
            </div>
            {moving && (
              <div className="tnum absolute bottom-3 left-3 flex items-center gap-2 rounded-full bg-[var(--ink)]/85 px-3.5 py-1.5 text-[12.5px] font-extrabold text-white backdrop-blur">
                {live && live.remainingKm > 0.05
                  ? `${live.remainingKm.toFixed(1)} km`
                  : "Arriving"}
                {live?.etaNow != null && live.etaNow > 0 && <span className="opacity-55">·</span>}
                {live?.etaNow != null && live.etaNow > 0 && <span>{etaText(live.etaNow)}</span>}
              </div>
            )}
          </div>

          {/* headline */}
          <div className="rounded-[16px] border border-[var(--line)] bg-[var(--surface)] p-5">
            {t.status === "COMPLETED" || t.status === "POD_CONFIRMED" ? (
              <>
                <p className="flex items-center gap-2 text-[19px] font-extrabold tracking-tight">
                  <PackageCheck size={20} className="text-[var(--success)]" /> Delivered
                </p>
                <p className="mt-1 text-[13px] font-semibold text-[var(--ink-2)]">
                  Received and confirmed{t.deliveredAt ? ` · ${fmtDateTimeEAT(t.deliveredAt)}` : ""}
                </p>
              </>
            ) : (
              <>
                <p className="text-[19px] font-extrabold tracking-tight">
                  {t.live?.leg === "TO_PICKUP" ? "Driver heading to pickup" : "Your delivery is on the way"}
                </p>
                {(live?.etaNow ?? t.etaMin) != null && (live?.etaNow ?? t.etaMin ?? 0) > 0 && (
                  <p className="mt-1 text-[13px] font-semibold text-[var(--ink-2)]">Arriving in about {etaText(live?.etaNow ?? t.etaMin ?? 0)}</p>
                )}
              </>
            )}

            {t.driver && (
              <div className="mt-4 flex items-center gap-3.5 border-t border-[var(--line)] pt-4">
                <span className="flex h-12 w-12 items-center justify-center rounded-full bg-[var(--ink)] text-[15px] font-extrabold text-white">
                  {t.driver.initials}
                </span>
                <div className="flex-1">
                  <p className="flex items-center gap-1.5 text-[15px] font-extrabold">
                    {t.driver.first} <BadgeCheck size={14} className="text-[var(--success)]" />
                  </p>
                  <p className="text-[12.5px] font-semibold text-[var(--ink-2)]">★ {t.driver.rating.toFixed(1)} · {t.category}</p>
                </div>
                {t.vehicle && (
                  <div className="text-right">
                    <p className="text-[13.5px] font-extrabold">{t.vehicle.registration}</p>
                    <p className="text-[11.5px] font-semibold text-[var(--ink-3)]">{t.vehicle.model}</p>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* route + events */}
          <div className="rounded-[16px] border border-[var(--line)] bg-[var(--surface)] p-5">
            <div className="flex items-start gap-3">
              <MapPin size={16} className="mt-0.5 shrink-0 text-[var(--success)]" />
              <p className="flex-1 text-[13.5px] font-bold">{t.pickup.name} <span className="font-medium text-[var(--ink-3)]">· {t.pickup.area}</span></p>
            </div>
            <div className="my-2 ml-[7px] h-8 w-[2px] rounded bg-[var(--line)]" />
            <div className="flex items-start gap-3">
              <MapPin size={16} className="mt-0.5 shrink-0 text-[var(--brand)]" />
              <p className="flex-1 text-[13.5px] font-bold">{t.dropoff.name} <span className="font-medium text-[var(--ink-3)]">· {t.dropoff.area}</span></p>
            </div>
            <p className="mt-3 border-t border-[var(--line)] pt-3 text-[12.5px] font-semibold text-[var(--ink-2)]">
              {t.cargoSummary} · {t.distanceKm.toFixed(1)} km
            </p>
          </div>

          <div className="rounded-[16px] border border-[var(--line)] bg-[var(--surface)] p-5">
            <p className="text-[13px] font-extrabold uppercase tracking-widest text-[var(--ink-3)]">Journey</p>
            <div className="mt-3">
              {t.events.map((e) => (
                <div key={e.at + e.type} className="border-l-2 border-[var(--line)] pb-3 pl-3.5 last:pb-0">
                  <p className="text-[12.5px] font-bold">{e.label}</p>
                  <p className="tnum text-[11px] font-semibold text-[var(--ink-3)]">{fmtDateTimeEAT(e.at)}</p>
                </div>
              ))}
            </div>
          </div>

          <p className="text-center text-[11.5px] font-medium text-[var(--ink-3)]">
            No account needed · this page shows only public delivery information
          </p>
          <Button variant="outline" className="w-full" onClick={() => { setTrackToken(null); setSurface("welcome"); }}>
            What is Mizigo?
          </Button>
        </div>
      )}
    </div>
  );
}
