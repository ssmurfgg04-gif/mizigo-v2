"use client";
// LiveMap — real-tile interactive map (MapLibre GL + CARTO Positron raster
// tiles, keyless). Wraps the hand-drawn MapCanvas as an automatic fallback when
// WebGL is unavailable, so every consumer degrades gracefully.
//
// Next.js detail: maplibre-gl only loads inside this component's chunk, and the
// chunk is only ever pulled client-side — consumers mount LiveMap via
// next/dynamic (ssr:false) or from an already-client-only tree, plus an
// explicit typeof-window guard here. The maplibre web worker is served
// deterministically from /maplibre-gl-worker.mjs (public/) via setWorkerUrl so
// bundler import.meta.url quirks can't break tile parsing.

import { useCallback, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { LocateFixed, Loader2 } from "lucide-react";
import { C } from "@/lib/palette";
import { VehicleTopIcon } from "./VehicleAvatar";
import MapCanvas from "./MapCanvas";

import {
  Map as MlMapCtor,
  Marker as MlMarkerCtor,
  LngLatBounds,
  setWorkerUrl,
} from "maplibre-gl";
import type { Map as MlMap, Marker as MlMarker, MarkerOptions, GeoJSONSource } from "maplibre-gl";
import type { StyleSpecification } from "@maplibre/maplibre-gl-style-spec";
import "maplibre-gl/dist/maplibre-gl.css";

// ── types ────────────────────────────────────────────────────────────────────

export interface LiveMapMarker {
  id: string;
  kind: "pickup" | "dropoff" | "stop" | "driver";
  lat: number;
  lng: number;
  heading?: number; // degrees clockwise from north (driver)
  label?: string; // pickup/dropoff caption
  sub?: string; // stop number, e.g. "1"
  categoryKey?: string; // driver vehicle category → VehicleTopIcon
}

/** Route geometry: [lat, lng] pairs (routing.ts) or {lat,lng} objects (geo.ts). */
export type RouteGeometry = [number, number][] | { lat: number; lng: number }[];

interface LiveMapProps {
  center?: { lat: number; lng: number };
  zoom?: number;
  markers?: LiveMapMarker[];
  route?: RouteGeometry;
  /** Camera keeps the driver marker centered (until the user pans). */
  follow?: boolean;
  onMapClick?: (p: { lat: number; lng: number }) => void;
  /** Compact mode: no floating controls (embeds/mini previews). */
  compact?: boolean;
  /** Static, gesture-free map (previews). Default: interactive. */
  interactive?: boolean;
  className?: string;
  /** WebGL-unavailable replacement. Defaults to a MapCanvas render of the same data. */
  fallback?: React.ReactNode;
  fitPad?: number;
}

// ── basemap + route style ────────────────────────────────────────────────────

const CARTO_STYLE: StyleSpecification = {
  version: 8,
  sources: {
    carto: {
      type: "raster",
      tiles: ["https://basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png"],
      tileSize: 256,
      maxzoom: 19,
      attribution: "© OpenStreetMap contributors © CARTO",
    },
  },
  layers: [
    { id: "carto-tiles", type: "raster", source: "carto", paint: { "raster-fade-duration": 200 } },
  ],
};

const EMPTY_FC: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };

function routeToFeature(route: RouteGeometry | undefined): GeoJSON.FeatureCollection {
  if (!route || route.length < 2) return EMPTY_FC;
  return {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        properties: {},
        geometry: {
          type: "LineString",
          // GeoJSON is [lng, lat]; inputs are [lat, lng] pairs or {lat,lng}
          coordinates: route.map((p) =>
            Array.isArray(p) ? [p[1], p[0]] : [p.lng, p.lat]
          ) as [number, number][],
        },
      },
    ],
  };
}

// ── pin elements (plain DOM — markers live outside React's tree) ────────────

