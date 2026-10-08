// Paystack webhook integration tests — the full dispatch path against the
// real (sqlite) DB: signature gate → PaystackEvent idempotency ledger →
// confirmCustomerPayment / payout state machines. The only thing mocked is
// the Paystack REST layer (verifyTransaction + secret resolution) so no
// network is touched and no real money can move; the HMAC verification is
// the REAL implementation (importActual).
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { createHmac, randomBytes } from "node:crypto";

const TEST_SECRET = "sk_test_" + randomBytes(16).toString("hex");

vi.mock("@/lib/integrations/paystack", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/integrations/paystack")>();
  return {
    ...actual,
    // NOTE: vi.mock does not rewire a module's INTERNAL calls, so both the
    // secret resolvers are mocked directly (resolveWebhookSecret would
    // otherwise close over the real resolvePaystackSecret).
    resolvePaystackSecret: vi.fn(async () => TEST_SECRET),
    resolveWebhookSecret: vi.fn(async () => TEST_SECRET),
    // verify always reports the exact expected amount for whatever reference
    // it is asked about (each test controls expectations via the DB rows)
    verifyTransaction: vi.fn(async (_secret: string, reference: string) => ({
      ok: true as const,
      data: {
        status: "success" as const,
        amount: VERIFY_AMOUNTS[reference] ?? 0,
        currency: "KES",
        reference,
        id: 424242,
        channel: "mobile_money",
        fees: 15,
        customer_email: "mz-test@mizigo.app",
      },
    })),
  };
});

// reference → subunits the fake verify reports (tests set these before firing)
const VERIFY_AMOUNTS: Record<string, number> = {};

import { handlePaystackWebhook } from "@/lib/payments";
import { db } from "@/lib/db";
import { ensureDB } from "@/lib/db-ready";

const sign = (body: string) => createHmac("sha512", TEST_SECRET).update(body, "utf8").digest("hex");
const hook = (payload: unknown, sig?: string) => {
  const body = JSON.stringify(payload);
  return handlePaystackWebhook(body, sig ?? sign(body));
};

const uniq = "t" + Date.now().toString(36);

// fixtures — every reference is unique PER CALL (checkoutReqId is unique)
let fixtureSeq = 0;
const nextRef = () => `MZG9${uniq.toUpperCase()}${(++fixtureSeq).toString(36).toUpperCase()}A1`.replace(/[^A-Z0-9]/g, "");
let customerId: string, driverId: string;
const PO_REF = `po-${uniq}-01`.padEnd(16, "0").slice(0, 18);
const ORPHAN_REF = `MZG0${uniq.toUpperCase()}A9`;

