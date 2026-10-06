// POST /api/auth — action: "otp" | "verify" | "logout"
// Mock SMS provider: the code is generated + verified server-side and shown
// in the app (sandbox honesty). Login issues a signed HttpOnly session cookie;
// identity on every other route comes from that cookie, never the client.
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { ensureDB } from "@/lib/db-ready";
import { issueOtp, verifyOtp, rateLimit, withSession, clearSession, getSession, type Role } from "@/lib/security";
import { isAtEnabled, sendSMS } from "@/lib/integrations";

export const dynamic = "force-dynamic";

const PHONE_RE = /^0(7|1)\d{8}$/;

export async function POST(req: Request) {
  await ensureDB();
  const body = await req.json().catch(() => ({}));
  const action = body.action as string;

  // ── request a code (mock SMS) ──
  if (action === "otp") {
    const limited = rateLimit(req, "auth:otp", 30, 60_000);
    if (limited) return limited;
    const phone = String(body.phone ?? "").replace(/\D/g, "");
    if (!PHONE_RE.test(phone)) {
      return NextResponse.json({ error: "Enter a valid Kenyan phone number, e.g. 0712 345 678." }, { status: 400 });
    }
    const code = issueOtp(phone);
    // AFRICASTALKING: when AT keys are configured the code goes out by real
    // SMS and is NEVER echoed back (no devCode field in that mode). OTP
    // expiry/attempts semantics live in lib/security.ts — unchanged either way.
    if (isAtEnabled()) {
      const sent = await sendSMS(phone, `Your MIZIGO verification code is ${code}. It expires in 5 minutes.`);
      if (sent.ok) {
        return NextResponse.json({ ok: true, sentTo: phone, provider: "AFRICASTALKING" });
      }
      // AT send failed → log + fall back to the current sandbox behavior
      // so login still works (integration rule: failures never hard-block).
      console.error("[africastalking] OTP SMS failed — falling back to sandbox echo", sent.error);
    }
    // MOCK_SMS: the sandbox displays the code in-app instead of texting it
    return NextResponse.json({ ok: true, sentTo: phone, devCode: code, provider: "MOCK_SMS" });
  }

  // ── verify the code → session cookie ──
  if (action === "verify") {
    const limited = rateLimit(req, "auth:verify", 45, 60_000);
    if (limited) return limited;
    const phone = String(body.phone ?? "").replace(/\D/g, "");
    const code = String(body.code ?? "").replace(/\D/g, "");
    if (!PHONE_RE.test(phone)) {
      return NextResponse.json({ error: "Enter a valid Kenyan phone number, e.g. 0712 345 678." }, { status: 400 });
    }
    if (code.length !== 6) {
      return NextResponse.json({ error: "Enter the 6-digit code we sent you." }, { status: 400 });
    }
    const checked = verifyOtp(phone, code);
    if (!checked.ok) return NextResponse.json({ error: checked.reason }, { status: 400 });

    let user = await db.user.findUnique({ where: { phone }, include: { driver: { include: { vehicles: true } } } });
    if (!user) {
      // a NEW phone signs up as the role it chose (demo self-registration)
      const role: Role = body.role === "DRIVER" ? "DRIVER" : "CUSTOMER";
      const accountType = body.accountType === "BUSINESS" ? "BUSINESS" : "PERSONAL";
      user = await db.user.create({
        data: {
          phone,
          name: String(body.name ?? "").trim().slice(0, 60) || "New Customer",
          role,
          accountType,
          businessName: accountType === "BUSINESS" ? String(body.businessName ?? "").trim().slice(0, 60) || null : null,
          avatarSeed: phone.slice(-4),
        },
        include: { driver: { include: { vehicles: true } } },
      });
      if (role === "DRIVER") {
        // self-registered drivers start unverified with no vehicle (admin approves)
        await db.driver.create({ data: { userId: user.id, status: "OFFLINE", verification: "PENDING" } });
        user = await db.user.findUnique({ where: { phone }, include: { driver: { include: { vehicles: true } } } });
      }
    }

    // role from the DB, not the request — you are what your account is
    const dbRole = (user!.role === "ADMIN" || user!.role === "DRIVER" ? user!.role : "CUSTOMER") as Role;
    return withSession(req, { uid: user!.id, role: dbRole, did: user!.driver?.id ?? null }, {
      ok: true,
      user: {
        id: user!.id, phone: user!.phone, name: user!.name, role: user!.role,
        accountType: user!.accountType, businessName: user!.businessName,
        avatarSeed: user!.avatarSeed, rating: user!.rating,
        driverId: user!.driver?.id ?? null,
        driverStatus: user!.driver?.status ?? null,
        driverVerification: user!.driver?.verification ?? null,
      },
    });
  }

  // ── logout: clear the session cookie ──
  if (action === "logout") {
    return clearSession(req);
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}

// GET /api/auth?action=me — session probe
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  if (searchParams.get("action") !== "me") {
    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  }
  await ensureDB();
  const session = getSession(req);
  if (!session) return NextResponse.json({ user: null });
  const user = await db.user.findUnique({
    where: { id: session.uid },
    include: { driver: { include: { vehicles: true } } },
  });
  if (!user) return NextResponse.json({ user: null });
  return NextResponse.json({
    user: {
      id: user.id, phone: user.phone, name: user.name, role: user.role,
      accountType: user.accountType, businessName: user.businessName,
      avatarSeed: user.avatarSeed, rating: user.rating,
      driverId: user.driver?.id ?? null,
      driverStatus: user.driver?.status ?? null,
      driverVerification: user.driver?.verification ?? null,
    },
  });
}
