"use client";
// Rate + Receipt — the closing moments of the core loop.

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Download, Star } from "lucide-react";
import { api, post } from "@/lib/api-client";
import type { ShipmentDTO } from "@/lib/types";
import { useSession } from "@/store/session";
import { Button, Row } from "@/components/mizigo/shared/ui";
import { kes, fmtDateTimeEAT, fmtTimeEAT } from "@/lib/format";
import { toast } from "@/hooks/use-toast";

const QUICK_TAGS = ["Arrived on time", "Careful with cargo", "Professional", "Good communication", "Vehicle clean"];

export function RateScreen() {
  const { focusShipmentId, setBookingStep, setCustomerTab } = useSession();
  const [stars, setStars] = useState(0);
  const [tags, setTags] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const { data } = useQuery({
    queryKey: ["shipment", focusShipmentId],
    queryFn: () => api<{ shipment: ShipmentDTO }>(`/api/shipments/${focusShipmentId}`),
    enabled: !!focusShipmentId,
  });
  const s = data?.shipment;

  if (!s) return <div className="h-full animate-pulse bg-[var(--surface-2)]" />;

  const submit = async () => {
    setBusy(true);
    try {
      await post(`/api/shipments/${s.id}/action`, { action: "rate", actor: "CUSTOMER", stars: stars || 5, tags });
      toast({ title: "Thanks for the feedback" });
      setBookingStep("receipt");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-full flex-col px-6 pb-8 pt-10">
      <div className="flex flex-1 flex-col items-center justify-center text-center">
        <svg width="80" height="80" viewBox="0 0 76 76" aria-hidden="true">
          <circle cx="38" cy="38" r="36" fill="#E8F5EC" />
          <path d="M24 40 L34 50 L54 29" fill="none" stroke="#15803D" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" className="animate-mz-check" style={{ strokeDasharray: 45 }} />
        </svg>
        <h1 className="mt-4 text-[24px] font-extrabold tracking-tight">Your delivery was completed</h1>
        <div className="mt-2 rounded-[12px] bg-[var(--surface)] px-4 py-3 text-left">
          <Row label="Delivered to" value={s.pod?.recipient ?? "Recipient"} />
          <Row label="Time" value={s.pod ? fmtTimeEAT(s.pod.verifiedAt) : "—"} />
          <Row label="Location" value="GPS recorded" />
        </div>
        <p className="mt-7 text-[16px] font-extrabold">How was {s.driver?.name.split(" ")[0]}?</p>
        <div className="mt-3 flex gap-2" role="radiogroup" aria-label="Star rating">
          {[1, 2, 3, 4, 5].map((i) => (
            <button key={i} onClick={() => setStars(i)} className="p-1.5 transition active:scale-90" aria-label={`${i} star${i > 1 ? "s" : ""}`} aria-pressed={stars === i}>
              <Star size={34} strokeWidth={1.4} className={i <= stars ? "fill-[var(--brand)] text-[var(--brand)]" : "text-[var(--line)]"} />
            </button>
          ))}
        </div>
        <div className="mt-4 flex flex-wrap justify-center gap-2">
          {QUICK_TAGS.map((t) => (
            <button
              key={t}
              onClick={() => setTags(tags.includes(t) ? tags.filter((x) => x !== t) : [...tags, t])}
              className={`rounded-full border px-4 py-2 text-[13px] font-bold transition ${tags.includes(t) ? "border-[var(--ink)] bg-[var(--ink)] text-white" : "border-[var(--line)] bg-[var(--surface)] text-[var(--ink-2)]"}`}
            >
              {t}
            </button>
          ))}
        </div>
      </div>
      <div className="space-y-2.5">
        <Button variant="brand" className="w-full" onClick={submit} loading={busy} disabled={!stars}>
          Submit rating
        </Button>
        <Button variant="ghost" className="w-full" onClick={() => setBookingStep("receipt")}>Skip</Button>
      </div>
    </div>
  );
}

export function ReceiptScreen() {
  const { focusShipmentId, setBookingStep, setCustomerTab, resetDraft, setFocusShipment } = useSession();

  const { data } = useQuery({
    queryKey: ["shipment", focusShipmentId],
    queryFn: () => api<{ shipment: ShipmentDTO }>(`/api/shipments/${focusShipmentId}`),
    enabled: !!focusShipmentId,
  });
  const s = data?.shipment;

  if (!s) return <div className="h-full animate-pulse bg-[var(--surface-2)]" />;

  const close = () => {
    resetDraft();
    setFocusShipment(null);
    setBookingStep("idle");
    setCustomerTab("trips");
  };

  return (
    <div className="min-h-full px-5 pb-8 pt-6">
      <div className="rounded-[18px] border border-[var(--line)] bg-[var(--surface)] p-5 brand-shadow">
        <div className="text-center">
          <span className="text-[19px] font-extrabold tracking-[-0.03em]">MIZIGO</span>
          <p className="tnum mt-0.5 text-[12.5px] font-bold text-[var(--ink-3)]">Delivery {s.code}</p>
        </div>
        <div className="mt-4 border-t border-dashed border-[var(--line)] pt-3">
          <Row label="Date" value={fmtDateTimeEAT(s.createdAt)} />
          <Row label="Pickup" value={s.route.pickup.name} />
          <Row label="Drop-off" value={s.route.dropoff.name} />
          <Row label="Vehicle" value={s.category.name} />
          <Row label="Cargo" value={`${s.cargo.items.reduce((a, i) => a + i.qty, 0)} items`} />
          {s.driver && <Row label="Driver" value={`${s.driver.name.split(" ")[0]} ${s.driver.name.split(" ")[1]?.[0]}.`} />}
        </div>
        <div className="mt-3 border-t border-dashed border-[var(--line)] pt-3">
          {s.fare.base > 0 && <Row label="Transport" value={kes(s.fare.base)} />}
          {s.fare.distance > 0 && <Row label={`Distance · ${s.route.distanceKm.toFixed(1)} km`} value={kes(s.fare.distance)} />}
          {s.fare.duration > 0 && <Row label="Time on road" value={kes(s.fare.duration)} />}
          {s.fare.loading > 0 && <Row label="Loading assistance" value={kes(s.fare.loading)} />}
          {s.fare.platform > 0 && <Row label="Platform fee" value={kes(s.fare.platform)} />}
        </div>
        <div className="mt-3 flex items-baseline justify-between border-t-2 border-[var(--ink)] pt-3">
          <span className="text-[15px] font-extrabold">TOTAL</span>
          <span className="tnum text-[24px] font-extrabold tracking-tight">{kes(s.fare.total)}</span>
        </div>
        <div className="mt-3 rounded-[10px] bg-[var(--surface-2)] px-4 py-3">
          <Row label="Payment" value={s.payment.method === "MPESA" ? "M-PESA" : s.payment.method} />
          {s.payment.ref && <Row label="Receipt" value={s.payment.ref} />}
          <Row label="Status" value={s.payment.status === "CONFIRMED" ? "PAID" : s.payment.status} strong />
        </div>
        <p className="mt-3 text-center text-[11px] font-medium text-[var(--ink-3)]">
          {s.customer.business ? "VAT invoice available for business accounts · " : ""}
          Proof of delivery attached to this receipt
        </p>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2.5">
        <Button variant="outline" onClick={() => toast({ title: "Receipt saved", description: "PDF download starts in production." })}>
          <Download size={16} /> Download
        </Button>
        <Button variant="outline" onClick={() => toast({ title: "Share", description: "Receipt link copied (sandbox)." })}>
          Share
        </Button>
      </div>
      <Button variant="brand" className="mt-3 w-full" onClick={close}>
        Done
      </Button>
    </div>
  );
}
