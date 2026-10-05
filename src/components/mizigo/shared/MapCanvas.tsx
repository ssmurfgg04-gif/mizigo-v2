"use client";
// MapCanvas — stylized vector Nairobi map (MockMapProvider surface).
// Roads, estates, parks and the river are drawn from the geo model; routes and
// markers are projected lat/lng → SVG. Auto-fits to the content it is showing.

import { useMemo, useId } from "react";
import { ROADS, project, MAP_W, MAP_H } from "@/lib/geo";
import { C } from "@/lib/palette";

export type MarkerKind = "me" | "pickup" | "dropoff" | "vehicle" | "nearby" | "stop" | "demand" | "problem";

export interface MapMarker {
  lat: number; lng: number;
  kind: MarkerKind;
  label?: string;
  heading?: number; // degrees, for vehicle rotation
  sub?: string;
}

interface MapCanvasProps {
  route?: { lat: number; lng: number }[];
  traveled?: { lat: number; lng: number }[];
  markers?: MapMarker[];
  focus?: { lat: number; lng: number } | null;
  showLabels?: boolean;
  interactive?: boolean;
  className?: string;
  fitPad?: number;
}

const AREA_FILLS: { name: string; pts: [number, number][]; fill: string; stroke: string }[] = [
  { name: "Nairobi National Park", pts: [[520, 660], [770, 640], [800, 900], [500, 940]], fill: C.successSoft, stroke: C.success },
  { name: "Karura Forest", pts: [[20, 60], [200, 40], [260, 150], [60, 180]], fill: C.successSoft, stroke: C.success },
  { name: "Uhuru Park", pts: [[368, 470], [412, 472], [416, 512], [364, 510]], fill: C.successSoft, stroke: C.success },
];

const ESTATE_LABELS: { name: string; lat: number; lng: number }[] = [
  { name: "CBD", lat: -1.2852, lng: 36.8250 },
  { name: "Westlands", lat: -1.2603, lng: 36.8020 },
  { name: "Parklands", lat: -1.2550, lng: 36.8320 },
  { name: "Kilimani", lat: -1.2920, lng: 36.7800 },
  { name: "Lavington", lat: -1.2730, lng: 36.7640 },
  { name: "Karen", lat: -1.3200, lng: 36.7150 },
  { name: "Langata", lat: -1.3300, lng: 36.7800 },
  { name: "South B", lat: -1.3090, lng: 36.8380 },
  { name: "South C", lat: -1.3230, lng: 36.8080 },
  { name: "Industrial Area", lat: -1.3080, lng: 36.8430 },
  { name: "Eastleigh", lat: -1.2780, lng: 36.8480 },
  { name: "Donholm", lat: -1.2970, lng: 36.8900 },
  { name: "Umoja", lat: -1.2930, lng: 36.9050 },
  { name: "Kasarani", lat: -1.2290, lng: 36.8800 },
  { name: "Roysambu", lat: -1.2170, lng: 36.8900 },
  { name: "Kawangware", lat: -1.2870, lng: 36.7500 },
  { name: "Gikomba", lat: -1.2845, lng: 36.8340 },
  { name: "Kibera", lat: -1.3120, lng: 36.7800 },
  { name: "Embakasi", lat: -1.3150, lng: 36.8720 },
  { name: "Ruaraka", lat: -1.2430, lng: 36.8650 },
];

function pathD(pts: { lat: number; lng: number }[]) {
  if (!pts.length) return "";
  return pts.map((p, i) => { const { x, y } = project(p); return `${i === 0 ? "M" : "L"}${x} ${y}`; }).join(" ");
}

