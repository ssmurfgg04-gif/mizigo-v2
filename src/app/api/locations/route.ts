// GET /api/locations?q= — place search (GeocodingService, mock provider).
// Saved places come from the session identity, never a query param.
import { NextResponse } from "next/server";
import { searchPlaces } from "@/lib/geo";
import { db } from "@/lib/db";
import { ensureDB } from "@/lib/db-ready";
import { getSession, rateLimit } from "@/lib/security";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  await ensureDB();
  const limited = rateLimit(req, "locations", 120, 60_000);
  if (limited) return limited;
  const { searchParams } = new URL(req.url);
  const q = (searchParams.get("q") ?? "").slice(0, 80);
  const session = getSession(req);

  const results = searchPlaces(q);
  const saved = session ? await db.savedPlace.findMany({ where: { userId: session.uid } }) : [];

  return NextResponse.json({
    results: results.map((r) => ({ ...r, source: "search" })),
    saved: saved.map((s) => ({ name: s.name, area: s.area, lat: s.lat, lng: s.lng, label: s.label, source: "saved" })),
  });
}
