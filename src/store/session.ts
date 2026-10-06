"use client";
// MIZIGO session store — role routing, demo sessions, booking draft.
// The booking draft is the progressive cargo-first flow state.

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type { PlaceHit } from "@/lib/types";
import type { Lang } from "@/lib/i18n";

export type Surface = "welcome" | "customer" | "driver" | "admin" | "track";
export type CustomerTab = "home" | "trips" | "wallet" | "account";
export type DriverTab = "home" | "requests" | "trips" | "earnings" | "account";
export type BookingStep =
  | "idle" | "cargo" | "pickup" | "dropoff" | "vehicle" | "review" | "payment" | "quotes"
  | "matching" | "active" | "receipt" | "rate" | "problem";

export interface DraftItem { name: string; qty: number; weightKg: number }

export interface SessionUser {
  id: string; phone: string; name: string; role: string;
  accountType: string; businessName: string | null; avatarSeed: string;
}

interface SessionState {
  surface: Surface;
  trackToken: string | null;
  user: SessionUser | null;
  driverId: string | null;
  customerTab: CustomerTab;
  driverTab: DriverTab;
  adminTab: string;
  bookingStep: BookingStep;
  focusShipmentId: string | null;
  // rating + chat sheets (deep-link targets — session-scoped, never persisted)
  ratingShipmentId: string | null;
  chatShipmentId: string | null;
  // booking draft (cargo-first)
  draft: {
    draftId: string;
    category: string | null;
    items: DraftItem[];
    load: string;
    helpers: number;
    special: string[];
    notes: string;
    pickup: PlaceHit | null;
    pickupNote: string;
    pickupContact: string;
    pickupPhone: string;
    dropoff: PlaceHit | null;
    dropoffNote: string;
    dropoffContact: string;
    dropoffPhone: string;
    stops: PlaceHit[];
    when: "NOW" | "SCHEDULE";
    scheduledAt: string | null;
    selectedVehicle: string | null;
    paymentMethod: "MPESA" | "CASH" | "CARD";
    promoCode: string;
    quoteMode: boolean;
    repeatOf: string | null;
  };
  lang: Lang;
  setLang: (l: Lang) => void;
  setSurface: (s: Surface) => void;
  setTrackToken: (t: string | null) => void;
  setUser: (u: SessionUser | null, driverId?: string | null) => void;
  setCustomerTab: (t: CustomerTab) => void;
  setDriverTab: (t: DriverTab) => void;
  setAdminTab: (t: string) => void;
  setBookingStep: (s: BookingStep) => void;
  setFocusShipment: (id: string | null) => void;
  setRatingShipment: (id: string | null) => void;
  setChatShipment: (id: string | null) => void;
  patchDraft: (p: Partial<SessionState["draft"]>) => void;
  resetDraft: (keep?: boolean) => void;
  logout: () => void;
}

const newDraftId = () => `d-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const emptyDraft = () => ({
  draftId: `d-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  category: null,
  items: [] as DraftItem[],
  load: "MEDIUM",
  helpers: 0,
  special: [] as string[],
  notes: "",
  pickup: null as PlaceHit | null,
  pickupNote: "",
  pickupContact: "",
  pickupPhone: "",
  dropoff: null as PlaceHit | null,
  dropoffNote: "",
  dropoffContact: "",
  dropoffPhone: "",
  stops: [] as PlaceHit[],
  when: "NOW" as const,
  scheduledAt: null,
  selectedVehicle: null,
  paymentMethod: "MPESA" as const,
  promoCode: "",
  quoteMode: false,
  repeatOf: null,
});

export const useSession = create<SessionState>()(
  persist(
    (set, get) => ({
      surface: "welcome",
      trackToken: null,
      user: null,
      driverId: null,
      customerTab: "home",
      driverTab: "home",
      adminTab: "overview",
      bookingStep: "idle",
      focusShipmentId: null,
      ratingShipmentId: null,
      chatShipmentId: null,
      lang: "en" as Lang,
      setLang: (lang) => set({ lang }),
      draft: emptyDraft(),
      setSurface: (surface) => set({ surface }),
      setTrackToken: (trackToken) => set({ trackToken, surface: trackToken ? "track" : get().surface }),
      setUser: (user, driverId = null) => set({ user, driverId }),
      setCustomerTab: (customerTab) => set({ customerTab }),
      setDriverTab: (driverTab) => set({ driverTab }),
      setAdminTab: (adminTab) => set({ adminTab }),
      setBookingStep: (bookingStep) => set({ bookingStep }),
      setFocusShipment: (focusShipmentId) => set({ focusShipmentId }),
      setRatingShipment: (ratingShipmentId) => set({ ratingShipmentId }),
      setChatShipment: (chatShipmentId) => set({ chatShipmentId }),
      patchDraft: (p) => set({ draft: { ...get().draft, ...p } }),
      resetDraft: (keep) => set({ draft: { ...emptyDraft(), ...(keep ? { pickup: get().draft.pickup, dropoff: get().draft.dropoff, category: get().draft.category, items: get().draft.items, load: get().draft.load } : {}) } }),
      logout: () => set({ user: null, driverId: null, surface: "welcome", bookingStep: "idle", focusShipmentId: null, ratingShipmentId: null, chatShipmentId: null, draft: emptyDraft() }),
    }),
    {
      name: "mizigo-session",
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({ surface: s.surface, trackToken: s.trackToken, user: s.user, driverId: s.driverId, customerTab: s.customerTab, driverTab: s.driverTab, adminTab: s.adminTab, lang: s.lang }),
    }
  )
);
