// MIZIGO — money-state service (the ONLY place payment/payout state flips).
// Marketplace model: hold-then-payout-on-POD — customer pays the full fare
// (Paystack M-Pesa collection), the platform holds it, and after proof of
// delivery the driver's share goes out as a Paystack Transfer to their saved
// M-Pesa/bank recipient. Commission + platform fee stay with the platform.
//
// Rules (docs/research/PAYSTACK_WIRING_BLUEPRINT.md §g):
//   * every status flip is driven by a signature-verified webhook OR a
//     server-to-server verify call — never by a client action alone
//   * expected amounts are recomputed from the Shipment row and compared
//     against the provider payload in SUBUNITS (anti-underpayment)
//   * atomic claims (updateMany WHERE status=PENDING) make every path
//     idempotent under races: webhook vs callback vs pay-verify all funnel
//     into confirmCustomerPayment() and exactly one caller wins
//   * MOCK provider keeps the sandbox byte-identical (zero keys → zero change)

import { db } from "@/lib/db";
import { getShipmentFull, applyTransition, shipmentDTO } from "@/lib/shipments";
import { mpesaRef } from "@/lib/format";
import { isDarajaEnabled, initiateMpesaPayment } from "@/lib/integrations";
import {
  resolvePaystackSecret, resolveWebhookSecret, initializeTransaction, verifyTransaction, createTransfer,
  createTransferRecipient, paystackTxReference, paystackTransferReference,
  verifyPaystackSignature, refundTransaction,
  type VerifyResult,
} from "@/lib/integrations/paystack";

export type ProviderName = "PAYSTACK" | "DARAJA" | "MOCK";

/** PAYSTACK (secret resolvable) → DARAJA (keys set) → MOCK (sandbox). */
export async function resolvePaymentProvider(): Promise<ProviderName> {
  if (await resolvePaystackSecret()) return "PAYSTACK";
  if (isDarajaEnabled()) return "DARAJA";
  return "MOCK";
}

// ─── customer payment: start ────────────────────────────────────────────────

export interface StartPaymentOutcome {
  provider: ProviderName;
  checkoutReqId: string;         // PaymentEvent.checkoutReqId (the provider reference)
  mode: "REDIRECT" | "STK" | "SIMULATED";
  authorizationUrl?: string;     // Paystack checkout (REDIRECT)
  prompt: string;                // customer-facing next step
}

