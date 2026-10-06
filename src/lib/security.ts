// MIZIGO security toolkit — session cookies (HMAC-signed), OTP verification,
// rate limiting and input validation for API routes.
//
// Sandbox honesty note: the OTP "provider" is a mock — codes are generated
// server-side, stored (hashed comparison not needed for 6-digit demo codes),
// expiry + attempt limited, and *shown in-app* because there is no real SMS
// gateway in the sandbox. Everything else is real: sessions are signed
// HttpOnly cookies, identity is never trusted from the client, and every
// mutating route binds to the session.

import { createHmac, timingSafeEqual } from "crypto";
import { NextResponse } from "next/server";

// ─────────────────────────────────────────────────────────────────────────────
// Session cookies — payload base64url + HMAC-SHA256 signature
// ─────────────────────────────────────────────────────────────────────────────

export type Role = "CUSTOMER" | "DRIVER" | "ADMIN";

export interface Session {
  uid: string; // user id
  role: Role;
  did: string | null; // driver profile id (drivers only)
  exp: number; // epoch ms
}

const SECRET =
  process.env.MIZIGO_SESSION_SECRET ||
  "mizigo-sandbox-session-secret-change-me-in-production";
const COOKIE_NAME = "mizigo_sid";
const SESSION_TTL_MS = 30 * 86400_000; // 30 days

function b64url(input: string): string {
  return Buffer.from(input, "utf8").toString("base64url");
}

function sign(payload: string): string {
  return createHmac("sha256", SECRET).update(payload).digest("base64url");
}

function serializeSession(s: Session): string {
  const payload = b64url(JSON.stringify(s));
  return `${payload}.${sign(payload)}`;
}

function parseSessionToken(token: string | undefined | null): Session | null {
  if (!token) return null;
  const dot = token.lastIndexOf(".");
  if (dot <= 0) return null;
  const payload = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = sign(payload);
  try {
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
    const s = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Session;
    if (!s?.uid || !s.role || typeof s.exp !== "number") return null;
    if (s.exp < Date.now()) return null;
    if (!["CUSTOMER", "DRIVER", "ADMIN"].includes(s.role)) return null;
    return s;
  } catch {
    return null;
  }
}

function readCookie(req: Request, name: string): string | null {
  const header = req.headers.get("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return v.join("=");
  }
  return null;
}

/** Read + verify the session from the request cookie. */
export function getSession(req: Request): Session | null {
  const raw = readCookie(req, COOKIE_NAME);
  if (!raw || revoked.has(raw)) return null;
  return parseSessionToken(raw);
}

// logout denylist (per instance — stateless signed cookies otherwise can't be revoked)
const revoked = new Set<string>();

function isHttps(req: Request): boolean {
  const proto = req.headers.get("x-forwarded-proto");
  if (proto) return proto.split(",")[0].trim() === "https";
  try {
    return new URL(req.url).protocol === "https:";
  } catch {
    return false;
  }
}

/** Issue a session: returns a NextResponse with the cookie set. */
export function withSession<T>(req: Request, session: { uid: string; role: Role; did?: string | null }, body: T, status = 200): NextResponse {
  const s: Session = { uid: session.uid, role: session.role, did: session.did ?? null, exp: Date.now() + SESSION_TTL_MS };
  const res = NextResponse.json(body, { status });
  res.cookies.set(COOKIE_NAME, serializeSession(s), {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: Math.floor(SESSION_TTL_MS / 1000),
    secure: isHttps(req),
  });
  return res;
}

/** Clear the session cookie (logout) — the token is also revoked server-side. */
export function clearSession(req: Request): NextResponse {
  const raw = readCookie(req, COOKIE_NAME);
  if (raw) {
    revoked.add(raw);
    if (revoked.size > 10_000) revoked.clear(); // demo-grade memory cap
  }
  const res = NextResponse.json({ ok: true });
  res.cookies.set(COOKIE_NAME, "", { httpOnly: true, sameSite: "lax", path: "/", maxAge: 0, secure: isHttps(req) });
  return res;
}

// ─────────────────────────────────────────────────────────────────────────────
// Guards — return a NextResponse (error) or null (continue)
// ─────────────────────────────────────────────────────────────────────────────

export type Guard = Session | NextResponse;

