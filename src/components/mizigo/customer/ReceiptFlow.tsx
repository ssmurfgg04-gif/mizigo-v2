"use client";
// Rate + Receipt — the closing moments of the core loop. The rating UI is
// the shared RatingForm from RatingSheet.tsx; the receipt nudges an unrated
// delivery once (dismissable, remembered per delivery) and always keeps a
// compact rate entry — no dead ends.

import { useQuery } from "@tanstack/react-query";
import { Download, Star, X } from "lucide-react";
import { api } from "@/lib/api-client";
import type { ShipmentDTO } from "@/lib/types";
import { useSession } from "@/store/session";
import { Button, Row } from "@/components/mizigo/shared/ui";
import { kes, fmtDateTimeEAT, fmtTimeEAT } from "@/lib/format";
import { toast } from "@/hooks/use-toast";
import { isRateable, RatingForm, RatingSheetHost, useRateNudge } from "./RatingSheet";
import { SystemNotifications } from "./useSystemNotifications";

export function RateScreen() {
  const { focusShipmentId, setBookingStep } = useSession();

  const { data } = useQuery({
    queryKey: ["shipment", focusShipmentId],
    queryFn: () => api<{ shipment: ShipmentDTO }>(`/api/shipments/${focusShipmentId}`),
    enabled: !!focusShipmentId,
  });
  const s = data?.shipment;

  if (!s) return <div className="h-full animate-pulse bg-[var(--surface-2)]" />;

  return (
    <div className="flex min-h-full flex-col px-6 pb-8 pt-10">
      <div className="flex flex-1 flex-col items-center justify-center text-center">
        <svg width="80" height="80" viewBox="0 0 76 76" aria-hidden="true">
          <circle cx="38" cy="38" r="36" fill="#E8F5EC" />
          <path d="M24 40 L34 50 L54 29" fill="none" stroke="#15803D" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" className="animate-mz-check" style={{ strokeDasharray: 45 }} />
        </svg>
        <h1 className="mt-4 text-[24px] font-extrabold tracking-tight">Your delivery was completed</h1>
        <div className="mt-2 w-full rounded-[12px] bg-[var(--surface)] px-4 py-3 text-left">
          <Row label="Delivered to" value={s.pod?.recipient ?? "Recipient"} />
          <Row label="Time" value={s.pod ? fmtTimeEAT(s.pod.verifiedAt) : "—"} />
          <Row label="Location" value="GPS recorded" />
        </div>
        <p className="mt-7 text-[16px] font-extrabold">How was {s.driver?.name.split(" ")[0] ?? "your delivery"}?</p>
        <div className="mt-3 w-full">
          <RatingForm shipment={s} onRated={() => setBookingStep("receipt")} />
        </div>
      </div>
      <Button variant="ghost" className="mt-4 w-full" onClick={() => setBookingStep("receipt")}>Skip</Button>
      <SystemNotifications />
    </div>
  );
}