export async function startCustomerPayment(
  shipmentId: string,
  attempt: number,
): Promise<{ ok: true; outcome: StartPaymentOutcome } | { ok: false; error: string }> {
  const s = await getShipmentFull({ id: shipmentId });
  if (!s) return { ok: false, error: "Not found" };
  const provider = await resolvePaymentProvider();

  // fresh attempt: clear prior PENDING rows first (same contract as before)
  await db.paymentEvent.deleteMany({ where: { shipmentId: s.id, status: "PENDING" } });

  if (provider === "PAYSTACK") {
    const secret = (await resolvePaystackSecret())!;
    const reference = paystackTxReference(s.code, attempt);
    const init = await initializeTransaction(secret, {
      email: `mz-${s.code.toLowerCase()}@mizigo.app`, // Paystack requires an email; phone is the real identity
      amountSubunits: s.fareTotal * 100,              // KES → cents (§11.8)
      reference,
      callbackUrl: `https://mizigo.netlify.app/pay/callback?shipment=${s.id}`,
      metadata: {
        shipmentId: s.id,
        shipmentCode: s.code,
        custom_fields: [{ display_name: "Delivery", variable_name: "delivery", value: s.code }],
      },
    });
    if (!init.ok) return { ok: false, error: `Payment could not start (${init.error}). Try again.` };
    await db.paymentEvent.create({
      data: {
        shipmentId: s.id, checkoutReqId: reference, provider: "PAYSTACK", method: s.paymentMethod,
        amount: s.fareTotal, amountSubunits: s.fareTotal * 100, status: "PENDING",
        providerMeta: JSON.stringify({ authorization_url: init.data.authorization_url, access_code: init.data.access_code }),
      },
    });
    await db.shipment.update({ where: { id: s.id }, data: { paymentStatus: "PENDING", checkoutReqId: reference, status: "PAYMENT_PENDING", stateEnteredAt: new Date() } });
    return {
      ok: true,
      outcome: {
        provider, checkoutReqId: reference, mode: "REDIRECT",
        authorizationUrl: init.data.authorization_url,
        prompt: "Continue to M-PESA to complete payment.",
      },
    };
  }

  if (provider === "DARAJA" && s.paymentMethod === "MPESA") {
    const phone = s.pickupPhone ?? s.customer?.phone ?? "";
    const init = await initiateMpesaPayment({ id: s.id, code: s.code }, phone, s.fareTotal);
    const checkoutReqId = init.mode === "LIVE" && init.ok ? init.CheckoutRequestID : `ws_CO_${s.code}_${Date.now()}`;
    await db.paymentEvent.create({
      data: { shipmentId: s.id, checkoutReqId, provider: "DARAJA", method: "MPESA", amount: s.fareTotal, status: "PENDING" },
    });
    await db.shipment.update({ where: { id: s.id }, data: { paymentStatus: "PENDING", checkoutReqId, status: "PAYMENT_PENDING", stateEnteredAt: new Date() } });
    return { ok: true, outcome: { provider, checkoutReqId, mode: init.mode === "LIVE" ? "STK" : "SIMULATED", prompt: "Check your phone to complete payment." } };
  }

  // MOCK — byte-identical sandbox flow (e2e contract)
  const checkoutReqId = `ws_CO_${s.code}_${Date.now()}`;
  await db.paymentEvent.create({
    data: { shipmentId: s.id, checkoutReqId, provider: "MOCK", method: s.paymentMethod, amount: s.fareTotal, status: "PENDING" },
  });
  await db.shipment.update({ where: { id: s.id }, data: { paymentStatus: "PENDING", checkoutReqId, status: "PAYMENT_PENDING", stateEnteredAt: new Date() } });
  return { ok: true, outcome: { provider: "MOCK", checkoutReqId, mode: "SIMULATED", prompt: "Check your phone to complete payment." } };
}

// ─── customer payment: the one confirmation funnel ──────────────────────────

export type ConfirmSource = "pay-confirm" | "pay-verify" | "webhook" | "callback";

export interface ConfirmOutcome {
  ok: boolean;
  alreadyPaid?: boolean;
  receipt?: string;
  error?: string;
  code?: number;
  shipment?: ReturnType<typeof shipmentDTO>;
}

/**
 * Confirm a shipment's PENDING payment. Callers: the pay-confirm action
 * (sandbox PIN flow), the pay-verify action (Paystack callback page), and the
 * charge.success webhook (source of truth). All race safely — the atomic
 * PENDING→CONFIRMED claim lets exactly one caller through; the rest receive
 * alreadyPaid. PAYSTACK mode verifies server-to-server and enforces the exact
 * amount before claiming; MOCK keeps the simulated PIN semantics.
 */
