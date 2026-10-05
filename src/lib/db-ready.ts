// MIZIGO — runtime database readiness for serverless hosts.
// On a cold start with an empty /tmp SQLite (Netlify), creates the schema from
// DDL_STATEMENTS (generated from prisma/schema.prisma) and seeds demo data.
// Single-flight: concurrent callers share one bootstrap promise per instance.
// Local dev: schema already exists via `prisma db push`; this is a cheap no-op.

import { db } from "./db";
import { DDL_STATEMENTS } from "./ddl";
import { ensureSeed } from "./seed";

let ready: Promise<void> | null = null;

async function ensureSchema(): Promise<void> {
  const rows = await db.$queryRawUnsafe<{ c: number }[]>(
    "SELECT COUNT(*) AS c FROM sqlite_master WHERE type='table' AND name='Shipment'",
  );
  if ((rows[0] as { c: number } | undefined)?.c) return;
  // IF NOT EXISTS on every statement keeps concurrent cold starts safe.
  for (const stmt of DDL_STATEMENTS) {
    await db.$executeRawUnsafe(stmt);
  }
}

export function ensureDB(): Promise<void> {
  if (!ready) {
    ready = (async () => {
      await ensureSchema();
      await ensureSeed();
    })().catch((err) => {
      ready = null; // allow retry on next request
      throw err;
    });
  }
  return ready;
}
