// MIZIGO refund policy — mirrors the actual money behaviour of the platform.
// M-Pesa Daraja onboarding requires a live refund policy on the site.
import type { Metadata } from "next";
import { LegalShell, H2, UL } from "@/components/mizigo/shared/LegalPages";

export const metadata: Metadata = { title: "Refund Policy · Mizigo" };

export default function RefundPage() {
  return (
    <LegalShell title="Refund Policy" updated="7 October 2026">
      <p>
        All fares are paid through M-PESA. Refunds go back to the same M-PESA number you paid with. This policy covers every case where money comes back to you.
      </p>

      <H2>Cancellations</H2>
      <UL
        items={[
          "Cancel before your driver accepts: full refund, automatically.",
          "Cancel within 2 minutes of the driver accepting (the grace window): full refund, automatically.",
          "Cancel after the grace window: KES 200 cancellation fee is withheld; the rest is refunded automatically. The exact refund amount is shown before you confirm the cancellation.",
          "Cancel because your driver made no progress toward the pickup: the fee is waived and you get a full refund, automatically.",
          "Driver cancels or no vehicle is found: full refund, automatically — you never chase us.",
        ]}
      />

      <H2>Failed or stuck payments</H2>
      <UL
        items={[
          "If your M-PESA prompt times out or the app loses connection after you paid, check the delivery screen — if the payment shows as unconfirmed, contact support with the M-PESA message and we reconcile within 24 hours.",
          "If you are ever charged twice for one delivery, the duplicate is refunded in full within 24 hours of you reporting it.",
        ]}
      />

      <H2>Loss or damage (disputes)</H2>
      <p>
        Report the problem from the delivery screen (or your receipt) as soon as you notice it — the chain-of-custody log (photos, GPS, timestamps, delivery code) is attached automatically. Ops reviews every case. Where the transporter is at fault, you are refunded the delivery fare and, for damaged or missing goods, the documented value of the affected items up to the goods-in-transit cover limit.
      </p>

      <H2>Timing</H2>
      <p>
        Automatic refunds (cancellations and failed matches) are issued to M-PESA the moment they happen — M-PESA usually completes them same-day. Dispute refunds are issued within 3 working days of the decision.
      </p>

      <H2>Tips</H2>
      <p>
        Tips go 100% to your driver and are processed with the fare. A tip sent by mistake is refunded if you report it within 2 hours.
      </p>
    </LegalShell>
  );
}
