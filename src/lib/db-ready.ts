// MIZIGO — runtime database readiness.
// Sandbox (SQLite, per-instance /tmp on Netlify): a cold start with an empty
// DB creates the schema from DDL_STATEMENTS (generated from
// prisma/schema.prisma) and seeds demo data. Single-flight: concurrent
// callers share one bootstrap promise per instance. Local dev: schema
// already exists via `prisma db push`; this is a cheap no-op.
// Production (DATABASE_URL=postgres://…): the schema is pushed at build time
// by scripts/db-prepare.mjs (prisma db push) and persists in the hosted DB —
// verify it exists and fail with a clear message if the deploy skipped it.

import { db } from "./db";
import { DDL_STATEMENTS } from "./ddl";
import { ensureSeed } from "./seed";

const IS_POSTGRES = /^postgres(ql)?:\/\//.test(process.env.DATABASE_URL ?? "");

let ready: Promise<void> | null = null;

async function ensureSchema(): Promise<void> {
  if (IS_POSTGRES) {
    // mizigo's Postgres tables live in their own schema (default: mizigo) so
    // the platform can share a Supabase project with other apps — the schema
    // is mirrored in the URL's ?schema= param (see prisma/schema.postgres.prisma)
    const schema = (() => {
      try {
        return new URL(process.env.DATABASE_URL!).searchParams.get("schema") ?? "public";
      } catch {
        return "public";
      }
    })();
    const rows = await db.$queryRawUnsafe<{ c: string }[]>(
      "SELECT COUNT(*)::text AS c FROM information_schema.tables WHERE table_schema = $1 AND table_name = 'Shipment'",
      schema,
    );
    if (!Number(rows[0]?.c)) {
      throw new Error(
        `Production Postgres has no Mizigo schema (schema "${schema}"). Set DATABASE_URL to the hosted Postgres and deploy again (scripts/db-prepare.mjs runs \`prisma db push\` during the build).`,
      );
    }
    return;
  }
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
