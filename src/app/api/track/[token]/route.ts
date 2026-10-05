// GET /api/track/[token] — public, no-login recipient tracking page data.
// Deliberately minimal: no phones, no notes, no customer names.
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getShipmentFull, shipmentDTO } from "@/lib/shipments";
import { STATUS_LABEL } from "@/lib/state-machine";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const s = await db.shipment.findUnique({ where: { shareToken: token } });
  if (!s) return NextResponse.json({ error: "Tracking link not found" }, { status: 404 });
  const full = await getShipmentFull({ id: s.id });
  const dto = shipmentDTO(full!);
  return NextResponse.json({
    tracking: {
      code: dto.code,
      status: dto.status,
      statusLabel: STATUS_LABEL[dto.status] ?? dto.status,
      driver: dto.driver ? { first: dto.driver.name.split(" ")[0], rating: dto.driver.rating, initials: dto.driver.initials } : null,
      vehicle: dto.vehicle ? { model: `${dto.vehicle.make} ${dto.vehicle.model}`, registration: dto.vehicle.registration } : null,
      category: dto.category.name,
      pickup: { name: dto.route.pickup.name, area: dto.route.pickup.area, lat: dto.route.pickup.lat, lng: dto.route.pickup.lng },
      dropoff: { name: dto.route.dropoff.name, area: dto.route.dropoff.area, lat: dto.route.dropoff.lat, lng: dto.route.dropoff.lng },
      polyline: dto.route.polyline,
      etaMin: dto.live?.etaMin ?? null,
      live: dto.live ? { lat: dto.live.lat, lng: dto.live.lng, progress: dto.live.progress, leg: dto.live.leg } : null,
      distanceKm: dto.route.distanceKm,
      events: dto.events.map((e) => ({ label: e.label, at: e.at, type: e.type })),
      deliveredAt: dto.pod?.verifiedAt ?? null,
      cargoSummary: `${dto.cargo.items.reduce((a, i) => a + i.qty, 0)} item${dto.cargo.items.reduce((a, i) => a + i.qty, 0) === 1 ? "" : "s"}`,
    },
  });
}
