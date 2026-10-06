// MIZIGO — tiny in-process TTL cache for GET payloads (per serverless instance).
// Serverless-friendly: bounded memory (MAX_ENTRIES), monotonic clock (immune to
// wall-clock jumps), LRU-ish eviction (Map recency ordering, evict oldest),
// prefix invalidation for cache families ("admin", "shipments").
//
// Rules of use (perf task 10-E):
//   • cache ONLY successful GET responses — never per-user mutations
//   • always invalidate on the mutating path that changes the data
//   • keep TTLs short: this smooths poll bursts, it is not a CDN

export interface CacheEntry {
  value: unknown;
  expiresAt: number; // monotonic clock ms
}

const MAX_ENTRIES = 500;

// ── monotonic clock ─────────────────────────────────────────────────────────
// Real-time based but never goes backwards (immune to NTP jumps), strictly
// increasing across calls. Tests can swap in a fake via __setClock.
let lastTick = 0;
const realClock = (): number => {
  const t = Date.now();
  if (t > lastTick) lastTick = t;
  else lastTick += 1; // same-ms or clock-went-backwards → nudge forward
  return lastTick;
};

let clock: () => number = realClock;

/** Test hook: inject a controllable clock (restored with __resetClock). */
export function __setClock(fn: () => number): void {
  clock = fn;
}
/** Test hook: restore the real monotonic clock. */
export function __resetClock(): void {
  clock = realClock;
}

const store = new Map<string, CacheEntry>(); // Map preserves insertion (≈recency) order

/** Get a cached value, or undefined on miss/expiry. Refreshes recency. */
export function cacheGet<T = unknown>(key: string): T | undefined {
  const t = clock();
  const hit = store.get(key);
  if (!hit) return undefined;
  if (hit.expiresAt <= t) {
    store.delete(key);
    return undefined;
  }
  // LRU refresh: re-insert so recently used keys sort last
  store.delete(key);
  store.set(key, hit);
  return hit.value as T;
}

/** Store a value with a TTL (ms). Evicts the least-recently-used entry over cap. */
export function cacheSet(key: string, value: unknown, ttlMs: number): void {
  const t = clock();
  if (ttlMs <= 0) return;
  store.delete(key);
  store.set(key, { value, expiresAt: t + ttlMs });
  while (store.size > MAX_ENTRIES) {
    const oldest = store.keys().next().value; // insertion order ≈ least-recently-used
    if (oldest === undefined) break;
    store.delete(oldest);
  }
}

/** Drop one exact key. */
export function invalidate(key: string): void {
  clock();
  store.delete(key);
}

/** Drop every key that starts with the prefix (e.g. "admin", "shipments"). */
export function invalidatePrefix(prefix: string): void {
  clock();
  for (const key of store.keys()) {
    if (key.startsWith(prefix)) store.delete(key);
  }
}

/** Number of live entries (test/debug only). */
export function cacheSize(): number {
  return store.size;
}

/** Clear everything (test/debug only). */
export function cacheClear(): void {
  store.clear();
}
