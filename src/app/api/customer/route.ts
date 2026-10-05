// GET /api/customer — customer home + wallet + notifications
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { ensureSeed } from "@/lib/seed";
import { ACTIVE_STATES } from "@/lib/state-machine";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  await ensureSeed();
  const { searchParams } = new URL(req.url);
  const userId = searchParams.get("userId");
  if (!userId) return NextResponse.json({ error: "userId required" }, { status: 400 });

  const [user, active, trips, saved, notifications] = await Promise.all([
    db.user.findUnique({ where: { id: userId } }),
    db.shipment.findFirst({
      where: { customerId: userId, status: { in: ACTIVE_STATES } },
      include: { category: true, vehicle: true, driver: { include: { user: true } }, customer: true, items: true, events: true, ratings: true },
      orderBy: { createdAt: "desc" },
    }),
    db.shipment.findMany({
      where: { customerId: userId, status: { notIn: ACTIVE_STATES } },
      include: { category: true, vehicle: true, driver: { include: { user: true } }, customer: true, items: true, events: true, ratings: true },
      orderBy: { createdAt: "desc" }, take: 20,
    }),
    db.savedPlace.findMany({ where: { userId } }),
    db.notification.findMany({ where: { userId }, orderBy: { createdAt: "desc" }, take: 15 }),
  ]);

  const { shipmentDTO } = await import("@/lib/shipments");
  const completed = trips.filter((t) => t.status === "COMPLETED");
  return NextResponse.json({
    user,
    active: active ? shipmentDTO(active) : null,
    trips: trips.map(shipmentDTO),
    saved,
    notifications,
    stats: { completed: completed.length, spent: completed.reduce((a, t) => a + t.fareTotal, 0) },
  });
}