export default function MapCanvas({
  route, traveled, markers = [], focus = null, showLabels = true, className = "", fitPad = 110,
}: MapCanvasProps) {
  const uid = useId().replace(/[:]/g, "");

  const { viewBox, scale } = useMemo(() => {
    const pts: { lat: number; lng: number }[] = [];
    if (route) pts.push(...route);
    if (traveled) pts.push(...traveled);
    markers.forEach((m) => pts.push(m));
    if (focus) pts.push(focus);
    if (pts.length === 0) return { viewBox: `0 0 ${MAP_W} ${MAP_H}`, scale: 1 };

    let minLat = Infinity, maxLat = -Infinity, minLng = Infinity, maxLng = -Infinity;
    pts.forEach((p) => {
      minLat = Math.min(minLat, p.lat); maxLat = Math.max(maxLat, p.lat);
      minLng = Math.min(minLng, p.lng); maxLng = Math.max(maxLng, p.lng);
    });
    if (minLat === maxLat) { minLat -= 0.005; maxLat += 0.005; }
    if (minLng === maxLng) { minLng -= 0.005; maxLng += 0.005; }

    const padDeg = 0.004;
    const tl = project({ lat: maxLat + padDeg, lng: minLng - padDeg });
    const br = project({ lat: minLat - padDeg, lng: maxLng + padDeg });

    const x = Math.max(-40, tl.x - fitPad / 2);
    const y = Math.max(-40, tl.y - fitPad / 2);
    const w = Math.min(br.x - tl.x + fitPad, MAP_W + 80);
    const h = Math.min(br.y - tl.y + fitPad, MAP_H + 80);
    return { viewBox: `${x} ${y} ${w} ${h}`, scale: MAP_W / w };
  }, [route, traveled, markers, focus, fitPad]);

  const small = scale > 2.4;

  return (
    <div className={`relative overflow-hidden ${className}`} style={{ background: C.surface2 }} aria-label="Map of Nairobi" role="img">
      <svg viewBox={viewBox} className="h-full w-full" preserveAspectRatio="xMidYMid slice">
        <defs>
          <radialGradient id={`bg-${uid}`} cx="50%" cy="42%" r="75%">
            <stop offset="0%" stopColor={C.surface} />
            <stop offset="100%" stopColor={C.surface2} />
          </radialGradient>
        </defs>

        {/* base */}
        <rect x={-80} y={-80} width={MAP_W + 160} height={MAP_H + 160} fill={`url(#bg-${uid})`} />

        {/* subtle grid */}
        <g stroke={C.line} strokeWidth={0.5} opacity={0.5}>
          {Array.from({ length: 21 }, (_, i) => (
            <line key={`gv${i}`} x1={i * 40} y1={-40} x2={i * 40} y2={MAP_H + 40} />
          ))}
          {Array.from({ length: 26 }, (_, i) => (
            <line key={`gh${i}`} x1={-40} y1={i * 40} x2={MAP_W + 40} y2={i * 40} />
          ))}
        </g>

        {/* green areas */}
        {AREA_FILLS.map((a) => (
          <polygon key={a.name} points={a.pts.map(([x, y]) => `${x},${y}`).join(" ")} fill={a.fill} stroke={a.stroke} strokeWidth={0.8} strokeOpacity={0.35} />
        ))}

        {/* Nairobi River (stylized) */}
        <path
          d={`M${project({ lat: -1.22, lng: 36.84 }).x} ${project({ lat: -1.22, lng: 36.84 }).y}
              Q ${project({ lat: -1.25, lng: 36.83 }).x} ${project({ lat: -1.25, lng: 36.83 }).y} ${project({ lat: -1.262, lng: 36.84 }).x} ${project({ lat: -1.262, lng: 36.84 }).y}
              T ${project({ lat: -1.284, lng: 36.848 }).x} ${project({ lat: -1.284, lng: 36.848 }).y}
              Q ${project({ lat: -1.296, lng: 36.856 }).x} ${project({ lat: -1.296, lng: 36.856 }).y} ${project({ lat: -1.3, lng: 36.872 }).x} ${project({ lat: -1.3, lng: 36.872 }).y}
              T ${project({ lat: -1.316, lng: 36.9 }).x} ${project({ lat: -1.316, lng: 36.9 }).y}`}
          fill="none" stroke={C.info} strokeOpacity={0.35} strokeWidth={3.2} strokeLinecap="round"
        />

        {/* roads */}
        {ROADS.map((r) => (
          <path
            key={r.name}
            d={pathD(r.pts)}
            fill="none"
            stroke={C.ink}
            strokeOpacity={r.class === "primary" ? 0.22 : 0.13}
            strokeWidth={r.class === "primary" ? 5 : 3.2}
            strokeLinecap="round" strokeLinejoin="round"
          />
        ))}

        {/* estate labels */}
        {showLabels && !small && (
          <g fontSize={11} fill={C.ink3} fontWeight={600} letterSpacing={0.4}>
            {ESTATE_LABELS.map((e) => {
              const p = project(e);
              return <text key={e.name} x={p.x} y={p.y} textAnchor="middle">{e.name.toUpperCase()}</text>;
            })}
          </g>
        )}

        {/* route */}
        {route && route.length > 1 && (
          <>
            <path d={pathD(route)} fill="none" stroke={C.white} strokeWidth={9} strokeOpacity={0.85} strokeLinecap="round" strokeLinejoin="round" />
            <path d={pathD(route)} fill="none" stroke={C.brand} strokeWidth={5} strokeLinecap="round" strokeLinejoin="round" opacity={0.28} />
            <path
              d={pathD(route)} fill="none" stroke={C.brand} strokeWidth={5} strokeLinecap="round" strokeLinejoin="round"
              strokeDasharray="4 20" className="animate-mz-dash"
            />
          </>
        )}
        {traveled && traveled.length > 1 && (
          <path d={pathD(traveled)} fill="none" stroke={C.ink} strokeWidth={5} strokeLinecap="round" strokeLinejoin="round" />
        )}

        {/* markers */}
        {markers.map((m, i) => {
          const p = project(m);
          const markerScale = Math.max(0.75, Math.min(1.4, scale * 0.62));
          return (
            <g key={`${m.kind}-${i}`} transform={`translate(${p.x} ${p.y}) scale(${markerScale})`}>
              {m.kind === "me" && (
                <g>
                  <circle r={14} fill={C.brand} opacity={0.18} className="animate-mz-radar" />
                  <circle r={6.5} fill={C.surface} stroke={C.ink} strokeWidth={3} />
                </g>
              )}
              {m.kind === "pickup" && (
                <g>
                  <circle r={13} fill={C.success} opacity={0.16} />
                  <circle r={5.5} fill={C.success} stroke={C.surface} strokeWidth={2.2} />
                </g>
              )}
              {m.kind === "dropoff" && (
                <g>
                  <path d="M0 2 C -7 -6 -9 -10 -9 -14 A 9 9 0 1 1 9 -14 C 9 -10 7 -6 0 2 Z" fill={C.brand} stroke={C.surface} strokeWidth={1.6} />
                  <circle cx={0} cy={-14} r={3.4} fill={C.surface} />
                </g>
              )}
              {m.kind === "stop" && (
                <g>
                  <rect x={-5} y={-5} width={10} height={10} rx={3} fill={C.surface} stroke={C.ink2} strokeWidth={2.4} />
                </g>
              )}
              {m.kind === "nearby" && (
                <g opacity={0.75}>
                  <circle r={7.5} fill={C.ink} fillOpacity={0.85} />
                  <g transform="translate(0 -1) scale(0.55)" stroke={C.surface} strokeWidth={3} fill="none" strokeLinecap="round">
                    <path d="M-7 3 L-7 -2 L-3 -6 L4 -6 L7 -3 L7 3 Z" />
                    <path d="M-4 -3 L-1.5 -5.5 L2.5 -5.5 L4.5 -3 Z" />
                  </g>
                </g>
              )}
              {m.kind === "vehicle" && (
                <g transform={`rotate(${m.heading ?? 0})`}>
                  <circle r={16} fill={C.brand} opacity={0.15} className="animate-mz-pulse" />
                  <rect x={-11} y={-11} width={22} height={22} rx={7} fill={C.ink} stroke={C.surface} strokeWidth={2.2} />
                  <g transform="rotate(90)" stroke={C.surface} strokeWidth={2.6} fill="none" strokeLinecap="round">
                    <path d="M-4.5 2 L-4.5 -2 L-2 -5 L2.5 -5 L4.5 -2 L4.5 2 Z" />
                    <path d="M-2.5 -2.5 L-1 -4 L1.5 -4 L2.5 -2.5 Z" />
                  </g>
                </g>
              )}
              {m.kind === "demand" && (
                <g>
                  <circle r={26} fill={m.sub === "high" ? C.brand : m.sub === "medium" ? C.warn : C.success} opacity={0.14} />
                  <circle r={5} fill={m.sub === "high" ? C.brand : m.sub === "medium" ? C.warn : C.success} opacity={0.75} />
                  {m.label && (
                    <text y={-18} textAnchor="middle" fontSize={12} fontWeight={700} fill={C.ink2}>{m.label}</text>
                  )}
                </g>
              )}
              {m.kind === "problem" && (
                <g>
                  <circle r={9} fill={C.danger} />
                  <path d="M-4 3 L0 -4 L4 3 Z" fill={C.surface} />
                  <circle cx={0} cy={1.4} r={0.9} fill={C.danger} />
                </g>
              )}
              {m.label && (m.kind === "pickup" || m.kind === "dropoff") && (
                <text y={m.kind === "pickup" ? 22 : 24} textAnchor="middle" fontSize={12.5} fontWeight={700} fill={C.ink} fontFamily="inherit" stroke={C.surface} strokeWidth={4} paintOrder="stroke">
                  {m.label}
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}
