"use client";
// Vector vehicle avatars — clean top-view representations per category.
// One visual family: ink body, brand cab accent, surface windows.

import { C } from "@/lib/palette";

const VEHICLES: Record<string, { body: string; cab: string; size: [number, number]; detail: "open" | "covered" | "tuktuk" }> = {
  tuktuk: { body: "M -3 -5 A 5.2 5.2 0 0 1 3 -5 L 3.6 3 A 1.4 1.4 0 0 1 2.2 4.4 L -2.2 4.4 A 1.4 1.4 0 0 1 -3.6 3 Z", cab: "M 0 -3.6 A 2.6 2.6 0 0 1 2.2 -1.6 L -2.2 -1.6 A 2.6 2.6 0 0 1 0 -3.6 Z", size: [22, 22], detail: "tuktuk" },
  van: { body: "M -7 -8 L 3.4 -8 L 3.4 8 L -7 8 Z", cab: "M 3.4 -8 L 7 -8 L 7 8 L 3.4 8 Z", size: [26, 26], detail: "covered" },
  pickup: { body: "M -8.5 -6.5 L 0.8 -6.5 L 0.8 6.5 L -8.5 6.5 Z", cab: "M 0.8 -6.5 L 8 -6.5 L 8 6.5 L 0.8 6.5 Z", size: [28, 24], detail: "open" },
  canter: { body: "M -10 -5.5 L 1.6 -5.5 L 1.6 5.5 L -10 5.5 Z", cab: "M 1.6 -5.5 L 9 -5.5 L 9 5.5 L 1.6 5.5 Z", size: [32, 24], detail: "open" },
  lorry_7t: { body: "M -11 -7 L 1.2 -7 L 1.2 7 L -11 7 Z", cab: "M 1.2 -7 L 9.4 -7 L 9.4 7 L 1.2 7 Z", size: [34, 26], detail: "covered" },
  lorry_10t: { body: "M -12 -8 L 1.2 -8 L 1.2 8 L -12 8 Z", cab: "M 1.2 -8 L 10 -8 L 10 8 L 1.2 8 Z", size: [36, 28], detail: "covered" },
};

export default function VehicleAvatar({ category, size = 44, className = "" }: { category: string; size?: number; className?: string }) {
  const v = VEHICLES[category] ?? VEHICLES.pickup;
  const [w, h] = v.size;
  return (
    <svg
      viewBox={`${-w / 2 - 2} ${-h / 2 - 2} ${w + 4} ${h + 4}`}
      width={size} height={size}
      className={className}
      role="img"
      aria-label={`${category} vehicle`}
    >
      {/* cargo bed */}
      <path d={v.body} fill={C.ink} />
      {v.detail === "open" && (
        <path d={v.body} fill="none" stroke={C.surface} strokeWidth={1.1} strokeDasharray="2.2 1.8" opacity={0.85} />
      )}
      {v.detail === "covered" && (
        <path d={v.body} fill={C.ink} stroke={C.surface} strokeWidth={0.8} opacity={1} />
      )}
      {/* cab */}
      <path d={v.cab} fill={C.brand} />
      <path d={v.cab} fill="none" stroke={C.surface} strokeWidth={0.7} strokeOpacity={0.6} />
      {/* windshield */}
      <path d={v.cab} fill={C.surface} fillOpacity={0.22} />
      {v.detail === "tuktuk" && <circle cx={0} cy={-0.5} r={2} fill={C.surface} fillOpacity={0.3} />}
      {/* wheels */}
      <g fill={C.night}>
        {category === "tuktuk" ? (
          <>
            <circle cx={-2.6} cy={4.6} r={1.5} /><circle cx={2.6} cy={4.6} r={1.5} /><circle cx={0} cy={-5.4} r={1.2} />
          </>
        ) : (
          <>
            <rect x={-8.5} y={-8} width={3} height={2.2} rx={1} /><rect x={-8.5} y={5.8} width={3} height={2.2} rx={1} />
            <rect x={5} y={-8} width={3} height={2.2} rx={1} /><rect x={5} y={5.8} width={3} height={2.2} rx={1} />
          </>
        )}
      </g>
    </svg>
  );
}
