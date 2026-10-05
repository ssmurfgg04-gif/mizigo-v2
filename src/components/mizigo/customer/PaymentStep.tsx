"use client";
// Payment step — M-Pesa STK-push simulation (Daraja-shaped, sandbox).
// Creates the shipment (idempotent), initiates payment, simulates the phone
// prompt, and confirms server-side. Cash skips straight to matching.
// Quote-marketplace bookings arrive here with the shipment already created
// and the fare locked to the accepted quote.

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, Smartphone } from "lucide-react";
import { post, api } from "@/lib/api-client";
import type { ShipmentDTO } from "@/lib/types";
import { useSession } from "@/store/session";
import { Button, Row } from "@/components/mizigo/shared/ui";
import { kes } from "@/lib/format";
import { toast } from "@/hooks/use-toast";

export default function PaymentStep() {
  const { draft, user, setBookingStep, setFocusShipment, focusShipmentId } = useSession();
  const [phase, setPhase] = useState<"review" | "stk" | "pin" | "confirming" | "done">("review");
  const [shipment, setShipment] = useState<ShipmentDTO | null>(null);
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);

  // quote-mode: the shipment exists already (fare locked to the accepted quote)
  const { data: existing } = useQuery({
    queryKey: ["shipment", focusShipmentId, "pay"],
    queryFn: () => api<{ shipment: ShipmentDTO }>(`/api/shipments/${focusShipmentId}`),
    enabled: !!focusShipmentId && draft.quoteMode,
  });

  const initPayment = async () => {
    if (!user || !draft.selectedVehicle) return;
    setBusy(true);
    try {
      let s = shipment;
      if (!s) {
        if (draft.quoteMode && existing?.shipment && existing.shipment.status === "PAYMENT_PENDING") {
          s = existing.shipment;
        } else {
          // create (idempotent by draftId) then pay
          const created = await post<{ shipment: ShipmentDTO }>("/api/shipments", {
            draftId: draft.draftId, customerId: user.id,
            pickup: draft.pickup, dropoff: draft.dropoff,
            stops: draft.stops.map((st) => ({ name: st.name, lat: st.lat, lng: st.lng })),
            cargo: { category: draft.category, items: draft.items, load: draft.load, helpers: draft.helpers, special: draft.special, notes: draft.notes },
            categoryKey: draft.selectedVehicle, paymentMethod: draft.paymentMethod,
            scheduledAt: draft.when === "SCHEDULE" ? draft.scheduledAt : null,
            promoCode: draft.promoCode || undefined,
          });
          s = created.shipment;
        }
        setShipment(s);
        setFocusShipment(s.id);
      }

      if (draft.paymentMethod === "CASH") {
        const req = await post(`/api/shipments/${s.id}/action`, { action: "request", actor: "CUSTOMER" });
        setBookingStep("matching");
        return;
      }
      await post(`/api/shipments/${s.id}/action`, { action: "pay" });
      setPhase("stk");
    } catch (e) {
      toast({ title: "Couldn't start payment", description: (e as Error).message, variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  const openPin = () => setPhase("pin");

  const confirmPin = async () => {
    if (pin.replace(/\D/g, "").length !== 4) {
      toast({ title: "Enter your 4-digit M-PESA PIN" });
      return;
    }
    setPhase("confirming");
    try {
      const r = await post<{ receipt: string }>(`/api/shipments/${shipment!.id}/action`, { action: "pay-confirm", pin });
      setPhase("done");
      toast({ title: "Payment confirmed", description: `M-PESA receipt ${r.receipt}` });
      setTimeout(() => setBookingStep("matching"), 3000);
    } catch (e) {
      setPhase("stk");
      toast({ title: "Payment failed", description: (e as Error).message, variant: "destructive" });
    }
  };

  return (
    <div className="flex min-h-full flex-col">
      {phase === "review" && (
        <div className="space-y-4">
          <div className="rounded-[16px] border border-[var(--line)] bg-[var(--surface)] p-4">
            <p className="text-[14.5px] font-extrabold">Paying with {draft.paymentMethod === "MPESA" ? "M-PESA" : draft.paymentMethod === "CASH" ? "cash" : "card"}</p>
            <p className="mt-1 text-[13px] font-medium text-[var(--ink-2)]">
              {draft.paymentMethod === "MPESA"
                ? `We'll send a payment request to ${user?.phone ? `0${user.phone.slice(1)}` : "your phone"}. Check your phone and enter your PIN.`
                : "You'll pay the driver when the delivery is completed."}
            </p>
            {draft.quoteMode && existing?.shipment && (
              <div className="mt-2.5 rounded-[10px] bg-[var(--surface-2)] px-3.5 py-2.5">
                <Row label="Accepted quote" value={kes(existing.shipment.fare.total)} strong />
                <Row label="Delivery" value={existing.shipment.code} />
              </div>
            )}
          </div>
          <Button variant="brand" className="w-full" onClick={initPayment} loading={busy}>
            {draft.paymentMethod === "MPESA" ? "Pay with M-PESA" : "Request vehicle"}
          </Button>
        </div>
      )}

      {(phase === "stk" || phase === "pin" || phase === "confirming") && shipment && (
        <div className="flex flex-1 flex-col items-center justify-center gap-6 py-10 text-center">
          <div className="relative">
            <span className="absolute inset-0 animate-mz-radar rounded-full bg-[var(--brand)] opacity-20" />
            <div className="flex h-20 w-20 items-center justify-center rounded-full bg-[var(--brand-soft)] text-[var(--brand-deep)]">
              <Smartphone size={34} strokeWidth={2} />
            </div>
          </div>
          <div>
            <p className="text-[19px] font-extrabold tracking-tight">Check your phone</p>
            <p className="mt-1.5 max-w-[280px] text-[13.5px] font-medium leading-relaxed text-[var(--ink-2)]">
              We sent an M-PESA request for <span className="tnum font-bold text-[var(--ink)]">{kes(shipment.fare.total)}</span> to your number.
              Enter your PIN to authorise.
            </p>
          </div>

          {phase === "stk" && (
            <div className="w-full max-w-[300px]">
              <Button variant="brand" className="w-full" onClick={openPin}>
                Simulate phone prompt
              </Button>
              <button onClick={() => setPhase("review")} className="mt-2.5 w-full text-[12.5px] font-bold text-[var(--ink-3)] underline underline-offset-4">
                Back — pay another way
              </button>
            </div>
          )}

          {phase === "pin" && (
            <div className="w-full max-w-[300px] animate-mz-slide-up">
              {/* sandbox stand-in for the native M-PESA prompt */}
              <div className="rounded-[16px] bg-[var(--ink)] p-4 text-left text-white brand-shadow">
                <div className="flex items-center justify-between text-[12px] font-bold">
                  <span>M-PESA</span><span className="text-white/50">SANDBOX</span>
                </div>
                <p className="mt-2 text-[12.5px] font-medium leading-relaxed">
                  Enter M-PESA PIN to pay <span className="tnum font-bold">{kes(shipment.fare.total)}</span> to MIZIGO for delivery {shipment.code}.
                </p>
                <input
                  value={pin}
                  onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 4))}
                  type="password"
                  inputMode="numeric"
                  placeholder="••••"
                  className="tnum mt-3 h-12 w-full rounded-[8px] bg-white/10 text-center text-[20px] font-extrabold tracking-[0.4em] outline-none placeholder:text-white/30"
                  aria-label="M-PESA PIN"
                  autoFocus
                />
                <div className="mt-3 flex gap-2">
                  <button onClick={() => setPhase("stk")} className="h-11 flex-1 rounded-[8px] bg-white/10 text-[13px] font-bold">CANCEL</button>
                  <button onClick={confirmPin} className="h-11 flex-1 rounded-[8px] bg-[var(--brand-deep)] text-[13px] font-extrabold">OK</button>
                </div>
              </div>
              <p className="mt-3 text-[11.5px] font-semibold text-[var(--ink-3)]">Sandbox only · no real money moves</p>
            </div>
          )}

          {phase === "confirming" && (
            <p className="text-[13.5px] font-semibold text-[var(--ink-2)]">Confirming with Safaricom…</p>
          )}
        </div>
      )}

      {phase === "done" && shipment && (
        <div className="flex flex-1 flex-col items-center justify-center gap-5 py-10 text-center">
          <svg width="76" height="76" viewBox="0 0 76 76" aria-hidden="true">
            <circle cx="38" cy="38" r="36" fill="#E8F5EC" />
            <path d="M24 40 L34 50 L54 29" fill="none" stroke="#15803D" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" className="animate-mz-check" style={{ strokeDasharray: 45 }} />
          </svg>
          <div>
            <p className="text-[20px] font-extrabold tracking-tight">Payment confirmed</p>
            <p className="tnum mt-1 text-[16px] font-extrabold text-[var(--success)]">{kes(shipment.fare.total)}</p>
            <p className="mt-1.5 text-[13px] font-semibold text-[var(--ink-2)]">Finding your vehicle…</p>
          </div>
          <div className="w-full max-w-[300px] rounded-[12px] bg-[var(--surface)] p-4 text-left">
            <Row label="M-PESA receipt" value={shipment.payment.ref ?? "—"} />
            <Row label="Delivery" value={shipment.code} strong />
          </div>
        </div>
      )}
    </div>
  );
}
