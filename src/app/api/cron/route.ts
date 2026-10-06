// GET /api/cron — secret-gated maintenance jobs.
//
// ACCESS MODEL: requires CRON_SECRET to be set in the environment. When it is
// UNSET the endpoint 404s unconditionally (indistinguishable from an unknown
// route — it does not reveal its own existence, and 401 would). When set, the
// caller must prove knowledge via `?secret=…` or the `X-Cron-Secret` header
// (timing-safe compare); any mismatch also 404s.
//
// Each job is individually try/caught — one failing job never blocks the
// others; results are aggregated into the response JSON.
//
// Jobs:
//   1. expireQuotes    — flip stale PENDING driver quotes (past their
//                        quoteExpiryMinutes-derived expiresAt) to EXPIRED.
//                        (Quote.status enum: PENDING | ACCEPTED | DECLINED | EXPIRED)
//   2. freeStuckDrivers— drivers stuck BUSY with zero active shipments →
//                        ONLINE (fleet-wide version of the POD self-heal in
//                        /api/shipments/[id] which auto-completes POD_CONFIRMED
//                        after a dwell window to release the driver).
//   3. reconcilePayments— payments still PENDING after 10 min are logged for
//                        the record; when Daraja is enabled each gets an
//                        stkQuery follow-up (timeout reconciliation).
//
// NETLIFY WIRING (documented here — netlify.toml is intentionally NOT edited):
// create netlify/functions/cron-ping.mjs:
//
//   export default async () => {
//     const base = process.env.URL || process.env.DEPLOY_PRIME_URL;
//     const secret = process.env.CRON_SECRET;
//     if (!base || !secret) return new Response("cron not configured", { status: 200 });
//     return fetch(`${base}/api/cron?secret=${encodeURIComponent(secret)}`);
//   };
//
// and add to netlify.toml (Netlify scheduled-function convention — the
// [functions."<name>"] block; the Next runtime's own handlers live under
// .netlify/functions-internal/ and are untouched):
//
//   [functions."cron-ping"]
//     schedule = "*/15 * * * *"   # or "@hourly"
//
// Then set CRON_SECRET in Netlify env. Without it this route stays dark (404).

import { createHash, timingSafeEqual } from "crypto";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { ensureDB } from "@/lib/db-ready";
import { getPendingCheckout, isDarajaEnabled, stkQuery } from "@/lib/integrations";

export const dynamic = "force-dynamic";

/** Timing-safe string equality (hash first — no length leak). */
function secretMatches(a: string, b: string): boolean {
  const ha = createHash("sha256").update(a).digest();
  const hb = createHash("sha256").update(b).digest();
  return timingSafeEqual(ha, hb);
}

function notFound(): NextResponse {
  // same shape the app uses for unknown resources — reveals nothing extra
  return NextResponse.json({ error: "Not Found" }, { status: 404 });
}

