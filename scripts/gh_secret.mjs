#!/usr/bin/env node
// Set a GitHub Actions repo secret via the REST API (sealed-box encryption).
// Usage: node scripts/gh_secret.mjs OWNER REPO SECRET_NAME SECRET_VALUE
import sodium from "libsodium-wrappers";
import { execSync } from "node:child_process";

const [owner, repo, name, value] = process.argv.slice(2);
if (!owner || !repo || !name || !value) {
  console.error("usage: node gh_secret.mjs OWNER REPO SECRET_NAME SECRET_VALUE");
  process.exit(1);
}

const token = process.env.GH_TOKEN;
if (!token) { console.error("GH_TOKEN not set"); process.exit(1); }

const headers = {
  "Authorization": `token ${token}`,
  "Accept": "application/vnd.github+json",
  "Content-Type": "application/json",
};

// 1. fetch the repo's public key
const pkRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/actions/secrets/public-key`, { headers });
if (!pkRes.ok) { console.error("public-key failed:", pkRes.status, await pkRes.text()); process.exit(1); }
const pk = await pkRes.json();

// 2. seal the secret with libsodium crypto_box_seal
await sodium.ready;
const binKey = sodium.from_base64(pk.key, sodium.base64_variants.ORIGINAL);
const binSecret = sodium.from_string(value);
const encrypted = sodium.crypto_box_seal(binSecret, binKey);
const b64 = sodium.to_base64(encrypted, sodium.base64_variants.ORIGINAL);

// 3. PUT the secret
const putRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/actions/secrets/${name}`, {
  method: "PUT",
  headers,
  body: JSON.stringify({ encrypted_value: b64, key_id: pk.key_id }),
});
if (!putRes.ok && putRes.status !== 201) { console.error("put failed:", putRes.status, await putRes.text()); process.exit(1); }
console.log(`secret ${name} set on ${owner}/${repo} (${putRes.status === 201 ? "created" : "updated"})`);
