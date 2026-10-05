// GET /api/customer — customer home + wallet + notifications + promos
// POST /api/customer — save-place | remove-place | apply-promo
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
      where: { customerId: userId, status: { in: [...ACTIVE_STATES, "QUOTED"] } },
      include: { category: true, vehicle: true, driver: { include: { user: true } }, customer: true, items: true, events: true, ratings: true, quotes: { include: { driver: { include: { user: true, vehicles: true } } } }, messages: { orderBy: { createdAt: "asc" } } },
      orderBy: { createdAt: "desc" },
    }),
    db.shipment.findMany({
      where: { customerId: userId, status: { notIn: [...ACTIVE_STATES, "QUOTED"] } },
      include: { category: true, vehicle: true, driver: { include: { user: true } }, customer: true, items: true, events: true, ratings: true, messages: { orderBy: { createdAt: "asc" } } },
      orderBy: { createdAt: "desc" }, take: 20,
    }),
    db.savedPlace.findMany({ where: { userId } }),
    db.notification.findMany({ where: { userId }, orderBy: { createdAt: "desc" }, take: 15 }),
  ]);

  const { shipmentDTO } = await import("@/lib/shipments");
  const completed = trips.filter((t) => t.status === "COMPLETED");

  // monthly business invoices (plan §23 central billing)
  const invoiceMap = new Map<string, { month: string; deliveries: number; net: number; vat: number; total: number }>();
  for (const t of completed) {
    const d = new Date(t.createdAt);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const net = t.fareTotal - t.farePlatform;
    const vat = Math.round(net * 0.16);
    const e = invoiceMap.get(key) ?? { month: key, deliveries: 0, net: 0, vat: 0, total: 0 };
    e.deliveries += 1; e.net += net; e.vat += vat; e.total += net + vat;
    invoiceMap.set(key, e);
  }
  const invoices = [...invoiceMap.values()].sort((a, b) => (a.month < b.month ? 1 : -1));

  return NextResponse.json({
    user,
    active: active ? shipmentDTO(active) : null,
    trips: trips.map(shipmentDTO),
    saved,
    notifications,
    invoices,
    stats: { completed: completed.length, spent: completed.reduce((a, t) => a + t.fareTotal, 0) },
  });
}

export async function POST(req: Request) {
  await ensureSeed();
  const body = (await req.json().catch(() => ({}))) as {
    action?: string; userId?: string; place?: { label: string; name: string; area: string; lat: number; lng: number }; placeId?: string;
  };
  if (!body.userId) return NextResponse.json({ error: "userId required" }, { status: 400 });

  if (body.action === "save-place") {
    const p = body.place;
    if (!p?.name || p.lat == null) return NextResponse.json({ error: "Place details required" }, { status: 400 });
    const existing = await db.savedPlace.findFirst({ where: { userId: body.userId, name: p.name } });
    if (existing) {
      const updated = await db.savedPlace.update({ where: { id: existing.id }, data: { label: p.label || "Saved", name: p.name, area: p.area ?? "", lat: p.lat, lng: p.lng } });
      return NextResponse.json({ ok: true, place: updated });
    }
    const created = await db.savedPlace.create({ data: { userId: body.userId!, label: p.label || "Saved", name: p.name, area: p.area ?? "", lat: p.lat, lng: p.lng } });
    return NextResponse.json({ ok: true, place: created });
  }

  if (body.action === "remove-place") {
    if (!body.placeId) return NextResponse.json({ error: "placeId required" }, { status: 400 });
    await db.savedPlace.deleteMany({ where: { id: body.placeId, userId: body.userId } });
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