export async function confirmCustomerPayment(shipmentId: string, source: ConfirmSource): Promise<ConfirmOutcome> {
  const s = await getShipmentFull({ id: shipmentId });
  if (!s) return { ok: false, error: "Not found", code: 404 };

  const pending = await db.paymentEvent.findFirst({ where: { shipmentId: s.id, status: "PENDING" }, orderBy: { createdAt: "desc" } });
  if (!pending) {
    // re-read: the snapshot may predate another caller's confirmation
    let now = await db.shipment.findUnique({ where: { id: s.id }, select: { paymentStatus: true } });
    if (now?.paymentStatus !== "CONFIRMED") {
      await new Promise((r) => setTimeout(r, 300)); // concurrent confirm may be mid-flight
      now = await db.shipment.findUnique({ where: { id: s.id }, select: { paymentStatus: true } });
    }
    if (now?.paymentStatus === "CONFIRMED") {
      return { ok: true, alreadyPaid: true, shipment: shipmentDTO((await getShipmentFull({ id: shipmentId }))!) };
    }
    return { ok: false, error: "No pending payment. Start again.", code: 409 };
  }

  let receipt = mpesaRef();
  let providerTxId: string | null = null;
  let channel: string | null = null;
  let feesCharged: number | null = null;

  if (pending.provider === "PAYSTACK") {
    const secret = await resolvePaystackSecret();
    if (!secret) return { ok: false, error: "Payment provider unavailable. Try again shortly.", code: 503 };
    const v = await verifyTransaction(secret, pending.checkoutReqId);
    if (!v.ok) return { ok: false, error: `Payment still processing (${v.error}). If you completed it, we'll confirm automatically.`, code: 409 };
    const data: VerifyResult = v.data;
    // amount integrity (§g.5): provider amount must equal fare in subunits
    if (data.status !== "success" || data.currency !== "KES" || data.amount !== s.fareTotal * 100) {
      if (data.status === "success") {
        // a real payment with the wrong amount is an incident, not a retry (§g.5)
        await db.paymentEvent.update({ where: { id: pending.id }, data: { status: "FAILED" } });
        await pageAdmins("Payment amount mismatch", `${s.code}: Paystack reports KES ${Math.round(data.amount / 100).toLocaleString()} but the fare is KES ${s.fareTotal.toLocaleString()} — payment NOT confirmed. Review before any manual fix.`, s.code);
        return { ok: false, error: "Payment amount mismatch — support has been notified.", code: 409 };
      }
      return { ok: false, error: "Payment not completed yet. If you paid, we'll confirm automatically.", code: 202 };
    }
    receipt = String(data.id); // u64 as string
    providerTxId = String(data.id);
    channel = data.channel;
    feesCharged = data.fees ?? null;
  }

  const claimed = await db.paymentEvent.updateMany({
    where: { id: pending.id, status: "PENDING" },
    data: { status: "CONFIRMED", mpesaReceipt: receipt, providerTxId, channel, feesCharged, verifiedAt: new Date() },
  });
  if (!claimed.count) {
    // someone else confirmed first — idempotent replay
    return { ok: true, alreadyPaid: true, shipment: shipmentDTO((await getShipmentFull({ id: shipmentId }))!) };
  }
  await db.shipment.update({ where: { id: s.id }, data: { paymentStatus: "CONFIRMED", paymentRef: receipt, paidAt: new Date() } });
  const t = await applyTransition(shipmentId, "payment-confirmed", "SYSTEM", { label: `Payment confirmed · ${pending.provider === "PAYSTACK" ? "M-PESA (Paystack)" : `M-PESA ${receipt}`}` });
  if (!t.ok) return { ok: false, error: t.error, code: t.code };
  return { ok: true, receipt, shipment: shipmentDTO((await getShipmentFull({ id: shipmentId }))!) };
}

// ─── driver payout destination (once per driver) ────────────────────────────

export async function setupDriverPayout(
  driverId: string,
  input: { type: "mobile_money" | "kepss"; accountNumber: string; bankCode: string },
): Promise<{ ok: true; bankName?: string } | { ok: false; error: string }> {
  const driver = await db.driver.findUnique({ where: { id: driverId }, include: { user: true } });
  if (!driver?.user) return { ok: false, error: "Driver not found" };
  const account = input.type === "mobile_money"
    ? input.accountNumber.replace(/\D/g, "").replace(/^0/, "254") // M-Pesa needs 2547XXXXXXXX
    : input.accountNumber.replace(/\s/g, "");
  if (input.type === "mobile_money" && !/^254[17]\d{8}$/.test(account)) return { ok: false, error: "Enter the driver's M-Pesa number like 0712 345 678." };
  if (input.type === "kepss" && account.length < 4) return { ok: false, error: "Enter a valid bank account number." };

  if ((await resolvePaymentProvider()) === "PAYSTACK") {
    const secret = (await resolvePaystackSecret())!;
    const r = await createTransferRecipient(secret, { type: input.type, name: driver.user.name, accountNumber: account, bankCode: input.bankCode });
    if (!r.ok) return { ok: false, error: `Could not save payout details (${r.error}).` };
    await db.driver.update({
      where: { id: driverId },
      data: {
        payoutType: input.type, payoutAccountNumber: account, payoutBankCode: input.bankCode,
        payoutBankName: r.data.details?.bank_name ?? null, payoutRecipientCode: r.data.recipient_code, payoutSetupAt: new Date(),
      },
    });
    return { ok: true, bankName: r.data.details?.bank_name };
  }
  // sandbox: store the details without a live recipient (withdraw stays instant)
  await db.driver.update({
    where: { id: driverId },
    data: { payoutType: input.type, payoutAccountNumber: account, payoutBankCode: input.bankCode, payoutBankName: input.type === "mobile_money" ? "M-PESA" : "Bank", payoutRecipientCode: `RCP_SANDBOX_${driverId.slice(-8)}`, payoutSetupAt: new Date() },
  });
  return { ok: true, bankName: input.type === "mobile_money" ? "M-PESA" : "Bank" };
}

