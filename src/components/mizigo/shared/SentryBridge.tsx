"use client";

// MIZIGO — Sentry client bootstrap.
//
// INTENTIONALLY UNMOUNTED (this component is not imported anywhere yet): it
// exists so go-live is a 2-step swap —
//   1. set NEXT_PUBLIC_SENTRY_DSN in the build environment (client env vars
//      MUST carry the NEXT_PUBLIC_ prefix; a plain SENTRY_DSN is server-only
//      and never reaches the browser bundle), and
//   2. mount <SentryBridge /> once inside the client shell (e.g. next to the
//      theme provider in src/app/page.tsx's client root).
// Until then it is dead code to the bundler — zero bytes in any client chunk.
//
// Behavior when mounted WITHOUT the env var: renders null and never imports
// the SDK (inert, same guarantee as the server-side instrumentation.ts).

import { useEffect } from "react";

export default function SentryBridge() {
  useEffect(() => {
    const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;
    if (!dsn) return; // inert — no keys, no SDK import, no network
    import("@sentry/nextjs")
      .then((Sentry) => {
        Sentry.init({
          dsn,
          tracesSampleRate: 0.1,
          environment: process.env.NODE_ENV,
        });
      })
      .catch((err) => console.error("[sentry] client init failed", err));
  }, []);
  return null;
}
