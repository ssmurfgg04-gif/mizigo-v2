"use client";
// MIZIGO vehicle avatars — premium side-view vector illustrations per category.
// One visual family: ink cargo bodies, brand cabs, surface glass, round-cap details.
// Side view (default) for cards/lists; top view for map markers.
// SVG presentation attributes can't resolve CSS var() — hex palette from lib/palette.

import { C } from "@/lib/palette";

// ── shared bits ─────────────────────────────────────────────────────────────

function Wheel({ cx, cy = 76, r = 7 }: { cx: number; cy?: number; r?: number }) {
  return (
    <g>
      <circle cx={cx} cy={cy} r={r} fill={C.ink} />
      <circle cx={cx} cy={cy} r={r} fill="none" stroke={C.surface} strokeOpacity={0.28} strokeWidth={1.1} />
      <circle cx={cx} cy={cy} r={r * 0.46} fill="none" stroke={C.ink3} strokeWidth={1.6} />
      <circle cx={cx} cy={cy} r={r * 0.16} fill={C.surface2} />
    </g>
  );
}

const Headlight = ({ x, y }: { x: number; y: number }) => <circle cx={x} cy={y} r={1.7} fill="#FDF3E1" stroke={C.brandDeep} strokeWidth={0.5} />;
const Taillight = ({ x, y }: { x: number; y: number }) => <rect x={x} y={y} width={2.2} height={3.4} rx={1} fill={C.danger} />;
const Ground = ({ x1 = 10, x2 = 86 }: { x1?: number; x2?: number }) => (
  <g fill={C.ink}>
    <ellipse cx={(x1 + x2) / 2} cy={86.5} rx={(x2 - x1) / 2 + 6} ry={2.2} opacity={0.08} />
    <ellipse cx={(x1 + x2) / 2} cy={86} rx={(x2 - x1) / 2 - 4} ry={1.7} opacity={0.1} />
  </g>
);

// ── side views ──────────────────────────────────────────────────────────────

function TuktukSide() {
  return (
    <g>
      <Ground x1={14} x2={80} />
      {/* rear cargo basket */}
      <path d="M18 66 L18 55 L38 55 L38 66 Z" fill={C.ink} />
      <rect x="16.5" y="53.5" width="23" height="3" rx="1.5" fill={C.ink} />
      <rect x="22" y="58" width="12" height="2" rx="1" fill={C.surface} opacity={0.25} />
      {/* spare wheel on the back — classic Nairobi tuktuk */}
      <g>
        <circle cx="13.5" cy="60" r="5.4" fill={C.ink} />
        <circle cx="13.5" cy="60" r="2.6" fill="none" stroke={C.ink3} strokeWidth={1.3} />
        <circle cx="13.5" cy="60" r="0.9" fill={C.surface2} />
      </g>
      {/* body: canopy + cowl */}
      <path
        d="M36 66 L36 50 Q36 45 41 44.5 L60 44 Q66 44 70 48 L77 56 Q79 59 79 62 L79 66 Z"
        fill={C.brand}
      />
      {/* roof rail */}
      <rect x="40" y="41.5" width="24" height="2.6" rx="1.3" fill={C.ink} />
      {/* windshield */}
      <path d="M64 46.5 L74 55.5 L77.5 55.5 L69.5 46.5 Z" fill={C.surface} opacity={0.85} />
      {/* side window */}
      <path d="M41 48.5 L57 48.5 L57 55 L39.5 55 L39.5 51 Q39.5 48.5 41 48.5 Z" fill={C.surface} opacity={0.75} />
      {/* body crease + rear plate */}
      <path d="M38 61 L78 61" stroke={C.brandDeep} strokeWidth={1.2} strokeLinecap="round" />
      {/* driver silhouette — a friendly presence */}
      <circle cx="47" cy="42.2" r="2.5" fill={C.ink} />
      <Headlight x={78.4} y={59} />
      <Wheel cx={27} r={6.2} />
      <Wheel cx={68} r={6.2} />
    </g>
  );
}

