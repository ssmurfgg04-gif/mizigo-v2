# PAYSTACK MARKETPLACE WIRING BLUEPRINT — MIZIGO (hold → payout on POD)

Research deliverable for Task 15-b. Everything here was verified against (1) our actual code at
/home/z/my-project, (2) the 4 reference repos cloned under /home/z/my-project/research-repos/,
(3) official Paystack docs fetched live today, and (4) LIVE READ-ONLY API calls against the
owner's Paystack account (GET only, live secret key used in shell only — it appears in NO file).
The main agent should be able to implement directly from this doc without re-fetching anything.

Citations: `[D:<slug>]` = official Paystack doc page (fetched today, list in §10),
`[L]` = live API observation made today, `[R:<repo>]` = reference-repo code,
`[C]` = our codebase at the referenced path. Fetched-doc archives: /tmp/paystack-docs/*.txt
(mirrored summaries inline below; key JSON kept out of the repo).

---

## (a) Today's money flow — exactly what the code does now

**Pricing (C: src/lib/pricing.ts).** `priceFor()` computes fare lines (base + distance + duration
+ loading + stops + night − schedule + platformFee, minimum-fare floor). Money split:
`commission = Math.round(total * zone.commissionRate)` and
`driverEarnings = total − platformFee − commission`. The Prisma schema defaults
`PricingZone.commissionRate = 0.15` and the sandbox seed (C: src/lib/seed.ts:54) sets Nairobi to
**0.15 (15%)**; the owner's current intent is **12%** — see "Surprises" in §11: the live DB zone
must be confirmed/updated to 0.12 and /terms copy (currently "15% plus KES 100") kept in sync.
Rust/WASM core mirrors this bit-exactly. Tip (Rating.tip) is added to `driverEarnings` post-POD.

**Payment lifecycle (C: src/app/api/shipments/[id]/action/route.ts).**
- `pay` (customer-only): deletes prior PENDING PaymentEvents, creates a PaymentEvent
  `{checkoutReqId: "ws_CO_<code>_<ts>" (MOCK), method, amount: fareTotal, status: PENDING}`,
  sets Shipment → `PAYMENT_PENDING` + `paymentStatus PENDING` + `checkoutReqId`.
  **No real provider is called** — `initiateMpesaPayment()` exists (C: src/lib/integrations/index.ts)
  but is deliberately unwired.
- `pay-confirm` (customer): the simulated PIN entry. Atomic claim
  `updateMany({where: {id, status: PENDING}, data: {status: CONFIRMED, mpesaReceipt}})` →
  exactly one winner; losers get `alreadyPaid`. Then Shipment `paymentStatus CONFIRMED`,
  `paymentRef` receipt, `paidAt`, and state machine `payment-confirmed` transition (SYSTEM).
- `pay-timeout`: PENDING events → TIMEOUT, shipment `TIMED_OUT`.
- Client (C: src/components/mizigo/customer/PaymentStep.tsx): "Simulate phone prompt" → fake
  M-PESA PIN sheet → calls `pay-confirm` with the pin. CASH skips to `request` (matching).
- `/api/mpesa/callback` (C: src/app/api/mpesa/callback/route.ts): Daraja-shaped webhook,
  always replies 200 `{"ResultCode":0}`, resolves CheckoutRequestID → shipment via in-memory map
  then `PaymentEvent.checkoutReqId`, idempotent via the same atomic-claim, applies
  `payment-confirmed` transition. Inert today (nothing registers the URL with Safaricom).
- Daraja adapter (C: src/lib/integrations/daraja.ts): complete STK push + stkQuery, inert by
  design (no DARAJA_* env → zero network I/O). Africa's Talking SMS adapter same pattern.

**POD (C: action route lines ~243–308).** `pod` (DRIVER, allowed SYSTEM in state machine):
BLOCKING 4-digit `deliveryCode` handshake (Shipment.deliveryCode vs body.otp), records
`podRecipient/podOtp/podPhotoTaken/podVerifiedAt/podLat/podLng`, transition `pod` →
`POD_CONFIRMED`. `complete` (SYSTEM, auto-fired by the `rate` action when status is
POD_CONFIRMED/DELIVERED) → `COMPLETED`.

**Payouts (C: src/app/api/driver/action/route.ts `withdraw`; src/app/api/admin/action/route.ts
`payout-pay`).** Driver wallet = Σ driverEarnings of COMPLETED shipments (last 30d) − Σ PAID
payouts. `withdraw` (min KES 100) creates a `Payout` row `{driverId, amount, method: "MPESA",
status: PROCESSING, ref: mpesaRef()}` then **immediately marks it PAID** — "MOCK B2C: paid
instantly in sandbox". Admin `payout-pay` similarly flips a Payout to PAID with a fake receipt.
**No money ever moves.** Payout model: `{driverId, amount, method, status(PENDING|PROCESSING|PAID|FAILED), ref}` —
no shipment link, no transfer code, no fee capture.

**Net state:** the whole money stack is a faithful simulation with production-shaped invariants
(atomic claims, idempotency, server-only state changes). Nothing Paystack exists yet
(0 grep hits for "paystack" in src/). No PAYSTACK_* env vars anywhere.

---

## (b) Target architecture — PaymentProvider interface + adapters

New file `src/lib/integrations/paystack.ts` (adapter) + rework `src/lib/integrations/index.ts`
into a provider registry. Keep the house style: **inert by design, never throws, 5s timeout,
structured logs** (C: daraja.ts conventions).

```ts
// src/lib/integrations/types.ts (new)
export type ProviderName = "PAYSTACK" | "DARAJA" | "MOCK";

export interface StartPaymentArgs {
  shipment: { id: string; code: string };
  customerPhone: string;      // 07…/2547… — normalised inside
  customerEmail?: string | null;
  amountKes: number;          // whole KES (fareTotal)
  callbackUrl: string;        // browser return URL
  attempt: number;            // attempt counter for reference building
}
export type StartPaymentResult =
  | { ok: true; mode: "REDIRECT"; reference: string; authorizationUrl: string }
  | { ok: true; mode: "STK"; reference: string; checkoutId: string }   // Daraja path
  | { ok: true; mode: "SIMULATED"; reference: string }                  // MOCK path
  | { ok: false; error: string };

export interface VerifyPaymentResult {
  ok: boolean; reference: string; status: "PENDING" | "SUCCESS" | "FAILED" | "ABANDONED";
  amountSubunits?: number; channel?: string; feesSubunits?: number; providerTxId?: string;
  raw?: unknown;
}
export interface CreatePayoutArgs {
  payoutId: string; reference: string;      // ≥16 chars, [a-z0-9_-]
  driverName: string; amountKes: number;
  recipient: { type: "mobile_money" | "kepss"; accountNumber: string; bankCode: string; recipientCode?: string };
  reason: string;
}
export type CreatePayoutResult =
  | { ok: true; status: "queued" | "otp"; transferCode: string; recipientCode: string }
  | { ok: false; error: string };

export interface PaymentProvider {
  readonly name: ProviderName;
  isEnabled(): boolean;
  startCustomerPayment(args: StartPaymentArgs): Promise<StartPaymentResult>;
  verifyCustomerPayment(reference: string): Promise<VerifyPaymentResult>;
  // Payouts (Paystack only for now; Daraja B2C is future work)
  createTransferRecipient(recipient: { type: "mobile_money" | "kepss"; name: string; accountNumber: string; bankCode: string }): Promise<{ ok: true; recipientCode: string; bankName?: string } | { ok: false; error: string }>;
  createPayout(args: CreatePayoutArgs): Promise<CreatePayoutResult>;
  verifyPayout(reference: string): Promise<{ ok: boolean; status?: string; feeChargedSubunits?: number; raw?: unknown }>;
}
```

Three implementations, selected at call time (mirrors commit-gear's container pattern [R:commit-gear]
and our inert-by-design rule):
- `PaystackAdapter` — active iff `PAYSTACK_SECRET_KEY` env present. All calls to
  `https://api.paystack.co` with `Authorization: Bearer <secret>`, 10s AbortController timeout,
  typed JSON, never throws.
- `DarajaAdapter` — wraps existing `stkPush/stkQuery` (C: daraja.ts) behind the same interface;
  active iff DARAJA_* present. (Fallback/alternate provider as the owner wants.)
- `MockPaymentProvider` — the current simulated flow, byte-identical sandbox behavior (returns
  `SIMULATED` + a `ws_CO_…` reference exactly like today's mock, so e2e tests keep passing with
  zero keys). Modeled on commit-gear's `MockPaystackProvider` [R:commit-gear].

Selection order in `resolvePaymentProvider()`: `PAYSTACK_SECRET_KEY` → Paystack;
else DARAJA_* → Daraja; else Mock. Resolution is logged once at first use.

**Action routing:**
- `pay` → `provider.startCustomerPayment(...)`. PaymentEvent.checkoutReqId = the provider
  reference (Paystack reference / Daraja CheckoutRequestID / mock id). Response additionally
  returns `authorizationUrl` (Paystack) so the client can redirect. MOCK mode: response is
  byte-identical to today (prompt text) → sandbox UI unchanged.
- `pay-confirm` → **becomes a server-side verify** (`provider.verifyCustomerPayment(reference)`)
  for Paystack; the pin parameter is ignored for Paystack (kept for Daraja/Mock semantics).
  Success rule: `data.status === "success" && data.amount === fareTotal * 100 && data.currency === "KES"`
  (anti-underpayment, per [D:verify-payments], [R:commit-gear] AMOUNT_MISMATCH, [R:rn-checkout]).
  Then the SAME atomic claim as today. Callback page + webhook both funnel into this one service.
- `pod` → unchanged handshake, plus: after the transition succeeds, enqueue the driver payout
  (create Payout row PENDING → call `provider.createPayout` → PROCESSING). Payout creation must
  be failure-tolerant: if the Paystack call fails, Payout stays PENDING and an admin
  notification is created (ops releases it later from the admin Payouts tab).
- Admin `payout-pay` → for a PENDING payout: same `provider.createPayout` path (idempotent by
  reference — safe to retry). For MOCK mode it stays the instant "mark paid" sandbox behavior.
- `withdraw` (driver) → unchanged wallet math; the instant-PAID line is replaced by the real
  transfer initiation (Paystack) or the sandbox instant path (Mock).

---

## (c) Exact API call sequences

### c.1 Customer payment (Paystack Checkout, M-Pesa channel)

Verified against [D:api-transaction] and [L] (live account already ran mobile_money
transactions in Feb 2026 — see §9).

1. Client `POST /api/shipments/[id]/action {action:"pay"}` (customer session, as today).
2. Server (Paystack mode):
   - Build reference: `MZG<6digits>A<attempt>` e.g. `MZG482913A2` — Paystack transaction
     references allow ONLY `-`, `.`, `=`, and alphanumerics [D:api-transaction] (**no
     underscore** — do not reuse the `ws_CO_…` shape).
   - `POST https://api.paystack.co/transaction/initialize`:
     ```json
     {
       "email": "<customer or no-reply@mizigo.app placeholder>",
       "amount": 300000,                       // fareTotal * 100 — KES is in CENTS [L]
       "currency": "KES",
       "reference": "MZG482913A1",
       "callback_url": "https://mizigo.netlify.app/pay/callback?shipment=<id>",
       "channels": ["mobile_money"],           // M-Pesa only (cards arrive later if wanted)
       "metadata": { "shipmentId": "<cuid>", "shipmentCode": "MZG-482913", "custom_fields": [
         {"display_name":"Delivery","variable_name":"delivery","value":"MZG-482913"} ] }
     }
     ```
     Response `{status:true, data:{authorization_url, access_code, reference}}` [D:api-transaction].
   - Persist BEFORE redirecting: `PaymentEvent.create({shipmentId, checkoutReqId: reference,
     method:"MPESA", provider:"PAYSTACK", amount: fareTotal, amountSubunits: fareTotal*100,
     status:"PENDING"})` + `Shipment.checkoutReqId = reference` (existing columns).
   - Also store `authorization_url`/`access_code` on the PaymentEvent (new `providerMeta`
     JSON column, §e) so a re-`pay` within the attempt can resume instead of re-initializing.
   - Respond `{ok, checkoutReqId: reference, authorizationUrl, mode:"REDIRECT"}`.
3. Client redirects (`window.location.href = authorizationUrl`). On the Paystack page the
   customer picks M-Pesa, enters their phone, receives the STK push, enters PIN. 180s window
   applies to MoMo authorisation [D:payment-channels].
4. Paystack redirects the browser to `callback_url?reference=…&trxref=…` [D:accept-payments].
   Our `/pay/callback` page reads `reference` and calls
   `POST /api/shipments/[id]/action {action:"pay-verify", reference}` (new thin alias for the
   verify path of `pay-confirm`; keeps `pay-confirm` for the sandbox PIN flow).
5. Server verify: `GET /transaction/verify/:reference` [D:api-transaction]. Enforce
   `data.status === "success"`, `data.amount === fareTotal*100`, `data.currency === "KES"`.
   Then atomic-claim PaymentEvent PENDING→CONFIRMED (existing pattern), set
   `paymentStatus CONFIRMED, paymentRef = data.id (or reference), paidAt`, fire
   `payment-confirmed` transition. Losing races get `alreadyPaid` (idempotent).
6. **Webhook is the source of truth** (`charge.success` → same verify-then-claim service).
   The callback page is only a UX nicety — visiting it proves nothing [D:accept-payments].
7. Failure/abandon: if verify returns `abandoned`/`failed`/`ongoing`/`pending`
   ([D:verify-payments] status list), the page polls `pay-verify` a few times (the rn-checkout
   pattern: 2s delay, 3 retries, 3s interval [R:rn-checkout]) then shows retry/pay-again.
   Re-`pay` bumps the attempt counter → new reference `MZG482913A2`. Old PENDING events are
   marked TIMEOUT by the existing `pay-timeout` / cron sweep.

**Phase-2 option (documented, not required):** direct Charge API — `POST /charge` with
`{email, amount, currency:"KES", mobile_money:{phone:"2547XXXXXXXX", provider:"mpesa"}}`,
STK push straight to the customer's phone, no redirect, response `data.status:"pay_offline"`
+ `display_text` [D:payment-channels]. We already hold the customer's phone, so this is a
natural upgrade after the Checkout path is proven. The initialize+Checkout path ships first
because the owner's dashboard callback + webhook already point at live URLs and Checkout is
the lowest-risk first wire.

### c.2 Driver payout setup (once per driver)

1. Driver app "Payout details" screen: choose M-Pesa (default) or bank.
2. Bank/MNO list: `GET https://api.paystack.co/bank?currency=KES&perPage=100` → 54 entries [L].
   Cache it (PlatformSetting or in-memory 24h). Driver UI groups: M-Pesa (`MPESA`),
   Airtel Money (`ATL_KE`), Telkom (`97`), then banks (`kepss` entries). Full highlights in §9.
   **Correct recipient type for Kenyan bank accounts is `kepss`** (Kenya Electronic Payment
   and Settlement System), NOT `nuban` (Nigeria) [D:single-transfers] [L: bank list `type` field].
3. On save: `POST /transferrecipient`:
   ```json
   { "type": "mobile_money",            // or "kepss" for a bank account
     "name": "<driver name as on account>",
     "account_number": "2547XXXXXXXX",  // M-Pesa phone (toMsisdn); bank acct no for kepss
     "bank_code": "MPESA",              // from the /bank list [L]
     "currency": "KES",
     "description": "MIZIGO driver payout" }
   ```
   Response: `data.recipient_code` = `RCP_…` (save on Driver, §e), `data.details.bank_name`.
   Duplicate account+bank returns the existing record [D:api-transfer-recipient] — safe to re-POST.
   Owner already proved this live: a `mobile_money`/`MPESA` recipient exists on the account [L: §9].
4. Store `payoutType/payoutAccountNumber/payoutBankCode/payoutBankName/payoutRecipientCode`
   on the Driver row. Re-saving details after a change re-POSTs and overwrites the code.
   (Optional belt-and-braces: `GET /transferrecipient/:id_or_code` to confirm `active:true`.)

### c.3 POD payout (hold-then-pay, after `pod` succeeds)

1. Trigger: the `pod` action completes (or admin releases a stuck PENDING payout). Preconditions:
   Shipment POD_CONFIRMED, paymentStatus CONFIRMED, driver has payoutRecipientCode.
2. Compute payout amount server-side ONLY: `driverEarnings + tip − payoutsAlreadyPaidForShipment`
   (driverEarnings already includes the tip via the rate action's increment; guard against
   double-count by linking Payout→shipmentId and checking for an existing non-failed payout).
3. Create Payout row first: `{driverId, shipmentId, amount, method: "PAYSTACK_MPESA"|"PAYSTACK_BANK",
   status: "PENDING", reference: "po-mzg482913-01"}` — reference constraints: 16–50 chars,
   `[a-z0-9_-]` only, lowercase; **retry the same reference to avoid double-crediting**
   [D:single-transfers].
4. `POST /transfer`:
   ```json
   { "source": "balance",
     "amount": 254000,                 // payoutAmount * 100 (cents) [D:api-transfer]
     "recipient": "RCP_xxxxxxxx",
     "reference": "po-mzg482913-01",
     "reason": "MIZIGO MZG-482913 delivery payout",
     "currency": "KES" }
   ```
   (`account_reference` is only needed for M-PESA **Paybill** B2B transfers [D:api-transfer] —
   not for driver wallets.)
   Response: `data.transfer_code` (TRF_…), `data.status` = `pending` if OTP disabled, `otp` if
   OTP still required [D:api-transfer]. Persist `transferCode`; set status PROCESSING.
   If status comes back `otp`: surface in admin Payouts tab ("finalize with OTP" — needs the
   OTP sent to the business phone; see §c.5).
5. Final state arrives via webhook `transfer.success` / `transfer.failed` / `transfer.reversed`
   [D:single-transfers] → handler verifies (optional `GET /transfer/verify/:reference`, which
   also returns `fee_charged` [D:api-transfer]) → Payout PAID (+feeCharged) + ShipmentEvent
   `PAYOUT_PAID` + driver notification; FAILED/REVERSED → Payout FAILED/REVERSED + admin alert.
6. Amount guard on webhook: `data.amount === payout.amount * 100` before flipping to PAID.
7. Minimums: M-Pesa wallet transfers: min KES 10, max KES 250,000 per single transfer; bank
   min KES 10, max KES 50,000,000 [D:support-transfers]. Our driver withdraw min KES 100 is
   compatible. Wallet payouts over KES 250k would need splitting — note for ops, not code yet.

### c.4 Refund flow (cancellation economics, live money)

Cancellation already computes `refundKes` (fee withheld) [C: action route]. With Paystack:
1. On `cancel` of a CONFIRMED shipment (or admin dispute resolution):
   `POST /refund { "transaction": "<PaymentEvent.checkoutReqId>", "amount": refundKes * 100 }`
   (omit `amount` for full refund) [D:refunds]. Response: `data.id`, `data.status: "pending"`.
2. Webhooks `refund.processing` → `refund.processed` (final ok) / `refund.failed`
   [D:webhooks] → PaymentEvent status REFUNDED (existing enum value), ShipmentEvent REFUND_*
   with the refunded amount, notify customer.
3. `refund.needs-attention` is NOT in the documented webhook list; the docs instead say a
   refund whose status becomes `needs-attention` requires `POST
   /refund/retry_with_customer_details/:id` with the customer's bank details [D:refunds] —
   handle by alerting ops (manual step) rather than auto-retry.
4. The withheld cancelFee stays with the platform (no transfer needed).

### c.5 Transfers OTP (the one dashboard switch that matters)

Live transfers normally require an OTP sent to the business phone; with OTP ON, `POST /transfer`
returns `status:"otp"` and needs `POST /transfer/finalize_transfer {transfer_code, otp}` [D:api-transfer].
For an unattended marketplace this blocks automation. Two ways to disable [D:single-transfers]:
- **Dashboard (recommended):** Settings → Preferences → uncheck "Confirm transfers before
  sending". Owner action, reversible, auditable.
- API: `POST /transfer/disable_otp` then `POST /transfer/disable_otp_finalize` with the OTP
  sent to the business phone [D:api-transfer sidebar: Transfers Control].
Code must handle `status:"otp"` regardless (surfaced to admin with a "finalize" affordance).

---

## (d) Webhook handler spec — `POST /api/paystack/webhook` (new route)

**Route:** `src/app/api/paystack/webhook/route.ts`, `export const dynamic = "force-dynamic"`.
Next.js App Router gives the raw bytes directly: `const raw = await req.text()` — no JSON
middleware can mutate it (this is the Next.js equivalent of mounting `express.raw()` BEFORE
`express.json()` [R:rn-checkout] [R:commit-gear] [D:webhooks]).

1. **Signature check first, always** [D:webhooks]:
   ```ts
   import { createHmac, timingSafeEqual } from "node:crypto";
   const sig = req.headers.get("x-paystack-signature") ?? "";
   const computed = createHmac("sha512", secretKey).update(raw, "utf8").digest("hex");
   const a = Buffer.from(computed, "utf8"), b = Buffer.from(sig, "utf8");
   if (a.length !== b.length || !timingSafeEqual(a, b)) return new Response("invalid signature", { status: 401 });
   ```
   (HMAC-SHA512 of the RAW body keyed with the secret key; `timingSafeEqual` + length check
   per [R:paystack-js] webhooks.ts — NOT the plain `!==` of the official sample [R:sample-express-backend].)
   With no secret configured: acknowledge 200 and ignore (inert by design — nothing to forge).
2. **Parse + allowlist**: `JSON.parse(raw)`; accept only:
   `charge.success`, `charge.failed`, `transfer.success`, `transfer.failed`,
   `transfer.reversed`, `refund.processing`, `refund.processed`, `refund.failed`,
   `refund.pending`. Unknown events → 200 + log (Paystack retries non-200 for 72h in live mode:
   every 3 min × 4, then hourly for 72h; test mode hourly × 10h, 30s timeout [D:webhooks] —
   never punish it with 5xx for events we simply don't handle).
3. **Idempotency ledger** (Paystack POSTs the same event multiple times; the payload has NO
   event id — it is `{event, data}` [D:webhooks] [L]):
   dedupe key = `${event}:${data.reference ?? data.id}`. Insert into `PaystackEvent` with a
   UNIQUE eventId; on conflict → 200 immediately, no state change. (This also gives us a
   replay-proof audit trail: the full raw payload is stored verbatim.)
4. **Dispatch** (each handler re-verifies via the REST API before mutating money state —
   defense-in-depth per [R:commit-gear]'s verifyTransaction and [D:verify-payments]):
   - `charge.success` → look up PaymentEvent by `data.reference`; missing → log orphan (200).
     Verify `GET /transaction/verify/:reference`; require success + amount match; atomic-claim
     PENDING→CONFIRMED; transition `payment-confirmed`. (Webhook and pay-verify race safely —
     exactly today's callback/pay-confirm race, already proven idempotent.)
   - `charge.failed` → PaymentEvent → FAILED. NOTE: docs say webhooks are currently sent for
     successful transactions only [D:verify-payments]; abandonment is handled by the verify/
     timeout path, so treat this event as best-effort.
   - `transfer.success|failed|reversed` → resolve Payout by `data.reference`; amount check;
     PENDING/PROCESSING → PAID / FAILED / REVERSED; record `data.fee_charged`; ShipmentEvent +
     notifications; `transfer.reversed` additionally pages admins (money returned to balance —
     the driver did NOT get paid).
   - `refund.*` → PaymentEvent → REFUNDED + ShipmentEvent + notification (see c.4).
5. **Always 200 fast**; long work must not block the ack [D:webhooks]. Our handlers are all
   sub-second DB writes, so no queue needed yet; wrap the whole dispatch in try/catch →
   log + 200 on internal error (Paystack's 72h retry is the safety net) — mirror of the
   existing mpesa callback philosophy [C: src/app/api/mpesa/callback/route.ts].
6. **IP whitelist note** [D:webhooks]: Paystack webhooks originate only from
   `52.31.139.75`, `52.49.173.169`, `52.214.14.220` (test AND live). With HMAC-SHA512 +
   timingSafeEqual the signature is the primary control; the IP check is optional
   defense-in-depth (Netlify doesn't expose client IP filtering simply — note as accepted
   residual risk, mitigated by the signature).
7. **Dashboard change required:** the live webhook URL currently points at the Supabase edge
   function `https://fnlyuabpiqwqaohztdbn.supabase.co/functions/v1/paystack-webhook` (per the
   owner's setup). It must be repointed to `https://mizigo.netlify.app/api/paystack/webhook`
   before go-live. Keep the Supabase one as a documented fallback while migrating.

---

## (e) Ledger schema — Prisma evolution (additive, no breaking changes)

Aligned with the existing PaymentEvent/Payout/PaymentCallback-doc pattern in
[C: prisma/schema.prisma]. SQLite-safe (String enums validated in code, JSON strings).

```prisma
// ── evolve: PaymentEvent (keep checkoutReqId as the provider reference, unique) ──
model PaymentEvent {
  id             String   @id @default(cuid())
  shipmentId     String
  checkoutReqId  String   @unique          // Paystack reference | Daraja CheckoutRequestID | mock id
  provider       String   @default("MOCK") // MOCK | PAYSTACK | DARAJA
  method         String                     // MPESA | CARD | CASH
  amount         Int                        // whole KES (fareTotal)
  amountSubunits Int?                       // provider payload amount (cents) for reconciliation
  currency       String   @default("KES")
  status         String                     // PENDING | CONFIRMED | FAILED | TIMEOUT | REFUNDED
  mpesaReceipt   String?                    // keep: Daraja receipt / generic display receipt
  providerTxId   String?                    // Paystack transaction id (u64 as string!)
  channel        String?                    // mobile_money | card …
  feesCharged    Int?                       // subunits — from verify/webhook (fees / fee_charged)
  providerMeta   String?                    // JSON: authorization_url, access_code, raw response…
  verifiedAt     DateTime?                  // when a verify call or valid webhook confirmed it
  refundedSubunits Int?                     // partial refund total for this payment
  createdAt      DateTime @default(now())
  shipment       Shipment @relation(fields: [shipmentId], references: [id], onDelete: Cascade)
  @@index([shipmentId])
  @@index([provider, status])
}

// ── new: webhook idempotency ledger (also the audit trail) ──
model PaystackEvent {
  id         String   @id @default(cuid())
  eventId    String   @unique   // "<event>:<data.reference ?? data.id>"
  event      String             // charge.success | transfer.success | …
  reference  String?            // data.reference
  payload    String             // raw body verbatim (JSON string)
  status     String   @default("RECEIVED") // RECEIVED | PROCESSED | IGNORED | ORPHAN
  errorNote  String?
  createdAt  DateTime @default(now())
  processedAt DateTime?
  @@index([event, createdAt])
}

// ── evolve: Payout — tie to shipment, capture the transfer lifecycle ──
model Payout {
  id            String   @id @default(cuid())
  driverId      String
  shipmentId    String?            // POD payouts; null for driver-initiated withdrawals
  amount        Int                // whole KES
  method        String   @default("MPESA")   // MPESA (sandbox) | PAYSTACK_MPESA | PAYSTACK_BANK
  status        String   @default("PAID")    // PENDING | PROCESSING | PAID | FAILED | REVERSED
  ref           String?            // display ref (existing column)
  reference     String?  @unique   // transfer reference po-… (≥16 chars, [a-z0-9_-]) — retry key
  transferCode  String?            // TRF_…
  recipientCode String?            // RCP_…
  currency      String   @default("KES")
  feeCharged    Int?               // subunits, from transfer webhook/verify
  failureReason String?
  initiatedBy   String   @default("SYSTEM")  // SYSTEM (auto POD) | ADMIN | DRIVER
  createdAt     DateTime @default(now())
  processedAt   DateTime?
  @@index([driverId, status])
  @@index([shipmentId])
}

// ── evolve: Driver — payout destination (created once via /transferrecipient) ──
model Driver {
  // … existing fields …
  payoutType            String?  // mobile_money | kepss
  payoutAccountNumber   String?  // 2547XXXXXXXX (M-Pesa) | bank account number
  payoutBankCode        String?  // MPESA | ATL_KE | 97 | 68 (Equity) | 01 (KCB) …
  payoutBankName        String?  // display name from /bank list
  payoutRecipientCode   String?  // RCP_…  (the reusable payout handle)
  payoutSetupAt         DateTime?
}
```

Rules: **every status flip is driven by a verified webhook or a verify-call** — never by a
client action alone, never from webhook payload amounts without the expected-amount check.
Transaction ids are unsigned 64-bit — store as String [D:api-transaction]. Keep
`Shipment.paymentStatus/paymentRef/paidAt` as the denormalised read-model the UI already uses;
PaymentEvent/Payout/PaystackEvent are the immutable ledgers.

DDL regeneration: prisma db push (sqlite local) + the production-migrate workflow already
handles Supabase; add the new tables to src/lib/ddl.ts's CREATE TABLE list (existing
convention for the sqlite boot path) and bump scripts/mizigo_schema_reset.mjs if it enumerates
tables explicitly.

---

## (f) Fees — current, cited, with dates — and unit economics

Sources fetched TODAY: [D:support-transactions] "Transactions pricing" (article footer:
"Edited Tuesday, September 15 2026"), [D:support-transfers] "Transfers" (search-index date
Sep 28, 2026), plus LIVE fee evidence from the account's own transactions [L].

**Collections (Kenya, KES):**
| Channel | Fee | Source |
|---|---|---|
| M-PESA (local) | **1.5%** | [D:support-transactions]; VERIFIED LIVE: KES 10.00 mobile_money tx (ref T283348702722238, 2026-02-01) charged fees 15 cents = 1.5% exactly [L] |
| Local cards | 2.9% | [D:support-transactions] |
| International cards (Mastercard/Visa/Amex/Apple Pay) | 3.8% | [D:support-transactions]; VERIFIED LIVE: KES 1,500 card tx (ref lpsyegknyq, 2026-02-03) charged KES 57 = 3.8% [L] |
| No flat fee, no cap documented for KES (the NGN 100/2000 cap is Nigeria-only) | — | [D:support-transactions] |

**Transfers OUT (Kenya) [D:support-transfers]:**
| Rail | Band | Fee |
|---|---|---|
| M-PESA customer wallet (B2C) — the driver payout rail | KES 10–1,500 | KES 20 |
| 〃 | KES 1,501–20,000 | KES 40 |
| 〃 | KES 20,001–250,000 | KES 60 |
| Bank transfer (kepss) | KES 10–10,000 | KES 80 |
| 〃 | KES 10,001–50,000 | KES 120 |
| 〃 | KES 50,001–999,999 | KES 140 |
| Limits | M-Pesa wallet: min KES 10 / max KES 250,000 per transfer; bank max KES 50,000,000 | [D:support-transfers] |

**Unit economics — KES 3,000 job, 12% commission, KES 100 platform fee (nairobi zone maths,
payout via M-Pesa wallet):**
```
Customer pays (checkout, M-Pesa)              KES 3,000.00
Paystack collection fee 1.5%                    −   45.00   → settled to balance  2,955.00
Driver share = 3000 − 100(platform) − 360(comm)  2,540.00
M-Pesa B2C transfer fee (1,501–20,000 band)      −   40.00
────────────────────────────────────────────────────────────
Platform net on the job                          KES  375.00
  (= commission 360 + platform fee 100 − Paystack 85 = 375)
Bank payout instead (KES 80 band ≤10,000): platform net = KES 335.00
Effective all-in Paystack cost: 2.83% of job value (M-Pesa payout) / 4.17% (bank payout)
```
Same numbers for a KES 10,000 job (12%): commission 1,200 + platform 100 − fees (150 collect
+ 40 payout) = **net KES 1,110** (M-Pesa payout). Margin scales fine; small jobs (KES 900
minimum fare) net ≈ 900×12%+100 − 13.5 − 20 ≈ KES 174.
Implication: **driver payouts should default to M-Pesa wallets** (KES 40 beats bank KES 80/120
for typical job sizes) — bank payout offered as an option.

---

## (g) Security rules

1. **Secret keys server-side only.** `PAYSTACK_SECRET_KEY` lives in Netlify env / GitHub
   secrets only. Never `NEXT_PUBLIC_*`, never in the client bundle, never in logs. The docs
   say it explicitly [D:accept-payments]; paystack-js validates `sk_` prefix at construction
   [R:paystack-js]. The live secret key is used in shell commands only — it must never be
   written to any file in this repo (docs, worklog, notes, tests).
2. **DB-encrypted key storage (optional, recommended before scale):** store keys
   AES-256-GCM-encrypted in `PlatformSetting` (`paystack.secret.live` etc.:
   `iv:tag:ciphertext`, base64) with the master key `PAYSTACK_MASTER_KEY` in env only;
   resolution order: env `PAYSTACK_SECRET_KEY` → decrypted DB value. Lets the owner rotate the
   key from the admin UI without a redeploy. Never store the master key in the DB.
3. **Separate live/test configs:** `PAYSTACK_SECRET_KEY` (live) and `PAYSTACK_SECRET_KEY_TEST`
   (only if/when the owner creates a test integration). CI e2e uses the MOCK provider (zero
   keys) — the existing suites keep passing unchanged. A `PAYSTACK_MODE=live|test` switch
   selects which key the adapter loads; default live (the account is live-only today).
4. **Webhook hardening:** HMAC-SHA512 + `timingSafeEqual` (§d); event allowlist; idempotency
   ledger; 401 (not 500) on bad signatures; optional IP allowlist (52.31.139.75,
   52.49.173.169, 52.214.14.220) [D:webhooks].
5. **Amount integrity:** every confirm path recomputes the expected amount from the Shipment
   row and compares against `data.amount` in subunits [D:verify-payments] [R:commit-gear]
   [R:rn-checkout]. Reject + log on mismatch (underpayment attack).
6. **State integrity:** money state flips only from (a) a signature-verified webhook, or
   (b) a server-to-server verify call, through the atomic-claim pattern. Client actions may
   only *request* these. Reference reuse is bounded by the attempt counter; transfer retries
   MUST reuse the same reference [D:single-transfers].
7. **PII/recipient hygiene:** driver payout details are stored once, only server-written
   (driver submits via their session action; validated with the /bank list codes); the
   recipient_code is the only thing shared with Paystack on each payout.
8. **Audit:** AuditLog rows for payout release/refund admin actions (existing `audit()` helper);
   PaystackEvent rows are the raw provider audit trail.

---

## (h) Reference-repo scorecard (all four cloned to research-repos/)

| Repo | What it is | Does well | Does poorly | What we adopt |
|---|---|---|---|---|
| **PaystackOSS/sample-express-backend** [R] | Official 50-line Express sample (initialize + webhook) | Exact official HMAC-SHA512 webhook shape; initialize pass-through of extra params | Signs `JSON.stringify(req.body)` AFTER `express.json()` — the body was already parsed, so the signature can break on any re-serialization; plain `!==` compare (no timingSafeEqual); zero idempotency; no verify call; no amount check | Nothing verbatim — treat as the *shape* reference only. Our Next.js route reads `req.text()` directly, which sidesteps its core flaw |
| **funpm/paystack-rn-checkout-server** [R] | RN checkout backend example (initialize/verify/webhook) | Webhook route defined BEFORE `express.json()` with `express.raw()` + an explicit comment explaining WHY (raw bytes for HMAC); event switch incl. transfer.*; loud "verify amount or you'll be underpaid" warnings; verify retry loop (2s delay, 3 retries, 3s interval); reference generation; CORS locked to app origin | No timingSafeEqual; no persistent dedupe (console.log handlers); returns 500 on parse errors (forces pointless retries) | The raw-body-before-parser rule (maps to `await req.text()` in our route); the amount-mismatch warning as a code comment; the verify-retry cadence for the callback page |
| **Weber-droid/commit-gear** [R] | TS marketplace backend w/ DI, providers, Paystack + Mock | `PaymentProvider` interface + `MockPaystackProvider`; env-gated provider selection in the container; service-level idempotency (`paymentStatus === 'paid'` → `{processed:false}`); `AMOUNT_MISMATCH` AppError; `verify()` fallback that only runs while status is pending (self-healing missed webhooks); re-derives authorization URL from stored reference; controller tests | Signature check is plain `!==`; allowlist only charge.* (no transfer.*); no event-id ledger (dedupes purely on order state); Mongo-shaped models | The interface itself (§b is a superset of it); mock provider + env-gated selection (matches our inert-by-design); verify-only-while-pending; the amount-mismatch rejection |
| **SCOnyema/paystack-js** [R] | Typed Node SDK covering transactions/splits/subaccounts/recipients/transfers/webhooks | `verifyWebhookSignature` = `createHmac('sha512')` + `timingSafeEqual` with length guard — the correct verification primitive, verbatim; complete typed resource/param/response surfaces (matches the official API exactly incl. `InitiateTransferParams{source:'balance', amount, recipient, reason?, currency?, reference?}`); axios retry; `sk_` key validation | No webhook handler logic beyond signature verification; axios-centric (we use fetch); bulk transfer hardcodes NGN | Its `webhooks.ts` as-is for our signature function; its types as the reference for our adapter's request/response shapes |

Adopt-set summary: raw-body HMAC + timingSafeEqual (paystack-js), raw-body-before-parser
discipline (rn-checkout), PaymentProvider + mock + env gating (commit-gear), amount-mismatch
rejection (commit-gear + rn-checkout), verify-as-webhook-fallback (commit-gear + official docs),
atomic-claim idempotency (our existing mpesa callback — keep), reference-reuse transfer retries
(official docs).

---

## (i) Test plan for our situation

**1. Live read-only verification — DONE today (all GET, live key, zero side effects):**
- `GET /balance` → `{"status":true,"data":[{"currency":"KES","balance":0}]}` — live balance KES 0.
- `GET /transaction?currency=KES` → 22 total (2 success, 18 abandoned, 2 failed; meta
  total_volume 285300 cents = KES 2,853 all-time). Successes: KES 1,500 card (fees KES 57 =
  3.8%, international card) and **KES 10 mobile_money (fees KES 0.15 = 1.5%) — M-Pesa
  collection is LIVE-PROVEN on this account**. The abandoned ones are from a Feb 2026 Lovable
  e-commerce prototype (localhost:8080 referrer) — unrelated to mizigo.
- `GET /transfer?perPage=3` → `{"data":[],"meta":{"total":0,…}}` — no transfers ever.
- `GET /transferrecipient` → exactly ONE live recipient: Jack Blessed Kimani Kaguri,
  `RCP_64ryl02jjtmtv3f`, type `mobile_money`, bank_code `MPESA`, account_number `0721725958`
  (leading-0 phone accepted), currency KES — the owner already smoke-tested recipient creation.
- `GET /subaccount` → 0. `GET /page` (the real path — **`/payment-page` is a 404**, the
  endpoint is `/page`) → 0 pages.
- `GET /bank?currency=KES&perPage=100` → 54 institutions, each with `type` (the recipient
  type to use), `code`, `name`, `slug`. Highlights: **M-PESA = code `MPESA`, type
  `mobile_money`**; Airtel Kenya `ATL_KE` (mobile_money); Telkom `97` (mobile_money);
  M-PESA Paybill `MPPAYBILL` + M-PESA Till `MPTILL` (type `mobile_money_business` — B2B only);
  banks are type **`kepss`**: Equity `68`, KCB `01`, Co-op `11`, Absa `03`, NCBA `07`,
  Standard Chartered `02`, Stanbic `31`, DTB `63`, Family `70`, Sidian `66`, HFC `61`,
  SBM `60`, Stima Sacco `89`, Vooma `93`, NCBA Loop `138`, … (full list captured; the driver
  payout UI consumes this endpoint live, cached).

**2. Signed simulated webhook POSTs (local dev, no real money):** the endpoint can be
exercised without Paystack by computing the signature ourselves:
```sh
BODY='{"event":"charge.success","data":{"reference":"MZG482913A1","amount":300000,"currency":"KES","id":123,"status":"success"}}'
SIG=$(node -e "const c=require('crypto');process.stdout.write(c.createHmac('sha512',process.env.SK).update(process.argv[1]).digest('hex'))" "$BODY")
curl -s -X POST http://localhost:3000/api/paystack/webhook -H "content-type: application/json" -H "x-paystack-signature: $SIG" -d "$BODY"
```
Cases to assert (unit + e2e, MOCK provider everywhere): valid charge.success flips a PENDING
PaymentEvent exactly once; **replay of the identical event** → 200, zero state change
(PaystackEvent ledger hit); wrong signature → 401, zero DB writes; amount mismatch → event
stored as IGNORED with errorNote, PaymentEvent stays PENDING; unknown reference → ORPHAN log;
transfer.success/failed/reversed drive Payout states incl. fee capture; refund.processed sets
REFUNDED. Existing e2e suite (60/60) must stay green with no env keys (MOCK path byte-identical).

**3. Requires owner approval / owner actions (never do these from CI):**
- Repoint the live webhook URL (dashboard → Settings → Webhooks) from the Supabase edge
  function to `https://mizigo.netlify.app/api/paystack/webhook` (keep a note of the old URL).
- Confirm the live callback URL stays `https://mizigo.netlify.app/...` (it already points at
  mizigo.netlify.app; our per-transaction `callback_url` overrides it anyway).
- Disable transfers OTP (dashboard Preferences → uncheck "Confirm transfers before sending")
  — required for automated POD payouts; or decide to keep OTP ON and have ops finalize each
  payout manually at first.
- Set `PAYSTACK_SECRET_KEY` in Netlify env (and optionally in GitHub secrets for
  production-e2e smoke tests) — the live secret key is passed by the owner, never committed.
- First real transaction: a small live M-Pesa charge (e.g. KES 10–50, the owner's own phone)
  then a live KES 10 M-Pesa payout to the existing RCP_ recipient to watch
  transfer.success end-to-end. **Minimum viable go-live smoke.**
- Optional later: create a TEST Paystack integration for CI (test M-Pesa phone
  `+254 710 000 000`, no PIN/OTP needed; test transfers always succeed) [D:test-payments].

**4. Staged rollout order (recommendation):** (1) ship the PaymentProvider refactor with
MOCK only — zero behavior change, all suites green; (2) enable Paystack collections
(`pay`/`pay-verify`/webhook) with a live smoke charge; (3) enable payouts (recipient setup +
POD transfer) after the first real collection lands; (4) refunds last (cancellation economics
already compute amounts).

---

## 10. Fetched-doc index (all fetched live today; archived under /tmp/paystack-docs/)

- https://paystack.com/docs/payments/accept-payments — initialize from backend, callback_url,
  verify-before-value, never-secret-key-in-frontend
- https://paystack.com/docs/payments/webhooks — HMAC-SHA512 raw-body signature,
  x-paystack-signature, retry schedule (live 3min×4 then hourly×72h; test hourly×10h),
  IP allowlist, event table, Webhook Events API
- https://paystack.com/docs/payments/verify-payments — statuses
  (abandoned/failed/ongoing/pending/processing/queued/reversed/success), response.status vs
  data.status, "webhooks only for successful transactions" caveat, double-fulfilment warning
- https://paystack.com/docs/payments/payment-channels — mobile money/Charge API, provider
  codes (mpesa, mpesa_offline, mptill, atl…), 180s authorisation window, phone format
  2547…/+2547…, channel field "mobile_money"
- https://paystack.com/docs/payments/split-payments — subaccounts + percentage_charge
  (why we DON'T use it: drivers must not be paid before POD)
- https://paystack.com/docs/payments/refunds — POST /refund, refund.* webhooks,
  needs-attention retry
- https://paystack.com/docs/payments/test-payments — test M-Pesa +254 710 000 000 etc.
- https://paystack.com/docs/transfers — feature available in Kenya; overview
- https://paystack.com/docs/transfers/single-transfers — recipient types
  (kepss/mobile_money/nuban/ghipss/basa), transfer reference rules (16–50 chars,
  [a-z0-9_-], retry same reference), disable-OTP dashboard path, transfer.* webhook payloads
- https://paystack.com/docs/api/transaction — initialize/verify field reference (channels,
  reference charset, metadata, split_code/subaccount), response shapes
- https://paystack.com/docs/api/transfer — POST /transfer (source/amount/recipient/reference/
  reason/currency/account_reference), statuses pending|otp, verify endpoint + fee_charged
- https://paystack.com/docs/api/transfer-recipient — POST /transferrecipient fields,
  duplicate→existing-record semantics, RCP_ codes
- https://support.paystack.com/en/articles/2130306 (Transactions pricing, "Edited Tuesday,
  September 15 2026") — KE: 1.5% M-PESA, 2.9% local cards, 3.8% international
- https://support.paystack.com/en/articles/2132866 (Transfers) — KE transfer fee bands +
  min/max amounts (table in §f)
- https://support.paystack.com/en/articles/2128386 (Pay with Mobile Money) — KE 1.5% confirmation
- https://paystack.com/pricing (Nigeria default render; Kenya values come from the support
  articles above) — /ke/pricing is Cloudflare-gated for bots; support articles are the
  citable source

## 11. Surprises that change the plan (main-agent must-read)

1. **Kenyan bank recipient type is `kepss`, not `nuban`** — the bank list's `type` field is
   the authoritative recipient type per institution [L]. M-Pesa wallet recipients are
   `mobile_money` + bank_code `MPESA`.
2. **`/payment-page` is a 404** — the pages endpoint is `GET /page` [L].
3. **M-Pesa collection + payout rails are already live-proven on this account** (a KES 10
   mobile_money charge succeeded Feb 2026 at exactly 1.5%, and an M-PESA recipient exists) —
   the integration is lower-risk than assumed; the balance is just KES 0, so the first payout
   needs a successful collection first (or a top-up).
4. **Commission mismatch:** schema/seed/terms say 15%, the owner's brief says 12%. Before
   launch: set the nairobi zone commissionRate to 0.12 in the live DB (admin or migration) and
   update /terms copy — otherwise receipts, take-rate transparency cards, and payouts will
   disagree with the owner's intent.
5. **Transaction references may NOT contain underscores** (`-`, `.`, `=` + alphanumerics
   only) [D:api-transaction] — while TRANSFER references REQUIRE [a-z0-9_-] and ≥16 chars.
   Two different builders needed (§c.1 `MZG482913A1`, §c.3 `po-mzg482913-01`).
6. **The live webhook currently targets the Supabase edge function**, not our app — repointing
   it is an owner dashboard action (§i.3); until then charge.success will NOT reach the
   Next.js app (the callback-page verify path covers the gap, but webhooks are the source of truth).
7. **Webhooks are sent for successful transactions only** [D:verify-payments] — failure/
   abandonment handling must lean on verify + timeout sweeps, which our plan already does.
8. Amounts are in CENTS for KES (×100), and transaction ids are u64 → store as strings.
