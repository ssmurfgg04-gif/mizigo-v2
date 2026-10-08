// Daraja backup-channel tests (per-transaction Paystack→Daraja fallback +
// the callback-only confirmation gate for live Safaricom STK payments).
// Integration against the real (sqlite) DB; the ONLY mocks are the provider
// REST layers (Paystack initialize + Daraja STK push) — no network, no money.
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { randomBytes } from "node:crypto";

const TEST_SECRET = "sk_test_" + randomBytes(16).toString("hex");
let initFails = true; // the fake Paystack initialize is down for these tests

vi.mock("@/lib/integrations/paystack", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/integrations/paystack")>();
  return {
    ...actual,
    resolvePaystackSecret: vi.fn(async () => TEST_SECRET),
    resolveWebhookSecret: vi.fn(async () => TEST_SECRET),
    initializeTransaction: vi.fn(async () =>
      initFails
        ? { ok: false as const, error: "Paystack timeout on /transaction/initialize" }
        : { ok: true as const, data: { authorization_url: "https://checkout.paystack.com/x", access_code: "ac", reference: "r" } },
    ),
  };
});

vi.mock("@/lib/integrations", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/integrations")>();
  return {
    ...actual,
    isDarajaEnabled: vi.fn(() => true),
    initiateMpesaPayment: vi.fn(async () => ({
      mode: "LIVE" as const,
      ok: true as const,
      MerchantRequestID: "29115-34620561-1",
      CheckoutRequestID: "ws_CO_" + Date.now().toString(36),
      ResponseCode: "0",
      ResponseDescription: "Success. Request accepted for processing",
    })),
  };
});

import { startCustomerPayment, confirmCustomerPayment, failPendingPayment } from "@/lib/payments";
import { db } from "@/lib/db";
import { ensureDB } from "@/lib/db-ready";

const uniq = "d" + Date.now().toString(36);
let fixtureSeq = 0;

async function makeShipment(fareTotal: number): Promise<string> {
  const cat = await db.vehicleCategory.findFirst();
  const customer = await db.user.create({
    data: { phone: `0715${(Date.now() % 100000000).toString().padStart(8, "0")}${fixtureSeq}`, name: "Daraja Fallback Test", role: "CUSTOMER" },
  });
  const s = await db.shipment.create({
    data: {
      code: `MZG-${(Date.now() % 900000 + 100000)}${fixtureSeq}`, shareToken: randomBytes(12).toString("hex"),
      customerId: customer.id, status: "PAYMENT_PENDING",
      pickupName: "Test Pickup", pickupArea: "CBD", pickupLat: -1.2841, pickupLng: 36.8265,
      dropoffName: "Test Dropoff", dropoffArea: "Westlands", dropoffLat: -1.267, dropoffLng: 36.801,
      distanceKm: 5, durationMin: 20, cargoCategory: "retail",
      categoryId: cat!.id,
      fareBase: 500, fareDistance: 450, fareDuration: 60, fareLoading: 0, fareStops: 0,
      farePlatform: 100, fareTotal, driverEarnings: Math.round(fareTotal * 0.85) - 100, commission: Math.round(fareTotal * 0.15),
      paymentMethod: "MPESA", paymentStatus: "PENDING",
    },
  });
  fixtureSeq++;
  return s.id;
}

let idA: string, idB: string;
let checkoutA = "";

beforeAll(async () => {
  await ensureDB();
  idA = await makeShipment(3000);
  idB = await makeShipment(1500);
});

afterAll(async () => {
  await db.shipment.deleteMany({ where: { id: { in: [idA, idB] } } }).catch(() => null);
  await db.$disconnect();
});

