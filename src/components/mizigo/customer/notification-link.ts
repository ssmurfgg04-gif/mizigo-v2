"use client";
// Notification deep-link engine — one routine shared by the notification centre,
// the wallet list and system (web) notifications. Resolves the row to a shipment
// (linked id → loaded lists → fetch by id — never a silent fall-through), opens
// the right surface, and auto-opens the rating sheet or driver chat per type.

import { Bell, MessageCircle, Star, Tag, Truck } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { api, post } from "@/lib/api-client";
import type { CustomerHome, ShipmentDTO } from "@/lib/types";
import { useSession } from "@/store/session";
import { toast } from "@/hooks/use-toast";
import { ACTIVE_STATES } from "@/lib/state-machine";
import { isRateable } from "./RatingSheet";

export type NotificationRow = CustomerHome["notifications"][number];

/** Per-type row icon: status=truck, rate=star, promo=tag, chat=message, system=bell. */
export const KIND_ICON: Record<string, LucideIcon> = {
  status: Truck,
  rate: Star,
  promo: Tag,
  chat: MessageCircle,
  system: Bell,
};

/**
 * Deep-link a notification row.
 * rate  → rating sheet (the linked delivery, else the latest unrated one)
 * chat  → the shipment chat (live screen if still in progress)
 * status/other → the shipment detail (live screen if still in progress)
 * Unresolvable rows give honest toast feedback — nothing taps silently.
 */
export function useNotificationOpen(lists?: { trips?: ShipmentDTO[]; active?: ShipmentDTO | null }) {
  const { setFocusShipment, setCustomerTab, setBookingStep, setRatingShipment, setChatShipment } = useSession();
  const qc = useQueryClient();

  return async (n: NotificationRow) => {
    // 1. mark the row read (best effort) + refresh the bell badge
    post("/api/customer", { action: "notifications-read", id: n.id })
      .then(() => qc.invalidateQueries({ queryKey: ["customer-home"] }))
      .catch(() => {});

    // 2. resolve the shipment: linked id → loaded lists → fetch by id
    const pool = [...(lists?.trips ?? []), ...(lists?.active ? [lists.active] : [])];
    let s: ShipmentDTO | null = null;
    if (n.shipmentId) s = pool.find((t) => t.id === n.shipmentId) ?? null;
    else if (n.shipmentCode) s = pool.find((t) => t.code === n.shipmentCode) ?? null;
    if (!s && n.shipmentId) {
      try {
        s = (await api<{ shipment: ShipmentDTO }>(`/api/shipments/${n.shipmentId}`)).shipment;
      } catch {
        s = null; // deleted / not ours → honest feedback below
      }
    }

    const openLive = (target: ShipmentDTO) => {
      setFocusShipment(target.id);
      setBookingStep("active");
    };
    const openDetail = (target: ShipmentDTO) => {
      setFocusShipment(target.id);
      setCustomerTab("trips");
    };

    // 3. route by kind
    if (n.kind === "rate" || (s && isRateable(s))) {
      // the rating intent: the linked delivery if it's rateable, else the latest unrated one
      const target = (s && isRateable(s) ? s : null) ?? pool.find((t) => isRateable(t)) ?? null;
      if (target) {
        setFocusShipment(target.id);
        setRatingShipment(target.id);
        setCustomerTab("trips");
        return;
      }
      if (s) {
        // linked, but already rated or still in flight → open it + honest feedback
        if (ACTIVE_STATES.includes(s.status)) openLive(s);
        else openDetail(s);
        toast(
          s.ratings.some((r) => r.byRole === "CUSTOMER")
            ? { title: "Already rated", description: "You already rated this delivery — asante!" }
            : { title: "Delivery in progress", description: "You can rate the driver once the delivery is completed." }
        );
        return;
      }
      toast({ title: "Nothing to rate yet", description: "Once a delivery is completed, rate the driver from here or your trips." });
      return;
    }

    if (s) {
      if (n.kind === "chat") setChatShipment(s.id);
      if (ACTIVE_STATES.includes(s.status)) openLive(s);
      else openDetail(s);
      return;
    }

    // 4. unresolvable — honest feedback, never a silent no-op
    if (n.shipmentCode && n.shipmentCode !== "recent") {
      toast({ title: "Delivery not found", description: `We couldn't find ${n.shipmentCode} on your account.` });
    } else {
      toast({ title: "No delivery attached", description: "This update isn't linked to one of your deliveries." });
    }
  };
}
