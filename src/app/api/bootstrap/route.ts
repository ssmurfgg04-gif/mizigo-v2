// GET /api/bootstrap — ensure seed, return marketplace config + platform settings.
// Perf (task 10-E): response gains a shape-additive `build` block (sha, db mode,
// demo-auto-progress flag) and the route emits request telemetry.
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { ensureDB } from "@/lib/db-ready";
import { dbIsPostgres, isDemoAutoProgress } from "@/lib/feature-flags";
import { record, logEvent } from "@/lib/telemetry";

export const dynamic = "force-dynamic";

export async function GET() {
  const t0 = Date.now();
  try {
    const res = await handle();
    record("api:bootstrap", Date.now() - t0, res.ok);
    logEvent({ route: "api:bootstrap", latencyMs: Date.now() - t0, ok: res.ok, status: res.status });
    return res;
  } catch (err) {
    record("api:bootstrap", Date.now() - t0, false);
    logEvent({ level: "error", route: "api:bootstrap", ok: false, extra: { message: (err as Error)?.message } });
    throw err;
  }
}

async function handle(): Promise<NextResponse> {
  await ensureDB();
  const [categories, zone, counts, settingRows] = await Promise.all([
    db.vehicleCategory.findMany({ where: { active: true }, orderBy: { sortOrder: "asc" } }),
    db.pricingZone.findFirst({ where: { key: "nairobi" } }),
    db.place.count(),
    db.platformSetting.findMany(),
  ]);
  const settings = Object.fromEntries(settingRows.map((s) => [s.key, s.value]));
  return NextResponse.json({
    categories,
    zone,
    places: counts,
    settings: {
      supportPhone: settings.supportPhone ?? "0800 724 343",
      advanceBookingDays: Number(settings.advanceBookingDays ?? 14),
      autoDispatch: settings.autoDispatch !== "false",
      quoteExpiryMinutes: Number(settings.quoteExpiryMinutes ?? 60),
      cancellationFeeKes: Number(settings.cancellationFeeKes ?? 200),
      cancelGraceMinutes: Number(settings.cancelGraceMinutes ?? 2),
    },
    demo: {
      customer: { email: "customer@mizigo.demo", phone: "0712 000 001", name: "John Kariuki" },
      business: { email: "business@mizigo.demo", phone: "0722 000 033", name: "Zainab Mabuyu", business: "ABC Traders Ltd" },
      driver: { email: "driver@mizigo.demo", phone: "0712 000 002", name: "Peter Kamau" },
      admin: { email: "admin@mizigo.demo", name: "Ops Control" },
    },
    build: {
      sha: process.env.BUILD_SHA || process.env.COMMIT_REF || "dev",
      mode: dbIsPostgres() ? "postgres" : "sqlite",
      demo: isDemoAutoProgress(),
    },
  });
}