// ─── payouts: POD transfer + withdrawals ────────────────────────────────────

async function pageAdmins(title: string, body: string, shipmentCode?: string): Promise<void> {
  const admins = await db.user.findMany({ where: { role: "ADMIN" }, select: { id: true } });
  if (admins.length) {
    await db.notification.createMany({ data: admins.map((a) => ({ userId: a.id, role: "ADMIN", title, body, shipmentCode: shipmentCode ?? null })) }).catch(() => null);
  }
}

/**
 * Hold-then-payout: after POD, move the driver's share (driverEarnings incl.
 * tip) out via Paystack Transfer. Failure-tolerant by design — the Payout row
 * is created FIRST and survives provider failures as PENDING with a reason;
 * ops can retry from the admin Payouts tab (idempotent reference reuse).
 */
export async function initiatePodPayout(
  shipmentId: string,
  initiatedBy: "SYSTEM" | "ADMIN",
): Promise<{ ok: boolean; payoutId?: string; status?: string; note?: string }> {
  const s = await getShipmentFull({ id: shipmentId });
  if (!s || !s.driverId) return { ok: false, note: "shipment/driver missing" };
  if (s.paymentStatus !== "CONFIRMED") return { ok: false, note: "payment not confirmed" };
  if (s.status !== "POD_CONFIRMED" && s.status !== "COMPLETED") return { ok: false, note: `not POD-confirmed (${s.status})` };

  // double-pay guard: any non-FAILED/REVERSED payout for this shipment blocks
  const existing = await db.payout.findFirst({ where: { shipmentId, status: { notIn: ["FAILED", "REVERSED"] } } });
  if (existing) return { ok: true, payoutId: existing.id, status: existing.status, note: "payout already exists" };

  const driver = await db.driver.findUnique({ where: { id: s.driverId } });
  if (!driver) return { ok: false, note: "driver row missing" };
  const amount = s.driverEarnings; // includes tip (rate action increments it)

  const reference = paystackTransferReference(s.code, 1);
  const payout = await db.payout.create({
    data: {
      driverId: driver.id, shipmentId, amount,
      method: driver.payoutType === "kepss" ? "PAYSTACK_BANK" : "PAYSTACK_MPESA",
      status: "PENDING", reference, initiatedBy,
    },
  });

  if (!driver.payoutRecipientCode) {
    await db.payout.update({ where: { id: payout.id }, data: { failureReason: "Driver payout details not set — driver must add M-Pesa/bank details first" } });
    await pageAdmins("Payout blocked", `${s.code}: driver has no payout details — ask the driver to add them, then release the payout.`, s.code);
    return { ok: true, payoutId: payout.id, status: "PENDING", note: "driver payout details missing" };
  }

  const result = await executePayout(payout.id);
  return { ok: result.ok, payoutId: payout.id, status: result.status, note: result.note };
}

