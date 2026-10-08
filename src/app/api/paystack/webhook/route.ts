// POST /api/paystack/webhook — the money source of truth (blueprint §d).
// Raw body → HMAC-SHA512 signature check (timingSafeEqual) → event allowlist
// → PaystackEvent idempotency ledger → dispatch through lib/payments (every
// handler re-verifies via the REST API before mutating state). Always 200
// fast on accepted events; 401 (never 5xx) on bad signatures — Paystack
// retries non-200 for 72h in live mode, so unhandled ≠ error.
import { handlePaystackWebhook } from "@/lib/payments";
import { logEvent } from "@/lib/telemetry";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  // Next.js App Router hands us the raw bytes — no JSON middleware can mutate
  // them (the Next.js equivalent of mounting express.raw() BEFORE the parser).
  const raw = await req.text();
  const signature = req.headers.get("x-paystack-signature") ?? "";
  const res = await handlePaystackWebhook(raw, signature);
  if (res.status !== 200) {
    logEvent({ level: "warn", route: "api:paystack-webhook", ok: false, extra: { note: res.note, status: res.status } });
  } else {
    logEvent({ route: "api:paystack-webhook", ok: true, extra: { note: res.note } });
  }
  return new Response(res.status === 200 ? "" : res.note, {
    status: res.status,
    headers: { "content-type": "text/plain" },
  });
}
