"use client";
// Problem screen (plan §38) — customer disputes with evidence. The booking ID,
// driver and route are attached automatically (plan §76).

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, TriangleAlert } from "lucide-react";
import { api, post } from "@/lib/api-client";
import type { ShipmentDTO } from "@/lib/types";
import { useSession } from "@/store/session";
import { Button } from "@/components/mizigo/shared/ui";
import { toast } from "@/hooks/use-toast";

const TYPES = [
  { key: "CARGO_DAMAGE", label: "Cargo damaged", hint: "Scratches, breaks, water damage" },
  { key: "MISSING_ITEM", label: "Missing item", hint: "Something didn't arrive" },
  { key: "WRONG_DELIVERY", label: "Wrong delivery", hint: "Delivered to the wrong place" },
  { key: "LATE", label: "Late delivery", hint: "Much later than promised" },
  { key: "DRIVER_ISSUE", label: "Driver issue", hint: "Conduct, handling, communication" },
  { key: "PAYMENT", label: "Payment issue", hint: "Charged wrongly, refund needed" },
  { key: "OTHER", label: "Other", hint: "Tell us what happened" },
];

export default function ProblemScreen() {
  const { focusShipmentId, setBookingStep, setCustomerTab } = useSession();
  const [type, setType] = useState<string | null>(null);
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);

  const { data } = useQuery({
    queryKey: ["shipment", focusShipmentId],
    queryFn: () => api<{ shipment: ShipmentDTO }>(`/api/shipments/${focusShipmentId}`),
    enabled: !!focusShipmentId,
  });
  const s = data?.shipment;

  const submit = async () => {
    if (!s || !type) return;
    setBusy(true);
    try {
      await post(`/api/shipments/${s.id}/action`, { action: "dispute", actor: "CUSTOMER", type, notes });
      toast({ title: "Case opened", description: `Our team will contact you about ${s.code} within 2 hours.` });
      setBookingStep("idle");
      setCustomerTab("trips");
    } catch (e) {
      toast({ title: "Couldn't open the case", description: (e as Error).message, variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-full flex-col bg-[var(--paper)]">
      <div className="sticky top-0 z-20 bg-[var(--paper)]/95 px-5 pb-3 pt-4 backdrop-blur">
        <div className="flex items-center gap-3">
          <button
            onClick={() => setBookingStep("idle")}
            className="flex h-11 w-11 items-center justify-center rounded-[10px] border border-[var(--line)] bg-[var(--surface)]"
            aria-label="Back"
          >
            <ArrowLeft size={18} />
          </button>
          <div>
            <h1 className="text-[18px] font-extrabold tracking-tight">What happened?</h1>
            {s && <p className="tnum text-[12px] font-semibold text-[var(--ink-3)]">{s.code} · {s.route.pickup.area} → {s.route.dropoff.area}</p>}
          </div>
        </div>
      </div>

      <div className="flex-1 space-y-4 px-5 pb-6">
        <div className="flex items-start gap-3 rounded-[12px] bg-[var(--warn-soft)] px-4 py-3">
          <TriangleAlert size={16} className="mt-0.5 shrink-0 text-[var(--warn)]" />
          <p className="text-[12.5px] font-semibold leading-relaxed text-[var(--ink-2)]">
            Evidence from the chain of custody — photos, GPS and timestamps for {s?.code ?? "this delivery"} — is attached automatically. Ops reviews every case.
          </p>
        </div>

        <div className="space-y-2">
          {TYPES.map((t) => {
            const on = type === t.key;
            return (
              <button
                key={t.key}
                onClick={() => setType(t.key)}
                className={`flex w-full items-center gap-3.5 rounded-[14px] border-2 px-4 py-3.5 text-left transition ${on ? "border-[var(--brand)] bg-[var(--brand-soft)]" : "border-[var(--line)] bg-[var(--surface)]"}`}
              >
                <span className="flex-1">
                  <span className="block text-[14.5px] font-extrabold">{t.label}</span>
                  <span className="block text-[12px] font-medium text-[var(--ink-2)]">{t.hint}</span>
                </span>
                <span className={`flex h-5 w-5 items-center justify-center rounded-full border-2 ${on ? "border-[var(--brand)]" : "border-[var(--line)]"}`}>
                  {on && <span className="h-2.5 w-2.5 rounded-full bg-[var(--brand)]" />}
                </span>
              </button>
            );
          })}
        </div>

        <label className="block">
          <span className="text-[11.5px] font-bold uppercase tracking-widest text-[var(--ink-3)]">Tell us more (optional)</span>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value.slice(0, 400))}
            placeholder="e.g. The fridge arrived with a big dent on the left side…"
            rows={3}
            className="mt-1.5 w-full rounded-[12px] border border-[var(--line)] bg-[var(--surface)] px-3.5 py-3 text-[14px] font-semibold outline-none focus:border-[var(--brand)]"
          />
        </label>

        <Button variant="danger" className="w-full" disabled={!type || busy} loading={busy} onClick={submit}>
          Open a case
        </Button>
      </div>
    </div>
  );
}