function PickupSide() {
  return (
    <g>
      <Ground x1={8} x2={90} />
      {/* cargo bed + boxes */}
      <rect x="9" y="53" width="47" height="12" rx="2" fill={C.ink} />
      <rect x="7.5" y="51.5" width="50" height="3.2" rx="1.6" fill={C.ink} />
      <rect x="13" y="44.5" width="16" height="8.5" rx="1.5" fill={C.surface2} stroke={C.ink} strokeWidth={1.1} />
      <rect x="31" y="47" width="13" height="6" rx="1.2" fill={C.surface} stroke={C.ink} strokeWidth={1} />
      <path d="M11 46 L54 46" stroke={C.brand} strokeWidth={1.4} strokeLinecap="round" opacity={0.9} />
      {/* cab */}
      <path d="M56 65 L56 39.5 Q56 37.5 58 37.5 L72 37.5 Q74 37.5 75 39 L82.5 49.5 L86.5 51 Q88.5 52 88.5 54.5 L88.5 65 Z" fill={C.brand} />
      {/* window */}
      <path d="M60 41 L70.5 41 Q71.5 41 72 41.8 L78.5 50.5 L60 50.5 Z" fill={C.surface} opacity={0.88} />
      {/* mirror */}
      <path d="M85 46.5 L88 43.5" stroke={C.ink} strokeWidth={1.6} strokeLinecap="round" />
      <circle cx="88.6" cy="43" r="1.3" fill={C.ink} />
      {/* door line + handle */}
      <path d="M68 52 L68 63.5" stroke={C.brandDeep} strokeWidth={1.1} strokeLinecap="round" />
      <rect x="70" y="55" width="5" height="1.6" rx="0.8" fill={C.brandDeep} />
      {/* bumpers */}
      <rect x="4.5" y="61.5" width="4" height="4.5" rx="1" fill={C.ink2} />
      <rect x="88" y="60" width="5.5" height="5.5" rx="1.2" fill={C.ink2} />
      <Headlight x={89.6} y={56.5} />
      <Taillight x={7.6} y={56} />
      <Wheel cx={23} />
      <Wheel cx={74} />
    </g>
  );
}

function VanSide() {
  return (
    <g>
      <Ground x1={10} x2={88} />
      {/* roof rack — matatu energy */}
      <rect x="18" y="36.5" width="50" height="2.8" rx="1.4" fill={C.ink} />
      {/* body */}
      <path
        d="M10.5 67 L10.5 50 Q10.5 44 16 43.5 L70 42 Q75 42 78.5 45.5 L85.5 52.5 Q87.5 55 87.5 58 L87.5 65 Q87.5 67 85.5 67 Z"
        fill={C.brand}
      />
      {/* window band: 2 passenger + driver glass */}
      <path d="M17 46.5 L43 46.5 L43 55 L15.5 55 L15.5 49 Q15.5 46.5 17 46.5 Z" fill={C.surface} opacity={0.88} />
      <path d="M47 46.3 L68 46.3 L68 55 L47 55 Z" fill={C.surface} opacity={0.88} />
      <path d="M72.5 47.5 L81.5 55.5 L69 55.5 L69 47.8 Q70.5 47 72.5 47.5 Z" fill={C.surface} opacity={0.88} />
      {/* sliding door + handle */}
      <path d="M45 46 L45 66" stroke={C.brandDeep} strokeWidth={1.2} strokeLinecap="round" />
      <rect x="49" y="57.5" width="5.5" height="1.7" rx="0.85" fill={C.brandDeep} />
      {/* rocker skirt + crease */}
      <path d="M12 60 L86.5 60" stroke={C.brandDeep} strokeWidth={1.2} strokeLinecap="round" opacity={0.85} />
      <rect x="10.5" y="64" width="77" height="3" rx="1.5" fill={C.ink} opacity={0.22} />
      {/* mirrors */}
      <path d="M84 48 L87.5 44.5" stroke={C.ink} strokeWidth={1.6} strokeLinecap="round" />
      <circle cx="88" cy="44" r="1.3" fill={C.ink} />
      <Headlight x={88.6} y={57.5} />
      <Taillight x={9.2} y={55.5} />
      <Wheel cx={27} />
      <Wheel cx={70} />
    </g>
  );
}

