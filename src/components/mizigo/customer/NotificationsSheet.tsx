"use client";
// Notification centre — the bell on customer home. Rows carry a type
// (status / rate / chat / promo / system), unread state and relative time, and
// deep-link into the right surface: rating sheet, driver chat, or the delivery
// detail (live screen while in progress). Unresolvable rows give honest toast
// feedback — nothing taps silently anymore.

import { useEffect } from "react";
import { CheckCheck, ChevronRight, X } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import type { CustomerHome, ShipmentDTO } from "@/lib/types";
import { relTimeEAT } from "@/lib/format";
import { post } from "@/lib/api-client";
import { useSettings } from "@/components/mizigo/shared/useSettings";
import { toast } from "@/hooks/use-toast";
import { KIND_ICON, useNotificationOpen } from "./notification-link";

type Notification = CustomerHome["notifications"][number];

export default function NotificationsSheet({
  notifications,
  trips,
  active,
  onClose,
}: {
  notifications: Notification[];
  trips?: CustomerHome["trips"];
  active?: ShipmentDTO | null;
  onClose: () => void;
}) {
  const settings = useSettings();
  const qc = useQueryClient();
  const open = useNotificationOpen({ trips, active });
  const unread = notifications.filter((n) => !n.read).length;

  // Esc closes — the sheet is a dialog
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const markAll = async () => {
    try {
      await post("/api/customer", { action: "notifications-read" });
      await qc.invalidateQueries({ queryKey: ["customer-home"] });
    } catch (e) {
      toast({ title: "Couldn't mark all read", description: (e as Error).message, variant: "destructive" });
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end bg-[rgba(23,24,28,0.45)]" onClick={onClose}>
      <div
        className="flex max-h-[74%] w-full animate-mz-slide-up flex-col rounded-t-[18px] bg-[var(--surface)] sheet-shadow"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Notifications"
      >
        <div className="flex items-center gap-3 border-b border-[var(--line)] px-5 py-4">
          <div className="min-w-0 flex-1">
            <p className="text-[16px] font-extrabold tracking-tight">Notifications</p>
            <p className="text-[11.5px] font-semibold text-[var(--ink-3)]">
              {unread > 0 ? `${unread} unread · ` : ""}support {settings.supportPhone}
            </p>
          </div>
          {unread > 0 && (
            <button
              onClick={() => void markAll()}
              className="flex h-10 items-center gap-1.5 rounded-full bg-[var(--surface-2)] px-3.5 text-[12px] font-bold text-[var(--brand-deep)] transition hover:bg-[var(--brand-soft)]"
              aria-label="Mark all notifications as read"
            >
              <CheckCheck size={14} /> Mark all read
            </button>
          )}
          <button onClick={onClose} className="flex h-10 w-10 items-center justify-center rounded-full bg-[var(--surface-2)]" aria-label="Close notifications">
            <X size={17} />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto thin-scrollbar">
          {notifications.length === 0 ? (
            <p className="py-10 text-center text-[13px] font-medium text-[var(--ink-3)]">You&apos;re all caught up. Delivery updates will appear here.</p>
          ) : (
            notifications.map((n) => {
              const Icon = KIND_ICON[n.kind] ?? KIND_ICON.system;
              return (
                <button
                  key={n.id}
                  onClick={() => {
                    onClose();
                    void open(n);
                  }}
                  className={`flex w-full items-start gap-3 border-b border-[var(--line)] px-5 py-3.5 text-left transition last:border-b-0 hover:bg-[var(--surface-2)] ${
                    n.read ? "" : "bg-[var(--brand-soft)]"
                  }`}
                  aria-label={`${n.read ? "" : "Unread. "}${n.title}. ${n.body}`}
                >
                  <span
                    className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${
                      n.kind === "rate" ? "bg-[var(--brand)] text-white" : "bg-[var(--brand-soft)] text-[var(--brand-deep)]"
                    }`}
                    aria-hidden="true"
                  >
                    <Icon size={14} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5 text-[13.5px] font-bold">
                      {!n.read && <span className="h-2 w-2 shrink-0 rounded-full bg-[var(--brand)]" aria-hidden="true" />}
                      <span className="truncate">{n.title}</span>
                    </span>
                    <span className="block text-[12px] font-medium leading-snug text-[var(--ink-2)]">{n.body}</span>
                    <span className="block text-[11px] font-semibold text-[var(--ink-3)]">
                      {relTimeEAT(n.createdAt)}
                      {n.shipmentCode && n.shipmentCode !== "recent" ? ` · ${n.shipmentCode}` : ""}
                    </span>
                  </span>
                  <ChevronRight size={15} className="mt-1.5 shrink-0 text-[var(--ink-3)]" />
                </button>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
