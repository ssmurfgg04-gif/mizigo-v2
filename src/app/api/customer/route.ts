// GET /api/customer — customer home + wallet + notifications (with unread count,
// per-row kind + linked shipment id for deep-links) + promos
// POST /api/customer — save-place | remove-place | notifications-read | apply-promo
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
  // 401 (not 404): a session whose account no longer exists — e.g. a sandbox
  // instance whose /tmp DB recycled — must expire the session client-side,
  // not brick the surface with a retryable "not found".
  if (!user) return NextResponse.json({ error: "Session expired. Please sign in again." }, { status: 401 });

  const [active, trips, saved, notifications, unread] = await Promise.all([
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
    db.notification.count({ where: { userId, read: false } }),
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

  // notification rows: resolve each code to the customer's own shipment (the
  // deep-link target) and tag a kind for per-type icons + routing. Codes that
  // don't resolve (e.g. the "recent" seed row) keep shipmentId null — the
  // client then gives honest feedback instead of tapping through to nothing.
  const codes = [...new Set(notifications.map((n) => n.shipmentCode).filter((c): c is string => !!c))];
  const linked = codes.length
    ? await db.shipment.findMany({ where: { customerId: userId, code: { in: codes } }, select: { id: true, code: true } })
    : [];
  const shipmentByCode = new Map(linked.map((x) => [x.code, x.id]));
  const notifRows = notifications.map((n) => ({
    id: n.id,
    title: n.title,
    body: n.body,
    createdAt: n.createdAt.toISOString(),
    read: n.read,
    shipmentCode: n.shipmentCode,
    shipmentId: n.shipmentCode ? shipmentByCode.get(n.shipmentCode) ?? null : null,
    kind: notificationKind(n.title, n.body, n.shipmentCode),
  }));

  return NextResponse.json({
    user,
    active: active ? shipmentDTO(active) : null,
    trips: trips.map(shipmentDTO),
    saved,
    notifications: notifRows,
    unread,
    invoices,
    stats: { completed: completed.length, spent: completed.reduce((a, t) => a + t.fareTotal, 0) },
  });
}

// Notification type for per-row icons + deep-link routing. The Notification
// model carries no kind column, so the kind is derived from the copy this
// codebase itself generates (NOTIFY_COPY + the inline notification creates) —
// all fixed English strings, so the mapping is stable.
function notificationKind(title: string, body: string, shipmentCode: string | null): "status" | "rate" | "chat" | "promo" | "system" {
  const t = title.toLowerCase();
  if (t === "delivery completed" || t === "rate your driver" || body.toLowerCase().includes("rate your driver")) return "rate";
  if (t.startsWith("message from") || t === "new message") return "chat";
  if (t.startsWith("promo") || t.includes("offer") || t.includes("deal")) return "promo";
  return shipmentCode ? "status" : "system";
}

export async function POST(req: Request) {
  await ensureDB();
  const session = requireSession(req);
  if (isResponse(session)) return session;
  const limited = rateLimit(req, "customer:post", 30, 60_000);
  if (limited) return limited;
  const body = (await req.json().catch(() => ({}))) as {
    action?: string; place?: { label: string; name: string; area: string; lat: number; lng: number }; placeId?: string; id?: string;
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

  // mark one notification (id) or all of them read — drives the bell badge
  if (body.action === "notifications-read") {
    const id = typeof body.id === "string" && body.id ? body.id : null;
    await db.notification.updateMany({
      where: id ? { id, userId } : { userId, read: false },
      data: { read: true },
    });
    return NextResponse.json({ ok: true, unread: await db.notification.count({ where: { userId, read: false } }) });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