function CanterSide() {
  return (
    <g>
      <Ground x1={8} x2={90} />
      {/* flatbed with stake rails + cargo */}
      <rect x="8" y="55" width="50" height="8" rx="1.5" fill={C.ink} />
      <rect x="8" y="41" width="50" height="3" rx="1.5" fill={C.ink} />
      {[14, 25, 36, 47].map((x) => (
        <rect key={x} x={x} y="42.5" width="2.4" height="13" rx="1.2" fill={C.ink} />
      ))}
      <rect x="15" y="47" width="17" height="9" rx="1.3" fill={C.surface2} stroke={C.ink} strokeWidth="1" />
      <rect x="34" y="49.5" width="12" height="6.5" rx="1.2" fill={C.surface} stroke={C.ink} strokeWidth="0.9" />
      {/* exhaust stack */}
      <rect x="55.5" y="40" width="2.6" height="17" rx="1.3" fill={C.ink2} />
      {/* cab */}
      <path d="M59 65 L59 38 Q59 35.5 61.5 35.5 L72 35.5 Q74 35.5 75 37 L82.5 47.5 L86.5 49.5 Q88.5 50.5 88.5 53 L88.5 65 Z" fill={C.brand} />
      {/* window */}
      <path d="M63 39.5 L70.5 39.5 Q71.5 39.5 72 40.3 L78.5 48.5 L63 48.5 Z" fill={C.surface} opacity={0.88} />
      {/* grill + bumper */}
      <rect x="88" y="55" width="3.5" height="7" rx="1.2" fill={C.ink2} />
      <rect x="88.4" y="52.5" width="3" height="2.4" rx="1" fill={C.ink2} />
      <path d="M60 57.5 L88.5 57.5" stroke={C.brandDeep} strokeWidth="1.1" strokeLinecap="round" />
      <Headlight x={90} y={50.5} />
      <Taillight x={8.2} y={57.5} />
      <Wheel cx={21} />
      <Wheel cx={73} />
    </g>
  );
}

function Lorry7tSide() {
  return (
    <g>
      <Ground x1={6} x2={92} />
      {/* canvas tilt body */}
      <path d="M7 66 L7 50 Q7 40.5 16.5 40.5 L52 40.5 Q61 40.5 61 50 L61 66 Z" fill={C.ink} />
      {[15, 23.5, 32, 40.5, 49, 57].map((x) => (
        <path key={x} d={`M${x} 43 L${x} 64`} stroke={C.surface} strokeWidth="1.3" strokeLinecap="round" opacity={0.22} />
      ))}
      {/* rear doors + lights */}
      <path d="M9.5 46 L9.5 64" stroke={C.surface} strokeWidth="1.1" opacity={0.3} />
      {/* fuel tank */}
      <rect x="30" y="68.5" width="15" height="5" rx="2.5" fill={C.ink2} />
      {/* cab with air deflector */}
      <path d="M61.5 26.5 L70 26.5 L74.5 33 L62 33 Z" fill={C.ink} />
      <path d="M63 66 L63 33.5 Q63 31.5 65 31.5 L76.5 31.5 Q78.5 31.5 79.5 33 L86.5 44 L89 45.5 Q91 46.8 91 49 L91 66 Z" fill={C.brand} />
      {/* window */}
      <path d="M66.5 35 L75 35 Q76 35 76.5 35.8 L82.5 44.5 L66.5 44.5 Z" fill={C.surface} opacity={0.88} />
      {/* grill + bumper + steps */}
      <rect x="90.5" y="56" width="3.8" height="8" rx="1.3" fill={C.ink2} />
      <path d="M64 57.5 L90.5 57.5" stroke={C.brandDeep} strokeWidth="1.1" strokeLinecap="round" />
      <rect x="63.5" y="67.5" width="7" height="3.6" rx="1.2" fill={C.ink2} />
      <Headlight x={92} y={51.5} />
      <Taillight x={7.4} y={58} />
      <Wheel cx={18} r={7.4} />
      <Wheel cx={76} r={7.4} />
    </g>
  );
}

