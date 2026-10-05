"use client";
// Customer app shell — tab bar + booking flow overlay.

import { Home, Package, Wallet, User } from "lucide-react";
import { useSession } from "@/store/session";
import Onboarding from "./Onboarding";
import BookingFlow from "./BookingFlow";
import ActiveTrip from "./ActiveTrip";
import { RateScreen, ReceiptScreen } from "./ReceiptFlow";
import { TripsScreen, WalletScreen, AccountScreen } from "./CustomerScreens";
import HomeScreen from "./HomeScreen";

const TABS = [
  { key: "home", label: "Home", icon: Home },
  { key: "trips", label: "Trips", icon: Package },
  { key: "wallet", label: "Wallet", icon: Wallet },
  { key: "account", label: "Account", icon: User },
] as const;

export default function CustomerApp() {
  const { user, customerTab, setCustomerTab, bookingStep, setBookingStep } = useSession();

  if (!user) return <Onboarding />;

  const flowActive = bookingStep !== "idle";

  // Full-bleed live screens
  if (bookingStep === "active") return <ActiveTrip />;
  if (bookingStep === "matching") return <BookingFlow />;

  return (
    <div className="flex h-full flex-col bg-[var(--paper)]">
      <div className="flex-1 overflow-y-auto thin-scrollbar">
        {flowActive ? (
          bookingStep === "rate" ? <RateScreen /> :
          bookingStep === "receipt" ? <ReceiptScreen /> :
          <BookingFlow />
        ) : (
          <div className="mx-auto w-full max-w-[480px] px-5 pt-2">
            {customerTab === "home" && <HomeScreen />}
            {customerTab === "trips" && <TripsScreen />}
            {customerTab === "wallet" && <WalletScreen />}
            {customerTab === "account" && <AccountScreen />}
          </div>
        )}
      </div>

      {/* bottom nav — hidden mid-flow */}
      {!flowActive && (
        <nav className="border-t border-[var(--line)] bg-[var(--surface)] pb-[max(env(safe-area-inset-bottom),8px)] pt-1.5" aria-label="Main">
          <div className="mx-auto flex max-w-[480px]">
            {TABS.map((t) => {
              const active = customerTab === t.key;
              return (
                <button
                  key={t.key}
                  onClick={() => setCustomerTab(t.key)}
                  className="flex flex-1 flex-col items-center gap-0.5 py-2.5 transition"
                  aria-current={active ? "page" : undefined}
                >
                  <t.icon size={21} strokeWidth={active ? 2.4 : 2} className={active ? "text-[var(--ink)]" : "text-[var(--ink-3)]"} />
                  <span className={`text-[10.5px] font-bold ${active ? "text-[var(--ink)]" : "text-[var(--ink-3)]"}`}>{t.label}</span>
                  <span className={`h-1 w-1 rounded-full ${active ? "bg-[var(--brand)]" : "bg-transparent"}`} />
                </button>
              );
            })}
          </div>
        </nav>
      )}
    </div>
  );
}