const DROPOFF_PATH =
  "M15 3 C8.8 3 4.5 7.6 4.5 13.2 C4.5 20.4 15 33 15 33 C15 33 25.5 20.4 25.5 13.2 C25.5 7.6 21.2 3 15 3 Z";

function labelPill(text: string): string {
  return `<span style="position:absolute;left:50%;transform:translateX(-50%);top:100%;margin-top:2px;white-space:nowrap;
    font:700 11px/1.2 Manrope,system-ui,sans-serif;color:${C.ink};background:rgba(255,255,255,0.92);
    padding:2px 7px;border-radius:99px;border:1px solid ${C.line};box-shadow:0 1px 4px rgba(23,24,28,0.10)">${text}</span>`;
}

function makePinElement(m: LiveMapMarker): HTMLElement {
  const el = document.createElement("div");
  el.style.cssText = "position:relative;pointer-events:none;";
  if (m.kind === "pickup") {
    el.innerHTML =
      `<svg width="26" height="26" viewBox="0 0 26 26" aria-hidden="true">
         <circle cx="13" cy="13" r="12" fill="${C.success}" fill-opacity="0.18"/>
         <circle cx="13" cy="13" r="5.6" fill="${C.success}" stroke="#FFFFFF" stroke-width="2.4"/>
       </svg>` + (m.label ? labelPill(m.label) : "");
  } else if (m.kind === "dropoff") {
    el.innerHTML =
      `<svg width="30" height="38" viewBox="0 0 30 38" fill="none" aria-hidden="true">
         <ellipse cx="15" cy="34.5" rx="6.5" ry="2.6" fill="${C.ink}" fill-opacity="0.16"/>
         <path d="${DROPOFF_PATH}" fill="${C.brand}" stroke="#FFFFFF" stroke-width="2"/>
         <circle cx="15" cy="13.4" r="3.9" fill="#FFFFFF"/>
       </svg>` + (m.label ? labelPill(m.label) : "");
  } else {
    el.innerHTML =
      `<div style="width:26px;height:26px;border-radius:99px;background:${C.ink};color:#fff;
         display:flex;align-items:center;justify-content:center;font:800 12px/1 Manrope,system-ui,sans-serif;
         border:2px solid #FFFFFF;box-shadow:0 1px 5px rgba(23,24,28,0.28)">${m.sub ?? "•"}</div>`;
  }
  return el;
}

// ── component ────────────────────────────────────────────────────────────────

const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);

/** Shortest-arc delta between two compass headings, -180..180. */
function headingDelta(from: number, to: number): number {
  return ((((to - from) % 360) + 540) % 360) - 180;
}

let workerUrlSet = false;

interface MarkerEntry {
  marker: MlMarker;
  rotator?: HTMLElement;
  root?: ReturnType<typeof createRoot>;
}