function Lorry10tSide() {
  return (
    <g>
      <Ground x1={4} x2={94} />
      {/* container body with corrugation */}
      <rect x="5" y="35" width="58" height="30" rx="2" fill={C.ink} />
      {Array.from({ length: 9 }, (_, i) => 10 + i * 6).map((x) => (
        <path key={x} d={`M${x} 37.5 L${x} 62`} stroke={C.surface} strokeWidth="1.2" opacity={0.16} />
      ))}
      {/* brand stripe + door hardware */}
      <rect x="5" y="57.5" width="58" height="5.5" fill={C.brand} />
      <rect x="5" y="35" width="58" height="5.5" rx="2" fill={C.brandDeep} opacity={0.35} />
      <rect x="6.5" y="42" width="2" height="18" rx="1" fill={C.surface} opacity={0.28} />
      {/* fuel tank */}
      <rect x="28" y="68" width="16" height="5" rx="2.5" fill={C.ink2} />
      {/* tandem mudguard */}
      <rect x="46" y="65.5" width="27" height="9" rx="4" fill={C.ink} />
      {/* big cab-over */}
      <path d="M64 66 L64 30.5 Q64 28 66.5 28 L80 28 Q82 28 83 29.5 L89.5 40 L92 42 Q93.5 43.5 93.5 45.5 L93.5 66 Z" fill={C.brand} />
      {/* sun visor + window */}
      <rect x="65" y="30" width="26" height="2.2" rx="1.1" fill={C.ink} opacity={0.85} />
      <path d="M68 34 L79.5 34 Q80.5 34 81 34.8 L86.5 43 L68 43 Z" fill={C.surface} opacity={0.9} />
      {/* grill + bumper */}
      <rect x="92.8" y="55.5" width="3.6" height="9" rx="1.4" fill={C.ink2} />
      <path d="M66 56.5 L92.8 56.5" stroke={C.brandDeep} strokeWidth="1.2" strokeLinecap="round" />
      <rect x="66" y="68" width="8" height="3.8" rx="1.3" fill={C.ink2} />
      <Headlight x={94.4} y={51.5} />
      <Taillight x={5.4} y={60} />
      <Wheel cx={17} r={7.4} />
      <Wheel cx={56} r={6.6} />
      <Wheel cx={69} r={6.6} />
      <Wheel cx={84} r={7.4} />
    </g>
  );
}

function BodaSide() {
  return (
    <g>
      <Ground x1={16} x2={78} />
      {/* rear rack + parcel box — the cargo story */}
      <path d="M22 58 L22 50 L34 50 L34 58 Z" fill={C.ink} />
      <rect x="20.5" y="48.5" width="15" height="2.6" rx="1.3" fill={C.ink} />
      <rect x="24" y="52.5" width="8" height="1.8" rx="0.9" fill={C.surface} opacity={0.25} />
      {/* frame tubes */}
      <path d="M28 69 L44 60 L64 64 L70 69" fill="none" stroke={C.ink} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M28 69 L48 70.5 L64 64" fill="none" stroke={C.ink} strokeWidth="2.2" strokeLinecap="round" />
      {/* engine block */}
      <rect x="42" y="62" width="14" height="9" rx="2.5" fill={C.ink2} />
      <rect x="44.5" y="64.5" width="9" height="4" rx="1" fill={C.ink} />
      {/* seat */}
      <path d="M36 57 Q36 52.5 41 52.5 L52 52.5 Q55 52.5 56 54.5 L56 57 Z" fill={C.brand} />
      {/* fuel tank */}
      <path d="M56 56 Q56 51.5 61 51.5 L67 54 L67 58 L56 58 Z" fill={C.brandDeep} opacity={0.9} />
      {/* front fork + handlebar */}
      <path d="M70 69 L66 48" stroke={C.ink} strokeWidth="2.6" strokeLinecap="round" />
      <path d="M66 48 L61 44 M66 48 L72 43" stroke={C.ink} strokeWidth="2.2" strokeLinecap="round" />
      {/* mirror + headlight */}
      <circle cx="60" cy="43" r="1.3" fill={C.ink2} />
      <Headlight x={71.5} y={46.5} />
      {/* exhaust */}
      <path d="M44 71 L60 71" stroke={C.ink3} strokeWidth="2" strokeLinecap="round" />
      <Wheel cx={28} r={7} />
      <Wheel cx={70} r={7} />
    </g>
  );
}

