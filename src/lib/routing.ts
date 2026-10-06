// MIZIGO — keyless routing layer (server-side).
// Primary: public OSRM demo server (real Nairobi road geometry + turn-by-turn
// steps, no API key). Fallback: the internal geo.ts polyline model so the map
// never goes blank. Adds an EAT hour-of-day "typical traffic" congestion model
// on top of OSRM's free-flow duration — clearly labelled typical, not live.
//
// Clients never call OSRM directly; they go through GET /api/routing.

import { MAP_BOUNDS, buildRoute, routeLengthKm, routeDurationMin, type LatLng } from "./geo";

export interface RouteStep {
  instruction: string; // human line, e.g. "Turn right onto Uhuru Highway"
  name: string; // road name at the maneuver ("" when unnamed)
  distanceM: number; // length of the step
}

export interface RouteResult {
  polyline: [number, number][]; // [lat, lng] pairs, app convention (geo.ts LatLng)
  distanceKm: number;
  durationMin: number; // free-flow-ish driving time
  trafficMin: number; // duration adjusted by the typical-traffic model
  steps?: RouteStep[];
  source: "osrm" | "internal";
}

// ── guards ───────────────────────────────────────────────────────────────────

/** Nairobi service bounds (small epsilon so edge places like Mlolongo pass). */
const EPS = 0.015;
export function isValidLatLng(p: unknown): p is LatLng {
  return (
    typeof p === "object" && p !== null &&
    typeof (p as LatLng).lat === "number" && typeof (p as LatLng).lng === "number" &&
    Number.isFinite((p as LatLng).lat) && Number.isFinite((p as LatLng).lng)
  );
}

export function inServiceArea(p: LatLng): boolean {
  return (
    p.lat >= MAP_BOUNDS.minLat - EPS && p.lat <= MAP_BOUNDS.maxLat + EPS &&
    p.lng >= MAP_BOUNDS.minLng - EPS && p.lng <= MAP_BOUNDS.maxLng + EPS
  );
}

export const MAX_WAYPOINTS = 2;

// ── typical-traffic model (EAT hour-of-day) ─────────────────────────────────
// Honest copy everywhere: "incl. typical traffic" — this is a model, not live
// congestion. Peak Nairobi jams 07–10 & 16–20, lighter midday, clear nights.
// The internal fallback already bakes congestion into its 24 km/h average, so
// the factor is applied to OSRM durations only.

export function trafficFactor(date: Date = new Date()): number {
  const h = (date.getTime() / 3_600_000 + 3) % 24; // UTC → EAT (UTC+3) hour
  if ((h >= 7 && h < 10) || (h >= 16 && h < 20)) return 1.35; // morning + evening peak
  if (h >= 10 && h < 16) return 1.1; // midday
  if (h >= 22 || h < 5) return 0.9; // night
  return 1.0; // early morning / late evening
}

// ── OSRM client ──────────────────────────────────────────────────────────────

const OSRM_BASE = "http://router.project-osrm.org/route/v1/driving";
const OSRM_TIMEOUT_MS = 2_500;

interface OsrmResponse {
  code: string;
  routes?: {
    distance: number; // meters
    duration: number; // seconds
    geometry: { coordinates: [number, number][] }; // GeoJSON [lng, lat]
    legs?: {
      steps?: {
        name: string;
        distance: number;
        maneuver: { type: string; modifier?: string; exit?: number };
      }[];
    }[];
  }[];
}

const MANEUVER_VERB: Record<string, string> = {
  depart: "Head out",
  arrive: "Arrive",
  turn: "Turn",
  "new name": "Continue onto",
  continue: "Continue",
  merge: "Merge",
  "on ramp": "Take the ramp",
  "off ramp": "Take the exit",
  fork: "Keep",
  "end of road": "At the end of the road, turn",
  roundabout: "At the roundabout, take the exit",
  rotary: "At the roundabout, take the exit",
  "roundabout turn": "At the roundabout, turn",
  "exit roundabout": "Exit the roundabout",
  "exit rotary": "Exit the roundabout",
  notification: "Continue",
};

/** Compact, driver-readable instruction from an OSRM maneuver. */
function stepInstruction(m: { type: string; modifier?: string; exit?: number }, name: string): string {
  if (m.type === "depart") return name ? `Start on ${name}` : "Head out";
  if (m.type === "arrive") return name ? `Arrive at ${name}` : "Arrive at your destination";
  const verb = MANEUVER_VERB[m.type] ?? "Continue";
  if ((m.type === "roundabout" || m.type === "rotary") && m.exit) {
    return `${verb} ${m.exit}${name ? ` onto ${name}` : ""}`;
  }
  const dir =
    m.modifier === "uturn" ? "U-turn" :
    m.modifier && m.modifier !== "straight" ? m.modifier : "";
  const onto = name ? ` onto ${name}` : "";
  return `${verb}${dir ? ` ${dir}` : ""}${onto}`.replace(/\s+/g, " ").trim();
}

// ── in-memory TTL cache (shared per server instance) ────────────────────────

const CACHE_TTL_MS = 15 * 60_000;
const CACHE_MAX = 200; // hard cap
const cache = new Map<string, { at: number; result: RouteResult }>();

function cacheKey(from: LatLng, to: LatLng, via: LatLng[]): string {
  const r = (n: number) => n.toFixed(4); // ~11 m rounding — stable keys for moving origins
  return [from, ...via, to].map((p) => `${r(p.lat)},${r(p.lng)}`).join(">");
}

