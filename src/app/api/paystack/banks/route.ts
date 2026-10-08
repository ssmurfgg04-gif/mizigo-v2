// GET /api/paystack/banks — Kenyan payout destinations for the driver payout
// setup UI (M-Pesa, Airtel, Telkom wallets + kepss banks), served from the
// Paystack /bank list and cached 24h in-process. Driver/admin session required.
import { NextResponse } from "next/server";
import { resolvePaystackSecret, listKenyanBanks } from "@/lib/integrations/paystack";
import { requireSession, isResponse } from "@/lib/security";
import { ensureDB } from "@/lib/db-ready";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const session = requireSession(req);
  if (isResponse(session)) return session;
  // payout destinations are the driver's own concern (admins see them in ops)
  if (session.role !== "DRIVER" && session.role !== "ADMIN") {
    return NextResponse.json({ error: "Not allowed" }, { status: 403 });
  }
  await ensureDB();
  const secret = await resolvePaystackSecret();
  if (!secret) {
    // sandbox: a static minimal list keeps the payout-setup UI usable
    return NextResponse.json({
      ok: true, sandbox: true,
      banks: [
        { name: "M-PESA (mobile money)", code: "MPESA", type: "mobile_money" },
        { name: "Airtel Money", code: "ATL_KE", type: "mobile_money" },
        { name: "Telkom Money", code: "97", type: "mobile_money" },
        { name: "Equity Bank", code: "68", type: "kepss" },
        { name: "Kenya Commercial Bank", code: "01", type: "kepss" },
        { name: "Co-operative Bank", code: "11", type: "kepss" },
        { name: "Absa Bank Kenya", code: "03", type: "kepss" },
        { name: "NCBA Bank", code: "07", type: "kepss" },
        { name: "Standard Chartered", code: "02", type: "kepss" },
        { name: "Stanbic Bank", code: "31", type: "kepss" },
      ],
    });
  }
  const res = await listKenyanBanks(secret);
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: 502 });
  // wallets first, then banks alphabetically — the UI groups by type
  const wallets = res.banks.filter((b) => b.type === "mobile_money");
  const banks = res.banks.filter((b) => b.type === "kepss").sort((a, b) => a.name.localeCompare(b.name));
  return NextResponse.json({ ok: true, sandbox: false, banks: [...wallets, ...banks] });
}