const SIDE: Record<string, () => React.ReactElement> = {
  boda: BodaSide,
  tuktuk: TuktukSide,
  van: VanSide,
  pickup: PickupSide,
  canter: CanterSide,
  lorry_7t: Lorry7tSide,
  lorry_10t: Lorry10tSide,
};

// ── top views (map markers) ─────────────────────────────────────────────────

const TOP: Record<string, { body: string; cab: string; size: [number, number]; detail: "open" | "covered" | "tuktuk" }> = {
  boda: { body: "M -1.9 -3.2 L 1.9 -3.2 L 2.4 8 L -2.4 8 Z", cab: "M -3.4 -8.4 L 3.4 -8.4 L 1.9 -3.2 L -1.9 -3.2 Z", size: [14, 22], detail: "open" },
  tuktuk: { body: "M -3 -5 A 5.2 5.2 0 0 1 3 -5 L 3.6 3 A 1.4 1.4 0 0 1 2.2 4.4 L -2.2 4.4 A 1.4 1.4 0 0 1 -3.6 3 Z", cab: "M 0 -3.6 A 2.6 2.6 0 0 1 2.2 -1.6 L -2.2 -1.6 A 2.6 2.6 0 0 1 0 -3.6 Z", size: [22, 22], detail: "tuktuk" },
  van: { body: "M -7 -8 L 3.4 -8 L 3.4 8 L -7 8 Z", cab: "M 3.4 -8 L 7 -8 L 7 8 L 3.4 8 Z", size: [26, 26], detail: "covered" },
  pickup: { body: "M -8.5 -6.5 L 0.8 -6.5 L 0.8 6.5 L -8.5 6.5 Z", cab: "M 0.8 -6.5 L 8 -6.5 L 8 6.5 L 0.8 6.5 Z", size: [28, 24], detail: "open" },
  canter: { body: "M -10 -5.5 L 1.6 -5.5 L 1.6 5.5 L -10 5.5 Z", cab: "M 1.6 -5.5 L 9 -5.5 L 9 5.5 L 1.6 5.5 Z", size: [32, 24], detail: "open" },
  lorry_7t: { body: "M -11 -7 L 1.2 -7 L 1.2 7 L -11 7 Z", cab: "M 1.2 -7 L 9.4 -7 L 9.4 7 L 1.2 7 Z", size: [34, 26], detail: "covered" },
  lorry_10t: { body: "M -12 -8 L 1.2 -8 L 1.2 8 L -12 8 Z", cab: "M 1.2 -8 L 10 -8 L 10 8 L 1.2 8 Z", size: [36, 28], detail: "covered" },
};

function TopView({ category }: { category: string }) {
  const v = TOP[category] ?? TOP.pickup;
  const [w, h] = v.size;
  return (
    <>
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
        ) : category === "boda" ? (
          <>
            <circle cx={0} cy={-7} r={1.4} /><circle cx={0} cy={6.4} r={1.4} />
          </>
        ) : (
          <>
            <rect x={-8.5} y={-8} width={3} height={2.2} rx={1} /><rect x={-8.5} y={5.8} width={3} height={2.2} rx={1} />
            <rect x={5} y={-8} width={3} height={2.2} rx={1} /><rect x={5} y={5.8} width={3} height={2.2} rx={1} />
          </>
        )}
      </g>
    </>
  );
}

