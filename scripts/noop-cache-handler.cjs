"use strict";
// MIZIGO — no-op Next.js incremental cache handler for Netlify.
//
// WHY THIS FILE EXISTS
// ─────────────────────
// @netlify/plugin-nextjs (5.16.x) unconditionally wires its Blobs-backed
// cache handler into every request (run/config.js → config.cacheHandler).
// The handler's constructor eagerly opens a *regional* Netlify Blobs deploy
// store, which requires platform-injected environment data
// (NETLIFY_BLOBS_CONTEXT → deployID / siteID / token / primaryRegion …).
// On site/regions where that context is absent or legacy, the constructor
// throws MissingBlobsEnvironmentError and **every** dynamic route returns
// HTTP 500 — the whole API goes down (verified live + reproduced locally
// against the real function bundle).
//
// MIZIGO does not use any of the features this cache provides: every API
// route is `export const dynamic = "force-dynamic"`, the single page is
// prerendered and served from the CDN, and no route uses ISR, `use cache`,
// or fetch-level caching. A no-op cache (permanent miss) is therefore
// functionally identical and immune to Blobs environment problems.
//
// Contract mirrored from the original handler
// (dist/run/handlers/cache.cjs @ plugin 5.16.1):
//   get(key, ctx)            → null on miss  (we always miss)
//   set(key, data, ctx)      → no-op
//   revalidateTag(...)       → no-op (nothing is cached, nothing to purge)
//   resetRequestCache()      → no-op (also empty in the original)
//   getPrerenderManifest(dir)→ real filesystem read (kept: not Blobs-backed)
//   injectEntryToPrerenderManifest → no-op (ISR-only feature)

const { join } = require("node:path");

let memoizedPrerenderManifest;

class NoopCacheHandler {
  constructor(options) {
    this.options = options ?? {};
    // Next.js mutates this map to track revalidated tags; keep the reference.
    this.revalidatedTags = this.options.revalidatedTags ?? {};
  }

  /** Permanent cache miss — Next.js falls through to rendering. */
  async get() {
    return null;
  }

  /** Never persist cache entries. */
  async set() {
    return undefined;
  }

  /** Nothing is ever cached, so there is nothing to revalidate or purge. */
  async revalidateTag() {
    return undefined;
  }

  resetRequestCache() {}

  async injectEntryToPrerenderManifest() {
    return undefined;
  }

  /** Read prerender-manifest.json from disk (filesystem only — no Blobs). */
  async getPrerenderManifest(serverDistDir) {
    if (memoizedPrerenderManifest) {
      return memoizedPrerenderManifest;
    }
    const prerenderManifestPath = join(serverDistDir, "..", "prerender-manifest.json");
    try {
      const { loadManifest } = await import("next/dist/server/load-manifest.external.js");
      memoizedPrerenderManifest = loadManifest(prerenderManifestPath);
    } catch {
      const { loadManifest } = await import("next/dist/server/load-manifest.js");
      memoizedPrerenderManifest = loadManifest(prerenderManifestPath);
    }
    return memoizedPrerenderManifest;
  }
}

// Export shapes for every require/import style Next.js may use.
module.exports = NoopCacheHandler;
module.exports.default = NoopCacheHandler;
module.exports.NetlifyCacheHandler = NoopCacheHandler;
