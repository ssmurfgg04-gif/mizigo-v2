"use client";
// Public tracking — no login, no app. Minimal data only (no phones, no notes).

import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, BadgeCheck, MapPin, PackageCheck } from "lucide-react";
import { api } from "@/lib/api-client";
import { useSession } from "@/store/session";
import { StatusBadge, toneForStatus, Button } from "@/components/mizigo/shared/ui";
import MapCanvas from "@/components/mizigo/shared/MapCanvas";
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
          {/* map */}
          <div className="relative h-64 overflow-hidden rounded-[16px] border border-[var(--line)]">
            <MapCanvas
              route={t.polyline}
              markers={[
                ...(t.live ? [{ kind: "vehicle" as const, lat: t.live.lat, lng: t.live.lng }] : []),
                { kind: "pickup", lat: t.pickup.lat, lng: t.pickup.lng },
                { kind: "dropoff", lat: t.dropoff.lat, lng: t.dropoff.lng },
              ]}
              showLabels={false}
              className="absolute inset-0"
              fitPad={70}
            />
            <div className="absolute left-3 top-3">
              <StatusBadge tone={toneForStatus(t.status)}>{t.statusLabel}</StatusBadge>
            </div>
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
                {t.etaMin != null && t.etaMin > 0 && (
                  <p className="mt-1 text-[13px] font-semibold text-[var(--ink-2)]">Arriving in about {etaText(t.etaMin)}</p>
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