// ── component ───────────────────────────────────────────────────────────────

export default function VehicleAvatar({
  category,
  size = 44,
  view = "side",
  className = "",
}: {
  category: string;
  size?: number;
  view?: "side" | "top";
  className?: string;
}) {
  if (view === "top") {
    const v = TOP[category] ?? TOP.pickup;
    const [w, h] = v.size;
    return (
      <svg
        viewBox={`${-w / 2 - 2} ${-h / 2 - 2} ${w + 4} ${h + 4}`}
        width={size} height={size}
        className={className}
        role="img"
        aria-label={`${category} vehicle`}
      >
        <TopView category={category} />
      </svg>
    );
  }
  const Art = SIDE[category] ?? SIDE.pickup;
  return (
    <svg
      viewBox="0 0 96 96"
      width={size} height={size}
      className={className}
      role="img"
      aria-label={`${category} vehicle`}
    >
      <Art />
    </svg>
  );
}

// ── premium top-view plate icons (Uber-style) ───────────────────────────────
// VehicleTopIcon: dark rounded-square plate + white top-down silhouette, for
// live-map driver markers (the silhouette points "up"/north; the marker host
// rotates it by heading). Readable at 28–40 px, one visual family, ink tints
// for glass/rails — no gradients, no ids (safe to instance many times).

const PLATE = { x: 2, y: 2, w: 44, h: 44, rx: 10 };

function Plate() {
  return (
    <>
      <rect x={PLATE.x} y={PLATE.y} width={PLATE.w} height={PLATE.h} rx={PLATE.rx} fill={C.ink} />
      {/* top edge sheen + bottom inner shade keep the plate from reading flat */}
      <path
        d={`M${PLATE.x + PLATE.rx} ${PLATE.y + 0.75} H${PLATE.x + PLATE.w - PLATE.rx}`}
        stroke={C.surface} strokeOpacity={0.14} strokeWidth={1.4} strokeLinecap="round"
      />
      <path
        d={`M${PLATE.x + PLATE.rx} ${PLATE.y + PLATE.h - 0.75} H${PLATE.x + PLATE.w - PLATE.rx}`}
        stroke="#000000" strokeOpacity={0.28} strokeWidth={1.4} strokeLinecap="round"
      />
    </>
  );
}

const glass = { stroke: C.ink, strokeOpacity: 0.2, strokeWidth: 1.3, fill: "none", strokeLinecap: "round" as const };
const WheelStub = ({ x, y, w = 3, h = 5.5 }: { x: number; y: number; w?: number; h?: number }) => (
  <rect x={x} y={y} width={w} height={h} rx={w / 2} fill={C.surface} />
);

function TuktukTopPlate() {
  return (
    <g>
      {/* nose wheel */}
      <WheelStub x={22.5} y={7.5} w={3} h={4.5} />
      {/* teardrop canopy */}
      <path
        d="M24 9.5 C20.4 9.5 18.9 12 17.9 15.2 L16.3 21.5 C15.8 24.2 16.9 26.5 18.6 26.5 H29.4 C31.1 26.5 32.2 24.2 31.7 21.5 L30.1 15.2 C29.1 12 27.6 9.5 24 9.5 Z"
        fill={C.surface}
      />
      <path d="M20.6 13.6 C21.4 12 22.6 11.2 24 11.2 C25.4 11.2 26.6 12 27.4 13.6" {...glass} />
      <path d="M18.9 20 H29.1" {...glass} />
      {/* rear cargo box */}
      <rect x={17.6} y={30} width={12.8} height={9.4} rx={2.2} fill={C.surface} />
      <path d="M24 30.8 V38.6" {...glass} />
      <WheelStub x={14.6} y={31.4} w={2.6} h={5} />
      <WheelStub x={30.8} y={31.4} w={2.6} h={5} />
    </g>
  );
}

