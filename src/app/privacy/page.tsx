// MIZIGO privacy policy — written against the Kenya Data Protection Act, 2019
// (ODPC registration is on the pre-launch checklist in docs/research/KENYA_MARKET_PLAYBOOK.md).
import type { Metadata } from "next";
import { LegalShell, H2, UL } from "@/components/mizigo/shared/LegalPages";

export const metadata: Metadata = { title: "Privacy Policy · Mizigo" };

export default function PrivacyPage() {
  return (
    <LegalShell title="Privacy Policy" updated="7 October 2026">
      <p>
        This policy explains what personal data MIZIGO collects, why we collect it, how long we keep it and the choices you have. We process data under the Kenya Data Protection Act, 2019. By using MIZIGO you agree to this policy.
      </p>

      <H2>What we collect</H2>
      <UL
        items={[
          "Account: your name, phone number and (optional) email. We verify your phone with a one-time code — we never store the code itself.",
          "Deliveries: pickup and drop-off locations, notes you add (gate numbers, contacts), cargo descriptions, photos you attach as proof, and the delivery code shown to your driver at drop-off.",
          "Location: while a delivery you booked (or are driving) is active, we process device location to show live tracking and ETAs. Tracking links you share show the driver's first name, vehicle and live location — nothing more — and stop working when the link expires.",
          "Payments: M-PESA receipts and transaction references. We never see or store your M-PESA PIN.",
          "Ratings and feedback: stars, tags, comments and tips you send after a delivery.",
        ]}
      />

      <H2>Why we process it</H2>
      <p>
        To match you with a vehicle, price your delivery, keep the chain of custody (who held your goods, when and where), process payments and refunds, prevent fraud, and resolve disputes. Live location is processed only while a delivery is active or a share link is live.
      </p>

      <H2>How long we keep it</H2>
      <UL
        items={[
          "Active delivery data: for the life of the delivery.",
          "Receipts and proof of delivery: 7 years (tax law, eTIMS).",
          "Location movement trails: stripped from share links 12 hours after a delivery ends.",
          "Share links: expire 48 hours after they are created.",
          "Account data: until you ask us to delete your account, then within 30 days (records we must keep by law excepted).",
        ]}
      />

      <H2>Who we share it with</H2>
      <p>
        Your assigned driver sees your first name, pickup/drop-off details and delivery notes — not your full profile. Recipients using a tracking link see only the delivery summary. We share payment data with our M-PESA provider (Safaricom) to complete transactions. We do not sell your data, ever.
      </p>

      <H2>Your rights</H2>
      <p>
        Under the Data Protection Act you can ask us to access, correct or delete your data, or object to our processing. Call {`0800 724 343`} or email privacy@mizigo.co.ke — we respond within 7 days. You may also complain to the Office of the Data Protection Commissioner (odpc.go.ke).
      </p>

      <H2>On your device</H2>
      <p>
        The app stores your session, language choice and dismissed reminders (like the rating reminder) in your browser's local storage. These never leave your device except your session id. We do not use advertising trackers.
      </p>
    </LegalShell>
  );
}