/** Require any signed-in session. */
export function requireSession(req: Request): Guard {
  const s = getSession(req);
  if (!s) {
    return NextResponse.json(
      { error: "Please sign in again — your session has expired." },
      { status: 401 }
    );
  }
  return s;
}

/** Require a signed-in session with one of the given roles. */
export function requireRole(req: Request, ...roles: Role[]): Guard {
  const g = requireSession(req);
  if (g instanceof NextResponse) return g;
  if (!roles.includes(g.role)) {
    return NextResponse.json(
      { error: "You don't have permission to do that." },
      { status: 403 }
    );
  }
  return g;
}

export function isResponse(x: unknown): x is NextResponse {
  return x instanceof NextResponse;
}

// ─────────────────────────────────────────────────────────────────────────────
// OTP store — mock SMS provider with real verification semantics
// ─────────────────────────────────────────────────────────────────────────────

interface OtpEntry {
  code: string;
  exp: number;
  attempts: number;
}

const otps = new Map<string, OtpEntry>();
const OTP_TTL_MS = 5 * 60_000;
const OTP_MAX_ATTEMPTS = 5;

/** Generate + store a 6-digit code for a phone (resend regenerates). */
export function issueOtp(phone: string): string {
  const code = String(Math.floor(100000 + Math.random() * 900000));
  otps.set(phone, { code, exp: Date.now() + OTP_TTL_MS, attempts: 0 });
  // opportunistic cleanup
  if (otps.size > 1000) {
    const now = Date.now();
    for (const [k, v] of otps) if (v.exp < now) otps.delete(k);
  }
  return code;
}

/** Verify + consume the code. Returns ok:true or a friendly reason. */
export function verifyOtp(phone: string, code: string): { ok: true } | { ok: false; reason: string } {
  const entry = otps.get(phone);
  if (!entry) return { ok: false, reason: "Request a new code — none is pending for this number." };
  if (entry.exp < Date.now()) {
    otps.delete(phone);
    return { ok: false, reason: "That code expired. Request a new one." };
  }
  if (entry.attempts >= OTP_MAX_ATTEMPTS) {
    otps.delete(phone);
    return { ok: false, reason: "Too many attempts. Request a new code." };
  }
  if (entry.code !== code) {
    entry.attempts += 1;
    return { ok: false, reason: `Wrong code. ${OTP_MAX_ATTEMPTS - entry.attempts} attempts left.` };
  }
  otps.delete(phone); // consume: one code, one login
  return { ok: true };
}

// ─────────────────────────────────────────────────────────────────────────────
// Rate limiting — in-memory sliding window, per instance (sandbox fast path)
// + optional DB-backed fixed window when the database is shared (Postgres
// production mode), so limits hold across serverless instances.
// ─────────────────────────────────────────────────────────────────────────────

const buckets = new Map<string, number[]>();

export function clientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return req.headers.get("x-nf-client-connection-ip") ?? "local";
}

// DB-backed view (PG mode only): key → epoch ms the bucket is blocked until.
// Mirrors the shared counter so the sync fast path can act on it next call.
const dbBlockedUntil = new Map<string, number>();

function isPgRuntime(): boolean {
  return /^postgres(ql)?:\/\//.test(process.env.DATABASE_URL ?? "");
}

let dbOps = 0; // throttles expired-row cleanup

/**
 * Distributed fixed-window counter — ONE round trip (upsert … RETURNING count),
 * always fire-and-forget (never awaited by the request), fail-open on any DB
 * error: the in-memory window keeps protecting the instance regardless.
 */
function dbRateLimitTick(key: string, limit: number, windowStart: number, windowMs: number): void {
  void (async () => {
    try {
      const { db } = await import("./db");
      const id = `${key}:${windowStart}`; // composite "bucket:window" PK
      const expiresAt = new Date(windowStart + windowMs + 60_000); // + sweep grace
      const rows = await db.$queryRaw<Array<{ count: number }>>`
        INSERT INTO "RateLimit" ("id", "count", "expiresAt")
        VALUES (${id}, 1, ${expiresAt})
        ON CONFLICT ("id") DO UPDATE SET "count" = "RateLimit"."count" + 1
        RETURNING "count"`;
      const count = Number(rows[0]?.count ?? 0);
      if (count >= limit) dbBlockedUntil.set(key, windowStart + windowMs);
      else dbBlockedUntil.delete(key);
      // opportunistic expired-row sweep (every 256th op)
      if (++dbOps % 256 === 0) {
        await db.rateLimit.deleteMany({ where: { expiresAt: { lt: new Date() } } }).catch(() => null);
      }
    } catch {
      // fail-open: memory window still enforces the per-instance limit
    }
  })();
}