export default function LiveMap({
  center,
  zoom = 12.4,
  markers = [],
  route,
  follow = false,
  onMapClick,
  compact = false,
  interactive = true,
  className = "",
  fallback,
  fitPad = 48,
}: LiveMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MlMap | null>(null);
  const markerStore = useRef(new Map<string, MarkerEntry>());
  const driverStateRef = useRef<{ lat: number; lng: number; heading: number; raf: number } | null>(null);
  const userPannedRef = useRef(false);
  const fittedRef = useRef(false);
  const routeRef = useRef<RouteGeometry | undefined>(route);
  const followRef = useRef(follow);
  const clickRef = useRef(onMapClick);
  const [phase, setPhase] = useState<"init" | "ready" | "failed">(() => {
    // WebGL availability probed lazily in the state initializer (client-only
    // guard included) — the mount effect below then never needs a sync
    // setState, which the React compiler lint forbids
    if (typeof document === "undefined") return "init";
    try {
      const probe = document.createElement("canvas");
      const gl = probe.getContext("webgl2") ?? probe.getContext("webgl");
      return gl ? "init" : "failed";
    } catch {
      return "failed";
    }
  });
  const [epoch, setEpoch] = useState(0); // map (re)creation count — see StrictMode note

  // latest-callback refs: written in an effect (after every render), never
  // during render — the map's internals read them from event handlers.
  useEffect(() => {
    followRef.current = follow;
    clickRef.current = onMapClick;
    routeRef.current = route;
  });

  // Fit the camera to route + markers (once, on first ready content).
  const fitToContent = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;
    const pts: [number, number][] = [];
    const r = routeRef.current;
    if (r) {
      for (const p of r) pts.push(Array.isArray(p) ? [p[1], p[0]] : [p.lng, p.lat]);
    }
    for (const m of markers) pts.push([m.lng, m.lat]);
    const uniq = pts.filter((p, i) => pts.findIndex((q) => q[0] === p[0] && q[1] === p[1]) === i);
    if (uniq.length === 0) return;
    if (uniq.length === 1) {
      map.jumpTo({ center: uniq[0], zoom: Math.max(map.getZoom(), 14.5) });
      return;
    }
    const bounds = new LngLatBounds();
    uniq.forEach((p) => bounds.extend(p));
    map.fitBounds(bounds, { padding: fitPad, duration: 0, maxZoom: 16 });
  }, [markers, fitPad]);

  // ── map lifecycle ──────────────────────────────────────────────────────────
  useEffect(() => {
    const container = containerRef.current;
    if (!container || typeof window === "undefined") return;

    // fresh instance state (this effect can re-run under React StrictMode)
    fittedRef.current = false;
    userPannedRef.current = false;
    if (driverStateRef.current) cancelAnimationFrame(driverStateRef.current.raf);
    driverStateRef.current = null;

    // WebGL was probed in the phase initializer — nothing sync to set here
    if (phase === "failed") return;

    if (!workerUrlSet) {
      try {
        setWorkerUrl("/maplibre-gl-worker.mjs");
        workerUrlSet = true;
      } catch {
        // keep going — the bundler default may still resolve
      }
    }

    let dead = false;
    let map: MlMap | null = null;
    const kill = () => {
      if (dead) return;
      dead = true;
      for (const { marker, root } of markerStore.current.values()) {
        try { marker.remove(); } catch { /* already gone */ }
        root?.unmount();
      }
      markerStore.current.clear();
      if (map) {
        mapRef.current = null;
        try { map.remove(); } catch { /* already gone */ }
      }
      setPhase("failed");
    };

    try {
      map = new MlMapCtor({
        container,
        style: CARTO_STYLE,
        center: center ? [center.lng, center.lat] : [36.8172, -1.2864],
        zoom,
        interactive,
        attributionControl: { compact: true },
        dragRotate: false,
        pitchWithRotate: false,
      });
    } catch {
      kill();
      return;
    }
    mapRef.current = map;

    map.on("error", (e) => {
      const msg = (e as { error?: { message?: string } }).error?.message ?? "";
      if (/webgl|context|Failed to initialize/i.test(msg)) kill();
      // individual tile fetch failures are non-fatal — maplibre retries/fades
    });

    map.on("load", () => {
      if (dead || !map) return;
      // announce readiness from the async load event (never a sync setState
      // inside the mount effect — React compiler lint + cascade safety)
      setEpoch((e) => e + 1);
      map.addSource("route", { type: "geojson", data: routeToFeature(routeRef.current) });
      map.addLayer({
        id: "route-casing",
        type: "line",
        source: "route",
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": "#FFFFFF", "line-width": 8 },
      });
      map.addLayer({
        id: "route-line",
        type: "line",
        source: "route",
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": C.brand, "line-width": 4 },
      });
      setPhase("ready");
    });

    map.on("click", (e) => {
      clickRef.current?.({ lat: e.lngLat.lat, lng: e.lngLat.lng });
    });
    // user gestures end follow mode (recenter restores it)
    map.on("dragstart", () => { userPannedRef.current = true; });

    return () => {
      dead = true;
      if (driverStateRef.current) cancelAnimationFrame(driverStateRef.current.raf);
      for (const { marker, root } of markerStore.current.values()) {
        try { marker.remove(); } catch { /* already gone */ }
        root?.unmount();
      }
      markerStore.current.clear();
      if (mapRef.current) {
        try { mapRef.current.remove(); } catch { /* already gone */ }
        mapRef.current = null;
      }
    };
  }, []);

  // ── explicit center prop updates (mini previews) ──────────────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map || phase !== "ready" || !center) return;
    map.easeTo({ center: [center.lng, center.lat], duration: 400 });
  }, [center, phase]);

  // ── route geometry updates (+ one-shot auto-fit once content exists) ──────
  useEffect(() => {
    if (!fittedRef.current && route && route.length > 1 && !userPannedRef.current) {
      fittedRef.current = true;
      fitToContent();
    }
    const map = mapRef.current;
    if (!map || phase !== "ready") return;
    const src = map.getSource("route") as GeoJSONSource | undefined;
    src?.setData(routeToFeature(route));
  }, [route, phase, epoch, fitToContent]);

  // ── markers: diff by id; driver gets animated movement + heading ──────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map || (phase !== "ready" && phase !== "init")) return;
    const live = markerStore.current;

    // remove stale
    for (const [id, entry] of live) {
      if (!markers.some((m) => m.id === id)) {
        try { entry.marker.remove(); } catch { /* already gone */ }
        entry.root?.unmount();
        live.delete(id);
      }
    }

    for (const m of markers) {
      const existing = live.get(m.id);
      if (m.kind !== "driver") {
        if (existing) continue; // static pins never move
        const anchor: MarkerOptions["anchor"] = m.kind === "dropoff" ? "bottom" : "center";
        const marker = new MlMarkerCtor({ element: makePinElement(m), anchor })
          .setLngLat([m.lng, m.lat])
          .addTo(map);
        live.set(m.id, { marker });
        continue;
      }

      // driver vehicle marker — DOM plate, rotated by heading
      if (!existing) {
        const el = document.createElement("div");
        el.style.cssText = "pointer-events:none;";
        const rotator = document.createElement("div");
        rotator.style.cssText = `width:34px;height:34px;transform:rotate(${m.heading ?? 0}deg);transition:transform .55s cubic-bezier(.2,.8,.3,1);`;
        el.appendChild(rotator);
        const root = createRoot(rotator);
        root.render(<VehicleTopIcon categoryKey={m.categoryKey ?? "pickup"} size={34} />);
        const marker = new MlMarkerCtor({ element: el, anchor: "center" })
          .setLngLat([m.lng, m.lat])
          .addTo(map);
        live.set(m.id, { marker, rotator, root });
        driverStateRef.current = { lat: m.lat, lng: m.lng, heading: m.heading ?? 0, raf: 0 };
        continue;
      }

      // animate the driver marker: ~1.2 s eased glide + shortest-arc turn
      const prev = driverStateRef.current ?? { lat: m.lat, lng: m.lng, heading: m.heading ?? 0, raf: 0 };
      const fromLat = prev.lat, fromLng = prev.lng, fromHeading = prev.heading;
      const dLat = m.lat - fromLat, dLng = m.lng - fromLng;
      const jumpMeters = Math.hypot(dLat, dLng) * 111_320;
      const rotator = existing.rotator;
      const targetHeading = m.heading ?? fromHeading;

      if (driverStateRef.current) cancelAnimationFrame(driverStateRef.current.raf);

      if (jumpMeters > 600) {
        // leg change / teleport — snap, no glide
        existing.marker.setLngLat([m.lng, m.lat]);
        if (rotator) rotator.style.transform = `rotate(${targetHeading}deg)`;
        driverStateRef.current = { lat: m.lat, lng: m.lng, heading: targetHeading, raf: 0 };
      } else {
        const start = performance.now();
        const DURATION = 1200;
        const hDelta = headingDelta(fromHeading, targetHeading);
        const tick = (now: number) => {
          const t = Math.min(1, (now - start) / DURATION);
          const e = easeOutCubic(t);
          const lat = fromLat + dLat * e;
          const lng = fromLng + dLng * e;
          existing.marker.setLngLat([lng, lat]);
          if (rotator) {
            // drive rotation per-frame during the glide, then restore the CSS
            // transition for standalone heading updates
            rotator.style.transition = "none";
            rotator.style.transform = `rotate(${fromHeading + hDelta * e}deg)`;
            if (t >= 1) rotator.style.transition = "";
          }
          const state = { lat, lng, heading: fromHeading + hDelta * e, raf: 0 };
          if (t < 1) state.raf = requestAnimationFrame(tick);
          driverStateRef.current = state;
        };
        driverStateRef.current = { ...prev, raf: requestAnimationFrame(tick) };
      }

      // follow camera (until the user pans)
      if (followRef.current && !userPannedRef.current) {
        map.easeTo({
          center: [m.lng, m.lat],
          zoom: map.getZoom() < 13.5 ? 14.8 : map.getZoom(),
          duration: 1200,
        });
      }
    }
  }, [markers, phase, epoch]);

  // ── fallback ───────────────────────────────────────────────────────────────
  if (phase === "failed" || typeof window === "undefined") {
    if (fallback !== undefined) return <>{fallback}</>;
    return <MapCanvasFallback route={route} markers={markers} className={className} />;
  }

  const recenter = () => {
    const map = mapRef.current;
    if (!map) return;
    userPannedRef.current = false;
    const driver = markers.find((m) => m.kind === "driver");
    if (driver) {
      map.easeTo({ center: [driver.lng, driver.lat], zoom: Math.max(map.getZoom(), 14.8), duration: 600 });
    } else {
      fittedRef.current = true; // from now on the route stays where the user put it
      fitToContent();
    }
  };

  return (
    <div className={`relative overflow-hidden ${className}`} style={{ background: C.surface2 }} role="region" aria-label="Live map">
      <div ref={containerRef} className="absolute inset-0" aria-hidden="true" />

      {phase === "init" && (
        <div className="absolute inset-0 flex items-center justify-center" aria-hidden="true">
          <Loader2 size={20} className="animate-spin text-[var(--ink-3)]" />
        </div>
      )}

      {!compact && (
        <button
          onClick={recenter}
          className="absolute bottom-3 right-3 z-10 flex h-11 w-11 items-center justify-center rounded-full border border-[var(--line)] bg-[var(--surface)] text-[var(--ink)] shadow-[0_2px_10px_rgba(23,24,28,0.16)] transition hover:border-[var(--ink-3)] active:scale-95"
          aria-label="Recenter map"
        >
          <LocateFixed size={18} />
        </button>
      )}
    </div>
  );
}

/** Default WebGL fallback: the hand-drawn MapCanvas fed the same data. */
function MapCanvasFallback({
  route,
  markers,
  className,
}: {
  route?: RouteGeometry;
  markers: LiveMapMarker[];
  className?: string;
}) {
  const pts = route
    ? route.map((p) => (Array.isArray(p) ? { lat: p[0], lng: p[1] } : { lat: p.lat, lng: p.lng }))
    : undefined;
  return (
    <MapCanvas
      route={pts}
      markers={markers.map((m) => ({
        kind: m.kind === "driver" ? ("vehicle" as const) : m.kind,
        lat: m.lat,
        lng: m.lng,
        heading: m.heading,
        label: m.label,
      }))}
      showLabels={false}
      className={className?.includes("absolute") ? className : `relative ${className ?? ""}`}
    />
  );
}