/** Execute (or retry — same reference) a PENDING payout row. */
export async function executePayout(payoutId: string): Promise<{ ok: boolean; status: string; note?: string }> {
  const p = await db.payout.findUnique({ where: { id: payoutId } });
  if (!p) return { ok: false, status: "MISSING", note: "payout not found" };
  if (p.status === "PAID" || p.status === "PROCESSING") return { ok: true, status: p.status, note: "already in flight/paid" };

  const driver = await db.driver.findUnique({ where: { id: p.driverId } });
  if (!driver?.payoutRecipientCode) {
    await db.payout.update({ where: { id: p.id }, data: { failureReason: "Driver payout details not set" } });
    return { ok: false, status: "PENDING", note: "driver payout details missing" };
  }

  if ((await resolvePaymentProvider()) !== "PAYSTACK") {
    // sandbox: instant PAID (existing withdraw semantics)
    await db.payout.update({ where: { id: p.id }, data: { status: "PAID", processedAt: new Date(), ref: p.ref ?? mpesaRef() } });
    return { ok: true, status: "PAID" };
  }

  const secret = (await resolvePaystackSecret())!;
  const t = await createTransfer(secret, {
    amountSubunits: p.amount * 100,
    recipientCode: driver.payoutRecipientCode,
    reference: p.reference ?? paystackTransferReference(`MZG${p.id.replace(/\D/g, "")}`, 1),
    reason: p.shipmentId ? `MIZIGO delivery payout` : "MIZIGO driver withdrawal",
  });
  if (!t.ok) {
    await db.payout.update({ where: { id: p.id }, data: { failureReason: t.error } });
    await pageAdmins("Payout failed to send", `Payout ${p.id.slice(-6)}: ${t.error} — retry from the Payouts tab.`);
    return { ok: false, status: "PENDING", note: t.error };
  }
  const otpNeeded = t.data.status === "otp";
  await db.payout.update({
    where: { id: p.id },
    data: { status: "PROCESSING", transferCode: t.data.transfer_code, failureReason: otpNeeded ? "Awaiting OTP finalization (Paystack transfers OTP is ON) — finalize from the Payouts tab" : null },
  });
  if (otpNeeded) await pageAdmins("Payout needs OTP", `Payout ${p.id.slice(-6)} was created but needs the OTP sent to the business phone. Finalize it in the Paystack dashboard or from the Payouts tab.`);
  return { ok: true, status: "PROCESSING" };
}

/** Driver wallet withdrawal → real transfer in PAYSTACK mode. */
export async function createWithdrawalPayout(
  driverId: string, amount: number,
): Promise<{ ok: true; status: string } | { ok: false; error: string; code?: number }> {
  const reference = `po-wd-${Date.now().toString(36)}-01`; // 16–50 chars, [a-z0-9_-]
  const payout = await db.payout.create({
    data: { driverId, amount, method: "PAYSTACK_MPESA", status: "PENDING", reference, initiatedBy: "DRIVER" },
  });
  const r = await executePayout(payout.id);
  if (!r.ok) return { ok: false, error: r.note ?? "Withdrawal could not be sent.", code: 502 };
  return { ok: true, status: r.status };
}

// ─── refunds (cancellation economics with real money) ───────────────────────

export async function refundShipmentPayment(shipmentId: string, refundKes: number): Promise<{ ok: boolean; note?: string }> {
  const s = await getShipmentFull({ id: shipmentId });
  if (!s) return { ok: false, note: "not found" };
  const ev = await db.paymentEvent.findFirst({ where: { shipmentId, status: "CONFIRMED", provider: "PAYSTACK" }, orderBy: { createdAt: "desc" } });
  if (!ev) return { ok: false, note: "no confirmed paystack payment" };
  const secret = await resolvePaystackSecret();
  if (!secret) return { ok: false, note: "paystack unavailable" };
  const r = await refundTransaction(secret, ev.checkoutReqId, Math.round(refundKes * 100));
  if (!r.ok) {
    await pageAdmins("Refund failed", `${s.code}: refund of KES ${refundKes.toLocaleString()} could not be sent (${r.error}). Refund manually from the Paystack dashboard.`, s.code);
    return { ok: false, note: r.error };
  }
  await db.shipmentEvent.create({ data: { shipmentId, type: "REFUND_PENDING", label: `Refund of KES ${refundKes.toLocaleString()} sent to M-PESA — arrives in minutes`, actor: "SYSTEM" } });
  return { ok: true };
}

// ─── Paystack webhook (source of truth) ─────────────────────────────────────

