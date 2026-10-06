// TEMPORARY production diagnostic endpoint (remove after outage is resolved).
// Returns HTTP 200 JSON with runtime diagnostics so failures that only happen
// on the real Netlify Lambda runtime can be observed without log access.
// Reports no secrets: booleans + error strings + engine file names only.
import { NextResponse } from "next/server";
import { readdirSync, readFileSync, existsSync, writeFileSync, unlinkSync } from "node:fs";
import { execSync } from "node:child_process";

export const dynamic = "force-dynamic";

function tryRun<T>(label: string, fn: () => T, out: Record<string, unknown>) {
  try {
    out[label] = fn();
  } catch (e) {
    out[label] = "ERROR: " + (e as Error)?.message;
  }
}

export async function GET() {
  const out: Record<string, unknown> = {};

  tryRun("nodeVersion", () => process.version, out);
  tryRun("platform", () => `${process.platform}/${process.arch}`, out);
  tryRun("cwd", () => process.cwd(), out);
  tryRun("netlifyEnv", () => process.env.NETLIFY ?? null, out);
  tryRun("databaseUrl", () => process.env.DATABASE_URL ?? null, out);
  out.blobsContextPresent = Boolean(process.env.NETLIFY_BLOBS_CONTEXT);
  tryRun("osRelease", () => readFileSync("/etc/os-release", "utf8").slice(0, 300), out);

  // /tmp writability
  tryRun("tmpWritable", () => {
    writeFileSync("/tmp/__diag_probe", "ok");
    unlinkSync("/tmp/__diag_probe");
    return true;
  }, out);

  // engine files visible to the function
  for (const base of [process.cwd(), process.cwd() + "/..", "/var/task", "/"]) {
    const dir = `${base}/node_modules/.prisma/client`;
    if (existsSync(dir)) {
      tryRun("prismaClientDir@" + base, () =>
        readdirSync(dir).filter((f) => f.includes("engine") || f.endsWith(".node")),
      , out);
      break;
    }
  }
  tryRun("prismaEnginesDir", () => {
    const dir = `${process.cwd()}/node_modules/@prisma/engines`;
    return existsSync(dir) ? readdirSync(dir).slice(0, 10) : "missing";
  }, out);

  // Prisma: constructor (engine load) + first query + full bootstrap
  try {
    const { db } = await import("@/lib/db");
    out.prismaConstruct = "ok";
    try {
      await db.$queryRawUnsafe("SELECT 1 AS one");
      out.prismaSelect1 = "ok";
    } catch (e) {
      out.prismaSelect1 = "ERROR: " + (e as Error)?.message;
    }
    try {
      const { ensureDB } = await import("@/lib/db-ready");
      await ensureDB();
      out.ensureDB = "ok";
    } catch (e) {
      out.ensureDB = "ERROR: " + (e as Error)?.message;
    }
  } catch (e) {
    out.prismaConstruct = "ERROR: " + (e as Error)?.message;
  }

  // ldd on an engine file (symbol resolution on this runtime)
  try {
    const dir = `${process.cwd()}/node_modules/.prisma/client`;
    const engine = readdirSync(dir).find((f) => f.endsWith(".so.node"));
    if (engine) {
      tryRun("ldd", () =>
        execSync(`ldd ${dir}/${engine} 2>&1 | head -12`, { encoding: "utf8" }),
      , out);
    }
  } catch {
    out.ldd = "unavailable";
  }

  return NextResponse.json({ ok: true, diag: out });
}
