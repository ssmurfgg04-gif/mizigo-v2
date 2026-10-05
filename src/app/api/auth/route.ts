// POST /api/auth — action: "otp" | "verify"  (mock OTP provider; code returned in dev)
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { ensureDB } from "@/lib/db-ready";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  await ensureDB();
  const body = await req.json().catch(() => ({}));
  const action = body.action as string;

  if (action === "otp") {
    const phone = String(body.phone ?? "").replace(/\D/g, "");
    if (!/^0(7|1)\d{8}$/.test(phone)) {
      return NextResponse.json({ error: "Enter a valid Kenyan phone number, e.g. 0712 345 678." }, { status: 400 });
    }
    // MockSMS provider: code is generated server-side and shown in the sandbox
    const code = String(Math.floor(100000 + Math.random() * 900000));
    return NextResponse.json({ ok: true, sentTo: phone, devCode: code, provider: "MOCK_SMS" });
  }

  if (action === "verify") {
    const phone = String(body.phone ?? "").replace(/\D/g, "");
    let user = await db.user.findUnique({ where: { phone }, include: { driver: { include: { vehicles: true } } } });
    if (!user) {
      // role determined by which demo number matched, else CUSTOMER
      const role = body.role === "DRIVER" ? "DRIVER" : "CUSTOMER";
      const accountType = body.accountType === "BUSINESS" ? "BUSINESS" : "PERSONAL";
      user = await db.user.create({
        data: {
          phone,
          name: String(body.name ?? "").trim() || "New Customer",
          role,
          accountType,
          businessName: accountType === "BUSINESS" ? String(body.businessName ?? "").trim() || null : null,
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
    return NextResponse.json({
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

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
