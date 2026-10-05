// GET /api/bootstrap — ensure seed, return marketplace config.
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { ensureDB } from "@/lib/db-ready";

export const dynamic = "force-dynamic";

export async function GET() {
  await ensureDB();
  const [categories, zone, counts] = await Promise.all([
    db.vehicleCategory.findMany({ where: { active: true }, orderBy: { sortOrder: "asc" } }),
    db.pricingZone.findFirst({ where: { key: "nairobi" } }),
    db.place.count(),
  ]);
  return NextResponse.json({
    categories,
    zone,
    places: counts,
    demo: {
      customer: { email: "customer@mizigo.demo", phone: "0712 000 001", name: "John Kariuki" },
      business: { email: "business@mizigo.demo", phone: "0722 000 033", name: "Zainab Mabuyu", business: "ABC Traders Ltd" },
      driver: { email: "driver@mizigo.demo", phone: "0712 000 002", name: "Peter Kamau" },
      admin: { email: "admin@mizigo.demo", name: "Ops Control" },
    },
  });
}