export function ReceiptScreen() {
  const { focusShipmentId, setBookingStep, setCustomerTab, resetDraft, setFocusShipment, setTrackToken, setRatingShipment } = useSession();
  const [nudgeDismissed, dismissNudge] = useRateNudge(focusShipmentId);

  const { data } = useQuery({
    queryKey: ["shipment", focusShipmentId],
    queryFn: () => api<{ shipment: ShipmentDTO }>(`/api/shipments/${focusShipmentId}`),
    enabled: !!focusShipmentId,
  });
  const s = data?.shipment;

  if (!s) return <div className="h-full animate-pulse bg-[var(--surface-2)]" />;

  const isBusiness = !!s.customer.business;
  const net = Math.round(s.fare.total / 1.16);
  const vat = s.fare.total - net;

  const download = () => {
    const lines = [
      "MIZIGO — DELIVERY RECEIPT",
      `Delivery ${s.code}`,
      `Date: ${fmtDateTimeEAT(s.createdAt)}`,
      isBusiness ? `Billed to: ${s.customer.business}` : `Customer: ${s.customer.name}`,
      isBusiness ? "PIN: P051234567X (demo)" : "",
      "",
      `Pickup: ${s.route.pickup.name}`,
      `Drop-off: ${s.route.dropoff.name}`,
      `Vehicle: ${s.category.name}`,
      `Cargo: ${s.cargo.items.reduce((a, i) => a + i.qty, 0)} items`,
      s.driver ? `Driver: ${s.driver.name}` : "",
      "",
      s.fare.base > 0 ? `Transport: KES ${s.fare.base.toLocaleString()}` : "",
      s.fare.distance > 0 ? `Distance (${s.route.distanceKm.toFixed(1)} km): KES ${s.fare.distance.toLocaleString()}` : "",
      s.fare.duration > 0 ? `Time on road: KES ${s.fare.duration.toLocaleString()}` : "",
      s.fare.loading > 0 ? `Loading assistance: KES ${s.fare.loading.toLocaleString()}` : "",
      s.fare.stops > 0 ? `Extra stops: KES ${s.fare.stops.toLocaleString()}` : "",
      s.fare.night > 0 ? `Night transport: KES ${s.fare.night.toLocaleString()}` : "",
      s.fare.schedule > 0 ? `Planned delivery discount: -KES ${s.fare.schedule.toLocaleString()}` : "",
      s.fare.discount > 0 ? `Promo ${s.fare.promoCode}: -KES ${s.fare.discount.toLocaleString()}` : "",
      s.fare.platform > 0 ? `Platform fee: KES ${s.fare.platform.toLocaleString()}` : "",
      s.fare.returnLoad ? "Booked as a return load (empty-leg price)" : "",
      "",
      `TOTAL: KES ${s.fare.total.toLocaleString()}`,
      isBusiness ? `  (incl. VAT 16% = KES ${vat.toLocaleString()})` : "",
      "",
      `Payment: ${s.payment.method === "MPESA" ? "M-PESA" : s.payment.method}`,
      s.payment.ref ? `Receipt: ${s.payment.ref}` : "",
      `Status: ${s.payment.status === "CONFIRMED" ? "PAID" : s.payment.status}`,
    ].filter(Boolean);
    const blob = new Blob([lines.join("\n")], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `MIZIGO-RECEIPT-${s.code}.txt`;
    a.click();
    URL.revokeObjectURL(url);
    toast({ title: "Receipt downloaded", description: `${s.code} · saved to your device.` });
  };

  const share = async () => {
    // share the receipt itself (summary text) — the recipient tracking link is a
    // separate action from the trip screen; this is the money story (Uber "Resend Receipt")
    const summary = [
      `MIZIGO receipt · ${s.code}`,
      `${s.route.pickup.name} → ${s.route.dropoff.name}`,
      `${s.category.name} · ${s.cargo.items.reduce((a, i) => a + i.qty, 0)} items`,
      `Total ${kes(s.fare.total)} · ${s.payment.method === "MPESA" ? "M-PESA" : s.payment.method}${s.payment.ref ? ` · ${s.payment.ref}` : ""}`,
      s.driver ? `Driver ${s.driver.name.split(" ")[0]} · ${s.vehicle?.registration ?? ""}` : "",
    ].filter(Boolean).join("\n");
    try {
      if (navigator.share) {
        await navigator.share({ title: `MIZIGO receipt ${s.code}`, text: summary }).catch(() => {});
        toast({ title: "Receipt shared" });
      } else {
        await navigator.clipboard?.writeText(summary).catch(() => {});
        toast({ title: "Receipt copied", description: "Paste it anywhere — WhatsApp, SMS, email." });
      }
    } catch {
      toast({ title: "Could not share", variant: "destructive" });
    }
  };

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
          {isBusiness && <Row label="Billed to" value={s.customer.business ?? ""} />}
          {isBusiness && <Row label="PIN" value="P051234567X" />}
          <Row label="Pickup" value={s.route.pickup.name} />
          <Row label="Drop-off" value={s.route.dropoff.name} />
          <Row label="Vehicle" value={s.category.name} />
          <Row label="Cargo" value={`${s.cargo.items.reduce((a, i) => a + i.qty, 0)} items`} />
          {s.route.stops?.length > 0 && <Row label="Stops" value={`${s.route.stops.length} on the way`} />}
          {s.driver && <Row label="Driver" value={`${s.driver.name.split(" ")[0]} ${s.driver.name.split(" ")[1]?.[0]}.`} />}
        </div>
        <div className="mt-3 border-t border-dashed border-[var(--line)] pt-3">
          {s.fare.base > 0 && <Row label="Transport" value={kes(s.fare.base)} />}
          {s.fare.distance > 0 && <Row label={`Distance · ${s.route.distanceKm.toFixed(1)} km`} value={kes(s.fare.distance)} />}
          {s.fare.duration > 0 && <Row label="Time on road" value={kes(s.fare.duration)} />}
          {s.fare.loading > 0 && <Row label="Loading assistance" value={kes(s.fare.loading)} />}
          {s.fare.stops > 0 && <Row label="Extra stops" value={kes(s.fare.stops)} />}
          {s.fare.night > 0 && <Row label="Night transport" value={kes(s.fare.night)} />}
          {s.fare.schedule > 0 && <Row label="Planned delivery discount" value={`−${kes(s.fare.schedule)}`} />}
          {s.fare.discount > 0 && <Row label={`Promo ${s.fare.promoCode}`} value={`- ${kes(s.fare.discount)}`} />}
          {s.fare.platform > 0 && <Row label="Platform fee" value={kes(s.fare.platform)} />}
          {(() => { const r = s.ratings.find((x) => x.byRole === "CUSTOMER"); return r?.tip ? <Row label="Driver tip · 100% to the driver" value={kes(r.tip)} /> : null; })()}
          {isBusiness && <Row label="VAT (16% incl.)" value={kes(vat)} />}
        </div>
        <div className="mt-3 flex items-baseline justify-between border-t-2 border-[var(--ink)] pt-3">
          <span className="text-[15px] font-extrabold">TOTAL</span>
          <span className="tnum text-[24px] font-extrabold tracking-tight">{kes(s.fare.total)}</span>
        </div>
        <div className="mt-3 rounded-[10px] bg-[var(--surface-2)] px-4 py-3">
          <Row label="Payment" value={s.payment.method === "MPESA" ? "M-PESA" : s.payment.method} />
          {s.payment.ref && <Row label="Receipt" value={s.payment.ref} />}
          <Row label="Status" value={s.payment.status === "CONFIRMED" ? "PAID" : s.payment.status} strong />
          {s.payment.status === "REFUNDED" && (
            <>
              <Row label="Refunded" value={kes(s.payment.refundKes ?? 0)} strong />
              {(s.payment.cancelFeeKes ?? 0) > 0 && <Row label="Cancellation fee withheld" value={kes(s.payment.cancelFeeKes)} />}
            </>
          )}
        </div>
        {s.pod && (
          <div className="mt-3 rounded-[10px] border border-[var(--line)] px-4 py-3">
            <p className="text-[11px] font-extrabold uppercase tracking-widest text-[var(--ink-3)]">Proof of delivery</p>
            <div className="mt-1">
              <Row label="Received by" value={s.pod.recipient} />
              <Row label="Time" value={fmtDateTimeEAT(s.pod.verifiedAt)} />
              <Row label="Evidence" value={s.pod.photo ? "Photo + GPS + code" : "GPS + delivery code"} />
            </div>
          </div>
        )}
        <p className="mt-3 text-center text-[11px] font-medium text-[var(--ink-3)]">
          {s.customer.business ? "VAT invoice available for business accounts · " : ""}
          Proof of delivery attached to this receipt
        </p>
      </div>

      {/* unrated delivery → one dismissable nudge, then a persistent compact entry */}
      {isRateable(s) &&
        (nudgeDismissed ? (
          <button
            onClick={() => setRatingShipment(s.id)}
            className="mt-4 flex w-full items-center justify-center gap-1.5 rounded-[12px] border border-[var(--line)] bg-[var(--surface)] py-3.5 text-[13.5px] font-bold text-[var(--brand-deep)] transition hover:bg-[var(--brand-soft)]"
          >
            <Star size={15} /> Rate your driver
          </button>
        ) : (
          <div className="mt-4 rounded-[14px] border-2 border-[var(--brand)] bg-[var(--brand-soft)] p-4">
            <div className="flex items-start gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[var(--brand)] text-white" aria-hidden="true">
                <Star size={17} />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-[14px] font-extrabold text-[var(--brand-ink)]">Rate {s.driver?.name.split(" ")[0] ?? "your driver"}</p>
                <p className="text-[12px] font-medium leading-snug text-[var(--ink-2)]">How was this delivery? Your feedback keeps the network honest.</p>
              </div>
              <button onClick={dismissNudge} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[var(--ink-3)] transition hover:bg-[var(--surface-2)]" aria-label="Dismiss rating reminder">
                <X size={15} />
              </button>
            </div>
            <Button variant="brand" className="mt-3 h-12 w-full text-[14px]" onClick={() => setRatingShipment(s.id)}>
              Rate your driver
            </Button>
          </div>
        ))}

      <div className="mt-4 grid grid-cols-2 gap-2.5">
        <Button variant="outline" onClick={download}>
          <Download size={16} /> Download
        </Button>
        <Button variant="outline" onClick={() => void share()}>
          Share receipt
        </Button>
      </div>
      <Button variant="brand" className="mt-3 w-full" onClick={close}>
        Done
      </Button>

      <RatingSheetHost />
      <SystemNotifications />
    </div>
  );
}
