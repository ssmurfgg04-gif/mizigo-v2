// GET /api/return-loads — the empty-leg marketplace (v1 goodness: "Use the empty leg").
// Public list of discounted return capacity that is already moving.
// ?mine=1&driverId= — the driver's own published legs (any status).
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { ensureDB } from "@/lib/db-ready";

export const dynamic = "force-dynamic";

function legDTO(l: {
  id: string; driverId: string; fromName: string; fromArea: string; fromLat: number; fromLng: number;
  toName: string; toArea: string; toLat: number; toLng: number; categoryKey: string; cargoNote: string;
  maxWeightKg: number; priceKes: number; normalPriceKes: number; status: string;
  availableUntil: Date | null; bookedById: string | null; bookedShipmentId: string | null; createdAt: Date;
}, driver?: { rating: number; tripsCompleted: number; user: { name: string } } | null, vehicle?: { make: string; model: string; registration: string } | null) {
  return {
    id: l.id,
    from: { name: l.fromName, area: l.fromArea, lat: l.fromLat, lng: l.fromLng },
    to: { name: l.toName, area: l.toArea, lat: l.toLat, lng: l.toLng },
    categoryKey: l.categoryKey,
    cargoNote: l.cargoNote,
    maxWeightKg: l.maxWeightKg,
    priceKes: l.priceKes,
    normalPriceKes: l.normalPriceKes,
    savingsKes: Math.max(0, l.normalPriceKes - l.priceKes),
    savingsPct: l.normalPriceKes > 0 ? Math.round((1 - l.priceKes / l.normalPriceKes) * 100) : 0,
    status: l.status,
    availableUntil: l.availableUntil?.toISOString() ?? null,
    booked: l.status === "BOOKED",
    createdAt: l.createdAt.toISOString(),
    driver: driver ? { name: driver.user.name.split(" ")[0], rating: driver.rating, trips: driver.tripsCompleted } : null,
    vehicle: vehicle ? { name: `${vehicle.make} ${vehicle.model}`, registration: vehicle.registration } : null,
  };
}

export async function GET(req: Request) {
  await ensureDB();
  const { searchParams } = new URL(req.url);
  const mine = searchParams.get("mine");
  const driverId = searchParams.get("driverId");

  if (mine && driverId) {
    const rows = await db.returnLoad.findMany({
      where: { driverId },
      orderBy: { createdAt: "desc" },
    });
    const [driver, vehicles] = await Promise.all([
      db.driver.findUnique({ where: { id: driverId }, include: { user: true } }),
      db.vehicle.findMany({ where: { driverId }, include: { category: true } }),
    ]);
    return NextResponse.json({
      returnLoads: rows.map((l) => {
        const v = vehicles.find((x) => x.category?.key === l.categoryKey) ?? vehicles[0] ?? null;
        return legDTO(l, driver, v ? { make: v.make, model: v.model, registration: v.registration } : null);
      }),
    });
  }

  const rows = await db.returnLoad.findMany({
    where: { status: "AVAILABLE", OR: [{ availableUntil: null }, { availableUntil: { gt: new Date() } }] },
    orderBy: { createdAt: "desc" },
    take: 24,
  });
  const drivers = await db.driver.findMany({
    where: { id: { in: rows.map((r) => r.driverId) } },
    include: { user: true, vehicles: { include: { category: true } } },
  });
  return NextResponse.json({
    returnLoads: rows.map((l) => {
      const d = drivers.find((x) => x.id === l.driverId) ?? null;
      const v = d?.vehicles.find((x) => x.category?.key === l.categoryKey) ?? d?.vehicles[0] ?? null;
      return legDTO(l, d, v);
    }),
  });
}
