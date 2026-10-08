#!/usr/bin/env node
// Vault read-check: proves the app's own database role (the session-pooler
// connection string in DATABASE_URL, exactly what the Netlify functions use)
// can read Supabase Vault secrets — the load-bearing assumption of the
// runtime-secrets pattern (src/lib/runtime-secrets.ts).
//
// Prints secret NAMES only (never values) and the count the app would
// hydrate. Run from CI (production-migrate) or locally:
//   DATABASE_URL=postgresql://… node scripts/vault_read_check.mjs
import { Client } from "pg";

const url = process.env.DATABASE_URL;
if (!url) { console.error("vault_read_check: DATABASE_URL not set"); process.exit(1); }

// strip sslmode (pg maps sslmode=require to verify-full; explicit ssl wins)
const cleanUrl = (() => {
  try { const u = new URL(url); u.searchParams.delete("sslmode"); return u.href; } catch { return url; }
})();

const c = new Client({ connectionString: cleanUrl, ssl: { rejectUnauthorized: false } });
await c.connect();
try {
  const r = await c.query("select name from vault.decrypted_secrets order by name");
  const names = r.rows.map((row) => row.name);
  console.log(`vault_read_check: OK — ${names.length} secret(s) readable by the app role: ${names.join(", ") || "(none provisioned)"}`);
  const failed = await c.query("select 1 from vault.decrypted_secrets limit 1").then(() => false).catch(() => true);
  if (failed) throw new Error("decrypted view unreadable");
} finally {
  await c.end();
}
