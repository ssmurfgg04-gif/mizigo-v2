// MIZIGO — Paystack adapter (marketplace hold-then-payout wiring).
// Spec source: docs/research/PAYSTACK_WIRING_BLUEPRINT.md (§b architecture,
// §c call sequences, §d webhook, §g security) — every rule here is traceable
// to that doc, which cites official Paystack docs + live API observations.
//
// House rules (mirror daraja.ts):
//   * inert by design — zero network I/O while no key is configured
//   * NEVER throws — every failure is a { ok: false, error } return
//   * 10s AbortController timeout on every call
//   * structured console logs, secrets never logged
//
// Key resolution order (§g.2): env PAYSTACK_SECRET_KEY → AES-256-GCM-encrypted
// PlatformSetting row (`paystack.secret.live` / `.test`), decrypted with
// PAYSTACK_MASTER_KEY (env only, never in the DB). PAYSTACK_MODE=live|test
// picks which pair loads (default live — the account is live-only today).

import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { db } from "@/lib/db";

const API = "https://api.paystack.co";
const TIMEOUT_MS = 10_000;

// ─── key resolution ─────────────────────────────────────────────────────────

export function isPaystackEnabledSync(): boolean {
  return !!envSecret();
}

function envSecret(): string | undefined {
  const mode = (process.env.PAYSTACK_MODE ?? "live").trim().toLowerCase();
  const key = mode === "test" ? process.env.PAYSTACK_SECRET_KEY_TEST : process.env.PAYSTACK_SECRET_KEY;
  const v = (key ?? "").trim();
  return v.startsWith("sk_") ? v : undefined;
}

let dbKeyCache: { secret: string; at: number } | null = null;
const DB_KEY_TTL_MS = 60_000;

/** AES-256-GCM encrypt → "v1:iv:tag:ciphertext" (all base64). */
export function encryptSecret(plaintext: string, masterKey: string): string {
  const key = Buffer.from(masterKey, "base64");
  if (key.length !== 32) throw new Error("PAYSTACK_MASTER_KEY must be 32 bytes base64");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return `v1:${iv.toString("base64")}:${cipher.getAuthTag().toString("base64")}:${enc.toString("base64")}`;
}

/** Decrypt "v1:iv:tag:ciphertext" — throws on tamper/wrong key (GCM auth). */
export function decryptSecret(blob: string, masterKey: string): string {
  const [v, ivB, tagB, dataB] = blob.split(":");
  if (v !== "v1" || !ivB || !tagB || !dataB) throw new Error("bad secret blob");
  const key = Buffer.from(masterKey, "base64");
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivB, "base64"));
  decipher.setAuthTag(Buffer.from(tagB, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(dataB, "base64")), decipher.final()]).toString("utf8");
}

/**
 * The live/test secret key for this instance: env first, then the encrypted
 * DB row. Cached 60s per instance. Null = Paystack not configured (inert).
 */
export async function resolvePaystackSecret(): Promise<string | null> {
  const env = envSecret();
  if (env) return env;
  if (dbKeyCache && Date.now() - dbKeyCache.at < DB_KEY_TTL_MS) return dbKeyCache.secret;
  const master = (process.env.PAYSTACK_MASTER_KEY ?? "").trim();
  if (!master) return null;
  try {
    const mode = (process.env.PAYSTACK_MODE ?? "live").trim().toLowerCase();
    const row = await db.platformSetting.findUnique({ where: { key: `paystack.secret.${mode}` } });
    if (!row?.value) return null;
    const secret = decryptSecret(row.value, master);
    dbKeyCache = { secret, at: Date.now() };
    return secret;
  } catch (err) {
    console.error("[paystack] encrypted DB key could not be decrypted (check PAYSTACK_MASTER_KEY)", (err as Error).message);
    return null;
  }
}

/**
 * The secret used to VERIFY webhook signatures: the provider key when
 * configured, else PAYSTACK_WEBHOOK_SECRET (a CI-only override that lets the
 * e2e suites exercise the full signature/idempotency path while `pay` stays
 * on the MOCK provider — it never enables provider calls by itself).
 */
export async function resolveWebhookSecret(): Promise<string | null> {
  return (await resolvePaystackSecret()) ?? ((process.env.PAYSTACK_WEBHOOK_SECRET ?? "").trim() || null);
}

// ─── webhook signature (§d.1 — the paystack-js primitive: HMAC-SHA512 of the
// RAW body + timingSafeEqual with length guard; NOT plain !== comparison) ────

