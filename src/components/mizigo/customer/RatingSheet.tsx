"use client";
// RatingSheet — the customer's rating surface, used everywhere: notification
// deep-links, the trips list, the receipt and the post-POD nudge. One rating
// per delivery per role — the server enforces it (409) and this sheet renders
// an existing rating read-only instead of a dead form.

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { BadgeCheck, Star, X } from "lucide-react";
import { api, post, ApiError } from "@/lib/api-client";
import type { ShipmentDTO } from "@/lib/types";
import { useSession } from "@/store/session";
import { Button, ErrorState, Stars } from "@/components/mizigo/shared/ui";
import { t } from "@/lib/i18n";

// praise tags (multi-select) — plain English by design (separate i18n track owns the dictionary)
export const PRAISE_TAGS = ["Careful with cargo", "Great communication", "On time", "Professional", "Went the extra mile"];

const TERMINAL_STATES = ["DELIVERED", "POD_CONFIRMED", "COMPLETED"];

export function customerRating(s: ShipmentDTO) {
  return s.ratings.find((r) => r.byRole === "CUSTOMER") ?? null;
}

/** A shipment can be rated once it has reached a terminal state and isn't rated yet. */
export function isRateable(s: ShipmentDTO): boolean {
  return TERMINAL_STATES.includes(s.status) && !customerRating(s);
}

// ── post-POD nudge memory: one banner per shipment, dismissible, never forced ──
const nudgeKey = (id: string) => `mizigo:rate-nudge:${id}`;
export function rateNudgeDismissed(id: string): boolean {
  try {
    return localStorage.getItem(nudgeKey(id)) === "1";
  } catch {
    return false;
  }
}
export function dismissRateNudge(id: string): void {
  try {
    localStorage.setItem(nudgeKey(id), "1");
  } catch {
    /* private mode — the banner just re-appears next session */
  }
}
const NUDGE_CHANGED_EVENT = "mizigo:rate-nudge-changed";
function subscribeNudge(cb: () => void) {
  window.addEventListener(NUDGE_CHANGED_EVENT, cb);
  return () => window.removeEventListener(NUDGE_CHANGED_EVENT, cb);
}
/** Dismissal is external state (localStorage) — read via useSyncExternalStore. */
export function useRateNudge(shipmentId: string | null | undefined): readonly [boolean, () => void] {
  const dismissed = useSyncExternalStore(
    subscribeNudge,
    () => (shipmentId ? rateNudgeDismissed(shipmentId) : true),
    () => true
  );
  const dismiss = useCallback(() => {
    if (shipmentId) {
      dismissRateNudge(shipmentId);
      window.dispatchEvent(new Event(NUDGE_CHANGED_EVENT));
    }
  }, [shipmentId]);
  return [dismissed, dismiss];
}

