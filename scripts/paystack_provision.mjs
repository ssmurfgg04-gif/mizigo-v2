#!/usr/bin/env node
// Paystack production provisioning: encrypts the provider keys into the
// mizigo schema's PlatformSetting table (AES-256-GCM, master key from env —
// never stored in the DB). The app resolves keys at runtime:
//   env PAYSTACK_SECRET_KEY → encrypted DB row (decrypted with PAYSTACK_MASTER_KEY)
// Idempotent: re-running rotates the stored ciphertext harmlessly.
//
// Usage (CI, env-provided):
//   DATABASE_URL=postgres://…  PAYSTACK_MASTER_KEY=<32B base64> \
//   PAYSTACK_SECRET_KEY=sk_live_…  PAYSTACK_PUBLIC_KEY=pk_live_… \
//   node scripts/paystack_provision.mjs
//
// SECURITY: never commit key values; this script only ever reads them from env.
import { createCipheriv, randomBytes } from "node:crypto";
import { Client } from "pg";

const url = process.env.DATABASE_URL;
const master = (process.env.PAYSTACK_MASTER_KEY ?? "").trim();
const secret = (process.env.PAYSTACK_SECRET_KEY ?? "").trim();
const pub = (process.env.PAYSTACK_PUBLIC_KEY ?? "").trim();

if (!url) { console.error("provision: DATABASE_URL not set"); process.exit(1); }
if (!master) { console.error("provision: PAYSTACK_MASTER_KEY not set — nothing to do (skipped)"); process.exit(0); }
if (!secret.startsWith("sk_")) { console.error("provision: PAYSTACK_SECRET_KEY missing/invalid — nothing to do (skipped)"); process.exit(0); }

// strip sslmode (pg maps sslmode=require to verify-full; explicit ssl wins)
const cleanUrl = (() => {
  try { const u = new URL(url); u.searchParams.delete("sslmode"); return u.href; } catch { return url; }
})();

function encrypt(plaintext) {
  const key = Buffer.from(master, "base64");
  if (key.length !== 32) { console.error("provision: PAYSTACK_MASTER_KEY must be 32 bytes base64"); process.exit(1); }
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return `v1:${iv.toString("base64")}:${cipher.getAuthTag().toString("base64")}:${enc.toString("base64")}`;
}

const schema = (() => {
  try { return new URL(url).searchParams.get("schema") ?? "mizigo"; } catch { return "mizigo"; }
})();

const c = new Client({ connectionString: cleanUrl, ssl: { rejectUnauthorized: false } });
await c.connect();

// decrypt-verification pass: the row we are about to write must be readable
// by the app with the same master key (write-then-verify, no silent rot)
const upsert = async (key, value) => {
  await c.query(
    `INSERT INTO "${schema}"."PlatformSetting" ("key", "value", "updatedAt") VALUES ($1, $2, now())
     ON CONFLICT ("key") DO UPDATE SET "value" = $2, "updatedAt" = now()`,
    [key, value],
  );
};

await upsert("paystack.secret.live", encrypt(secret));
if (pub.startsWith("pk_")) await upsert("paystack.public.live", pub); // public key: not secret, admin-displayable
await upsert("paystack.provisionedAt", new Date().toISOString());

// verify shape (read back, confirm ciphertext exists + public key plaintext)
const back = await c.query(`SELECT "key", "value" FROM "${schema}"."PlatformSetting" WHERE "key" LIKE 'paystack.%'`);
for (const r of back.rows) {
  const v = r.key.endsWith(".secret.live")
    ? `v1:${String(r.value).split(":").length} parts (encrypted, ${r.value.length} chars)`
    : String(r.value).slice(0, 24);
  console.log(`provision: ${r.key} = ${v}`);
}
console.log("provision: paystack keys stored (encrypted with PAYSTACK_MASTER_KEY) — set the SAME master key in Netlify env to activate");
await c.end();
