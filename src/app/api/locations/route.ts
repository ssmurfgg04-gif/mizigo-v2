// GET /api/locations?q= — place search (GeocodingService, mock provider)
import { NextResponse } from "next/server";
import { searchPlaces } from "@/lib/geo";
import { db } from "@/lib/db";
import { ensureSeed } from "@/lib/seed";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  await ensureSeed();
  const { searchParams } = new URL(req.url);
  const q = searchParams.get("q") ?? "";
  const userId = searchParams.get("userId");

  const results = searchPlaces(q);
  const saved = userId ? await db.savedPlace.findMany({ where: { userId } }) : [];

  return NextResponse.json({
    results: results.map((r) => ({ ...r, source: "search" })),
    saved: saved.map((s) => ({ name: s.name, area: s.area, lat: s.lat, lng: s.lng, label: s.label, source: "saved" })),
  });
}