describe("Paystack → Daraja backup channel (per-transaction fallback)", () => {
  it("falls back to a Daraja STK push when Paystack initialize fails", async () => {
    const r = await startCustomerPayment(idA, 1);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.outcome.provider).toBe("DARAJA");
    expect(r.outcome.mode).toBe("STK");
    expect(r.outcome.prompt).toContain("phone");
    checkoutA = r.outcome.checkoutReqId;
    const ev = await db.paymentEvent.findUnique({ where: { checkoutReqId: checkoutA } });
    expect(ev?.provider).toBe("DARAJA");
    expect(ev?.status).toBe("PENDING");
    // the fallback reason is recorded for reconciliation
    const meta = ev?.providerMeta ? (JSON.parse(ev.providerMeta) as { fallbackFrom?: string }) : {};
    expect(meta.fallbackFrom).toBe("PAYSTACK");
  });
});

describe("Daraja payment confirmation (callback-only gate)", () => {
  it("a client action can NEVER confirm a live Daraja STK payment", async () => {
    const r = await confirmCustomerPayment(idA, "pay-confirm");
    expect(r.ok).toBe(false);
    expect(r.code).toBe(202);
    const ev = await db.paymentEvent.findUnique({ where: { checkoutReqId: checkoutA } });
    expect(ev?.status).toBe("PENDING");
  });

  it("pay-verify polls as pending too (202, no state change)", async () => {
    const r = await confirmCustomerPayment(idA, "pay-verify");
    expect(r.ok).toBe(false);
    expect(r.code).toBe(202);
  });

  it("the Daraja callback confirms with the exact fare + real receipt", async () => {
    const r = await confirmCustomerPayment(idA, "callback", { receipt: "QGH7XK2M9P", amountKes: 3000 });
    expect(r.ok).toBe(true);
    expect(r.receipt).toBe("QGH7XK2M9P");
    const ev = await db.paymentEvent.findUnique({ where: { checkoutReqId: checkoutA } });
    expect(ev?.status).toBe("CONFIRMED");
    expect(ev?.mpesaReceipt).toBe("QGH7XK2M9P");
    expect(ev?.channel).toBe("mpesa");
    const s = await db.shipment.findUnique({ where: { id: idA } });
    expect(s?.paymentStatus).toBe("CONFIRMED");
    expect(s?.status).toBe("PAYMENT_CONFIRMED");
  });

  it("a replayed callback is idempotent (alreadyPaid)", async () => {
    const r = await confirmCustomerPayment(idA, "callback", { receipt: "QGH7XK2M9P", amountKes: 3000 });
    expect(r.ok).toBe(true);
    expect(r.alreadyPaid).toBe(true);
  });
});

describe("Daraja amount integrity + failure paths", () => {
  it("a callback with the WRONG amount marks the attempt FAILED and pages admins", async () => {
    const r = await startCustomerPayment(idB, 1); // fresh DARAJA attempt
    expect(r.ok).toBe(true);
    const m = await confirmCustomerPayment(idB, "callback", { receipt: "BADAMT01", amountKes: 100 }); // fare is 1500
    expect(m.ok).toBe(false);
    const ev = await db.paymentEvent.findFirst({ where: { shipmentId: idB }, orderBy: { createdAt: "desc" } });
    expect(ev?.status).toBe("FAILED");
    // an admin notification was created (amount mismatch is an incident)
    const admins = await db.user.findMany({ where: { role: "ADMIN" }, select: { id: true } });
    const notes = admins.length
      ? await db.notification.count({ where: { userId: { in: admins.map((a) => a.id) }, title: "Payment amount mismatch" } })
      : 0;
    expect(notes).toBeGreaterThanOrEqual(1);
  });

  it("failPendingPayment marks a cancelled PIN-dialog attempt FAILED, idempotently", async () => {
    const r = await startCustomerPayment(idB, 2);
    expect(r.ok).toBe(true);
    const checkout = r.ok ? r.outcome.checkoutReqId : "";
    expect(await failPendingPayment(checkout, "ResultCode 1032: Request cancelled by user")).toBe(true);
    expect(await failPendingPayment(checkout, "replay")).toBe(false); // already terminal
  });
});
