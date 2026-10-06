// MIZIGO — Safaricom Daraja (M-PESA) integration.
//
// INERT BY DESIGN: every function short-circuits (isEnabled() === false) when
// the DARAJA_* env vars are absent. Without keys this module performs zero
// network I/O and the app behaves byte-identically to the sandbox demo — the
// current STK flow stays a server-side simulation until keys are provided.
//
// Env vars (all optional; all five required to go live):
//   DARAJA_ENV            "sandbox" | "production"   (default: sandbox)
//   DARAJA_CONSUMER_KEY   Daraja app consumer key
//   DARAJA_CONSUMER_SECRET Daraja app consumer secret
//   DARAJA_SHORTCODE      Business shortcode (Paybill / Till)
//   DARAJA_PASSKEY        Lipa Na M-PESA Online passkey
//   DARAJA_CALLBACK_URL   Public https URL Daraja POSTs results to
//                         (e.g. https://mizigo.netlify.app/api/mpesa/callback)
//
// Go-live is a key swap: set the six vars in Netlify env and restart —
// `initiateMpesaPayment()` (src/lib/integrations/index.ts) starts issuing
// real STK pushes and /api/mpea/callback starts receiving Daraja results.

// ─────────────────────────────────────────────────────────────────────────────
// Config
// ─────────────────────────────────────────────────────────────────────────────

export interface DarajaConfig {
  env: "sandbox" | "production";
  consumerKey: string;
  consumerSecret: string;
  shortcode: string;
  passkey: string;
  callbackUrl: string;
}

/** Resolve the full config, or null when any required key is missing (inert). */
export function darajaConfig(): DarajaConfig | null {
  const consumerKey = process.env.DARAJA_CONSUMER_KEY?.trim();
  const consumerSecret = process.env.DARAJA_CONSUMER_SECRET?.trim();
  const shortcode = process.env.DARAJA_SHORTCODE?.trim();
  const passkey = process.env.DARAJA_PASSKEY?.trim();
  const callbackUrl = process.env.DARAJA_CALLBACK_URL?.trim();
  if (!consumerKey || !consumerSecret || !shortcode || !passkey || !callbackUrl) {
    return null;
  }
  return {
    env: process.env.DARAJA_ENV?.trim() === "production" ? "production" : "sandbox",
    consumerKey,
    consumerSecret,
    shortcode,
    passkey,
    callbackUrl,
  };
}

/** True only when every Daraja key is present — the master switch. */
export function isDarajaEnabled(): boolean {
  return darajaConfig() !== null;
}

function baseUrl(cfg: DarajaConfig): string {
  return cfg.env === "production"
    ? "https://api.safaricom.co.ke"
    : "https://sandbox.safaricom.co.ke";
}

// ─────────────────────────────────────────────────────────────────────────────
// Shared plumbing — 5s AbortController timeout, typed JSON, structured logs
// ─────────────────────────────────────────────────────────────────────────────

const TIMEOUT_MS = 5_000;

async function darajaFetch<T>(
  url: string,
  init: RequestInit,
  logLabel: string
): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    const text = await res.text();
    let data: unknown;
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      console.error(`[daraja] ${logLabel} — non-JSON response (HTTP ${res.status})`, text.slice(0, 200));
      return { ok: false, error: `Daraja returned a non-JSON response (HTTP ${res.status})` };
    }
    if (!res.ok) {
      const desc = (data as { errorMessage?: string; ResponseDescription?: string }) ?? {};
      console.error(`[daraja] ${logLabel} — HTTP ${res.status}`, desc.errorMessage ?? desc.ResponseDescription ?? data);
      return { ok: false, error: `Daraja HTTP ${res.status}: ${desc.errorMessage ?? desc.ResponseDescription ?? "request failed"}` };
    }
    return { ok: true, data: data as T };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    const timedOut = controller.signal.aborted;
    console.error(`[daraja] ${logLabel} — ${timedOut ? `timed out after ${TIMEOUT_MS}ms` : reason}`);
    return { ok: false, error: timedOut ? `Daraja request timed out after ${TIMEOUT_MS}ms` : reason };
  } finally {
    clearTimeout(timer);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// OAuth access token — cached in-module (Daraja tokens live ~1h; refresh 55min)
// ─────────────────────────────────────────────────────────────────────────────

interface TokenCache {
  token: string;
  expiresAt: number; // epoch ms
}

let tokenCache: TokenCache | null = null;
const TOKEN_TTL_MS = 55 * 60_000;

/** Fetch (or reuse) an OAuth access token. Returns null on any failure. */
export async function getAccessToken(): Promise<string | null> {
  const cfg = darajaConfig();
  if (!cfg) return null;
  if (tokenCache && tokenCache.expiresAt > Date.now() + 60_000) {
    return tokenCache.token;
  }
  const basic = Buffer.from(`${cfg.consumerKey}:${cfg.consumerSecret}`).toString("base64");
  const res = await darajaFetch<{ access_token?: string; expires_in?: string }>(
    `${baseUrl(cfg)}/oauth/v1/generate?grant_type=client_credentials`,
    { headers: { Authorization: `Basic ${basic}` } },
    "getAccessToken"
  );
  if (!res.ok || !res.data.access_token) {
    return null; // already logged by darajaFetch
  }
  tokenCache = { token: res.data.access_token, expiresAt: Date.now() + TOKEN_TTL_MS };
  console.log(`[daraja] getAccessToken ok (${cfg.env})`);
  return tokenCache.token;
}

// ─────────────────────────────────────────────────────────────────────────────
// STK push (Lipa Na M-PESA Online)
// ─────────────────────────────────────────────────────────────────────────────

export interface StkPushArgs {
  amount: number; // whole KES
  phone: string; // 07…, 2547… or 7… — normalised to 2547XXXXXXXX
  accountRef: string; // shown on the customer's M-PESA statement (e.g. MZG-123456)
  description: string; // TransactionDesc (≤13 chars safe; Daraja truncates)
}

export type StkPushResult =
  | {
      ok: true;
      MerchantRequestID: string;
      CheckoutRequestID: string;
      ResponseCode: string; // "0" = accepted for processing
      ResponseDescription: string;
    }
  | { ok: false; error: string };

/** Normalise a Kenyan mobile number to E.164 without "+" (2547XXXXXXXX). */
export function toMsisdn(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.startsWith("254")) return digits;
  if (digits.startsWith("0")) return `254${digits.slice(1)}`;
  if (digits.length === 9) return `254${digits}`;
  return digits;
}