/**
 * Sliding-window rate limit. Returns a 429 NextResponse when exceeded, else null.
 * Sandbox: pure in-memory (zero latency). Postgres mode: memory check first,
 * then a fire-and-forget shared-counter upsert merges the cross-instance view.
 * @example if (rateLimit(req, "auth:otp", 8, 60_000)) return it;
 */
export function rateLimit(req: Request, name: string, limit: number, windowMs: number): NextResponse | null {
  const key = `${name}:${clientIp(req)}`;
  const now = Date.now();
  const hits = (buckets.get(key) ?? []).filter((t) => now - t < windowMs);
  const blockedUntil = dbBlockedUntil.get(key) ?? 0;
  const sharedBlocked = blockedUntil > now;
  if (hits.length >= limit || sharedBlocked) {
    buckets.set(key, hits);
    return NextResponse.json(
      { error: "Too many requests — give it a moment and try again." },
      { status: 429 }
    );
  }
  hits.push(now);
  buckets.set(key, hits);
  // shared-database mode: merge the cross-instance counter (never blocks this call)
  if (isPgRuntime()) {
    const windowStart = Math.floor(now / windowMs) * windowMs;
    dbRateLimitTick(key, limit, windowStart, windowMs);
  }
  // opportunistic cleanup of cold keys
  if (buckets.size > 5000) {
    for (const [k, v] of buckets) if (!v.some((t) => now - t < windowMs)) buckets.delete(k);
  }
  if (dbBlockedUntil.size > 5000) {
    for (const [k, until] of dbBlockedUntil) if (until <= now) dbBlockedUntil.delete(k);
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Input validation helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Nairobi-ish service bounds — finite + roughly sane coordinates. */
const LAT_MIN = -2.5, LAT_MAX = 0.5, LNG_MIN = 35.0, LNG_MAX = 38.5;

export function validCoord(lat: unknown, lng: unknown): { lat: number; lng: number } | null {
  const la = Number(lat);
  const ln = Number(lng);
  if (!Number.isFinite(la) || !Number.isFinite(ln)) return null;
  if (la < LAT_MIN || la > LAT_MAX || ln < LNG_MIN || ln > LNG_MAX) return null;
  return { lat: la, lng: ln };
}

/** Clamp an integer into [min, max] with a default for NaN/garbage. */
export function clampInt(v: unknown, min: number, max: number, dflt: number): number {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return dflt;
  return Math.max(min, Math.min(max, n));
}

/** Cap a string's length (and force string type). */
export function capStr(v: unknown, max: number): string {
  return String(v ?? "").slice(0, max);
}

/** Sanitize booking items: ≤20 items, qty 1..99, weight 0..20000, name ≤60. */
export function sanitizeItems(items: unknown): { name: string; qty: number; weightKg: number }[] {
  if (!Array.isArray(items)) return [];
  return items.slice(0, 20).map((i) => {
    const it = (i ?? {}) as { name?: unknown; qty?: unknown; weightKg?: unknown };
    return {
      name: capStr(it.name, 60) || "Item",
      qty: clampInt(it.qty, 1, 99, 1),
      weightKg: Math.max(0, Math.min(20000, Math.round(Number(it.weightKg) || 0))),
    };
  });
}

/** Sanitize stops: ≤5, each with finite coords + capped name. */
export function sanitizeStops(stops: unknown): { name: string; area?: string; lat: number; lng: number }[] {
  if (!Array.isArray(stops)) return [];
  const out: { name: string; area?: string; lat: number; lng: number }[] = [];
  for (const raw of stops.slice(0, 5)) {
    const st = (raw ?? {}) as { name?: unknown; area?: unknown; lat?: unknown; lng?: unknown };
    const c = validCoord(st.lat, st.lng);
    if (!c) continue;
    out.push({ name: capStr(st.name, 80) || "Stop", area: capStr(st.area, 60), lat: c.lat, lng: c.lng });
  }
  return out;
}