export async function GET(req: Request) {
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    // CRON_SECRET unset → the feature is disabled; always 404 (documented).
    console.warn("[cron] hit with no CRON_SECRET configured — returning 404");
    return notFound();
  }
  const { searchParams } = new URL(req.url);
  const presented = searchParams.get("secret") ?? req.headers.get("x-cron-secret") ?? "";
  if (!presented || !secretMatches(presented, expected)) {
    console.warn("[cron] rejected (bad or missing secret)");
    return notFound();
  }

  await ensureDB();
  const ranAt = new Date().toISOString();
  const results: Record<string, unknown> = {};

  // ── Job 1: expire stale quotes ────────────────────────────────────────────
  // Quotes carry expiresAt = createdAt + quoteExpiryMinutes (platform setting,
  // set at driver-quote time — same setting the accept-quote path enforces).
  // The cron is the sweeper for quotes nobody accepted/declined in time.
  try {
    const quoteExpiryMinutes = Number(
      (await db.platformSetting.findUnique({ where: { key: "quoteExpiryMinutes" } }))?.value ?? 60
    );
    const expired = await db.quote.updateMany({
      where: { status: "PENDING", expiresAt: { lt: new Date() } },
      data: { status: "EXPIRED" },
    });
    results.expireQuotes = { expired: expired.count, quoteExpiryMinutes };
    if (expired.count) {
      console.log(`[cron] expired ${expired.count} stale quote(s) (expiry window ${quoteExpiryMinutes} min)`);
    }
  } catch (err) {
    console.error("[cron] expireQuotes failed", err);
    results.expireQuotes = { error: err instanceof Error ? err.message : String(err) };
  }

  // ── Job 2: free drivers stuck BUSY on terminal shipments ──────────────────
  // A driver is BUSY only while they own a shipment in an active state; the
  // shipment GET already self-heals the POD_CONFIRMED→COMPLETED dwell case —
  // this is the fleet-wide net for anything that slipped through (cancelled
  // while BUSY, crash between transitions, …).
  try {
    const ACTIVE = [
      "MATCHING", "DRIVER_ASSIGNED", "DRIVER_EN_ROUTE", "DRIVER_ARRIVED",
      "LOADING", "LOADED", "IN_TRANSIT", "ARRIVING", "DELIVERED", "POD_CONFIRMED",
    ] as const;
    const busyDrivers = await db.driver.findMany({ where: { status: "BUSY" }, select: { id: true } });
    let freed = 0;
    if (busyDrivers.length) {
      const busyIds = busyDrivers.map((d) => d.id);
      const withActive = await db.shipment.groupBy({
        by: ["driverId"],
        where: { status: { in: [...ACTIVE] }, driverId: { in: busyIds } },
        _count: { _all: true },
      });
      const activeDriverIds = new Set(withActive.map((g) => g.driverId).filter((x): x is string => !!x));
      const stuck = busyIds.filter((id) => !activeDriverIds.has(id));
      if (stuck.length) {
        const upd = await db.driver.updateMany({
          where: { id: { in: stuck }, status: "BUSY" },
          data: { status: "ONLINE", lastPingAt: new Date() },
        });
        freed = upd.count;
        console.log(`[cron] freed ${freed} driver(s) stuck BUSY with no active shipment (${busyDrivers.length} scanned)`);
      }
    }
    results.freeStuckDrivers = { scanned: busyDrivers.length, freed };
  } catch (err) {
    console.error("[cron] freeStuckDrivers failed", err);
    results.freeStuckDrivers = { error: err instanceof Error ? err.message : String(err) };
  }

  // ── Job 3: payment reconciliation summary ─────────────────────────────────
  // Payments still PENDING after 10 min are almost certainly abandoned PIN
  // dialogs or callbacks Daraja never delivered. Log them; when Daraja is
  // configured, follow up with stkQuery per checkout (timeout reconciliation).
  try {
    const stale = await db.paymentEvent.findMany({
      where: { status: "PENDING", createdAt: { lt: new Date(Date.now() - 10 * 60_000) } },
      select: { checkoutReqId: true, amount: true, shipmentId: true, createdAt: true },
    });
    let darajaFollowUps = 0;
    const darajaOn = isDarajaEnabled();
    for (const p of stale) {
      const tracked = !!getPendingCheckout(p.checkoutReqId);
      if (darajaOn) {
        darajaFollowUps += 1;
        const q = await stkQuery(p.checkoutReqId); // never throws; logs its own outcome
        console.log(
          `[cron] reconcile · ${p.checkoutReqId} · KES ${p.amount} · age ${Math.round((Date.now() - new Date(p.createdAt).getTime()) / 60000)} min · stkQuery ${q.found ? `found ResultCode ${q.resultCode}` : "no result"}${tracked ? " · tracked" : " · untracked (PaymentCallback table pending — see integrations docs)"}`
        );
      } else {
        console.log(
          `[cron] reconcile · ${p.checkoutReqId} · shipment ${p.shipmentId} · KES ${p.amount} · PENDING >10 min — Daraja disabled, logged only`
        );
      }
    }
    results.reconcilePayments = { stalePending: stale.length, darajaFollowUps, darajaEnabled: darajaOn };
  } catch (err) {
    console.error("[cron] reconcilePayments failed", err);
    results.reconcilePayments = { error: err instanceof Error ? err.message : String(err) };
  }

  return NextResponse.json({ ok: true, ranAt, jobs: results });
}
