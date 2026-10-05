"use client";
// Notification centre bottom sheet — the bell on customer home opens this.
// Rows deep-link into the relevant delivery (plan §40 notification deep-links).
import { Bell, ChevronRight, X } from "lucide-react";
import type { CustomerHome } from "@/lib/types";
import { relTimeEAT } from "@/lib/format";
import { useSession } from "@/store/session";
import { useSettings } from "@/components/mizigo/shared/useSettings";

type Notification = CustomerHome["notifications"][number];

export default function NotificationsSheet({ notifications, trips, onClose }: { notifications: Notification[]; trips?: CustomerHome["trips"]; onClose: () => void }) {
  const { setFocusShipment, setCustomerTab } = useSession();
  const settings = useSettings();

  const open = (code: string | null) => {
    onClose();
    if (!code) {
      setCustomerTab("trips");
      return;
    }
    // deep-link: resolve the code to a shipment id, then open its detail
    const target = (trips ?? []).find((t) => t.code === code);
    if (target) {
      setFocusShipment(target.id);
      setCustomerTab("trips");
    } else {
      setCustomerTab("trips");
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end bg-[rgba(23,24,28,0.45)]" onClick={onClose}>
      <div
        className="flex max-h-[74%] w-full animate-mz-slide-up flex-col rounded-t-[18px] bg-[var(--surface)] sheet-shadow"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Notifications"
      >
        <div className="flex items-center gap-3 border-b border-[var(--line)] px-5 py-4">
          <div className="min-w-0 flex-1">
            <p className="text-[16px] font-extrabold tracking-tight">Notifications</p>
            <p className="text-[11.5px] font-semibold text-[var(--ink-3)]">Delivery updates · support {settings.supportPhone}</p>
          </div>
          <button onClick={onClose} className="flex h-10 w-10 items-center justify-center rounded-full bg-[var(--surface-2)]" aria-label="Close notifications">
            <X size={17} />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {notifications.length === 0 ? (
            <p className="py-10 text-center text-[13px] font-medium text-[var(--ink-3)]">You&apos;re all caught up. Delivery updates will appear here.</p>
          ) : (
            notifications.map((n) => (
              <button
                key={n.id}
                onClick={() => open(n.shipmentCode)}
                className="flex w-full items-start gap-3 border-b border-[var(--line)] px-5 py-3.5 text-left transition last:border-b-0 hover:bg-[var(--surface-2)]"
              >
                <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--brand-soft)] text-[var(--brand)]"><Bell size={14} /></span>
                <span className="flex-1">
                  <span className="block text-[13.5px] font-bold">{n.title}</span>
                  <span className="block text-[12px] font-medium text-[var(--ink-2)]">{n.body}</span>
                  <span className="block text-[11px] font-semibold text-[var(--ink-3)]">{relTimeEAT(n.createdAt)}{n.shipmentCode && n.shipmentCode !== "recent" ? ` · ${n.shipmentCode}` : ""}</span>
                </span>
                <ChevronRight size={15} className="mt-1.5 shrink-0 text-[var(--ink-3)]" />
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
