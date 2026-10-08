// MIZIGO terms of service — the marketplace contract in plain language.
import type { Metadata } from "next";
import { LegalShell, H2, UL } from "@/components/mizigo/shared/LegalPages";

export const metadata: Metadata = { title: "Terms of Service · Mizigo" };

export default function TermsPage() {
  return (
    <LegalShell title="Terms of Service" updated="7 October 2026">
      <p>
        MIZIGO is a marketplace that connects customers who need cargo moved with independent, vetted transporters — boda bodas, tuk-tuks, vans, pickups, canters and lorries in Nairobi. These terms govern your use of the service.
      </p>

      <H2>Your account</H2>
      <p>
        You sign in with your phone number and a one-time verification code. You must give a real name and be 18 or older to book. Business accounts get VAT invoices and can manage saved locations.
      </p>

      <H2>Prices, quotes and what can change them</H2>
      <UL
        items={[
          "Instant bookings show an upfront, all-in price before you pay. That price is locked when you pay — it only changes if the job changes (an added stop, a much heavier load than booked, or waiting beyond the 20 included minutes at KES 10/min).",
          "Quote bookings (large or specialist loads): drivers send offers, you pick one, and that amount locks.",
          "Night moves (19:00–06:00) carry the night rate shown in the fare breakdown before you pay.",
        ]}
      />

      <H2>Cancellations</H2>
      <p>
        Cancelling is free until your driver accepts, and for 2 minutes after they accept. After that a KES 200 cancellation fee is withheld from your refund — the fee is always shown before you confirm. The fee is waived automatically if your driver has made no progress toward your pickup. Drivers may also cancel; if that leaves you unmatched, you are refunded in full.
      </p>

      <H2>Pickup and proof of delivery</H2>
      <p>
        Check the vehicle plate matches the app before loading — only load into the booked vehicle. At drop-off, your driver asks for the 4-digit delivery code in your app; that code (plus GPS and any photo) is the proof of delivery attached to your receipt.
      </p>

      <H2>Transporters</H2>
      <p>
        Drivers on MIZIGO are independent contractors. They must hold a valid driving licence for their vehicle class, current insurance and a roadworthy vehicle, and pass our document checks. Commission is 12% plus a KES 100 platform fee per completed job. Payouts are sent to the driver's saved M-PESA or bank account after proof of delivery.
      </p>

      <H2>Prohibited items</H2>
      <UL
        items={[
          "Anything illegal in Kenya: narcotics, unlicensed firearms, protected wildlife products, counterfeit goods.",
          "Dangerous goods (fuel, gas cylinders, industrial chemicals) unless declared and agreed in writing before booking.",
          "Passengers. MIZIGO moves goods, not people.",
        ]}
      />

      <H2>Liability</H2>
      <p>
        Deliveries ride with goods-in-transit cover arranged through the transporter. For loss or damage, report the issue from the delivery screen — ops decides from the chain-of-custody log (photos, GPS, timestamps) and refunds are handled under the Refund Policy. MIZIGO's liability for platform errors is limited to the delivery fare.
      </p>

      <H2>Law</H2>
      <p>
        These terms are governed by the laws of Kenya. Disputes go first to our support team, then to the courts of Kenya.
      </p>
    </LegalShell>
  );
}
