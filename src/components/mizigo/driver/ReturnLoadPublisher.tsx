"use client";
// Driver return-capacity publisher (v1 goodness: the empty-leg marketplace).
// After dropping a load, the driver publishes the return leg at a discount
// instead of driving back empty. Buyers get cheaper transport; the driver
// earns on the dead leg.

import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { BadgePercent, ChevronDown, MapPin, Plus, Undo2, X } from "lucide-react";
import { post } from "@/lib/api-client";
import { PLACES } from "@/lib/geo";
import { kes } from "@/lib/format";
import { Button, SectionTitle, StatusBadge } from "@/components/mizigo/shared/ui";
import VehicleAvatar from "@/components/mizigo/shared/VehicleAvatar";
import { toast } from "@/hooks/use-toast";
import type { DriverHome } from "@/lib/types";

const POPULAR = PLACES.filter((p) => p.popular);
const ALL = PLACES;

export default function ReturnLoadPublisher({ data }: { data: DriverHome }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [fromKey, setFromKey] = useState("");
  const [toKey, setToKey] = useState("");
  const [cargoNote, setCargoNote] = useState("General cargo");
  const [weight, setWeight] = useState("");
  const [price, setPrice] = useState("");
  const [busy, setBusy] = useState(false);

  const vehicles = data.driver.vehicles;
  const [categorySel, setCategorySel] = useState(vehicles[0]?.categoryKey ?? "");
  const chosen = vehicles.find((v) => v.categoryKey === categorySel) ?? vehicles[0];

  const from = useMemo(() => ALL.find((p) => `${p.name} · ${p.area}` === fromKey) ?? null, [fromKey]);
  const to = useMemo(() => ALL.find((p) => `${p.name} · ${p.area}` === toKey) ?? null, [toKey]);

  const legs = (data.returnLoads ?? []).filter((l) => l.status === "AVAILABLE" || l.status === "BOOKED");

  const publish = async () => {
    if (!from || !to || !chosen) {
      toast({ title: "Pick both ends of the return leg", variant: "destructive" });
      return;
    }
    setBusy(true);
    try {
      await post("/api/driver/action", {
        action: "publish-return-load",
        driverId: data.driver.id,
        from: { name: from.name, area: from.area, lat: from.lat, lng: from.lng },
        to: { name: to.name, area: to.area, lat: to.lat, lng: to.lng },
        categoryKey: chosen.categoryKey,
        cargoNote,
        maxWeightKg: Number(weight) || chosen.capacityKg,
        priceKes: Number(price) || 0,
      });
      toast({ title: "Return capacity published", description: `${from.area} → ${to.area} is live on the deals market. Customers can reserve it instantly.` });
      setOpen(false);
      setFromKey(""); setToKey(""); setPrice("");
      qc.invalidateQueries({ queryKey: ["driver"] });
    } catch (e) {
      toast({ title: "Could not publish", description: (e as Error).message, variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  const cancel = async (id: string) => {
    try {
      await post("/api/driver/action", { action: "return-load-cancel", id, driverId: data.driver.id });
      toast({ title: "Leg withdrawn" });
      qc.invalidateQueries({ queryKey: ["driver"] });
    } catch (e) {
      toast({ title: "Could not withdraw", description: (e as Error).message, variant: "destructive" });
    }
  };

  return (
    <div className="rounded-[16px] border border-[var(--line)] bg-[var(--surface)]">
      <button onClick={() => setOpen(!open)} className="flex w-full items-center gap-3.5 p-4 text-left">
        <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-[var(--brand-soft)] text-[var(--brand)]">
          <BadgePercent size={20} strokeWidth={2.2} />
        </span>
        <span className="flex-1">
          <span className="block text-[15px] font-extrabold tracking-tight">Sell your return leg</span>
          <span className="block text-[12px] font-medium text-[var(--ink-2)]">Driving back empty? Publish the leg at a discount and earn on the way home.</span>
        </span>
        <ChevronDown size={17} className={`text-[var(--ink-3)] transition ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div className="border-t border-[var(--line)] p-4 pt-3.5">
          <div className="grid grid-cols-2 gap-2.5">
            <label className="block">
              <span className="text-[10.5px] font-extrabold uppercase tracking-widest text-[var(--ink-3)]">Returning from</span>
              <select
                value={fromKey}
                onChange={(e) => setFromKey(e.target.value)}
                className="mt-1 h-11 w-full rounded-[10px] border border-[var(--line)] bg-[var(--surface)] px-2.5 text-[12.5px] font-bold outline-none focus:border-[var(--brand)]"
              >
                <option value="">Choose pickup</option>
                {(POPULAR.length ? POPULAR : ALL).map((p) => (
                  <option key={p.name} value={`${p.name} · ${p.area}`}>{p.name} · {p.area}</option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="text-[10.5px] font-extrabold uppercase tracking-widest text-[var(--ink-3)]">Going to</span>
              <select
                value={toKey}
                onChange={(e) => setToKey(e.target.value)}
                className="mt-1 h-11 w-full rounded-[10px] border border-[var(--line)] bg-[var(--surface)] px-2.5 text-[12.5px] font-bold outline-none focus:border-[var(--brand)]"
              >
                <option value="">Choose destination</option>
                {ALL.map((p) => (
                  <option key={p.name} value={`${p.name} · ${p.area}`}>{p.name} · {p.area}</option>
                ))}
              </select>
            </label>
          </div>

          <div className="mt-2.5 grid grid-cols-2 gap-2.5">
            <label className="block">
              <span className="text-[10.5px] font-extrabold uppercase tracking-widest text-[var(--ink-3)]">Vehicle</span>
              <select
                value={categorySel}
                onChange={(e) => setCategorySel(e.target.value)}
                className="mt-1 h-11 w-full rounded-[10px] border border-[var(--line)] bg-[var(--surface)] px-2.5 text-[12.5px] font-bold outline-none focus:border-[var(--brand)]"
              >
                {vehicles.map((v) => (
                  <option key={v.id} value={v.categoryKey}>{v.category} · {v.registration}</option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="text-[10.5px] font-extrabold uppercase tracking-widest text-[var(--ink-3)]">Cargo type</span>
              <input
                value={cargoNote}
                onChange={(e) => setCargoNote(e.target.value)}
                maxLength={60}
                className="mt-1 h-11 w-full rounded-[10px] border border-[var(--line)] bg-[var(--surface)] px-3 text-[12.5px] font-bold outline-none focus:border-[var(--brand)]"
              />
            </label>
          </div>

          <div className="mt-2.5 grid grid-cols-2 gap-2.5">
            <label className="block">
              <span className="text-[10.5px] font-extrabold uppercase tracking-widest text-[var(--ink-3)]">Max weight (kg)</span>
              <input
                type="number" inputMode="numeric" min={1}
                placeholder={String(chosen?.capacityKg ?? 1000)}
                value={weight}
                onChange={(e) => setWeight(e.target.value)}
                className="tnum mt-1 h-11 w-full rounded-[10px] border border-[var(--line)] bg-[var(--surface)] px-3 text-[12.5px] font-bold outline-none focus:border-[var(--brand)]"
              />
            </label>
            <label className="block">
              <span className="text-[10.5px] font-extrabold uppercase tracking-widest text-[var(--ink-3)]">Your price (KES)</span>
              <input
                type="number" inputMode="numeric" min={500}
                placeholder="≈ 60% of normal"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                className="tnum mt-1 h-11 w-full rounded-[10px] border border-[var(--line)] bg-[var(--surface)] px-3 text-[12.5px] font-bold outline-none focus:border-[var(--brand)]"
              />
            </label>
          </div>

          <Button variant="brand" className="mt-3 w-full" onClick={publish} disabled={busy || !from || !to || !(Number(price) >= 500)}>
            <Plus size={16} strokeWidth={2.6} /> {busy ? "Publishing…" : "Publish return capacity"}
          </Button>
          <p className="mt-2 text-[11px] font-medium text-[var(--ink-3)]">
            Customers see your leg on their home deals rail with your verified badge and rating. The leg stays live for 6 hours.
          </p>
        </div>
      )}

      {legs.length > 0 && (
        <div className="border-t border-[var(--line)] p-4 pt-3">
          <SectionTitle>Your published legs</SectionTitle>
          <div className="mt-2.5 space-y-2">
            {legs.map((l) => (
              <div key={l.id} className="flex items-center gap-3 rounded-[12px] border border-[var(--line)] bg-[var(--surface-2)] p-3">
                <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-[var(--surface)]"><VehicleAvatar category={l.categoryKey} size={32} /></span>
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-1 truncate text-[13px] font-extrabold"><MapPin size={12} className="text-[var(--brand)]" /> {l.fromArea} → {l.toArea}</p>
                  <p className="mt-0.5 text-[11.5px] font-semibold text-[var(--ink-3)]">
                    {kes(l.priceKes, { compact: true })} · {l.maxWeightKg.toLocaleString()} kg · {l.cargoNote}
                  </p>
                </div>
                {l.status === "BOOKED" ? (
                  <StatusBadge tone="success">Reserved</StatusBadge>
                ) : (
                  <button onClick={() => cancel(l.id)} className="flex h-9 w-9 items-center justify-center rounded-full border border-[var(--line)] bg-[var(--surface)] text-[var(--ink-3)] transition hover:text-[var(--danger)]" aria-label="Withdraw leg">
                    <Undo2 size={15} />
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
