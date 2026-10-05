// GET /api/shipments/[id] — full detail + live position (polled by live screens)
// Ownership: the customer, the assigned driver or an admin — nobody else.
// ?demo=auto (customer active-trip poll): sandbox driver auto-advance so the
// journey completes while watching. When the customer screen unmounts (e.g.
// the user switches to the driver surface) polling stops, so a human driver
// can take over at any time — the state machine guards both paths.
import { NextResponse } from "next/server";
import { getShipmentFull, shipmentDTO, applyTransition, simulateLive } from "@/lib/shipments";
import { db } from "@/lib/db";
import { ensureDB } from "@/lib/db-ready";
import { requireSession, isResponse } from "@/lib/security";

export const dynamic = "force-dynamic";

const SEC = 1000;

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  await ensureDB();
  const session = requireSession(req);
  if (isResponse(session)) return session;
  const { id } = await params;
  const demoAuto = new URL(req.url).searchParams.get("demo") === "auto";
  let s = await getShipmentFull({ id });
  if (!s) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // ownership gate — the customer, the assigned driver, or an admin
  const isCustomer = session.uid === s.customerId;
  const isDriver = !!session.did && session.did === s.driverId;
  const isAdmin = session.role === "ADMIN";
  if (!isCustomer && !isDriver && !isAdmin) {
    return NextResponse.json({ error: "You don't have access to this delivery." }, { status: 403 });
  }

  // DEV-MODE MOCK: the assigned driver auto-accepts after ~5s
  if (s.status === "DRIVER_ASSIGNED" && Date.now() - new Date(s.stateEnteredAt).getTime() > 5000) {
    await applyTransition(id, "driver-accept", "DRIVER", { label: "Driver accepted · on the way to pickup" }).catch(() => null);
    s = (await getShipmentFull({ id })) ?? s;
  }

  // DEV-MODE MOCK: while a QUOTED request is open, seeded drivers submit
  // quotes over ~15s so the marketplace comes alive in the sandbox. Real
  // drivers can still quote through the driver app at any time.
  if (s.status === "QUOTED") {
    const quotes = await db.quote.findMany({ where: { shipmentId: id } });
    const secondsIn = (Date.now() - new Date(s.stateEnteredAt).getTime()) / 1000;
    const wanted = secondsIn > 14 ? 3 : secondsIn > 7 ? 2 : secondsIn > 3 ? 1 : 0;
    if (quotes.length < wanted) {
      const candidates = await db.driver.findMany({
        where: { verification: "VERIFIED", id: { notIn: quotes.map((q) => q.driverId) }, vehicles: { some: { categoryId: s.categoryId } } },
        include: { user: true, vehicles: true },
        take: 4,
      });
      const pick = candidates[quotes.length];
      if (pick) {
        const sc = s;
        const veh = pick.vehicles.find((v) => v.categoryId === sc.categoryId) ?? pick.vehicles[0];
        // ±8% around the instant estimate keeps quotes believable
        const jitter = 0.92 + 0.16 * ((quotes.length + 1) / 3);
        const amount = Math.round((sc.fareTotal * jitter) / 50) * 50;
        await db.quote.create({ data: { shipmentId: id, driverId: pick.id, vehicleId: veh?.id ?? null, amount, etaText: sc.scheduledAt ? "As scheduled" : "Within the hour", expiresAt: new Date(Date.now() + 60 * 60_000) } });
        await db.shipmentEvent.create({ data: { shipmentId: id, type: "QUOTE_RECEIVED", label: `Quote received · ${pick.user?.name ?? "Driver"} · KES ${amount.toLocaleString()}`, actor: "DRIVER" } });
        await db.notification.create({ data: { userId: sc.customerId, role: "CUSTOMER", title: "Driver submitted a quote", body: `KES ${amount.toLocaleString()} for ${sc.code}`, shipmentCode: sc.code } });
        s = (await getShipmentFull({ id })) ?? s;
      }
    }
  }

  // DEV-MODE MOCK: sandbox driver walks the trip through its stations
  if (demoAuto) {
    const dwell = Date.now() - new Date(s.stateEnteredAt).getTime();
    const live = simulateLive(s);
    const next: Record<string, () => Promise<unknown> | null> = {
      DRIVER_EN_ROUTE: () => (live && live.progress >= 1 ? applyTransition(id, "arrive", "DRIVER") : null),
      DRIVER_ARRIVED: () => (dwell > 9 * SEC ? applyTransition(id, "start-loading", "DRIVER") : null),
      LOADING: () => (dwell > 11 * SEC ? applyTransition(id, "loaded", "DRIVER") : null),
      LOADED: () => (dwell > 6 * SEC ? applyTransition(id, "start-trip", "DRIVER") : null),
      IN_TRANSIT: () => (live && live.progress >= 0.86 ? applyTransition(id, "arriving", "DRIVER") : null),
      ARRIVING: () => (live && live.progress >= 1 ? applyTransition(id, "deliver", "DRIVER") : null),
      DELIVERED: () =>
        dwell > 8 * SEC
          ? applyTransition(id, "pod", "DRIVER", { label: `Proof of delivery · ${s!.dropoffContact || "Recipient"} · OTP verified` })
          : null,
    };
    const step = next[s.status];
    if (step) {
      await step();
      s = (await getShipmentFull({ id })) ?? s;
      if (s.status === "POD_CONFIRMED") {
        // record POD fields like the driver app would
        const { db } = await import("@/lib/db");
        await db.shipment.update({
          where: { id },
          data: { podRecipient: s.dropoffContact || "Recipient", podOtp: "auto", podPhotoTaken: true, podVerifiedAt: new Date(), podLat: s.dropoffLat, podLng: s.dropoffLng },
        }).catch(() => null);
        s = (await getShipmentFull({ id })) ?? s;
      }
    }
  }

  return NextResponse.json({ shipment: shipmentDTO(s) });
}
