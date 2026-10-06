// MIZIGO — Next.js server instrumentation hook (Next 16 loads this file from
// the repo root automatically; it also accepts src/instrumentation.ts).
//
// SENTRY, INERT BY DESIGN: when SENTRY_DSN is unset, register() returns before
// the SDK is ever imported and onRequestError is a no-op — zero behavior
// change, zero bundle impact on the live demo. Set SENTRY_DSN in the Netlify
// env to light up server-side error tracking (key swap, nothing else).
//
// Note: the CLIENT side needs NEXT_PUBLIC_SENTRY_DSN (client env must be
// inlined at build time) — see src/components/mizigo/shared/SentryBridge.tsx
// (intentionally unmounted until then).

export async function register(): Promise<void> {
  if (!process.env.SENTRY_DSN) return; // inert — no keys, no SDK, no I/O
  try {
    const Sentry = await import("@sentry/nextjs");
    Sentry.init({
      dsn: process.env.SENTRY_DSN,
      tracesSampleRate: 0.1,
      environment: process.env.NODE_ENV,
    });
    console.log("[sentry] server instrumentation registered");
  } catch (err) {
    // Telemetry must never take the app down (e.g. SDK import failure on an
    // exotic runtime). init() itself does not throw when the DSN is reachable
    // or not — events are simply dropped if Sentry can't be contacted.
    console.error("[sentry] server init failed (continuing without telemetry)", err);
  }
}

// Next.js calls this for every unhandled request error (App Router) with
// (error, request, context). Types written structurally to match Next's
// InstrumentationOnRequestError and Sentry's captureRequestError signature
// (verified against @sentry/nextjs 11.4.0 build/types/common/captureRequestError.d.ts).
export const onRequestError = async (
  error: unknown,
  request: Readonly<{ path: string; method: string; headers: Record<string, string | string[] | undefined> }>,
  context: Readonly<{ routerKind: string; routePath: string; routeType: string; renderSource?: string; revalidateReason?: string }>
): Promise<void> => {
  if (!process.env.SENTRY_DSN) return; // inert
  try {
    const Sentry = await import("@sentry/nextjs");
    Sentry.captureRequestError(error, request, context);
  } catch (err) {
    console.error("[sentry] onRequestError reporting failed", err);
  }
};
