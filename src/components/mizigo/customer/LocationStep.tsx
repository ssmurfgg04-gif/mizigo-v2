"use client";
// Location step — search, saved places, recent, map confirmation, contact + notes.
// Kenyan reality: landmarks and instructions matter more than street addresses.

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Bookmark, Clock3, MapPin, Search, Star } from "lucide-react";
import { api } from "@/lib/api-client";
import type { PlaceHit } from "@/lib/types";
import { useSession } from "@/store/session";
import { Button } from "@/components/mizigo/shared/ui";
import MapCanvas from "@/components/mizigo/shared/MapCanvas";
import { toast } from "@/hooks/use-toast";

export default function LocationStep({ mode }: { mode: "pickup" | "dropoff" }) {
  const { user, draft, patchDraft, setBookingStep } = useSession();
  const [q, setQ] = useState("");
  const isPickup = mode === "pickup";
  const selected = isPickup ? draft.pickup : draft.dropoff;

  const { data, isLoading } = useQuery({
    queryKey: ["locations", q, user?.id],
    queryFn: () => api<{ results: PlaceHit[]; saved: PlaceHit[] }>(`/api/locations?q=${encodeURIComponent(q)}&userId=${user?.id ?? ""}`),
    staleTime: 30_000,
  });

  const choose = (p: PlaceHit) => {
    patchDraft(isPickup ? { pickup: p } : { dropoff: p });
  };

  const note = isPickup ? draft.pickupNote : draft.dropoffNote;
  const contact = isPickup ? draft.pickupContact : draft.dropoffContact;
  const phone = isPickup ? draft.pickupPhone : draft.dropoffPhone;

  const next = () => {
    if (!selected) {
      toast({ title: isPickup ? "Choose a pickup point" : "Choose the destination", description: "Search a landmark, estate or business." });
      return;
    }
    setBookingStep(isPickup ? "dropoff" : "vehicle");
  };

  return (
    <div className="space-y-5">
      {/* search */}
      <div className="flex h-14 items-center gap-3 rounded-[12px] border border-[var(--line)] bg-[var(--surface)] px-4 focus-within:border-[var(--brand)]">
        <Search size={18} className="shrink-0 text-[var(--ink-3)]" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={isPickup ? "Search pickup · estate, landmark, business" : "Where should it go?"}
          className="h-full w-full bg-transparent text-[15px] font-semibold outline-none placeholder:font-medium placeholder:text-[var(--ink-3)]"
          aria-label="Search location"
          autoFocus
        />
      </div>

      {/* selected confirmation */}
      {selected && (
        <div className="animate-mz-slide-up overflow-hidden rounded-[16px] border border-[var(--line)] bg-[var(--surface)]">
          <div className="relative h-40">
            <MapCanvas
              focus={{ lat: selected.lat, lng: selected.lng }}
              markers={[{ kind: isPickup ? "pickup" : "dropoff", lat: selected.lat, lng: selected.lng, label: selected.area }]}
              showLabels={false}
              className="absolute inset-0"
              fitPad={90}
            />
          </div>
          <div className="p-4">
            <p className="text-[15.5px] font-extrabold tracking-tight">{selected.name}</p>
            <p className="text-[12.5px] font-semibold text-[var(--ink-3)]">{selected.area} · Nairobi</p>
          </div>
        </div>
      )}

      {/* saved places */}
      {!q && (data?.saved?.length ?? 0) > 0 && (
        <section>
          <p className="flex items-center gap-1.5 text-[11.5px] font-extrabold uppercase tracking-widest text-[var(--ink-3)]"><Bookmark size={12} /> Saved places</p>
          <div className="mt-2 space-y-1.5">
            {data!.saved.map((s) => (
              <button key={s.label} onClick={() => choose(s)} className="flex w-full items-center gap-3 rounded-[12px] border border-[var(--line)] bg-[var(--surface)] px-4 py-3 text-left transition hover:border-[var(--ink-3)]">
                <span className="flex h-9 w-9 items-center justify-center rounded-full bg-[var(--brand-soft)] text-[var(--brand)]"><Star size={14} /></span>
                <span className="flex-1">
                  <span className="block text-[14px] font-bold">{s.name}</span>
                  <span className="block text-[12px] font-medium text-[var(--ink-3)]">{s.label} · {s.area}</span>
                </span>
              </button>
            ))}
          </div>
        </section>
      )}

      {/* results */}
      <section>
        <p className="flex items-center gap-1.5 text-[11.5px] font-extrabold uppercase tracking-widest text-[var(--ink-3)]">
          <MapPin size={12} /> {q ? "Results" : "Popular around Nairobi"}
        </p>
        <div className="mt-2 space-y-1.5">
          {isLoading && [1, 2, 3, 4].map((i) => <div key={i} className="h-[62px] animate-pulse rounded-[12px] bg-[var(--surface-2)]" />)}
          {data?.results.map((p) => {
            const active = selected?.name === p.name;
            return (
              <button
                key={p.name}
                onClick={() => choose(p)}
                className={`flex w-full items-center gap-3 rounded-[12px] border px-4 py-3 text-left transition ${active ? "border-[var(--brand)] bg-[var(--brand-soft)]" : "border-[var(--line)] bg-[var(--surface)] hover:border-[var(--ink-3)]"}`}
              >
                <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${active ? "bg-[var(--brand)] text-white" : "bg-[var(--surface-2)] text-[var(--ink-2)]"}`}>
                  <MapPin size={14} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[14px] font-bold">{p.name}</span>
                  <span className="block text-[12px] font-medium capitalize text-[var(--ink-3)]">{p.area} · {p.category}</span>
                </span>
              </button>
            );
          })}
          {!isLoading && data?.results.length === 0 && (
            <p className="rounded-[12px] bg-[var(--surface-2)] px-4 py-3 text-[13px] font-medium text-[var(--ink-2)]">
              No matches. Try a landmark like “Sarit”, “Gikomba” or “T-Mall”.
            </p>
          )}
        </div>
      </section>

      {/* contact + instructions */}
      {selected && (
        <section className="animate-mz-fade-in space-y-3 rounded-[16px] border border-[var(--line)] bg-[var(--surface)] p-4">
          <p className="text-[14.5px] font-extrabold tracking-tight">{isPickup ? "Pickup details" : "Drop-off details"}</p>
          <label className="block">
            <span className="text-[11.5px] font-bold uppercase tracking-widest text-[var(--ink-3)]">{isPickup ? "Instructions for the driver" : "Delivery instructions"}</span>
            <input
              value={note}
              onChange={(e) => patchDraft(isPickup ? { pickupNote: e.target.value } : { dropoffNote: e.target.value })}
              placeholder={isPickup ? "Gate B, next to the petrol station" : "Call before arriving"}
              className="mt-1.5 h-12 w-full rounded-[10px] border border-[var(--line)] bg-[var(--surface)] px-3.5 text-[14px] font-semibold outline-none focus:border-[var(--brand)]"
            />
          </label>
          <div className="grid grid-cols-2 gap-2.5">
            <label className="block">
              <span className="text-[11.5px] font-bold uppercase tracking-widest text-[var(--ink-3)]">{isPickup ? "Contact person" : "Recipient"}</span>
              <input
                value={contact}
                onChange={(e) => patchDraft(isPickup ? { pickupContact: e.target.value } : { dropoffContact: e.target.value })}
                placeholder={isPickup ? "e.g. John" : "e.g. Mary"}
                className="mt-1.5 h-12 w-full rounded-[10px] border border-[var(--line)] bg-[var(--surface)] px-3.5 text-[14px] font-semibold outline-none focus:border-[var(--brand)]"
              />
            </label>
            <label className="block">
              <span className="text-[11.5px] font-bold uppercase tracking-widest text-[var(--ink-3)]">Phone</span>
              <input
                value={phone}
                onChange={(e) => patchDraft(isPickup ? { pickupPhone: e.target.value } : { dropoffPhone: e.target.value })}
                placeholder="0712 345 678"
                inputMode="tel"
                className="mt-1.5 h-12 w-full rounded-[10px] border border-[var(--line)] bg-[var(--surface)] px-3.5 text-[14px] font-semibold outline-none focus:border-[var(--brand)]"
              />
            </label>
          </div>
        </section>
      )}

      <div className="sticky bottom-4">
        <Button variant="brand" className="w-full" onClick={next}>
          {isPickup ? "Set pickup" : "Confirm destination"}
        </Button>
      </div>
    </div>
  );
}