function cacheGet(key: string): RouteResult | null {
  const hit = cache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > CACHE_TTL_MS) {
    cache.delete(key);
    return null;
  }
  return hit.result;
}

function cacheSet(key: string, result: RouteResult): void {
  if (cache.has(key)) cache.delete(key); // refresh insertion order for LRU-ish eviction
  cache.set(key, { at: Date.now(), result });
  while (cache.size > CACHE_MAX) {
    const oldest = cache.keys().next().value as string | undefined;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

// ── internal fallback ────────────────────────────────────────────────────────

function internalRoute(from: LatLng, to: LatLng): RouteResult {
  const pts = buildRoute(from, to);
  const distanceKm = Math.max(0.3, routeLengthKm(pts));
  const durationMin = routeDurationMin(distanceKm);
  return {
    polyline: pts.map((p) => [p.lat, p.lng] as [number, number]),
    distanceKm: Math.round(distanceKm * 10) / 10,
    durationMin,
    // the internal 24 km/h city average already bakes congestion in — no extra factor
    trafficMin: durationMin,
    source: "internal",
  };
}

// ── OSRM transport ───────────────────────────────────────────────────────────
// Two-tier transport for hostile environments:
//  1. standard fetch + User-Agent (OSRM's nginx 403s UA-less requests);
//  2. node:http with family:4 — some sandboxes break undici's happy-eyeballs
//     connect pattern while plain IPv4 sockets flow fine.
// Both tiers honour the same timeout; any miss degrades to the internal model.

const OSRM_UA = "mizigo-demo/2.0 (cargo tracking demo)";

async function osrmRequest(url: string, timeoutMs: number): Promise<string | null> {
  // tier 1 — fetch (serverless/production path)
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { "User-Agent": OSRM_UA },
      cache: "no-store",
    });
    clearTimeout(timer);
    if (res.ok) return await res.text();
    console.warn(`[routing] OSRM HTTP ${res.status} — trying node:http, then internal model`);
  } catch {
    // fall through to the node:http tier
  }
  return osrmRequestNode(url, timeoutMs);
}

async function osrmRequestNode(url: string, timeoutMs: number): Promise<string | null> {
  try {
    const http = await import("node:http");
    const u = new URL(url);
    return await new Promise<string | null>((resolve) => {
      const req = http.default.get(
        {
          hostname: u.hostname,
          port: 80,
          path: `${u.pathname}${u.search}`,
          family: 4,
          headers: { "User-Agent": OSRM_UA, Accept: "*/*" },
          timeout: timeoutMs,
        },
        (res) => {
          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
            let body = "";
            res.setEncoding("utf8");
            res.on("data", (c: string) => { body += c; });
            res.on("end", () => resolve(body));
            res.on("error", () => resolve(null));
          } else {
            res.resume();
            resolve(null);
          }
        }
      );
      req.on("timeout", () => { req.destroy(); resolve(null); });
      req.on("error", () => resolve(null));
    });
  } catch {
    return null;
  }
}

// ── public API ───────────────────────────────────────────────────────────────

export interface RouteOptions {
  /** Up to MAX_WAYPOINTS intermediate stops (checked, not silently dropped). */
  via?: LatLng[];
  // Turn-by-turn steps are always parsed and cached alongside the geometry so
  // a map-only request can never poison the cache for a steps request; the
  // API route decides whether to include them in its response.
}

/**
 * Route between two points (optionally via up to 2 waypoints).
 * Throws only on invalid input; OSRM/network failures degrade to the internal
 * model (source: "internal") so callers always get a usable route.
 */
export async function fetchRoute(from: LatLng, to: LatLng, opts: RouteOptions = {}): Promise<RouteResult> {
  if (!isValidLatLng(from) || !isValidLatLng(to)) throw new Error("Invalid coordinates.");
  const via = opts.via ?? [];
  if (via.length > MAX_WAYPOINTS) throw new Error(`At most ${MAX_WAYPOINTS} waypoints.`);
  if (![from, to, ...via].every(inServiceArea)) throw new Error("Outside the Nairobi service area.");

  const key = cacheKey(from, to, via);
  const cached = cacheGet(key);
  if (cached) return cached;

  const coords = [from, ...via, to]
    .map((p) => `${p.lng.toFixed(6)},${p.lat.toFixed(6)}`)
    .join(";");
  const url = `${OSRM_BASE}/${coords}?overview=full&geometries=geojson&steps=true`;

  let result: RouteResult | null = null;
  try {
    const body = await osrmRequest(url, OSRM_TIMEOUT_MS);
    if (body) {
      const data = JSON.parse(body) as OsrmResponse;
      const route = data.routes?.[0];
      if (data.code === "Ok" && route && route.distance > 0) {
        const durationMin = Math.max(1, Math.round(route.duration / 60));
        const out: RouteResult = {
          // GeoJSON is [lng, lat] — flip to the app's [lat, lng] convention
          polyline: route.geometry.coordinates.map(([lng, lat]) => [lat, lng] as [number, number]),
          distanceKm: Math.round((route.distance / 1000) * 10) / 10,
          durationMin,
          trafficMin: Math.max(1, Math.round(durationMin * trafficFactor())),
          source: "osrm",
          steps: (route.legs ?? []).flatMap((leg) =>
            (leg.steps ?? []).map((st) => ({
              instruction: stepInstruction(st.maneuver, st.name),
              name: st.name || "",
              distanceM: Math.round(st.distance),
            }))
          ),
        };
        result = out;
      }
    }
  } catch {
    // parse error → internal model below
  }

  if (!result) result = internalRoute(from, to);
  cacheSet(key, result);
  return result;
}