function PickupTopPlate() {
  return (
    <g>
      {/* cab */}
      <rect x={15.2} y={8.8} width={17.6} height={13} rx={4} fill={C.surface} />
      <path d="M18.6 13 H29.4" {...glass} />
      <WheelStub x={12.2} y={13.2} />
      <WheelStub x={32.8} y={13.2} />
      {/* mirrors */}
      <WheelStub x={11.4} y={12} w={2.2} h={2.2} />
      <WheelStub x={34.4} y={12} w={2.2} h={2.2} />
      {/* open bed with rails + strapped boxes */}
      <rect x={12.6} y={23.2} width={22.8} height={15} rx={2.4} fill={C.surface} />
      <path d="M15 25.6 H33" {...glass} />
      <rect x={16.2} y={27.6} width={8.2} height={8.2} rx={1.4} fill={C.ink} fillOpacity={0.12} />
      <rect x={26.2} y={29.2} width={6.6} height={6.2} rx={1.2} fill={C.ink} fillOpacity={0.09} />
      <path d="M20.3 27.6 V35.8" stroke={C.brand} strokeOpacity={0.75} strokeWidth={1.1} strokeLinecap="round" />
      <WheelStub x={12.2} y={27.8} />
      <WheelStub x={32.8} y={27.8} />
    </g>
  );
}

function VanTopPlate() {
  return (
    <g>
      <rect x={13.6} y={8} width={20.8} height={32} rx={5.4} fill={C.surface} />
      <path d="M17.2 12.6 C17.2 10.9 18.4 9.9 19.9 9.9 H28.1 C29.6 9.9 30.8 10.9 30.8 12.6" {...glass} />
      {/* roof rack (matatu energy) */}
      <path d="M15.8 21.6 H32.2 M15.8 25 H32.2" {...glass} />
      <path d="M18.4 18.6 V28 M29.6 18.6 V28" {...glass} />
      <WheelStub x={10.4} y={13.6} />
      <WheelStub x={34.4} y={13.6} />
      <WheelStub x={10.4} y={28.6} />
      <WheelStub x={34.4} y={28.6} />
    </g>
  );
}

function CanterTopPlate() {
  return (
    <g>
      {/* cab + exhaust stack */}
      <rect x={16.2} y={8.4} width={16.6} height={12} rx={3.4} fill={C.surface} />
      <path d="M19.6 12.8 H29.4" {...glass} />
      <WheelStub x={35.6} y={13.6} w={2.4} h={4} />
      {/* stake-bed flatbed */}
      <rect x={10.4} y={22} width={27.2} height={16.6} rx={2.2} fill={C.surface} />
      <rect x={12.6} y={24.2} width={22.8} height={12.2} rx={1.4} fill="none" stroke={C.ink} strokeOpacity={0.22} strokeWidth={1.1} strokeDasharray="3 2.2" />
      <rect x={15.4} y={26.6} width={8.6} height={7.4} rx={1.2} fill={C.ink} fillOpacity={0.12} />
      <rect x={25.8} y={28.2} width={6.8} height={5.4} rx={1} fill={C.ink} fillOpacity={0.09} />
      <WheelStub x={7.4} y={12.6} />
      <WheelStub x={35.6} y={12.6} />
      <WheelStub x={7.4} y={28.4} />
      <WheelStub x={37.6} y={28.4} />
    </g>
  );
}

function Lorry7tTopPlate() {
  return (
    <g>
      {/* cab with deflector */}
      <rect x={17.2} y={7.4} width={15.4} height={11} rx={3} fill={C.surface} />
      <path d="M20.4 11.6 H29.4" {...glass} />
      {/* canvas tilt body — lengthwise ribs */}
      <rect x={10.2} y={20} width={27.6} height={20.4} rx={2.4} fill={C.surface} />
      <path d="M13 24.2 H35 M13 28.6 H35 M13 33 H35 M13 37.2 H35" stroke={C.ink} strokeOpacity={0.15} strokeWidth={1.1} strokeLinecap="round" />
      <path d="M10.2 26.4 V34" {...glass} />
      <WheelStub x={13.8} y={10.6} w={2.8} h={5} />
      <WheelStub x={33.4} y={10.6} w={2.8} h={5} />
      <WheelStub x={7} y={27.2} w={2.8} h={6} />
      <WheelStub x={7} y={34} w={2.8} h={6} />
      <WheelStub x={38.2} y={27.2} w={2.8} h={6} />
      <WheelStub x={38.2} y={34} w={2.8} h={6} />
    </g>
  );
}

