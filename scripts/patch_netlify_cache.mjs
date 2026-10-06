#!/usr/bin/env node
// MIZIGO — Netlify cache-handler patcher.
//
// Replaces @netlify/plugin-nextjs's Blobs-backed incremental cache handler
// (dist/run/handlers/cache.cjs) with scripts/noop-cache-handler.cjs BEFORE the
// plugin's postBuild phase copies it into the serverless function bundle.
//
// Root cause being neutralized: the plugin's cache handler constructor eagerly
// opens a regional Netlify Blobs deploy store. On sites whose function
// environment lacks the injected Blobs context (deployID/siteID/token/…), the
// constructor throws MissingBlobsEnvironmentError and every dynamic route
// returns HTTP 500. MIZIGO uses no ISR / fetch-cache / `use cache`, so a no-op
// cache is functionally identical and removes the platform dependency.
//
// Run automatically as the first step of `npm run build:netlify` (netlify.toml
// build.command). Also patches an already-generated functions-internal bundle
// so `netlify build` re-runs stay correct. Idempotent; fails soft (warn, exit
// 0) if the plugin layout ever changes — in that case an upstream-fixed
// handler would simply ship instead.

import { copyFileSync, existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const noop = join(root, "scripts", "noop-cache-handler.cjs");

const targets = [
  // source of truth the plugin copies from during its postBuild phase
  join(root, "node_modules", "@netlify", "plugin-nextjs", "dist", "run", "handlers", "cache.cjs"),
];

// already-packaged function bundles (re-runs / local `netlify build` output)
const fnRoot = join(root, ".netlify", "functions-internal");
if (existsSync(fnRoot)) {
  for (const fn of readdirSync(fnRoot, { withFileTypes: true })) {
    if (fn.isDirectory()) {
      const p = join(fnRoot, fn.name, ".netlify", "dist", "run", "handlers", "cache.cjs");
      if (existsSync(p)) targets.push(p);
    }
  }
}

// Safety: confirm the original is the Blobs-backed handler before replacing it
// (defends against upstream shipping a fixed/different handler in the future).
const BLOBS_MARKER = "getMemoizedKeyValueStoreBackedByRegionalBlobStore";
let patched = 0;
let skipped = 0;

for (const target of targets) {
  if (!existsSync(target)) continue;
  const body = readFileSync(target, "utf8");
  const isBlobsHandler = body.includes(BLOBS_MARKER);
  const isAlreadyNoop = body.includes("MIZIGO — no-op Next.js incremental cache handler");
  if (isAlreadyNoop) {
    patched++; // keep counting as done (idempotent re-run)
    continue;
  }
  if (!isBlobsHandler) {
    console.warn(
      `⚠ mizigo-cache-patch: ${target} is not the expected Blobs handler — leaving it untouched.`,
    );
    skipped++;
    continue;
  }
  copyFileSync(noop, target);
  patched++;
  console.log(`✓ mizigo-cache-patch: installed no-op cache handler → ${target.replace(root, "")}`);
}

if (patched === 0 && skipped > 0) {
  console.warn("⚠ mizigo-cache-patch: nothing patched (plugin layout changed?) — continuing build.");
} else if (patched === 0) {
  console.warn("⚠ mizigo-cache-patch: no cache handler targets found (dev build?) — continuing.");
}
