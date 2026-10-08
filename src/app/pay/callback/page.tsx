"use client";
// /pay/callback — the browser return URL from Paystack checkout (§c.1).
// Paystack appends ?reference=…&trxref=… and we pass ?shipment=<id>. This page
// only proves the customer RETURNED — the money truth comes from the verify
// call and the webhook. We poll pay-verify (2s delay × 3 retries, the
// rn-checkout-server cadence) while M-Pesa is still processing, then send the
// customer back into the app.

import { useEffect, useRef, useState } from "react";
import { Button, Logo } from "@/components/mizigo/shared/ui";

type Phase = "verifying" | "paid" | "processing" | "failed";

export default function PayCallbackPage() {
  const [phase, setPhase] = useState<Phase>("verifying");
  const [attempt, setAttempt] = useState(0);
  const shipmentRef = useRef<string | null>(null);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const sp = new URLSearchParams(window.location.search);
    const shipment = sp.get("shipment");
    shipmentRef.current = shipment;
    if (!shipment) {
      setPhase("failed");
      return;
    }
    let cancelled = false;
    const call = async (payload: Record<string, unknown>) => {
      const res = await fetch(`/api/shipments/${shipment}/action`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "include",
        body: JSON.stringify(payload),
      });
      return { status: res.status, json: (await res.json().catch(() => ({}))) as { ok?: boolean; alreadyPaid?: boolean; error?: string } };
    };
    const verify = async (tryNo: number) => {
      try {
        const { status, json } = await call({ action: "pay-verify" });
        if (cancelled) return;
        if (status === 200 && (json.ok || json.alreadyPaid)) {
          setPhase("paid");
          // the customer paid to get a vehicle — kick off matching so the home
          // screen opens straight onto a live "finding your vehicle" card
          void call({ action: "request", actor: "CUSTOMER" }).catch(() => null);
          return;
        }
        // 202 = Paystack still processing the M-Pesa charge — retry
        if ((status === 202 || status === 502 || status === 503) && tryNo < 3) {
          setAttempt(tryNo + 1);
          setTimeout(() => void verify(tryNo + 1), 2000);
          return;
        }
        if (status === 409) {
          setPhase("failed");
          return;
        }
        // paid later by the webhook — let the customer in, the app shows truth
        setPhase("processing");
      } catch {
        if (!cancelled) setPhase("processing");
      }
    };
    void verify(0);
    return () => { cancelled = true; };
  }, []);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-[var(--paper)] px-6 text-center">
      <Logo size="lg" />
      <div className="mt-8 w-full max-w-sm rounded-[18px] border border-[var(--line)] bg-[var(--surface)] p-6 sheet-shadow">
        {phase === "verifying" && (
          <>
            <div className="mx-auto h-8 w-8 animate-spin rounded-full border-[3px] border-[var(--line)] border-t-[var(--ink)]" aria-hidden="true" />
            <h1 className="mt-4 text-[18px] font-extrabold tracking-tight">Confirming your payment…</h1>
            <p className="mt-1 text-[13.5px] font-medium text-[var(--ink-2)]">
              Checking M-PESA {attempt > 0 ? `(attempt ${attempt + 1} of 4)` : ""} — this takes a few seconds.
            </p>
          </>
        )}
        {phase === "paid" && (
          <>
            <h1 className="text-[20px] font-extrabold tracking-tight">Payment received</h1>
            <p className="mt-1 text-[13.5px] font-medium text-[var(--ink-2)]">Your delivery is booked. A receipt is waiting in the app.</p>
            <Button className="mt-5 w-full" onClick={() => { window.location.href = "/"; }}>Back to your delivery</Button>
          </>
        )}
        {phase === "processing" && (
          <>
            <h1 className="text-[20px] font-extrabold tracking-tight">Almost there</h1>
            <p className="mt-1 text-[13.5px] font-medium text-[var(--ink-2)]">
              M-PESA is still confirming. Your delivery updates automatically the moment it lands — nothing to do.
            </p>
            <Button variant="outline" className="mt-5 w-full" onClick={() => { window.location.href = "/"; }}>Open the app</Button>
          </>
        )}
        {phase === "failed" && (
          <>
            <h1 className="text-[20px] font-extrabold tracking-tight">Payment not completed</h1>
            <p className="mt-1 text-[13.5px] font-medium text-[var(--ink-2)]">
              No money has left your account. You can try again from the delivery screen.
            </p>
            <Button variant="brand" className="mt-5 w-full" onClick={() => { window.location.href = "/"; }}>Try again</Button>
          </>
        )}
      </div>
      <p className="mt-5 text-[11.5px] font-medium text-[var(--ink-3)]">Mizigo · Nairobi, Kenya</p>
    </div>
  );
}
