// GET /api/bootstrap — ensure seed, return marketplace config + platform settings.
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { ensureDB } from "@/lib/db-ready";

export const dynamic = "force-dynamic";

export async function GET() {
  await ensureDB();
  const [categories, zone, counts, settingRows] = await Promise.all([
    db.vehicleCategory.findMany({ where: { active: true }, orderBy: { sortOrder: "asc" } }),
    db.pricingZone.findFirst({ where: { key: "nairobi" } }),
    db.place.count(),
    db.platformSetting.findMany(),
  ]);
  const settings = Object.fromEntries(settingRows.map((s) => [s.key, s.value]));
  return NextResponse.json({
    categories,
    zone,
    places: counts,
    settings: {
      supportPhone: settings.supportPhone ?? "0800 724 343",
      advanceBookingDays: Number(settings.advanceBookingDays ?? 14),
      autoDispatch: settings.autoDispatch !== "false",
      quoteExpiryMinutes: Number(settings.quoteExpiryMinutes ?? 60),
    },
    demo: {
      customer: { email: "customer@mizigo.demo", phone: "0712 000 001", name: "John Kariuki" },
      business: { email: "business@mizigo.demo", phone: "0722 000 033", name: "Zainab Mabuyu", business: "ABC Traders Ltd" },
      driver: { email: "driver@mizigo.demo", phone: "0712 000 002", name: "Peter Kamau" },
      admin: { email: "admin@mizigo.demo", name: "Ops Control" },
    },
  });
}
