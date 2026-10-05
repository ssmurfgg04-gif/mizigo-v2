"use client";
// Location step — search, saved places, recent, map confirmation, contact + notes.
// Multi-stop support (plan §35) and save-place (plan §39).
// Kenyan reality: landmarks and instructions matter more than street addresses.

import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Bookmark, MapPin, Plus, Search, Star, Trash2 } from "lucide-react";
import { api, post } from "@/lib/api-client";
import type { PlaceHit } from "@/lib/types";
import { useSession } from "@/store/session";
import { Button } from "@/components/mizigo/shared/ui";
import MapCanvas from "@/components/mizigo/shared/MapCanvas";
import { toast } from "@/hooks/use-toast";

export default function LocationStep({ mode }: { mode: "pickup" | "dropoff" }) {
  const { user, draft, patchDraft, setBookingStep } = useSession();
  const qc = useQueryClient();
  const [qRaw, setQ] = useState("");
  const [q, setQDebounced] = useState("");
  const [addingStop, setAddingStop] = useState(false);
  const [saveOpen, setSaveOpen] = useState(false);
  const [saveLabel, setSaveLabel] = useState("");
  const isPickup = mode === "pickup";
  const selected = isPickup ? draft.pickup : draft.dropoff;

  // debounce the search so typing doesn't fire a request per keystroke
  useEffect(() => {
    const id = window.setTimeout(() => setQDebounced(qRaw.trim()), 250);
    return () => window.clearTimeout(id);
  }, [qRaw]);

  const { data, isLoading } = useQuery({
    queryKey: ["locations", q, user?.id],
    queryFn: () => api<{ results: PlaceHit[]; saved: PlaceHit[] }>(`/api/locations?q=${encodeURIComponent(q)}`),
    staleTime: 30_000,
  });

  const choose = (p: PlaceHit) => {
    if (addingStop) {
      if (draft.stops.length >= 2) {
        toast({ title: "Up to 2 extra stops", description: "Remove a stop to add another." });
        return;
      }
      patchDraft({ stops: [...draft.stops, p] });
      setAddingStop(false);
      toast({ title: "Stop added", description: `${p.name} · extra stops are priced by vehicle class (from KES 100).` });
      return;
    }
    patchDraft(isPickup ? { pickup: p } : { dropoff: p });
  };

  const savePlace = async () => {
    if (!selected || !user) return;
    const label = saveLabel.trim() || "Saved";
    try {
      await post("/api/customer", {
        action: "save-place", userId: user.id,
        place: { label, name: selected.name, area: selected.area, lat: selected.lat, lng: selected.lng },
      });
      await qc.invalidateQueries({ queryKey: ["locations"] });
      await qc.invalidateQueries({ queryKey: ["customer-home"] });
      setSaveOpen(false);
      setSaveLabel("");
      toast({ title: "Place saved", description: `${label} · ${selected.name}` });
    } catch (e) {
      toast({ title: "Couldn't save place", description: (e as Error).message, variant: "destructive" });
    }
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
    <div className="space-y-5 pb-16">
      {/* search */}
      <div className="flex h-14 items-center gap-3 rounded-[12px] border border-[var(--line)] bg-[var(--surface)] px-4 focus-within:border-[var(--brand)]">
        <Search size={18} className="shrink-0 text-[var(--ink-3)]" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={addingStop ? "Search your stop · estate, landmark, business" : isPickup ? "Search pickup · estate, landmark, business" : "Where should it go?"}
          className="h-full w-full bg-transparent text-[15px] font-semibold outline-none placeholder:font-medium placeholder:text-[var(--ink-3)]"
          aria-label="Search location"
          autoFocus
        />
        {addingStop && (
          <button onClick={() => setAddingStop(false)} className="shrink-0 rounded-full bg-[var(--brand-soft)] px-3 py-1.5 text-[11.5px] font-extrabold text-[var(--brand-ink)]">
            Picking stop…
          </button>
        )}
      </div>

      {/* selected confirmation */}
      {selected && !addingStop && (
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
          <div className="flex items-center gap-3 p-4">
            <div className="min-w-0 flex-1">
              <p className="text-[15.5px] font-extrabold tracking-tight">{selected.name}</p>
              <p className="text-[12.5px] font-semibold text-[var(--ink-3)]">{selected.area} · Nairobi</p>
            </div>
            <button
              onClick={() => setSaveOpen(!saveOpen)}
              className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full border transition ${saveOpen ? "border-[var(--brand)] bg-[var(--brand-soft)] text-[var(--brand-deep)]" : "border-[var(--line)] text-[var(--ink-2)] hover:border-[var(--brand)] hover:text-[var(--brand-deep)]"}`}
              aria-label="Save this place"
            >
              <Star size={16} className={saveOpen ? "fill-[var(--brand)]" : ""} />
            </button>
          </div>
          {saveOpen && (
            <div className="animate-mz-fade-in border-t border-[var(--line)] p-4">
              <p className="text-[13px] font-extrabold">Save this place?</p>
              <div className="mt-2 flex gap-2">
                {["Home", "Work", "Shop"].map((l) => (
                  <button key={l} onClick={() => setSaveLabel(l)} className={`rounded-full border px-3.5 py-1.5 text-[12.5px] font-bold transition ${saveLabel === l ? "border-[var(--brand)] bg-[var(--brand-soft)] text-[var(--brand-ink)]" : "border-[var(--line)] text-[var(--ink-2)]"}`}>
                    {l}
                  </button>
                ))}
                <input
                  value={saveLabel}
                  onChange={(e) => setSaveLabel(e.target.value)}
                  placeholder="Custom label"
                  className="h-9 flex-1 rounded-full border border-[var(--line)] bg-[var(--paper)] px-3.5 text-[12.5px] font-semibold outline-none focus:border-[var(--brand)]"
                  aria-label="Place label"
                />
              </div>
              <div className="mt-2.5 flex gap-2">
                <Button variant="outline" className="h-10 flex-1" onClick={savePlace}>Save place</Button>
                <Button variant="ghost" className="h-10" onClick={() => setSaveOpen(false)}>Cancel</Button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* stops (dropoff only, plan §35) */}
      {!isPickup && (draft.stops.length > 0 || addingStop || (selected && !q)) && (
        <section className="rounded-[16px] border border-[var(--line)] bg-[var(--surface)] p-4">
          <div className="flex items-center justify-between">
            <p className="text-[14.5px] font-extrabold tracking-tight">Stops along the way</p>
            {draft.stops.length > 0 && <span className="tnum text-[12px] font-bold text-[var(--ink-3)]">+ priced per vehicle</span>}
          </div>
          {draft.stops.length > 0 ? (
            <div className="mt-2.5 space-y-2">
              {draft.stops.map((s, i) => (
                <div key={i} className="flex items-center gap-3 rounded-[12px] bg-[var(--surface-2)] px-3.5 py-2.5">
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[var(--ink)] text-[11.5px] font-extrabold text-white">{i + 1}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13.5px] font-bold">{s.name}</span>
                    <span className="block text-[11.5px] font-medium text-[var(--ink-3)]">{s.area}</span>
                  </span>
                  <button onClick={() => patchDraft({ stops: draft.stops.filter((_, j) => j !== i) })} className="text-[var(--ink-3)] transition hover:text-[var(--danger)]" aria-label={`Remove stop ${i + 1}`}>
                    <Trash2 size={15} />
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <p className="mt-1 text-[12.5px] font-medium text-[var(--ink-2)]">Multi-stop deliveries drop items at up to 2 extra points on the way.</p>
          )}
          {!addingStop && draft.stops.length < 2 && (
            <button onClick={() => setAddingStop(true)} className="mt-2.5 flex items-center gap-1.5 text-[13px] font-bold text-[var(--brand-deep)]">
              <Plus size={14} /> {draft.stops.length === 0 ? "Add another stop" : "Add one more stop"}
            </button>
          )}
        </section>
      )}

      {/* saved places */}
      {!q && !addingStop && (data?.saved?.length ?? 0) > 0 && (
        <section>
          <p className="flex items-center gap-1.5 text-[11.5px] font-extrabold uppercase tracking-widest text-[var(--ink-3)]"><Bookmark size={12} /> Saved places</p>
          <div className="mt-2 space-y-1.5">
            {data!.saved.map((s) => (
              <button key={s.label} onClick={() => choose(s)} className="flex w-full items-center gap-3 rounded-[12px] border border-[var(--line)] bg-[var(--surface)] px-4 py-3 text-left transition hover:border-[var(--ink-3)]">
                <span className="flex h-9 w-9 items-center justify-center rounded-full bg-[var(--brand-soft)] text-[var(--brand-deep)]"><Star size={14} /></span>
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
          <MapPin size={12} /> {q ? "Results" : addingStop ? "Pick your stop" : "Popular around Nairobi"}
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
      {selected && !addingStop && (
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

      {/* sticky CTA — only once a place is chosen, so it never blocks the list */}
      {selected && !addingStop && (
        <div className="sticky bottom-4 pt-2">
          <Button variant="brand" className="w-full" onClick={next}>
            {isPickup ? "Set pickup" : "Confirm destination"}
          </Button>
        </div>
      )}
      {addingStop && (
        <div className="sticky bottom-4 pt-2">
          <Button variant="brand" className="w-full" onClick={() => setAddingStop(false)}>
            Done adding stops
          </Button>
        </div>
      )}
    </div>
  );
}