function Lorry10tTopPlate() {
  return (
    <g>
      {/* big cab-over */}
      <rect x={18.2} y={7} width={14.6} height={10.6} rx={3} fill={C.surface} />
      <path d="M21.2 11.2 H29.8" {...glass} />
      {/* container body — cross-corrugation */}
      <rect x={9} y={19.6} width={30} height={21.4} rx={2} fill={C.surface} />
      <path d="M14 22.4 V38.2 M18.6 22.4 V38.2 M23.2 22.4 V38.2 M27.8 22.4 V38.2 M32.4 22.4 V38.2" stroke={C.ink} strokeOpacity={0.13} strokeWidth={1.1} strokeLinecap="round" />
      <path d="M9 26.6 H39" {...glass} />
      <WheelStub x={14.8} y={10.4} w={2.8} h={5} />
      <WheelStub x={33.4} y={10.4} w={2.8} h={5} />
      <WheelStub x={5.8} y={28.6} w={2.8} h={6} />
      <WheelStub x={5.8} y={35.4} w={2.8} h={6} />
      <WheelStub x={39.4} y={28.6} w={2.8} h={6} />
      <WheelStub x={39.4} y={35.4} w={2.8} h={6} />
    </g>
  );
}

function BodaTopPlate() {
  return (
    <g>
      {/* handlebar + mirrors */}
      <rect x="17.8" y="11.6" width="12.4" height="2.2" rx="1.1" fill={C.surface} />
      <path d="M17 13.8 C19.6 11.2 28.4 11.2 31 13.8" {...glass} />
      {/* frame spine */}
      <rect x="21.6" y="13.8" width="4.8" height="16.6" rx="2.2" fill={C.surface} />
      {/* seat */}
      <rect x="19.8" y="16.6" width="8.4" height="5.2" rx="2.3" fill={C.surface} />
      {/* parcel box on the rear rack */}
      <rect x="19.6" y="26.4" width="8.8" height="8" rx="1.6" fill={C.surface} />
      <rect x="21.6" y="28.4" width="4.8" height="4" rx="0.9" fill={C.ink} fillOpacity={0.12} />
      <WheelStub x={22.3} y={8.8} w={3.4} h={3} />
      <WheelStub x={22.3} y={35.6} w={3.4} h={4.8} />
    </g>
  );
}

const PLATE_ART: Record<string, () => React.ReactElement> = {
  boda: BodaTopPlate,
  tuktuk: TuktukTopPlate,
  van: VanTopPlate,
  pickup: PickupTopPlate,
  canter: CanterTopPlate,
  lorry_7t: Lorry7tTopPlate,
  lorry_10t: Lorry10tTopPlate,
};

/**
 * Uber-style top-view vehicle icon: dark rounded plate + white silhouette.
 * Points north; the caller rotates by heading. Used by LiveMap driver markers.
 */
export function VehicleTopIcon({
  categoryKey,
  size = 32,
  className = "",
}: {
  categoryKey: string;
  size?: number;
  className?: string;
}) {
  const Art = PLATE_ART[categoryKey] ?? PLATE_ART.pickup;
  return (
    <span
      className={`inline-block ${className}`}
      style={{ width: size, height: size, filter: "drop-shadow(0 2px 3px rgba(23,24,28,0.35))" }}
      role="img"
      aria-label={`${categoryKey} vehicle`}
    >
      <svg viewBox="0 0 48 48" width={size} height={size} className="block">
        <Plate />
        <Art />
      </svg>
    </span>
  );
}
