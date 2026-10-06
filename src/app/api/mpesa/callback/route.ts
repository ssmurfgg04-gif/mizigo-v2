// POST /api/mpesa/callback — Safaricom Daraja STK result webhook.
//
// INERT/SAFE BY DESIGN: with no DARAJA_* keys configured nothing in the app
// ever registers this URL with Safaricom, so in the sandbox this endpoint only
// ever sees probes (curl/tests) — it answers them with the Daraja-mandated
// 200 acknowledgement and logs, without touching any state it can't resolve.
//
// Contract (Daraja docs): we MUST always reply HTTP 200 with
// {"ResultCode": 0, "ResultDesc": "Accepted"} — anything else makes Daraja
// retry forever. Business failures are handled internally, never via status.
//
// Resolution order for CheckoutRequestID → shipment:
//   1. in-memory map (src/lib/integrations — fast path, this instance)
//   2. PaymentEvent.checkoutReqId (durable; carries the real Daraja id once
//      the pay action is wired to initiateMpesaPayment — see integrations docs)
//   3. neither → orphan callback: LOG ONLY + 200 (Daraja requires the ack;
//      a cold map after a restart is expected and harmless in the demo).
//
// Idempotency: duplicate/late callbacks for an already-CONFIRMED payment are
// detected (atomic updateMany claim returns 0) and acknowledged without
// re-running the transition — same race-safety as the pay-confirm action.

import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { ensureDB } from "@/lib/db-ready";
import { applyTransition } from "@/lib/shipments";
import { clearCheckout, getPendingCheckout } from "@/lib/integrations";

export const dynamic = "force-dynamic";

interface DarajaCallbackItem {
  Name?: string;
  Value?: string | number;
}

interface DarajaCallbackBody {
  Body?: {
    stkCallback?: {
      MerchantRequestID?: string;
      CheckoutRequestID?: string;
      ResultCode?: number;
      ResultDesc?: string;
      CallbackMetadata?: { Item?: DarajaCallbackItem[] };
    };
  };
}

/** The ack Daraja requires — always 200, always this shape. */
const ACK = { ResultCode: 0, ResultDesc: "Accepted" } as const;

export async function POST(req: Request) {
  let parsed: DarajaCallbackBody = {};
  try {
    parsed = (await req.json()) as DarajaCallbackBody;
  } catch {
    // not JSON — not from Daraja; ack anyway (reveals nothing, keeps contract)
    console.warn("[mpesa-callback] received a non-JSON body — ignored");
    return NextResponse.json(ACK);
  }

  const cb = parsed.Body?.stkCallback;
  if (!cb?.CheckoutRequestID) {
    console.warn("[mpesa-callback] payload without Body.stkCallback.CheckoutRequestID — ignored");
    return NextResponse.json(ACK);
  }

  const checkoutId = String(cb.CheckoutRequestID);
  const resultCode = Number(cb.ResultCode);
  const resultDesc = String(cb.ResultDesc ?? "");
  const items = cb.CallbackMetadata?.Item ?? [];
  const meta = (name: string): string | undefined => {
    const hit = items.find((i) => i.Name === name);
    return hit?.Value != null ? String(hit.Value) : undefined;
  };
  const receipt = meta("MpesaReceiptNumber");
  const amount = meta("Amount");
  const phone = meta("PhoneNumber");

  // ── resolve the shipment this callback belongs to ──
  const pendingFromMap = getPendingCheckout(checkoutId);
  let shipmentId = pendingFromMap?.shipmentId ?? null;
  if (!shipmentId) {
    // durable path: the PaymentEvent row (once the pay action writes real ids)
    try {
      const ev = await db.paymentEvent.findUnique({
        where: { checkoutReqId: checkoutId },
        select: { shipmentId: true, status: true },
      });
      if (ev) shipmentId = ev.shipmentId;
    } catch (err) {
      console.error("[mpesa-callback] PaymentEvent lookup failed", err);
    }
  }

  if (!shipmentId) {
    // Cold map (server restarted / different instance) or a probe. Log for
    // reconciliation and ack — Daraja must not see a failure.
    console.warn(
      `[mpesa-callback] orphan callback · CheckoutRequestID ${checkoutId} · ResultCode ${resultCode} (${resultDesc}) — no shipment tracked; when live, ensure the pay action writes the real CheckoutRequestID to PaymentEvent (see src/lib/integrations docs)`
    );
    return NextResponse.json(ACK);
  }

  try {
    if (resultCode === 0) {
      // ── payment succeeded: same server-side transition as pay-confirm ──
      // atomic claim on the PENDING PaymentEvent (exactly one winner; a
      // replayed callback or a racing pay-confirm sees count 0 → idempotent)
      const claimed = await db.paymentEvent.updateMany({
        where: { checkoutReqId: checkoutId, status: "PENDING" },
        data: { status: "CONFIRMED", mpesaReceipt: receipt ?? null },
      });
      if (!claimed.count) {
        console.log(`[mpesa-callback] ${checkoutId} already confirmed (idempotent replay) — acknowledged`);
        clearCheckout(checkoutId);
        return NextResponse.json(ACK);
      }
      await db.shipment.update({
        where: { id: shipmentId },
        data: { paymentStatus: "CONFIRMED", paymentRef: receipt ?? null, paidAt: new Date() },
      });
      const t = await applyTransition(shipmentId, "payment-confirmed", "SYSTEM", {
        label: `Payment confirmed · M-PESA ${receipt ?? checkoutId}`,
      });
      if (!t.ok) {
        // e.g. the customer cancelled while the PIN dialog was open — the
        // money conversation continues off-band; never fail the ack.
        console.error(`[mpesa-callback] ${checkoutId} confirmed but transition rejected: ${t.error}`);
      } else {
        console.log(`[mpesa-callback] ${checkoutId} → shipment ${shipmentId} CONFIRMED · receipt ${receipt ?? "—"} · KES ${amount ?? "?"} · ${phone ?? ""}`);
      }
      clearCheckout(checkoutId);
      return NextResponse.json(ACK);
    }

    // ── customer cancelled / wrong PIN / timeout: mark the attempt FAILED ──
    const failed = await db.paymentEvent.updateMany({
      where: { checkoutReqId: checkoutId, status: "PENDING" },
      data: { status: "FAILED" },
    });
    console.log(
      `[mpesa-callback] ${checkoutId} FAILED (ResultCode ${resultCode}: ${resultDesc}) · shipment ${shipmentId} · marked ${failed.count ? "FAILED" : "already terminal"}`
    );
    clearCheckout(checkoutId);
    return NextResponse.json(ACK);
  } catch (err) {
    // DB/transient error — Daraja retries on non-200, but a 5xx would also
    // alarm; ack + log so reconciliation (cron) can pick it up.
    console.error("[mpesa-callback] handler error", err);
    return NextResponse.json(ACK);
  }
}
