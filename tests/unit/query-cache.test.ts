// query-cache unit tests — TTL expiry, LRU-ish eviction, prefix invalidation
// (task 10-E). Uses the injectable clock for deterministic time travel.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  cacheGet, cacheSet, invalidate, invalidatePrefix, cacheSize, cacheClear,
  __setClock, __resetClock,
} from "../../src/lib/query-cache";

describe("query-cache", () => {
  let t = 0;
  beforeEach(() => {
    t = 0;
    cacheClear();
    __setClock(() => t);
  });
  afterEach(() => {
    __resetClock();
    cacheClear();
  });

  it("stores and returns a value within the TTL", () => {
    cacheSet("k", { a: 1 }, 100);
    t = 99;
    expect(cacheGet<{ a: number }>("k")).toEqual({ a: 1 });
  });

  it("misses after the TTL expires (boundary: expiry is exclusive)", () => {
    cacheSet("k", "v", 100);
    t = 100; // expiresAt <= now → expired
    expect(cacheGet("k")).toBeUndefined();
    expect(cacheSize()).toBe(0); // expired entry is dropped
  });

  it("ttl <= 0 never stores", () => {
    cacheSet("k", "v", 0);
    expect(cacheGet("k")).toBeUndefined();
  });

  it("overwrites the same key (no duplicate entries)", () => {
    cacheSet("k", 1, 100);
    cacheSet("k", 2, 100);
    expect(cacheSize()).toBe(1);
    expect(cacheGet("k")).toBe(2);
  });

  it("invalidate() drops exactly one key", () => {
    cacheSet("a", 1, 100);
    cacheSet("b", 2, 100);
    invalidate("a");
    expect(cacheGet("a")).toBeUndefined();
    expect(cacheGet("b")).toBe(2);
  });

  it("invalidatePrefix() drops the whole family, leaves others", () => {
    cacheSet("admin:overview", 1, 100);
    cacheSet("admin:analytics", 2, 100);
    cacheSet("admin:shipments:ALL:", 3, 100);
    cacheSet("shipments:u1:CUSTOMER:ALL:50:0", 4, 100);
    cacheSet("other", 5, 100);
    invalidatePrefix("admin");
    expect(cacheGet("admin:overview")).toBeUndefined();
    expect(cacheGet("admin:analytics")).toBeUndefined();
    expect(cacheGet("admin:shipments:ALL:")).toBeUndefined();
    expect(cacheGet("shipments:u1:CUSTOMER:ALL:50:0")).toBe(4);
    expect(cacheGet("other")).toBe(5);
  });

  it("evicts the least-recently-used entry beyond 500 (touched keys survive)", () => {
    for (let i = 0; i < 500; i++) cacheSet(`k${i}`, i, 10_000);
    expect(cacheSize()).toBe(500);
    // touch the oldest so it becomes recently used
    expect(cacheGet("k0")).toBe(0);
    // one more entry → eviction of the now-oldest (k1), not k0
    cacheSet("k500", 500, 10_000);
    expect(cacheSize()).toBe(500);
    expect(cacheGet("k0")).toBe(0); // survived: was touched
    expect(cacheGet("k1")).toBeUndefined(); // evicted: oldest without recency
    expect(cacheGet("k500")).toBe(500);
  });

  it("a get refreshes recency (LRU, not FIFO)", () => {
    cacheSet("a", 1, 10_000);
    cacheSet("b", 2, 10_000);
    cacheGet("a"); // a is now most-recent
    // fill to the cap; "b" (least recent) should be evicted first
    for (let i = 0; i < 499; i++) cacheSet(`f${i}`, i, 10_000);
    expect(cacheSize()).toBe(500);
    expect(cacheGet("b")).toBeUndefined();
    expect(cacheGet("a")).toBe(1);
  });
});
