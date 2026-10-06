"use client";
// App providers — TanStack Query client (server-state polling).

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, ReactNode } from "react";
import SentryBridge from "@/components/mizigo/shared/SentryBridge";

export default function Providers({ children }: { children: ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 4_000,
            retry: 1,
            refetchOnWindowFocus: false,
          },
        },
      })
  );
  return (
    <QueryClientProvider client={client}>
      {/* no-op unless NEXT_PUBLIC_SENTRY_DSN is set (client error telemetry) */}
      <SentryBridge />
      {children}
    </QueryClientProvider>
  );
}
