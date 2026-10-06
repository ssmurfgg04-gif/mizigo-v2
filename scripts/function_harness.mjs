// MIZIGO — local Netlify function harness.
// Emulates a real Netlify Functions v2 invocation of the built Next.js server
// handler (the exact artifact Netlify deploys), so production-only crashes can
// be reproduced and stack-traced locally.
//
// Usage:
//   node scripts/function_harness.mjs GET "http://localhost/api/bootstrap"
//   node scripts/function_harness.mjs POST "http://localhost/api/auth" '{"action":"otp","phone":"0712345678"}'
//
// Env:
//   HARNESS_KEEP_DB=1  → do not wipe /tmp/mizigo.db first (warm-instance sim)

process.env.NETLIFY = "true";
process.env.NODE_ENV = "production";
// Emulate the worst-case sandbox runtime: force /tmp SQLite (the plugin copies
// the repo .env into the bundle and the runtime loads it, so deleting the
// variable is not enough locally). A hosted Postgres URL is kept to test the
// production path.
if (/^postgres(ql)?:\/\//.test(process.env.DATABASE_URL ?? "")) {
  // production Postgres test path — keep it
} else {
  process.env.DATABASE_URL = "file:/tmp/mizigo.db";
}

if (!process.env.HARNESS_KEEP_DB) {
  const fs = await import("node:fs");
  for (const f of ["/tmp/mizigo.db", "/tmp/mizigo.db-journal"]) {
    try { fs.rmSync(f, { force: true }); } catch {}
  }
}

const entry = new URL(
  "../.netlify/functions-internal/___netlify-server-handler/___netlify-server-handler.mjs",
  import.meta.url,
);
const mod = await import(entry);
const handler = mod.default;

const method = (process.argv[2] || "GET").toUpperCase();
const url = process.argv[3] || "http://localhost/api/bootstrap";
const body = process.argv[4];

const context = {
  site: { id: "site-id-1", name: "mizigo" },
  account: { id: "account-id-1" },
  deploy: { id: "deploy-id-1", prime: false },
  user: { email: "", tl: false },
  request_id: undefined,
  requestId: "req-1",
  params: {},
  json: (obj, init = {}) => new Response(JSON.stringify(obj), {
    ...init,
    headers: { "content-type": "application/json", ...(init.headers || {}) },
  }),
  log: () => {},
  cookies: { get: () => undefined, set: () => {}, delete: () => {} },
  next: () => new Response(null, { status: 500 }),
  geo: { city: "Nairobi", country: { code: "KE" } },
  ip: "41.90.64.10",
  rawStackTrace: (err) => err,
};

const req = new Request(url, {
  method,
  body: body ?? undefined,
  headers: { "content-type": "application/json", accept: "application/json" },
});

const t0 = Date.now();
try {
  const res = await handler(req, context);
  const text = await res.text();
  console.log(`→ ${method} ${new URL(url).pathname} [${Date.now() - t0}ms]`);
  console.log(`STATUS: ${res.status}`);
  console.log(`SET-COOKIE: ${res.headers.getSetCookie?.().join(" | ") ?? "none"}`);
  console.log(`BODY: ${text.slice(0, 2500)}`);
} catch (e) {
  console.error(`→ ${method} ${new URL(url).pathname} — HANDLER THREW [${Date.now() - t0}ms]`);
  console.error(e);
  process.exit(1);
}
