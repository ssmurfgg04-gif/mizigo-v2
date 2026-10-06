// MIZIGO — Africa's Talking SMS integration (OTP + future notifications).
//
// INERT BY DESIGN: sendSMS() returns { ok: false } without any network I/O
// when the AT_API_KEY / AT_USERNAME env vars are absent. In that mode the
// auth OTP flow keeps its exact sandbox behavior (code echoed in-app) —
// byte-identical demo output until keys are swapped in.
//
// Env vars (all optional):
//   AT_API_KEY    Africa's Talking API key (sandbox: "sandbox" works for tests)
//   AT_USERNAME   "sandbox" for the AT sandbox, or your production username
//   AT_SENDER_ID  optional alphanumeric sender ID / short code (production)

const API_URL = "https://api.africastalking.com/1/message/messenger";
const TIMEOUT_MS = 5_000;

/** True only when both required AT credentials are present — the master switch. */
export function isAtEnabled(): boolean {
  return !!(process.env.AT_API_KEY?.trim() && process.env.AT_USERNAME?.trim());
}

/** Normalise a Kenyan mobile number to E.164 (2547XXXXXXXX) for the `to` field. */
function toE164(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.startsWith("254")) return digits;
  if (digits.startsWith("0")) return `254${digits.slice(1)}`;
  if (digits.length === 9) return `254${digits}`;
  return digits;
}

export interface SmsResult {
  ok: boolean;
  messageId?: string;
  cost?: string;
  error?: string;
}

/**
 * Send an SMS via Africa's Talking.
 * Catches every failure (timeout, HTTP error, AT-side rejection) and returns
 * `{ ok: false, error }` — callers fall back to current behavior; nothing throws.
 */
export async function sendSMS(phone: string, message: string): Promise<SmsResult> {
  const apiKey = process.env.AT_API_KEY?.trim();
  const username = process.env.AT_USERNAME?.trim();
  if (!apiKey || !username) {
    return { ok: false, error: "Africa's Talking is not configured (missing AT_API_KEY / AT_USERNAME)" };
  }
  const senderId = process.env.AT_SENDER_ID?.trim();

  const params = new URLSearchParams({
    username,
    to: toE164(phone),
    message: message.slice(0, 320), // sane cap; AT's own limit is 765 chars
  });
  if (senderId) params.set("from", senderId);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(API_URL, {
      method: "POST",
      headers: {
        apiKey,
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: params.toString(),
      signal: controller.signal,
    });
    const text = await res.text();
    let data: unknown;
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      console.error(`[africastalking] sendSMS — non-JSON response (HTTP ${res.status})`, text.slice(0, 200));
      return { ok: false, error: `Africa's Talking returned a non-JSON response (HTTP ${res.status})` };
    }
    if (!res.ok) {
      const desc = (data as { message?: string })?.message ?? "";
      console.error(`[africastalking] sendSMS — HTTP ${res.status}`, desc);
      return { ok: false, error: `Africa's Talking HTTP ${res.status}: ${desc || "send failed"}` };
    }
    // { SMSMessageData: { Recipients: [{ messageId, status, statusCode, cost } ] } }
    const recipients = (data as { SMSMessageData?: { Recipients?: { messageId?: string; status?: string; statusCode?: number | string; cost?: string }[] } })
      ?.SMSMessageData?.Recipients ?? [];
    const first = recipients[0];
    const sentOk = String(first?.statusCode) === "101" || /success/i.test(first?.status ?? "");
    if (!sentOk) {
      console.error("[africastalking] sendSMS — recipient rejected", first);
      return { ok: false, error: first?.status || "Recipient rejected by Africa's Talking" };
    }
    console.log(`[africastalking] sendSMS ok · ${toE164(phone)} · ${first?.messageId ?? ""}`);
    return { ok: true, messageId: first?.messageId, cost: first?.cost };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    const timedOut = controller.signal.aborted;
    console.error(`[africastalking] sendSMS — ${timedOut ? `timed out after ${TIMEOUT_MS}ms` : reason}`);
    return { ok: false, error: timedOut ? `Africa's Talking request timed out after ${TIMEOUT_MS}ms` : reason };
  } finally {
    clearTimeout(timer);
  }
}