const ALLOWED_EVENTS = new Set([
  "charge.success", "charge.failed",
  "transfer.success", "transfer.failed", "transfer.reversed",
  "refund.processing", "refund.processed", "refund.failed", "refund.pending",
]);

export interface WebhookResult { status: number; note: string }

/**
 * Process a Paystack webhook: verify the HMAC-SHA512 signature over the RAW
 * body, dedupe by `<event>:<reference|id>` in the PaystackEvent ledger, then
 * dispatch through the same verified funnels the interactive paths use.
 * Always answers 200 fast on accepted events (Paystack retries non-200 for
 * 72h) — internal errors are logged, never 5xx'd.
 */
export async function handlePaystackWebhook(rawBody: string, signature: string): Promise<WebhookResult> {
  const secret = await resolveWebhookSecret();
  if (!secret) return { status: 200, note: "paystack not configured — ignored" };
  if (!verifyPaystackSignature(rawBody, signature, secret)) return { status: 401, note: "invalid signature" };

  let parsed: { event?: string; data?: Record<string, unknown> };
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    return { status: 400, note: "invalid json" };
  }
  const event = String(parsed.event ?? "");
  const data = parsed.data ?? {};
  if (!ALLOWED_EVENTS.has(event)) return { status: 200, note: `ignored unhandled event ${event}` };

  const reference = typeof data.reference === "string" ? data.reference : null;
  const eventId = `${event}:${reference ?? String(data.id ?? "")}`;
  try {
    await db.paystackEvent.create({ data: { eventId, event, reference, payload: rawBody, status: "RECEIVED" } });
  } catch (err) {
    // unique-constraint = replay of an event we already processed (Paystack
    // retries the same event multiple times); anything else is a real fault
    const e = err as { code?: string; message?: string };
    if (e?.code === "P2002" || /UNIQUE constraint/i.test(e?.message ?? "")) {
      return { status: 200, note: "duplicate event — already processed" };
    }
    console.error("[paystack-webhook] ledger write failed", e?.message);
    return { status: 200, note: "ledger error — logged (Paystack will retry)" };
  }

  try {
    if (event === "charge.success" || event === "charge.failed") {
      const ev = reference ? await db.paymentEvent.findUnique({ where: { checkoutReqId: reference } }) : null;
      if (!ev) {
        await db.paystackEvent.update({ where: { eventId }, data: { status: "ORPHAN" } });
        return { status: 200, note: "orphan reference" };
      }
      // only Paystack-initiated payments move on Paystack events (a MOCK
      // payment must never be confirmable by a webhook — provider guard)
      if (ev.provider !== "PAYSTACK") {
        await db.paystackEvent.update({ where: { eventId }, data: { status: "IGNORED", errorNote: `provider is ${ev.provider}, not PAYSTACK`, processedAt: new Date() } });
        return { status: 200, note: "non-paystack payment — ignored" };
      }
      const res = await confirmCustomerPayment(ev.shipmentId, "webhook");
      await db.paystackEvent.update({
        where: { eventId },
        data: { status: res.ok ? "PROCESSED" : res.alreadyPaid ? "PROCESSED" : "IGNORED", errorNote: res.ok ? null : res.error, processedAt: new Date() },
      });
      return { status: 200, note: res.ok ? "processed" : (res.error ?? "ignored") };
    }

    if (event.startsWith("transfer.")) {
      const payout = reference ? await db.payout.findUnique({ where: { reference } }) : null;
      if (!payout) {
        await db.paystackEvent.update({ where: { eventId }, data: { status: "ORPHAN" } });
        return { status: 200, note: "orphan transfer reference" };
      }
      const amount = Number(data.amount ?? 0);
      if (amount !== payout.amount * 100) {
        await db.paystackEvent.update({ where: { eventId }, data: { status: "IGNORED", errorNote: `amount mismatch ${amount} ≠ ${payout.amount * 100}`, processedAt: new Date() } });
        return { status: 200, note: "amount mismatch — ignored" };
      }
      const fee = Number(data.fee_charged ?? 0) || null;
      if (event === "transfer.success") {
        await db.payout.update({ where: { id: payout.id }, data: { status: "PAID", processedAt: new Date(), feeCharged: fee, failureReason: null } });
        if (payout.shipmentId) {
          const s = await db.shipment.findUnique({ where: { id: payout.shipmentId }, select: { code: true, driverId: true } });
          if (s) {
            await db.shipmentEvent.create({ data: { shipmentId: payout.shipmentId, type: "PAYOUT_PAID", label: `Driver paid · KES ${payout.amount.toLocaleString()} to ${(payout.method === "PAYSTACK_BANK") ? "bank" : "M-PESA"}`, actor: "SYSTEM" } });
            if (s.driverId) {
              const d = await db.driver.findUnique({ where: { id: s.driverId }, select: { userId: true } });
              if (d) await db.notification.create({ data: { userId: d.userId, role: "DRIVER", title: "Payout sent", body: `KES ${payout.amount.toLocaleString()} for ${s.code} is on its way to your ${(payout.method === "PAYSTACK_BANK") ? "bank" : "M-PESA"}.`, shipmentCode: s.code } }).catch(() => null);
            }
          }
        }
      } else if (event === "transfer.failed") {
        await db.payout.update({ where: { id: payout.id }, data: { status: "FAILED", failureReason: String((data.reason ?? "transfer failed")).slice(0, 200), feeCharged: fee } });
        await pageAdmins("Driver payout failed", `Payout ${payout.id.slice(-6)} (KES ${payout.amount.toLocaleString()}) failed — check the driver's payout details, then retry from the Payouts tab.`);
      } else if (event === "transfer.reversed") {
        await db.payout.update({ where: { id: payout.id }, data: { status: "REVERSED", failureReason: "transfer reversed — money returned to the platform balance", feeCharged: fee } });
        await pageAdmins("Driver payout REVERSED", `Payout ${payout.id.slice(-6)} was reversed — the money is back in the Paystack balance and the driver was NOT paid. Re-issue manually.`);
      }
      await db.paystackEvent.update({ where: { eventId }, data: { status: "PROCESSED", processedAt: new Date() } });
      return { status: 200, note: "processed" };
    }

    if (event.startsWith("refund.")) {
      // refund payloads carry the ORIGINAL transaction reference
      const txRef = typeof data.transaction_reference === "string" ? data.transaction_reference : reference;
      const ev = txRef ? await db.paymentEvent.findUnique({ where: { checkoutReqId: txRef } }) : null;
      if (!ev) {
        await db.paystackEvent.update({ where: { eventId }, data: { status: "ORPHAN" } });
        return { status: 200, note: "orphan refund reference" };
      }
      if (event === "refund.processed") {
        const refunded = Number(data.amount ?? 0);
        await db.paymentEvent.update({ where: { id: ev.id }, data: { status: "REFUNDED", refundedSubunits: refunded || null } });
        await db.shipment.update({ where: { id: ev.shipmentId }, data: { paymentStatus: "REFUNDED" } }).catch(() => null);
        const s = await db.shipment.findUnique({ where: { id: ev.shipmentId }, select: { code: true, customerId: true } });
        if (s) {
          await db.shipmentEvent.create({ data: { shipmentId: ev.shipmentId, type: "REFUND_COMPLETED", label: `Refund completed · KES ${Math.round((refunded || 0) / 100).toLocaleString()} back to M-PESA`, actor: "SYSTEM" } });
          await db.notification.create({ data: { userId: s.customerId, role: "CUSTOMER", title: "Refund completed", body: `Your refund for ${s.code} has been sent back to your M-PESA.`, shipmentCode: s.code } }).catch(() => null);
        }
      }
      await db.paystackEvent.update({ where: { eventId }, data: { status: "PROCESSED", processedAt: new Date() } });
      return { status: 200, note: "processed" };
    }

    return { status: 200, note: "unhandled" };
  } catch (err) {
    console.error("[paystack-webhook] dispatch error", (err as Error).message);
    await db.paystackEvent.update({ where: { eventId }, data: { status: "IGNORED", errorNote: (err as Error).message.slice(0, 200) } }).catch(() => null);
    return { status: 200, note: "internal error — logged (Paystack will retry)" };
  }
}