// ── the rating form (shared by the sheet and the in-flow rate screen) ──
export function RatingForm({
  shipment,
  onRated,
}: {
  shipment: ShipmentDTO;
  onRated: (r: { alreadyRated: boolean; driverRating: number | null }) => void;
}) {
  const { lang } = useSession();
  const qc = useQueryClient();
  const [stars, setStars] = useState(5); // default 5 — one tap to submit a happy rating
  const [tags, setTags] = useState<string[]>([]);
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canRate = isRateable(shipment);

  const submit = async () => {
    if (busy || !canRate) return;
    setBusy(true);
    setError(null);
    try {
      const res = await post<{ ok: boolean; shipment: ShipmentDTO }>(`/api/shipments/${shipment.id}/action`, {
        action: "rate",
        stars,
        tags,
        comment: comment.trim() || null,
      });
      void qc.invalidateQueries({ queryKey: ["customer-home"] });
      onRated({ alreadyRated: false, driverRating: res.shipment?.driver?.rating ?? null });
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        // rated already (another tab / earlier attempt) — not an error for the customer
        void qc.invalidateQueries({ queryKey: ["shipment", shipment.id] });
        void qc.invalidateQueries({ queryKey: ["customer-home"] });
        onRated({ alreadyRated: true, driverRating: shipment.driver?.rating ?? null });
        return;
      }
      setError(e instanceof Error && e.message ? e.message : "Couldn't send your rating. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="w-full">
      <div className="flex justify-center gap-1.5" role="radiogroup" aria-label="Star rating">
        {[1, 2, 3, 4, 5].map((i) => (
          <button
            key={i}
            type="button"
            onClick={() => setStars(i)}
            className="p-1.5 transition active:scale-90"
            aria-label={`${i} star${i > 1 ? "s" : ""}`}
            aria-pressed={stars === i}
          >
            <Star size={34} strokeWidth={1.4} className={i <= stars ? "fill-[var(--brand)] text-[var(--brand-deep)]" : "text-[var(--line)]"} />
          </button>
        ))}
      </div>

      <div className="mt-3.5 flex flex-wrap justify-center gap-2">
        {PRAISE_TAGS.map((tag) => (
          <button
            key={tag}
            type="button"
            onClick={() => setTags(tags.includes(tag) ? tags.filter((x) => x !== tag) : [...tags, tag])}
            aria-pressed={tags.includes(tag)}
            className={`rounded-full border px-4 py-2.5 text-[13px] font-bold transition active:translate-y-px ${
              tags.includes(tag)
                ? "border-[var(--ink)] bg-[var(--ink)] text-white"
                : "border-[var(--line)] bg-[var(--surface)] text-[var(--ink-2)]"
            }`}
          >
            {tag}
          </button>
        ))}
      </div>

      <div className="mt-3.5">
        <label htmlFor={`rating-comment-${shipment.id}`} className="sr-only">Comment (optional)</label>
        <textarea
          id={`rating-comment-${shipment.id}`}
          value={comment}
          onChange={(e) => setComment(e.target.value.slice(0, 280))}
          rows={3}
          maxLength={280}
          placeholder="Anything else? (optional)"
          className="w-full resize-none rounded-[12px] border border-[var(--line)] bg-[var(--surface)] px-3.5 py-3 text-[13.5px] font-medium leading-relaxed outline-none transition focus:border-[var(--brand)]"
        />
        <p className="tnum mt-1 text-right text-[11px] font-semibold text-[var(--ink-3)]">{comment.length}/280</p>
      </div>

      {error && (
        <p className="mt-1 rounded-[10px] bg-[var(--danger-soft)] px-3.5 py-2.5 text-[12.5px] font-bold text-[var(--danger)]" role="alert">
          {error}
        </p>
      )}

      <Button variant="brand" className="mt-2 w-full" onClick={() => void submit()} loading={busy} disabled={!canRate}>
        {t("rate.submit", lang)}
      </Button>
      {!canRate && (
        <p className="mt-2 text-center text-[12px] font-semibold text-[var(--ink-3)]">You can rate once the delivery is completed.</p>
      )}
    </div>
  );
}

// ── the bottom sheet ──
export function RatingSheet({ shipmentId, onClose }: { shipmentId: string; onClose: () => void }) {
  const { setFocusShipment, setBookingStep } = useSession();
  const [done, setDone] = useState<{ driverRating: number | null } | null>(null);

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["shipment", shipmentId],
    queryFn: () => api<{ shipment: ShipmentDTO }>(`/api/shipments/${shipmentId}`),
  });
  const s = data?.shipment;

  // Esc closes — same affordance as the in-app sheets
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const viewReceipt = () => {
    setFocusShipment(shipmentId);
    setBookingStep("receipt");
    onClose();
  };

  const rated = s ? customerRating(s) : null;

  return (
    <div className="fixed inset-0 z-50 flex items-end bg-[rgba(23,24,28,0.45)]" onClick={onClose}>
      <div
        className="flex max-h-[86%] w-full animate-mz-slide-up flex-col rounded-t-[18px] bg-[var(--surface)] sheet-shadow"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Rate your driver"
      >
        <div className="flex items-center gap-3 border-b border-[var(--line)] px-5 py-4">
          <div className="min-w-0 flex-1">
            <p className="text-[16px] font-extrabold tracking-tight">{done ? "Rating submitted" : "Rate your driver"}</p>
            <p className="tnum text-[11.5px] font-semibold text-[var(--ink-3)]">{s ? `Delivery ${s.code}` : "Loading delivery…"}</p>
          </div>
          <button onClick={onClose} className="flex h-10 w-10 items-center justify-center rounded-full bg-[var(--surface-2)]" aria-label="Close rating">
            <X size={17} />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto thin-scrollbar px-5 pb-6 pt-4">
          {isLoading ? (
            <div className="space-y-3.5">
              <div className="h-[76px] animate-pulse rounded-[12px] bg-[var(--surface-2)]" />
              <div className="mx-auto h-9 w-60 animate-pulse rounded-full bg-[var(--surface-2)]" />
              <div className="h-20 animate-pulse rounded-[12px] bg-[var(--surface-2)]" />
              <div className="h-14 animate-pulse rounded-[10px] bg-[var(--surface-2)]" />
            </div>
          ) : isError || !s ? (
            <ErrorState
              title="Couldn't load this delivery"
              body="Check your connection and try again."
              actions={<Button variant="brand" onClick={() => void refetch()}>Try again</Button>}
            />
          ) : done ? (
            <div className="flex flex-col items-center py-2 text-center">
              <svg width="72" height="72" viewBox="0 0 76 76" aria-hidden="true">
                <circle cx="38" cy="38" r="36" fill="#E8F5EC" />
                <path d="M24 40 L34 50 L54 29" fill="none" stroke="#15803D" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" className="animate-mz-check" style={{ strokeDasharray: 45 }} />
              </svg>
              <h2 className="mt-3 text-[19px] font-extrabold leading-snug tracking-tight">Asante! Your rating helps other customers</h2>
              {done.driverRating != null && s.driver && (
                <p className="mt-1.5 text-[13px] font-semibold text-[var(--ink-2)]">
                  {s.driver.name.split(" ")[0]} is now rated <span className="tnum font-extrabold text-[var(--ink)]">★ {done.driverRating.toFixed(1)}</span> on the network
                </p>
              )}
              <div className="mt-5 w-full space-y-2.5">
                <Button variant="brand" className="w-full" onClick={viewReceipt}>View receipt</Button>
                <Button variant="ghost" className="w-full" onClick={onClose}>Close</Button>
              </div>
            </div>
          ) : rated ? (
            <div>
              <DriverRow s={s} />
              <div className="mt-4 flex flex-col items-center rounded-[12px] bg-[var(--surface-2)] px-4 py-4 text-center">
                <span className="text-[11px] font-extrabold uppercase tracking-widest text-[var(--success)]">Rated</span>
                <Stars value={rated.stars} size={20} className="mt-1.5" />
                {rated.tags?.length > 0 && (
                  <div className="mt-3 flex flex-wrap justify-center gap-1.5">
                    {rated.tags.map((tag) => (
                      <span key={tag} className="rounded-full border border-[var(--line)] bg-[var(--surface)] px-3 py-1.5 text-[11.5px] font-bold text-[var(--ink-2)]">{tag}</span>
                    ))}
                  </div>
                )}
                {rated.comment && <p className="mt-3 text-[12.5px] font-medium italic leading-relaxed text-[var(--ink-2)]">“{rated.comment}”</p>}
              </div>
              <Button variant="outline" className="mt-4 w-full" onClick={viewReceipt}>View receipt</Button>
            </div>
          ) : (
            <div className="flex flex-col items-center">
              <DriverRow s={s} />
              <p className="mt-5 text-[16px] font-extrabold tracking-tight">
                How was {s.driver?.name.split(" ")[0] ?? "your delivery"}?
              </p>
              <div className="mt-3 w-full">
                <RatingForm
                  shipment={s}
                  onRated={(r) => {
                    if (r.alreadyRated) {
                      void refetch(); // the query will flip the sheet to the read-only view
                      return;
                    }
                    setDone({ driverRating: r.driverRating });
                  }}
                />
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function DriverRow({ s }: { s: ShipmentDTO }) {
  if (!s.driver) {
    return (
      <div className="flex w-full items-center gap-3.5 rounded-[12px] bg-[var(--surface-2)] px-4 py-3.5">
        <span className="flex h-[52px] w-[52px] shrink-0 items-center justify-center rounded-full bg-[var(--ink)] text-[16px] font-extrabold text-white">MZ</span>
        <div className="min-w-0 flex-1">
          <p className="text-[15px] font-extrabold tracking-tight">Your delivery {s.code}</p>
          <p className="text-[12.5px] font-semibold text-[var(--ink-2)]">{s.category.name} · {s.route.pickup.area} → {s.route.dropoff.area}</p>
        </div>
      </div>
    );
  }
  return (
    <div className="flex w-full items-center gap-3.5 rounded-[12px] bg-[var(--surface-2)] px-4 py-3.5">
      <span className="flex h-[52px] w-[52px] shrink-0 items-center justify-center rounded-full bg-[var(--ink)] text-[16px] font-extrabold text-white">
        {s.driver.initials}
      </span>
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-1.5 text-[15px] font-extrabold tracking-tight">
          {s.driver.name}
          <BadgeCheck size={15} className="text-[var(--success)]" />
        </p>
        <p className="truncate text-[12.5px] font-semibold text-[var(--ink-2)]">
          {s.vehicle ? `${s.vehicle.make} ${s.vehicle.model} · ` : ""}<span className="font-extrabold text-[var(--ink)]">{s.vehicle?.registration}</span>
          {" "}· ★ {s.driver.rating.toFixed(1)} · {s.driver.trips} trips
        </p>
      </div>
    </div>
  );
}

/** Mount anywhere the rating sheet must be reachable — reads the deep-link target from the session. */
export function RatingSheetHost() {
  const { ratingShipmentId, setRatingShipment } = useSession();
  if (!ratingShipmentId) return null;
  return <RatingSheet shipmentId={ratingShipmentId} onClose={() => setRatingShipment(null)} />;
}
