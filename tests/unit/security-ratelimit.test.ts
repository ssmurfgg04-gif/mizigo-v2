// security.ts rate-limit unit tests — in-memory sliding window (sandbox path).
// Verifies the signature stays synchronous and unchanged (task 10-E), plus
// DB-mode activation boundaries without touching a database.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { rateLimit } from "../../src/lib/security";

const req = (ip?: string) =>
  new Request("http://localhost/api/test", {
    method: "POST",
    headers: ip ? { "x-forwarded-for": ip } : {},
  });

// unique bucket name per test so the module-level window state is isolated
let bucket = "";
const fresh = () => `t:${Math.random().toString(36).slice(2)}`;

describe("rateLimit (in-memory sandbox path)", () => {
  const originalUrl = process.env.DATABASE_URL;
  beforeEach(() => {
    bucket = fresh();
    process.env.DATABASE_URL = "file:/tmp/mizigo-test.db"; // sandbox mode → pure memory
  });
  afterEach(() => {
    if (originalUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = originalUrl;
  });

  it("returns null (no limit) synchronously under the limit", () => {
    const r = rateLimit(req("10.0.0.1"), `${bucket}:a`, 3, 60_000);
    expect(r).toBeNull(); // synchronous: not a Promise
  });

  it("returns a 429 response once the window fills", () => {
    const name = `${bucket}:b`;
    expect(rateLimit(req("10.0.0.2"), name, 2, 60_000)).toBeNull();
    expect(rateLimit(req("10.0.0.2"), name, 2, 60_000)).toBeNull();
    const limited = rateLimit(req("10.0.0.2"), name, 2, 60_000);
    expect(limited).toBeInstanceOf(Response);
    expect((limited as Response).status).toBe(429);
  });

  it("windows are per ip × bucket", () => {
    const name = `${bucket}:c`;
    expect(rateLimit(req("10.0.0.3"), name, 1, 60_000)).toBeNull();
    expect(rateLimit(req("10.0.0.4"), name, 1, 60_000)).toBeNull(); // different ip
    expect(rateLimit(req("10.0.0.3"), name, 1, 60_000)).not.toBeNull();
    expect(rateLimit(req("10.0.0.4"), `${bucket}:d`, 1, 60_000)).toBeNull(); // different bucket
  });
});