export function verifyPaystackSignature(rawBody: string, signature: string, secret: string): boolean {
  try {
    const computed = createHmac("sha512", secret).update(rawBody, "utf8").digest("hex");
    const a = Buffer.from(computed, "utf8");
    const b = Buffer.from(signature, "utf8");
    return a.length === b.length && timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

// ─── low-level API call (never throws; 10s timeout; typed) ──────────────────

async function call<T>(
  secret: string,
  method: "GET" | "POST",
  path: string,
  body?: unknown,
): Promise<{ ok: true; data: T } | { ok: false; error: string; status?: number }> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${API}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${secret}`,
        "Content-Type": "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: ctl.signal,
    });
    const json = (await res.json().catch(() => null)) as
      | { status?: boolean; message?: string; data?: T }
      | null;
    if (!res.ok || !json || json.status !== true) {
      return { ok: false, error: json?.message ?? `Paystack ${res.status} on ${path}`, status: res.status };
    }
    return { ok: true, data: json.data as T };
  } catch (err) {
    return { ok: false, error: (err as Error).name === "AbortError" ? `Paystack timeout on ${path}` : (err as Error).message };
  } finally {
    clearTimeout(timer);
  }
}

// ─── transaction (collection) API — §c.1 ─────────────────────────────────────

export interface InitializeArgs {
  email: string;
  amountSubunits: number; // KES cents (fareTotal × 100)
  reference: string;      // MZG<6>A<attempt> — NO underscores (api charset)
  callbackUrl: string;
  metadata?: Record<string, unknown>;
}

export interface InitializeResult {
  authorization_url: string;
  access_code: string;
  reference: string;
}

export function paystackTxReference(shipmentCode: string, attempt: number): string {
  // transaction references allow ONLY "-", ".", "=" + alphanumerics (§11.5)
  return `MZG${shipmentCode.replace(/\D/g, "")}A${Math.max(1, attempt)}`;
}

export async function initializeTransaction(
  secret: string,
  args: InitializeArgs,
): Promise<{ ok: true; data: InitializeResult } | { ok: false; error: string }> {
  return call<InitializeResult>(secret, "POST", "/transaction/initialize", {
    email: args.email,
    amount: args.amountSubunits,
    currency: "KES",
    reference: args.reference,
    callback_url: args.callbackUrl,
    channels: ["mobile_money"], // M-Pesa first (Nairobi reality); cards can be widened later
    metadata: args.metadata,
  });
}

export interface VerifyResult {
  status: "success" | "failed" | "abandoned" | "ongoing" | "pending" | "processing" | "queued" | "reversed";
  amount: number;        // subunits
  currency: string;
  reference: string;
  id: number;            // u64 — store as string in our ledger
  channel: string;       // mobile_money | card …
  fees: number;          // subunits charged by Paystack
  paid_at?: string;
  customer_email: string;
}

export async function verifyTransaction(
  secret: string,
  reference: string,
): Promise<{ ok: true; data: VerifyResult } | { ok: false; error: string }> {
  return call<VerifyResult>(secret, "GET", `/transaction/verify/${encodeURIComponent(reference)}`);
}

export async function refundTransaction(
  secret: string,
  transactionReference: string,
  amountSubunits?: number,
): Promise<{ ok: true; data: { id: number; status: string } } | { ok: false; error: string }> {
  return call<{ id: number; status: string }>(secret, "POST", "/refund", {
    transaction: transactionReference,
    ...(amountSubunits ? { amount: amountSubunits } : {}),
  });
}

// ─── transfer (payout) API — §c.2/§c.3 ───────────────────────────────────────

export type RecipientType = "mobile_money" | "kepss"; // KE truth (§11.1): banks are kepss, NOT nuban

export interface RecipientArgs {
  type: RecipientType;
  name: string;
  accountNumber: string; // 2547XXXXXXXX (M-Pesa) | bank account number
  bankCode: string;      // MPESA | ATL_KE | 97 | 68 (Equity) | 01 (KCB) …
}

export async function createTransferRecipient(
  secret: string,
  args: RecipientArgs,
): Promise<{ ok: true; data: { recipient_code: string; details: { bank_name?: string } } } | { ok: false; error: string }> {
  return call<{ recipient_code: string; details: { bank_name?: string } }>(secret, "POST", "/transferrecipient", {
    type: args.type,
    name: args.name,
    account_number: args.accountNumber,
    bank_code: args.bankCode,
    currency: "KES",
    description: "MIZIGO driver payout",
  });
}

export interface TransferArgs {
  amountSubunits: number;
  recipientCode: string;
  reference: string; // po-mzg482913-01 — ≥16 chars, [a-z0-9_-], RETRY THE SAME (§c.3)
  reason: string;
}

export interface TransferResult {
  transfer_code: string;
  status: "pending" | "otp" | "success" | "failed";
}

/** Transfer reference builder — the charset rules differ from transactions (§11.5). */
export function paystackTransferReference(shipmentCode: string, seq: number): string {
  const digits = shipmentCode.replace(/\D/g, "").toLowerCase().padStart(6, "0"); // ≥16 chars guaranteed
  return `po-mzg-${digits}-${String(seq).padStart(2, "0")}`; // e.g. po-mzg-482913-01 (16–50 chars, [a-z0-9_-])
}

export async function createTransfer(
  secret: string,
  args: TransferArgs,
): Promise<{ ok: true; data: TransferResult } | { ok: false; error: string }> {
  return call<TransferResult>(secret, "POST", "/transfer", {
    source: "balance",
    amount: args.amountSubunits,
    recipient: args.recipientCode,
    reference: args.reference,
    reason: args.reason,
    currency: "KES",
  });
}

export async function verifyTransfer(
  secret: string,
  reference: string,
): Promise<{ ok: true; data: { status: string; fee_charged?: number } } | { ok: false; error: string }> {
  return call<{ status: string; fee_charged?: number }>(secret, "GET", `/transfer/verify/${encodeURIComponent(reference)}`);
}

// ─── bank list (driver payout UI — cached 24h in-process) ────────────────────

export interface KeBank {
  name: string;
  code: string;
  type: RecipientType | "mobile_money_business" | string;
  slug?: string;
}

let bankCache: { at: number; banks: KeBank[] } | null = null;
const BANK_TTL_MS = 24 * 60 * 60_000;

export async function listKenyanBanks(secret: string): Promise<{ ok: true; banks: KeBank[] } | { ok: false; error: string }> {
  if (bankCache && Date.now() - bankCache.at < BANK_TTL_MS) return { ok: true, banks: bankCache.banks };
  const res = await call<KeBank[]>(secret, "GET", "/bank?currency=KES&perPage=100");
  if (!res.ok) return res;
  bankCache = { at: Date.now(), banks: res.data };
  return { ok: true, banks: res.data };
}
