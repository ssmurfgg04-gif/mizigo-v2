// GET /api/shipments/[id] — full detail + live position (polled by live screens)
// ?demo=auto (customer active-trip poll): sandbox driver auto-advance so the
// journey completes while watching. When the customer screen unmounts (e.g.
// the user switches to the driver surface) polling stops, so a human driver
// can take over at any time — the state machine guards both paths.
import { NextResponse } from "next/server";
import { getShipmentFull, shipmentDTO, applyTransition, simulateLive } from "@/lib/shipments";

export const dynamic = "force-dynamic";

const SEC = 1000;

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const demoAuto = new URL(req.url).searchParams.get("demo") === "auto";
  let s = await getShipmentFull({ id });
  if (!s) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // DEV-MODE MOCK: the assigned driver auto-accepts after ~5s
  if (s.status === "DRIVER_ASSIGNED" && Date.now() - new Date(s.stateEnteredAt).getTime() > 5000) {
    await applyTransition(id, "driver-accept", "DRIVER", { label: "Driver accepted · on the way to pickup" }).catch(() => null);
    s = (await getShipmentFull({ id })) ?? s;
  }

  // DEV-MODE MOCK: sandbox driver walks the trip through its stations
  if (demoAuto) {
    const dwell = Date.now() - new Date(s.stateEnteredAt).getTime();
    const live = simulateLive(s);
    const next: Record<string, () => Promise<unknown>> = {
      DRIVER_EN_ROUTE: () => (live && live.progress >= 1 ? applyTransition(id, "arrive", "DRIVER") : null),
      DRIVER_ARRIVED: () => (dwell > 9 * SEC ? applyTransition(id, "start-loading", "DRIVER") : null),
      LOADING: () => (dwell > 11 * SEC ? applyTransition(id, "loaded", "DRIVER") : null),
      LOADED: () => (dwell > 6 * SEC ? applyTransition(id, "start-trip", "DRIVER") : null),
      IN_TRANSIT: () => (live && live.progress >= 0.86 ? applyTransition(id, "arriving", "DRIVER") : null),
      ARRIVING: () => (live && live.progress >= 1 ? applyTransition(id, "deliver", "DRIVER") : null),
      DELIVERED: () =>
        dwell > 8 * SEC
          ? applyTransition(id, "pod", "DRIVER", { label: `Proof of delivery · ${s!.dropoffContact || "Recipient"} · OTP verified` })
              .then(() => fetch(`http://localhost:3000/api/shipments/${id}`, { method: "GET" }).catch(() => null))
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
