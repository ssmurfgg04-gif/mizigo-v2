"use client";
// Booking flow shell — cargo → pickup → dropoff → vehicle → review → (quotes | payment).
// Cargo-first per the product brief: the customer describes WHAT before WHERE.

import { useQuery } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";
import { api } from "@/lib/api-client";
import type { Bootstrap } from "@/lib/types";
import { useSession } from "@/store/session";
import { t } from "@/lib/i18n";
import CargoStep from "./CargoStep";
import LocationStep from "./LocationStep";
import VehicleStep from "./VehicleStep";
import ReviewStep from "./ReviewStep";
import PaymentStep from "./PaymentStep";
import MatchingStep from "./MatchingStep";
import QuoteMarketStep from "./QuoteMarketStep";

const STEPS = ["cargo", "pickup", "dropoff", "vehicle", "review", "payment", "matching"] as const;

export default function BookingFlow() {
  const { bookingStep, setBookingStep, draft, lang } = useSession();
  const stepIdx = STEPS.indexOf(bookingStep as (typeof STEPS)[number]);

  const { data: boot } = useQuery({
    queryKey: ["bootstrap"],
    queryFn: () => api<Bootstrap>("/api/bootstrap"),
    staleTime: 60_000,
  });

  const titles: Record<string, string> = {
    cargo: draft.category ? t("booking.howMuch", lang) : t("booking.whatAreYouMoving", lang),
    pickup: t("booking.pickupTitle", lang),
    dropoff: t("booking.dropoffTitle", lang),
    vehicle: t("booking.vehicleTitle", lang),
    review: t("booking.reviewTitle", lang),
    payment: t("booking.paymentTitle", lang),
  };

  if (bookingStep === "quotes") return <QuoteMarketStep />;
  if (["matching", "active", "receipt", "rate", "problem"].includes(bookingStep)) {
    // matching and live screens are full-bleed
    if (bookingStep === "matching") return <MatchingStep />;
    return null;
  }

  const canBack = stepIdx > 0;

  return (
    <div className="flex min-h-full flex-col bg-[var(--paper)]">
      {/* header */}
      <div className="sticky top-0 z-20 bg-[var(--paper)]/95 px-5 pb-3 pt-4 backdrop-blur">
        <div className="flex items-center gap-3">
          <button
            onClick={() => (canBack ? setBookingStep(STEPS[stepIdx - 1]) : setCustomerTabHome())}
            className="flex h-11 w-11 items-center justify-center rounded-[10px] border border-[var(--line)] bg-[var(--surface)]"
            aria-label="Back"
          >
            <ArrowLeft size={18} />
          </button>
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-[18px] font-extrabold tracking-tight">{titles[bookingStep]}</h1>
            <div className="mt-2 flex gap-1.5">
              {STEPS.slice(0, 5).map((s, i) => (
                <span key={s} className={`h-1 flex-1 rounded-full transition-colors ${i <= stepIdx ? "bg-[var(--brand)]" : "bg-[var(--line)]"}`} />
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="flex-1 px-5 pb-6">
        {bookingStep === "cargo" && <CargoStep categories={boot?.categories ?? []} />}
        {bookingStep === "pickup" && <LocationStep mode="pickup" />}
        {bookingStep === "dropoff" && <LocationStep mode="dropoff" />}
        {bookingStep === "vehicle" && <VehicleStep />}
        {bookingStep === "review" && <ReviewStep />}
        {bookingStep === "payment" && <PaymentStep />}
      </div>
    </div>
  );
}

function setCustomerTabHome() {
  useSession.getState().setCustomerTab("home");
  useSession.getState().setBookingStep("idle");
}
