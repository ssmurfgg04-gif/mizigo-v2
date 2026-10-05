// GET /api/customer — customer home + wallet + notifications + promos
// POST /api/customer — save-place | remove-place | apply-promo
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { ensureDB } from "@/lib/db-ready";
import { ACTIVE_STATES } from "@/lib/state-machine";
import { requireSession, isResponse, rateLimit, capStr, validCoord } from "@/lib/security";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  await ensureDB();
  // the session decides whose data this is — never a query param
  const session = requireSession(req);
  if (isResponse(session)) return session;
  const userId = session.uid;
  const user = await db.user.findUnique({ where: { id: userId } });
  if (!user) return NextResponse.json({ error: "Account not found." }, { status: 404 });

  const [active, trips, saved, notifications] = await Promise.all([
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
  await ensureDB();
  const session = requireSession(req);
  if (isResponse(session)) return session;
  const limited = rateLimit(req, "customer:post", 30, 60_000);
  if (limited) return limited;
  const body = (await req.json().catch(() => ({}))) as {
    action?: string; place?: { label: string; name: string; area: string; lat: number; lng: number }; placeId?: string;
  };
  const userId = session.uid; // places belong to the signed-in account

  if (body.action === "save-place") {
    const p = body.place;
    const c = p ? validCoord(p.lat, p.lng) : null;
    if (!p?.name || !c) return NextResponse.json({ error: "Place details required" }, { status: 400 });
    const name = capStr(p.name, 80);
    const existing = await db.savedPlace.findFirst({ where: { userId, name } });
    if (existing) {
      const updated = await db.savedPlace.update({ where: { id: existing.id }, data: { label: capStr(p.label || "Saved", 24), name, area: capStr(p.area ?? "", 60), lat: c.lat, lng: c.lng } });
      return NextResponse.json({ ok: true, place: updated });
    }
    const created = await db.savedPlace.create({ data: { userId, label: capStr(p.label || "Saved", 24), name, area: capStr(p.area ?? "", 60), lat: c.lat, lng: c.lng } });
    return NextResponse.json({ ok: true, place: created });
  }

  if (body.action === "remove-place") {
    if (!body.placeId) return NextResponse.json({ error: "placeId required" }, { status: 400 });
    await db.savedPlace.deleteMany({ where: { id: body.placeId, userId } });
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
