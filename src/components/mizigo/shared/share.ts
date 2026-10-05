"use client";
// Mint-on-demand recipient tracking links (v1 security lesson: raw tokens are
// capabilities — they're only created the moment a user shares, never stored
// in the client or leaked inside DTOs).
import { post } from "@/lib/api-client";
import { toast } from "@/hooks/use-toast";

/**
 * Mint a fresh tracking link for a shipment via the `share-link` action and
 * hand it to the OS share sheet (mobile) or clipboard. Never navigates the
 * current user — sharing shouldn't pull you out of your screen.
 */
export async function shareTrackLink(shipmentId: string): Promise<string | null> {
  try {
    const r = await post<{ token: string; url: string }>(`/api/shipments/${shipmentId}/action`, { action: "share-link" });
    const url = `${location.origin}/?view=track&token=${r.token}`;
    if (navigator.share) {
      await navigator.share({ title: "Mizigo delivery tracking", text: "Follow this delivery on Mizigo", url }).catch(() => {});
    } else {
      await navigator.clipboard?.writeText(url).catch(() => {});
    }
    toast({ title: "Tracking link ready", description: "Anyone with the link can follow this delivery. No account needed." });
    return r.token;
  } catch {
    toast({ title: "Could not create link", variant: "destructive" });
    return null;
  }
}