/** yyyyMMddHHmmss in EAT (UTC+3) — matches Daraja's timestamp convention. */
export function darajaTimestamp(now = new Date()): string {
  const eat = new Date(now.getTime() + 3 * 60 * 60 * 1000);
  return eat.toISOString().replace(/[-:T]/g, "").slice(0, 14);
}

/** base64(shortcode + passkey + timestamp) — the STK security credential. */
function stkPassword(cfg: DarajaConfig, timestamp: string): string {
  return Buffer.from(`${cfg.shortcode}${cfg.passkey}${timestamp}`).toString("base64");
}

/** Prompt the customer's phone with an M-PESA PIN dialog for `amount`. */
export async function stkPush(args: StkPushArgs): Promise<StkPushResult> {
  const cfg = darajaConfig();
  if (!cfg) return { ok: false, error: "Daraja is not configured (missing DARAJA_* env vars)" };
  const token = await getAccessToken();
  if (!token) return { ok: false, error: "Could not obtain a Daraja access token" };

  const timestamp = darajaTimestamp();
  const msisdn = toMsisdn(args.phone);
  const payload = {
    BusinessShortCode: cfg.shortcode,
    Password: stkPassword(cfg, timestamp),
    Timestamp: timestamp,
    TransactionType: "CustomerPayBillOnline",
    Amount: Math.max(1, Math.round(args.amount)),
    PartyA: msisdn,
    PartyB: cfg.shortcode,
    PhoneNumber: msisdn,
    CallBackURL: cfg.callbackUrl,
    AccountReference: args.accountRef.slice(0, 12),
    TransactionDesc: args.description.slice(0, 13),
  };

  const res = await darajaFetch<{
    MerchantRequestID?: string;
    CheckoutRequestID?: string;
    ResponseCode?: string;
    ResponseDescription?: string;
  }>(
    `${baseUrl(cfg)}/mpesa/stkpush/v1/processrequest`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    },
    `stkPush ${args.accountRef} KES ${payload.Amount}`
  );

  if (!res.ok) return { ok: false, error: res.error };
  const d = res.data;
  if (!d.MerchantRequestID || !d.CheckoutRequestID || d.ResponseCode !== "0") {
    // Daraja answered, but rejected the push (bad shortcode/passkey/phone…)
    console.error("[daraja] stkPush rejected", d);
    return { ok: false, error: d.ResponseDescription || "Daraja rejected the STK push" };
  }
  console.log(`[daraja] stkPush accepted · ${args.accountRef} · KES ${payload.Amount} · CheckoutRequestID ${d.CheckoutRequestID}`);
  return {
    ok: true,
    MerchantRequestID: d.MerchantRequestID,
    CheckoutRequestID: d.CheckoutRequestID,
    ResponseCode: d.ResponseCode,
    ResponseDescription: d.ResponseDescription ?? "Success. Request accepted for processing",
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// STK query — reconcile a push whose callback never arrived (timeouts)
// ─────────────────────────────────────────────────────────────────────────────

export interface StkQueryResult {
  ok: boolean; // did the query itself succeed
  found: boolean; // ResponseCode "0" → a result exists for this CheckoutRequestID
  resultCode?: string;
  resultDesc?: string;
  error?: string;
}

/** Ask Daraja for the final state of an STK push (timeout reconciliation). */
export async function stkQuery(checkoutRequestId: string): Promise<StkQueryResult> {
  const cfg = darajaConfig();
  if (!cfg) return { ok: false, found: false, error: "Daraja is not configured" };
  const token = await getAccessToken();
  if (!token) return { ok: false, found: false, error: "Could not obtain a Daraja access token" };

  const timestamp = darajaTimestamp();
  const res = await darajaFetch<{ ResponseCode?: string; ResponseDescription?: string; ResultCode?: string; ResultDesc?: string }>(
    `${baseUrl(cfg)}/mpesa/stkpushquery/v1/query`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        BusinessShortCode: cfg.shortcode,
        Password: stkPassword(cfg, timestamp),
        Timestamp: timestamp,
        CheckoutRequestID: checkoutRequestId,
      }),
    },
    `stkQuery ${checkoutRequestId}`
  );

  if (!res.ok) return { ok: false, found: false, error: res.error };
  const code = res.data.ResponseCode ?? "";
  // "0" → the push has a final result; otherwise the push is unknown/pending
  // (e.g. "500.001 … not found" — customer never completed the PIN dialog).
  if (code === "0") {
    console.log(`[daraja] stkQuery ${checkoutRequestId} → ResultCode ${res.data.ResultCode} (${res.data.ResultDesc})`);
    return { ok: true, found: true, resultCode: res.data.ResultCode, resultDesc: res.data.ResultDesc };
  }
  console.log(`[daraja] stkQuery ${checkoutRequestId} → no result yet (${res.data.ResponseDescription})`);
  return { ok: true, found: false, resultCode: code, resultDesc: res.data.ResponseDescription };
}