async function makeShipment(fareTotal: number): Promise<{ id: string; ref: string }> {
  const ref = nextRef();
  VERIFY_AMOUNTS[ref] = fareTotal * 100; // the fake verify reports the exact fare
  const cat = await db.vehicleCategory.findFirst();
  const customer = await db.user.create({
    data: { phone: `0719${(Date.now() % 100000000).toString().padStart(8, "0")}${fixtureSeq}`, name: "Webhook Test", role: "CUSTOMER" },
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
  await db.paymentEvent.create({
    data: { shipmentId: s.id, checkoutReqId: ref, provider: "PAYSTACK", method: "MPESA", amount: fareTotal, amountSubunits: fareTotal * 100, status: "PENDING" },
  });
  return { id: s.id, ref };
}

let main: { id: string; ref: string };

beforeAll(async () => {
  await ensureDB();
  main = await makeShipment(3000);
  const driverUser = await db.user.create({
    data: { phone: `0729${(Date.now() % 100000000).toString().padStart(8, "0")}`, name: "Payout Test Driver", role: "DRIVER" },
  });
  const d = await db.driver.create({ data: { userId: driverUser.id, status: "OFFLINE" } });
  driverId = d.id;
});

afterAll(async () => {
  // full cascade cleanup of this test's fixtures
  await db.paystackEvent.deleteMany({ where: { OR: [{ reference: main.ref }, { reference: PO_REF }, { reference: ORPHAN_REF }] } });
  await db.payout.deleteMany({ where: { reference: PO_REF } });
  await db.shipment.deleteMany({ where: { id: main.id } }).catch(() => null);
  await db.driver.deleteMany({ where: { id: driverId } }).catch(() => null);
  await db.$disconnect();
});

describe("handlePaystackWebhook (integration, sqlite)", () => {
  it("rejects an unsigned/tampered request with 401 and zero DB writes", async () => {
    const before = await db.paystackEvent.count();
    const r = await hook({ event: "charge.success", data: { reference: main.ref } }, "deadbeef".repeat(16));
    expect(r.status).toBe(401);
    expect(await db.paystackEvent.count()).toBe(before);
  });

  it("processes charge.success → payment CONFIRMED (exact amount match)", async () => {
    const r = await hook({ event: "charge.success", data: { reference: main.ref, amount: 300000, currency: "KES", id: 424242 } });
    expect(r.status).toBe(200);
    expect(r.note).toBe("processed");
    const ev = await db.paymentEvent.findUnique({ where: { checkoutReqId: main.ref } });
    expect(ev?.status).toBe("CONFIRMED");
    expect(ev?.providerTxId).toBe("424242");
    expect(ev?.channel).toBe("mobile_money");
    const s = await db.shipment.findUnique({ where: { id: main.id } });
    expect(s?.paymentStatus).toBe("CONFIRMED");
    expect(s?.status).toBe("PAYMENT_CONFIRMED");
  });

  it("replays the identical event with no state change (idempotency ledger)", async () => {
    const r = await hook({ event: "charge.success", data: { reference: main.ref, amount: 300000, currency: "KES", id: 424242 } });
    expect(r.status).toBe(200);
    expect(r.note).toContain("duplicate");
    const rows = await db.paystackEvent.findMany({ where: { reference: main.ref } });
    expect(rows.length).toBe(1); // ledger holds exactly one copy
  });

  it("flags a non-paystack payment as IGNORED (provider guard)", async () => {
    // a MOCK payment with the same shape must NOT be confirmable by webhook
    const fx = await makeShipment(1500);
    const mockRef = `ws_CO_MOCK_${uniq}`;
    await db.paymentEvent.updateMany({ where: { shipmentId: fx.id, provider: "PAYSTACK" }, data: { provider: "MOCK", checkoutReqId: mockRef } });
    const r = await hook({ event: "charge.success", data: { reference: mockRef, amount: 150000 } });
    expect(r.status).toBe(200);
    expect(r.note).toContain("non-paystack");
    const ev = await db.paymentEvent.findUnique({ where: { checkoutReqId: mockRef } });
    expect(ev?.status).toBe("PENDING"); // untouched
    await db.shipment.deleteMany({ where: { id: fx.id } });
  });

  it("flags an unknown reference as an orphan (no crash, 200)", async () => {
    const r = await hook({ event: "charge.success", data: { reference: ORPHAN_REF, amount: 1 } });
    expect(r.status).toBe(200);
    expect(r.note).toBe("orphan reference");
  });

  it("ignores events outside the allowlist", async () => {
    const r = await hook({ event: "transfer.queued", data: { reference: "x" } });
    expect(r.status).toBe(200);
    expect(r.note).toContain("ignored unhandled event");
  });

  it("moves a Payout PENDING → PAID on transfer.success (with fee capture)", async () => {
    await db.payout.create({
      data: { driverId, amount: 2500, method: "PAYSTACK_MPESA", status: "PROCESSING", reference: PO_REF, transferCode: "TRF_TEST" },
    });
    const r = await hook({ event: "transfer.success", data: { reference: PO_REF, amount: 250000, fee_charged: 4000 } });
    expect(r.status).toBe(200);
    const p = await db.payout.findUnique({ where: { reference: PO_REF } });
    expect(p?.status).toBe("PAID");
    expect(p?.feeCharged).toBe(4000);
  });

  it("rejects a transfer event with a mismatched amount (anti-tamper)", async () => {
    const r = await hook({ event: "transfer.failed", data: { reference: PO_REF, amount: 999999 } });
    expect(r.status).toBe(200);
    expect(r.note).toContain("amount mismatch");
    const p = await db.payout.findUnique({ where: { reference: PO_REF } });
    expect(p?.status).toBe("PAID"); // unchanged — the bad event was ignored
  });
});
