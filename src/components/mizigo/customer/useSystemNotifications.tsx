"use client";
// Web Notifications API bridge — shows a system notification for NEW delivery
// events while the page is hidden (with permission), diffed against the
// last-seen event persisted in localStorage. Permission is only ever requested
// from an explicit user action (Account → Enable). Clicking a notification
// focuses the tab and runs the same deep-link as the in-app notification centre.

import { useEffect, useRef } from "react";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import type { CustomerHome } from "@/lib/types";
import { useSession } from "@/store/session";
import { useNotificationOpen } from "./notification-link";

const LAST_SEEN_KEY = "mizigo:notif-last-seen";
export const PERM_EVENT = "mizigo:notif-perm";

export type PermState = "granted" | "denied" | "default" | "unsupported";

export function permissionState(): PermState {
  if (typeof window === "undefined" || !("Notification" in window)) return "unsupported";
  return Notification.permission;
}

/** Current permission, kept in sync after an explicit request elsewhere. */
export function useNotificationPermission(): PermState {
  const [perm, setPerm] = useState<PermState>("unsupported");
  useEffect(() => {
    const sync = () => setPerm(permissionState());
    sync();
    window.addEventListener(PERM_EVENT, sync);
    return () => window.removeEventListener(PERM_EVENT, sync);
  }, []);
  return perm;
}

/** Ask the browser for notification permission — call ONLY from an explicit user action. */
export async function requestNotificationPermission(): Promise<PermState> {
  if (typeof window === "undefined" || !("Notification" in window)) return "unsupported";
  try {
    const p = await Notification.requestPermission();
    window.dispatchEvent(new Event(PERM_EVENT));
    return p;
  } catch {
    return "denied";
  }
}

/**
 * Renders nothing. While the customer app is visible it keeps the shared
 * customer-home cache warm; while the page is hidden it raises system
 * notifications for events newer than the persisted last-seen marker.
 */
export function SystemNotifications() {
  const { user } = useSession();
  const perm = useNotificationPermission();
  const enabled = !!user && perm === "granted";

  const { data } = useQuery({
    queryKey: ["customer-home", user?.id],
    queryFn: () => api<CustomerHome>("/api/customer"),
    enabled,
    refetchInterval: 15_000,
    refetchIntervalInBackground: true, // the whole point: catch events while hidden
    retry: 1,
  });

  const open = useNotificationOpen({ trips: data?.trips, active: data?.active });
  const openRef = useRef(open);
  useEffect(() => {
    openRef.current = open; // the system-notification click handler runs later than this effect
  }, [open]);

  useEffect(() => {
    const list = data?.notifications;
    if (!enabled || !list?.length) return;
    const newest = list[0].createdAt; // server orders newest first
    let last: string | null = null;
    try {
      last = localStorage.getItem(LAST_SEEN_KEY);
    } catch {
      last = null;
    }
    if (!last) {
      // first run: baseline only — never replay history as system notifications
      try {
        localStorage.setItem(LAST_SEEN_KEY, newest);
      } catch {
        /* private mode — no baseline, nothing to diff against */
      }
      return;
    }
    const fresh = list.filter((n) => n.createdAt > last!);
    if (!fresh.length) return;
    if (document.hidden) {
      for (const n of fresh.slice(-5)) {
        try {
          const sys = new Notification(n.title, { body: n.body, tag: n.id, icon: "/icon-192.png" });
          sys.onclick = () => {
            window.focus();
            void openRef.current(n);
          };
        } catch {
          // some browsers require a Service Worker for the constructor — skip quietly
        }
      }
    }
    // consume what the user has already seen in-app (visible) or just notified (hidden)
    try {
      localStorage.setItem(LAST_SEEN_KEY, newest);
    } catch {
      /* ignore */
    }
  }, [data?.notifications, enabled]);

  return null;
}
