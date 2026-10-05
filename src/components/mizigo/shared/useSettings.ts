"use client";
// Platform settings from /api/bootstrap — admin-editable, consumed live.
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api-client";

export interface PlatformSettings {
  supportPhone: string;
  advanceBookingDays: number;
  autoDispatch: boolean;
  quoteExpiryMinutes: number;
}

const FALLBACK: PlatformSettings = {
  supportPhone: "0800 724 343",
  advanceBookingDays: 14,
  autoDispatch: true,
  quoteExpiryMinutes: 60,
};

export function useSettings() {
  const q = useQuery({
    queryKey: ["bootstrap-settings"],
    queryFn: () => api<{ settings?: PlatformSettings }>("/api/bootstrap"),
    staleTime: 60_000,
  });
  return q.data?.settings ?? FALLBACK;
}
