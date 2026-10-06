// GET /api/routing?from=lat,lng&to=lat,lng&steps=1 — keyless road routing proxy.
// Clients never call OSRM directly; this route wraps src/lib/routing.ts (OSRM
// with a 15-min server cache, graceful internal-model fallback) and is safe to
// cache at the edge for a minute.
import { NextResponse } from "next/server";
import { fetchRoute, isValidLatLng, inServiceArea, MAX_WAYPOINTS, type RouteStep } from "@/lib/routing";
import { rateLimit } from "@/lib/security";

export const dynamic = "force-dynamic";

/** "lat,lng" → LatLng (null when malformed). */
function parseLatLng(raw: string | null): { lat: number; lng: number } | null {
  if (!raw) return null;
  const m = raw.match(/^(-?\d{1,3}(?:\.\d+)?),\s*(-?\d{1,3}(?:\.\d+)?)$/);
  if (!m) return null;
  return { lat: parseFloat(m[1]), lng: parseFloat(m[2]) };
}

export async function GET(req: Request) {
  const limited = rateLimit(req, "routing", 60, 60_000);
  if (limited) return limited;

  const { searchParams } = new URL(req.url);
  const from = parseLatLng(searchParams.get("from"));
  const to = parseLatLng(searchParams.get("to"));
  if (!from || !to || !isValidLatLng(from) || !isValidLatLng(to)) {
    return NextResponse.json({ error: "Expected ?from=lat,lng&to=lat,lng" }, { status: 400 });
  }
  if (!inServiceArea(from) || !inServiceArea(to)) {
    return NextResponse.json({ error: "Both points must be inside the Nairobi service area." }, { status: 400 });
  }

  const viaRaw = searchParams.get("via");
  const via = viaRaw
    ? viaRaw.split(";").map(parseLatLng).filter((p): p is { lat: number; lng: number } => p !== null)
    : [];
  if (via.length > MAX_WAYPOINTS) {
    return NextResponse.json({ error: `At most ${MAX_WAYPOINTS} waypoints.` }, { status: 400 });
  }

  try {
    const wantSteps = searchParams.get("steps") === "1";
    const route = await fetchRoute(from, to, { via });
    const body: {
      distanceKm: number;
      durationMin: number;
      trafficMin: number;
      source: "osrm" | "internal";
      polyline: [number, number][];
      steps?: RouteStep[];
    } = {
      distanceKm: route.distanceKm,
      durationMin: route.durationMin,
      trafficMin: route.trafficMin,
      source: route.source,
      polyline: route.polyline,
    };
    if (wantSteps) body.steps = route.steps ?? [];
    return NextResponse.json(body, { headers: { "Cache-Control": "public, max-age=60" } });
  } catch {
    return NextResponse.json({ error: "Couldn't calculate that route. Try again." }, { status: 400 });
  }
}
