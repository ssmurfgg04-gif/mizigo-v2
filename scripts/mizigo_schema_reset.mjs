#!/usr/bin/env node
// Reset the mizigo schema on Supabase (production hygiene between test runs):
// truncates every mizigo.* table; the next cold start re-seeds demo data.
// Usage: SUPA_URL=postgresql://... node scripts/mizigo_schema_reset.mjs
import { Client } from "pg";

const url = process.env.SUPA_URL;
if (!url) { console.error("SUPA_URL not set"); process.exit(1); }
const c = new Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
await c.connect();

const t = await c.query(
  "SELECT tablename FROM pg_tables WHERE schemaname = 'mizigo' ORDER BY tablename",
);
const tables = t.rows.map((r) => r.tablename);
if (!tables.length) { console.log("mizigo schema has no tables — nothing to reset"); await c.end(); process.exit(0); }

// TRUNCATE ... RESTART IDENTITY CASCADE in one statement — atomic and fast
const list = tables.map((x) => `"mizigo"."${x}"`).join(", ");
await c.query(`TRUNCATE ${list} RESTART IDENTITY CASCADE`);
console.log(`reset: truncated ${tables.length} tables in schema mizigo`);

// confirm the neighbour app (public schema) was untouched
const pub = await c.query(
  "SELECT count(*)::int AS n FROM pg_tables WHERE schemaname = 'public'",
);
console.log(`public schema untouched: ${pub.rows[0].n} tables still present`);
await c.end();
