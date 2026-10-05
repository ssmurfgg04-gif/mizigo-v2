// POST /api/quote — price a draft booking. Rates come from DB only.
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { ensureSeed } from "@/lib/seed";
import { priceFor, estimateWeight, recommendCategory, type CargoItem } from "@/lib/pricing";
import { routeDistanceKm, routeDurationMin, haversineKm } from "@/lib/geo";
import { nearbyDrivers } from "@/lib/matching";

export const dynamic = "force-dynamic";

interface QuoteBody {
  pickup: { name: string; area?: string; lat: number; lng: number };
  dropoff: { name: string; area?: string; lat: number; lng: number };
  stops?: { name: string; lat: number; lng: number }[];
  cargo: { items: CargoItem[]; load: string; helpers: number; special?: string[] };
}

export async function POST(req: Request) {
  await ensureSeed();
  const body = (await req.json().catch(() => null)) as QuoteBody | null;
  if (!body?.pickup?.lat || !body?.dropoff?.lat) {
    return NextResponse.json({ error: "Pickup and destination are required." }, { status: 400 });
  }

  const [zone, categories, driversRaw] = await Promise.all([
    db.pricingZone.findFirst({ where: { key: "nairobi" } }),
    db.vehicleCategory.findMany({ where: { active: true }, orderBy: { sortOrder: "asc" } }),
    db.driver.findMany({ include: { user: true, vehicles: { include: { category: true } } } }),
  ]);
  if (!zone) return NextResponse.json({ error: "No pricing zone configured" }, { status: 500 });

  // distance = pickup→stops→dropoff
  const waypoints = [body.pickup, ...(body.stops ?? []), body.dropoff].map((p) => ({ lat: p.lat, lng: p.lng }));
  let distanceKm = 0;
  for (let i = 0; i < waypoints.length - 1; i++) distanceKm += routeDistanceKm(waypoints[i], waypoints[i + 1]);
  distanceKm = Math.round(distanceKm * 10) / 10;
  const durationMin = routeDurationMin(distanceKm);
  const weightKg = estimateWeight(body.cargo.items ?? [], body.cargo.load ?? "MEDIUM");
  const extraStops = Math.max(0, waypoints.length - 2);
  const needsCovered = (body.cargo.special ?? []).includes("covered");
  const peak = new Date().getDay() >= 4 && new Date().getHours() >= 16; // Thu+ evenings (mock demand signal)

  const recommendedKey = recommendCategory(weightKg, categories, body.cargo.category);
  const quotes = categories
    .filter((c) => !(needsCovered && c.bodyType === "open"))
    .map((c) => {
      const fare = priceFor(c, zone, { distanceKm, durationMin, helpers: body.cargo.helpers ?? 0, extraStops, peak });
      const supply = driversRaw.filter((d) => d.status === "ONLINE" && d.vehicles.some((v) => v.categoryId === c.id)).length;
      // arrival estimate: nearest online driver of this category
      const cands = driversRaw.filter((d) => d.status === "ONLINE" && d.verification === "VERIFIED");
      const nearest = cands
        .map((d) => haversineKm({ lat: d.lat, lng: d.lng }, { lat: body.pickup.lat, lng: body.pickup.lng }))
        .sort((a, b) => a - b)[0];
      const etaMin = nearest != null ? Math.max(4, Math.round((nearest / 26) * 60) + 2) : 9 + c.sortOrder * 3;
      const fits = c.capacityKg >= weightKg;
      return {
        key: c.key, name: c.name, description: c.description, capacityKg: c.capacityKg,
        bodyType: c.bodyType, dimensions: `${c.lengthM} × ${c.widthM} × ${c.heightM} m`,
        volumeM3: c.volumeM3,
        fare, etaMin, supply,
        recommended: c.key === recommendedKey,
        fits,
        oversized: weightKg > c.capacityKg,
      };
    });

  return NextResponse.json({
    distanceKm, durationMin, weightKg, recommendedKey,
    peak,
    quotes,
    nearby: nearbyDrivers(
      driversRaw.map((d) => ({ ...d, user: d.user ? { name: d.user.name } : null })),
      { lat: body.pickup.lat, lng: body.pickup.lng }, 8
    ),
  });
}
