#!/usr/bin/env node
// MIZIGO — persistent local server around the REAL Netlify function bundle.
// Serves the exact artifact Netlify deploys (.netlify/functions-internal/
// ___netlify-server-handler) with a Netlify-Functions-v2-style context and
// worst-case environment (no Blobs context, no repo .env), so e2e tests run
// against true production code.
//
//   node scripts/serve_function.mjs [port]   # default 3100
//
// DB state: /tmp/mizigo.db is wiped on boot (cold-start sim) unless
// HARNESS_KEEP_DB=1 is set.

import http from "node:http";
import fs from "node:fs";

const PORT = Number(process.argv[2] || 3100);

process.env.NETLIFY = "true";
process.env.NODE_ENV = "production";
delete process.env.DATABASE_URL;

if (!process.env.HARNESS_KEEP_DB) {
  for (const f of ["/tmp/mizigo.db", "/tmp/mizigo.db-journal"]) {
    try { fs.rmSync(f, { force: true }); } catch {}
  }
}

const entry = new URL(
  "../.netlify/functions-internal/___netlify-server-handler/___netlify-server-handler.mjs",
  import.meta.url,
);
const { default: handler } = await import(entry);
console.log(`▸ mizigo function server: loaded real bundle (cold start, /tmp/mizigo.db wiped unless HARNESS_KEEP_DB=1)`);

const server = http.createServer(async (req, res) => {
  const url = `http://localhost:${PORT}${req.url}`;
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const body = chunks.length ? Buffer.concat(chunks) : undefined;

  const headers = { ...req.headers };
  delete headers["host"];
  delete headers["connection"];
  delete headers["content-length"];

  const request = new Request(url, {
    method: req.method,
    headers,
    body: ["GET", "HEAD"].includes(req.method) ? undefined : body,
    redirect: "manual",
  });

  const context = {
    site: { id: "site-id-1", name: "mizigo" },
    account: { id: "account-id-1" },
    deploy: { id: "deploy-id-1", prime: false },
    user: { email: "", tl: false },
    requestId: `req-${Date.now()}`,
    params: {},
    json: (obj, init = {}) => new Response(JSON.stringify(obj), init),
    log: () => {},
    cookies: { get: () => undefined, set: () => {}, delete: () => {} },
    next: () => new Response(null, { status: 500 }),
    geo: { city: "Nairobi", country: { code: "KE" } },
    ip: "41.90.64.10",
  };

  try {
    const out = await handler(request, context);
    const buf = Buffer.from(await out.arrayBuffer());
    const h = {};
    out.headers.forEach((v, k) => {
      if (k.toLowerCase() === "set-cookie") return;
      h[k] = v;
    });
    if (!("content-length" in h)) h["content-length"] = buf.length;
    const setCookies = out.headers.getSetCookie?.() ?? [];
    if (setCookies.length) h["set-cookie"] = setCookies;
    res.writeHead(out.status, h);
    res.end(buf);
  } catch (e) {
    console.error("‼ handler threw:", e);
    if (!res.headersSent) res.writeHead(500, { "content-type": "text/plain" });
    res.end("Internal Server Error (function crashed)");
  }
});

server.listen(PORT, () => console.log(`▸ listening on http://localhost:${PORT}`));
