// MIZIGO — integrations adapter (the single seam between the app and providers).
//
// This module is the DOCUMENTED WIRING POINT for going live with real M-PESA.
// Everything here is inert while provider keys are absent: the demo keeps its
// simulated STK flow (pay/pay-confirm in /api/shipments/[id]/action) and the
// only thing this module does is answer "not configured" — zero network I/O.
//
// ─────────────────────────────────────────────────────────────────────────────
// HOW TO GO LIVE (the ~5-line wiring, deliberately left unwired for the demo)
// ─────────────────────────────────────────────────────────────────────────────
// 1. Set the Daraja env vars (DARAJA_ENV, DARAJA_CONSUMER_KEY,
//    DARAJA_CONSUMER_SECRET, DARAJA_SHORTCODE, DARAJA_PASSKEY,
//    DARAJA_CALLBACK_URL=https://mizigo.netlify.app/api/mpesa/callback).
//
// 2. In src/app/api/shipments/[id]/action/route.ts, action "pay" (owned by
//    task 10-C — do not edit without coordinating), replace the mock id with:
//
//      import { initiateMpesaPayment } from "@/lib/integrations";
//      // …after the PaymentEvent PENDING row is created:
//      const init = await initiateMpesaPayment(
//        { id: s.id, code: s.code }, s.pickupPhone ?? customerPhone, s.fareTotal
//      );
//      const checkoutReqId = init.mode === "LIVE" && init.ok
//        ? init.checkoutRequestId
//        : `ws_CO_${s.code}_${Date.now()}`;   // sandbox fallback (current line)
//
//    That single swap makes the PaymentEvent row carry the REAL Daraja
//    CheckoutRequestID, so /api/mpesa/callback resolves the shipment from the
//    DB even after a server restart (see resolveCheckout below).
//
// 3. (Recommended before production) add a `PaymentCallback` Prisma model to
//    replace the in-memory map below — the map is per-instance and lost on
//    restart; a table survives restarts AND multi-instance deploys:
//
//      model PaymentCallback {
//        id                String   @id @default(cuid())
//        checkoutRequestId String   @unique
//        merchantRequestId String?
//        shipmentId        String
//        amount            Int
//        phone             String?
//        status            String   @default("PENDING") // PENDING|RECEIVED|FAILED
//        resultCode        String?
//        resultDesc        String?
//        mpesaReceipt      String?
//        createdAt         DateTime @default(now())
//        receivedAt        DateTime?
//      }
//
//    (Prisma schema is owned by task 10-E — coordinate before adding.)
//    Until then the map + PaymentEvent lookup below is correct for the
//    single-instance demo and degrades gracefully (logged orphan callback).
//
// 4. Netlify scheduled function for /api/cron — see the report/netlify snippet
//    (cron route docs). Requires CRON_SECRET in env.
//
// 5. Client-side Sentry: set NEXT_PUBLIC_SENTRY_DSN and mount
//    src/components/mizigo/shared/SentryBridge.tsx (currently unmounted).
// ─────────────────────────────────────────────────────────────────────────────

import { isDarajaEnabled, stkPush, toMsisdn, type StkPushResult } from "./daraja";
import { hydrateRuntimeSecrets } from "@/lib/runtime-secrets";

export { isDarajaEnabled, stkPush, stkQuery, darajaConfig, toMsisdn } from "./daraja";
export { isAtEnabled, sendSMS } from "./africastalking";

// ─────────────────────────────────────────────────────────────────────────────
// CheckoutRequestID → shipment tracking (until the PaymentCallback table)
// ─────────────────────────────────────────────────────────────────────────────

export interface PendingCheckout {
  shipmentId: string;
  shipmentCode: string;
  amount: number;
  phone: string;
  merchantRequestId?: string;
  createdAt: number; // epoch ms
}

/**
 * In-memory CheckoutRequestID → {shipmentId, amount} registry.
 * PRAGMA: module-level, per-instance, pruned aggressively. When Daraja is live
 * the PaymentEvent.checkoutReqId column (unique) is the durable copy — this map
 * only accelerates callback resolution and must never be the sole source of
 * truth in production (see the PaymentCallback model note above).
 */
const pendingCheckouts = new Map<string, PendingCheckout>();

const MAP_MAX = 500;
const MAP_TTL_MS = 24 * 60 * 60_000;

function trackCheckout(checkoutRequestId: string, entry: PendingCheckout): void {
  // hygiene: drop stale entries, then hard-cap
  const now = Date.now();
  for (const [k, v] of pendingCheckouts) {
    if (now - v.createdAt > MAP_TTL_MS) pendingCheckouts.delete(k);
  }
  if (pendingCheckouts.size >= MAP_MAX) {
    const oldest = pendingCheckouts.keys().next().value;
    if (oldest !== undefined) pendingCheckouts.delete(oldest);
  }
  pendingCheckouts.set(checkoutRequestId, entry);
}

/** Lookup for the callback route (map hit) — null when unknown/cold. */
export function getPendingCheckout(checkoutRequestId: string): PendingCheckout | null {
  return pendingCheckouts.get(checkoutRequestId) ?? null;
}

/** Remove after the callback resolves (or the push times out). */
export function clearCheckout(checkoutRequestId: string): void {
  pendingCheckouts.delete(checkoutRequestId);
}

// ─────────────────────────────────────────────────────────────────────────────
// initiateMpesaPayment — the adapter the pay action will call at go-live
// ─────────────────────────────────────────────────────────────────────────────

/** Minimal shipment shape the adapter needs (works with the full Prisma row). */
export interface MpesaPaymentShipment {
  id: string;
  code: string;
}

export type MpesaInitResult =
  /** Daraja keys absent — caller should keep the current sandbox simulation. */
  | { mode: "INERT"; reason: "daraja-not-configured" }
  /** Keys present: a real STK push was attempted. */
  | ({ mode: "LIVE" } & StkPushResult);

/**
 * Start a real M-PESA STK push for a shipment. INERT (no network call) unless
 * Daraja is configured; LIVE attempts the push and records the CheckoutRequestID.
 * Never throws — every failure is caught inside daraja.stkPush and returned.
 *
 * @example // go-live wiring in the "pay" action (see file header):
 * const init = await initiateMpesaPayment({ id: s.id, code: s.code }, phone, s.fareTotal);
 */
export async function initiateMpesaPayment(
  shipment: MpesaPaymentShipment,
  phone: string,
  amount: number
): Promise<MpesaInitResult> {
  // the DARAJA_* keys may live in the Supabase Vault rather than Netlify env
  // (runtime-secrets pattern) — make them visible before the enabled check
  await hydrateRuntimeSecrets();
  if (!isDarajaEnabled()) {
    return { mode: "INERT", reason: "daraja-not-configured" };
  }
  const res = await stkPush({
    amount,
    phone,
    accountRef: shipment.code, // e.g. MZG-482913 on the customer's statement
    description: `MIZIGO ${shipment.code}`,
  });
  if (res.ok) {
    trackCheckout(res.CheckoutRequestID, {
      shipmentId: shipment.id,
      shipmentCode: shipment.code,
      amount: Math.max(1, Math.round(amount)),
      phone: toMsisdn(phone),
      merchantRequestId: res.MerchantRequestID,
      createdAt: Date.now(),
    });
  }
  return { mode: "LIVE", ...res };
}
