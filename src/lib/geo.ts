// MIZIGO — Nairobi geo model, routing + projection behind MapService abstraction.
// This is the MockMapProvider (dev adapter). A production provider would call
// Google/Mapbox/OSM. All coordinates are real-ish Nairobi lat/lng.

export interface LatLng { lat: number; lng: number }
export interface NaiPlace { name: string; area: string; category: string; lat: number; lng: number; popular?: boolean }

// ── Projection (lat/lng → SVG space 800×1000) ───────────────────────────────
export const MAP_BOUNDS = { minLat: -1.352, maxLat: -1.165, minLng: 36.655, maxLng: 36.962 };
export const MAP_W = 800;
export const MAP_H = 1000;

export function project(p: LatLng): { x: number; y: number } {
  const x = ((p.lng - MAP_BOUNDS.minLng) / (MAP_BOUNDS.maxLng - MAP_BOUNDS.minLng)) * MAP_W;
  const y = (1 - (p.lat - MAP_BOUNDS.minLat) / (MAP_BOUNDS.maxLat - MAP_BOUNDS.minLat)) * MAP_H;
  return { x: Math.round(x * 100) / 100, y: Math.round(y * 100) / 100 };
}

export function unproject(x: number, y: number): LatLng {
  const lng = MAP_BOUNDS.minLng + (x / MAP_W) * (MAP_BOUNDS.maxLng - MAP_BOUNDS.minLng);
  const lat = MAP_BOUNDS.minLat + (1 - y / MAP_H) * (MAP_BOUNDS.maxLat - MAP_BOUNDS.minLat);
  return { lat, lng };
}

// ── Haversine distance ──────────────────────────────────────────────────────
export function haversineKm(a: LatLng, b: LatLng): number {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const la1 = (a.lat * Math.PI) / 180, la2 = (b.lat * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// ── Location catalog (Kenyan places, estates, landmarks) ────────────────────
export const PLACES: NaiPlace[] = [
  { name: "CBD · Kenyatta Avenue", area: "Nairobi CBD", category: "landmark", lat: -1.2841, lng: 36.8265, popular: true },
  { name: "Gikomba Market", area: "CBD East", category: "market", lat: -1.2841, lng: 36.8329, popular: true },
  { name: "Wakulima Market", area: "CBD", category: "market", lat: -1.2830, lng: 36.8270 },
  { name: "Muthurwa Market", area: "Muthurwa", category: "market", lat: -1.2870, lng: 36.8400 },
  { name: "Sarit Centre", area: "Westlands", category: "mall", lat: -1.2613, lng: 36.8027, popular: true },
  { name: "ABC Place", area: "Westlands", category: "landmark", lat: -1.2655, lng: 36.7995 },
  { name: "Riverside Drive", area: "Westlands", category: "estate", lat: -1.2670, lng: 36.8010 },
  { name: "Village Market", area: "Gigiri", category: "mall", lat: -1.2211, lng: 36.7964, popular: true },
  { name: "Two Rivers Mall", area: "Limuru Road", category: "mall", lat: -1.1948, lng: 36.7835 },
  { name: "UN Gigiri", area: "Gigiri", category: "landmark", lat: -1.2326, lng: 36.8105 },
  { name: "Runda Estate", area: "Runda", category: "estate", lat: -1.2245, lng: 36.7985 },
  { name: "Muthaiga", area: "Muthaiga", category: "estate", lat: -1.2410, lng: 36.8320 },
  { name: "Parklands 6th Avenue", area: "Parklands", category: "estate", lat: -1.2611, lng: 36.8301 },
  { name: "Ngara Road", area: "Ngara", category: "estate", lat: -1.2690, lng: 36.8330 },
  { name: "Pangani", area: "Pangani", category: "landmark", lat: -1.2660, lng: 36.8390 },
  { name: "Eastleigh First Avenue", area: "Eastleigh", category: "estate", lat: -1.2790, lng: 36.8460, popular: true },
  { name: "Huruma Flats", area: "Huruma", category: "estate", lat: -1.2580, lng: 36.8460 },
  { name: "Mathare North", area: "Mathare", category: "estate", lat: -1.2620, lng: 36.8520 },
  { name: "Dandora Phase 4", area: "Dandora", category: "estate", lat: -1.2580, lng: 36.8910 },
  { name: "Baba Dogo", area: "Ruaraka", category: "estate", lat: -1.2420, lng: 36.8740 },
  { name: "Kasarani Mwiki Road", area: "Kasarani", category: "estate", lat: -1.2295, lng: 36.8780 },
  { name: "Zimmerman Estate", area: "Zimmerman", category: "estate", lat: -1.2230, lng: 36.8800 },
  { name: "Roysambu Stage", area: "Roysambu", category: "landmark", lat: -1.2190, lng: 36.8840 },
  { name: "TRM · Thika Road Mall", area: "Roysambu", category: "mall", lat: -1.2187, lng: 36.8945 },
  { name: "Githurai 44", area: "Kasarani", category: "landmark", lat: -1.2090, lng: 36.8960, popular: true },
  { name: "Garden City Mall", area: "Thika Road", category: "mall", lat: -1.2267, lng: 36.8889 },
  { name: "Kenyatta Hospital", area: "Upper Hill", category: "landmark", lat: -1.3008, lng: 36.8070 },
  { name: "Yaya Centre", area: "Kilimani", category: "mall", lat: -1.2921, lng: 36.7859, popular: true },
  { name: "The Junction Mall", area: "Ngong Road", category: "mall", lat: -1.2932, lng: 36.7748 },
  { name: "Prestige Plaza", area: "Ngong Road", category: "mall", lat: -1.2937, lng: 36.7727 },
  { name: "Kilimani Wood Avenue", area: "Kilimani", category: "estate", lat: -1.2900, lng: 36.7830 },
  { name: "Kileleshwa Laikipia Road", area: "Kileleshwa", category: "estate", lat: -1.2734, lng: 36.7827 },
  { name: "Lavington Mall", area: "Lavington", category: "mall", lat: -1.2738, lng: 36.7687 },
  { name: "Dagoretti Corner", area: "Dagoretti", category: "landmark", lat: -1.2960, lng: 36.7610 },
  { name: "Kawangware Market", area: "Kawangware", category: "estate", lat: -1.2862, lng: 36.7528, popular: true },
  { name: "Satellite Shopping Centre", area: "Satellite", category: "estate", lat: -1.3040, lng: 36.7520 },
  { name: "Uthiru Junction", area: "Uthiru", category: "estate", lat: -1.2700, lng: 36.7350 },
  { name: "Kinoo Centre", area: "Kinoo", category: "estate", lat: -1.2560, lng: 36.7230 },
  { name: "Kikuyu Town", area: "Kiambu", category: "town", lat: -1.1948, lng: 36.6774 },
  { name: "Kangemi Market", area: "Kangemi", category: "estate", lat: -1.2666, lng: 36.7549 },
  { name: "Toi Market", area: "Kibera Drive", category: "market", lat: -1.2970, lng: 36.7790 },
  { name: "Kibera Olympic", area: "Kibera", category: "estate", lat: -1.3130, lng: 36.7820 },
  { name: "T-Mall Langata", area: "Langata", category: "mall", lat: -1.3229, lng: 36.7977 },
  { name: "Carnivore Grounds", area: "Langata", category: "landmark", lat: -1.3300, lng: 36.7900 },
  { name: "Nairobi West Shopping Centre", area: "Nairobi West", category: "estate", lat: -1.3100, lng: 36.8200 },
  { name: "South B Shopping Centre", area: "South B", category: "estate", lat: -1.3100, lng: 36.8350 },
  { name: "South C · Nairobi Dam", area: "South C", category: "estate", lat: -1.3206, lng: 36.8103 },
  { name: "Madaraka Estate", area: "Madaraka", category: "estate", lat: -1.3080, lng: 36.8140 },
  { name: "Nyayo Stadium", area: "Mombasa Road", category: "landmark", lat: -1.3155, lng: 36.8230 },
  { name: "GM Memorial Church", area: "Mombasa Road", category: "landmark", lat: -1.3290, lng: 36.8500 },
  { name: "Capital Centre Mall", area: "Mombasa Road", category: "mall", lat: -1.3060, lng: 36.8580 },
  { name: "Jomo Kenyatta International Airport", area: "Embakasi", category: "airport", lat: -1.3192, lng: 36.9278, popular: true },
  { name: "Syokimau Railway Station", area: "Syokimau", category: "landmark", lat: -1.3350, lng: 36.9050 },
  { name: "Mlolongo Weighbridge", area: "Mlolongo", category: "landmark", lat: -1.3380, lng: 36.9300 },
  { name: "Donholm Phase 5", area: "Donholm", category: "estate", lat: -1.2982, lng: 36.8899, popular: true },
  { name: "Umoja Innercore", area: "Umoja", category: "estate", lat: -1.2936, lng: 36.9012 },
  { name: "Buru Buru Phase 1", area: "Buru Buru", category: "estate", lat: -1.2990, lng: 36.8760 },
  { name: "Makadara Junction", area: "Makadara", category: "landmark", lat: -1.2970, lng: 36.8600 },
  { name: "Jogoo Road · Maringo", area: "Maringo", category: "estate", lat: -1.3020, lng: 36.8650 },
  { name: "Embakasi Village", area: "Embakasi", category: "estate", lat: -1.3160, lng: 36.8700 },
  { name: "ABC Industrial Area Godown 47", area: "Industrial Area", category: "industrial", lat: -1.3080, lng: 36.8330, popular: true },
  { name: "Mombasa Road Godowns", area: "Industrial Area", category: "industrial", lat: -1.3120, lng: 36.8420 },
  { name: "Sameer Business Park", area: "Mombasa Road", category: "industrial", lat: -1.3230, lng: 36.8750 },
  { name: "Baba Dogo Industrial Park", area: "Ruaraka", category: "industrial", lat: -1.2440, lng: 36.8670 },
  { name: "Karen Hardy Shopping Centre", area: "Karen", category: "estate", lat: -1.3197, lng: 36.7076, popular: true },
  { name: "Karen Blixen Museum", area: "Karen", category: "landmark", lat: -1.3180, lng: 36.7420 },
  { name: "Ngong Racecourse", area: "Ngong Road", category: "landmark", lat: -1.3110, lng: 36.7530 },
  { name: "Hurlingham Shopping Centre", area: "Kilimani", category: "estate", lat: -1.2970, lng: 36.7930 },
  { name: "Muthangari Drive", area: "Westlands", category: "estate", lat: -1.2560, lng: 36.7990 },
  { name: "Kasarani Mlolongo Stage", area: "Kasarani", category: "landmark", lat: -1.2300, lng: 36.8720 },
  { name: "Ruaka Town", area: "Kiambu", category: "town", lat: -1.2095, lng: 36.7955, popular: true },
  { name: "Kiamumbi Estate", area: "Kiambu", category: "estate", lat: -1.2030, lng: 36.8060 },
  { name: "Nairobi Terminus · SGR", area: "Syokimau", category: "terminal", lat: -1.3300, lng: 36.9150 },
  { name: "Country Bus Terminal", area: "CBD East", category: "terminal", lat: -1.2850, lng: 36.8350 },
  { name: "Machakos Country Bus", area: "Makadara", category: "terminal", lat: -1.2930, lng: 36.8520 },
];

export function searchPlaces(q: string, limit = 8): NaiPlace[] {
  const s = q.trim().toLowerCase();
  if (!s) return PLACES.filter((p) => p.popular).slice(0, limit);
  const starts: NaiPlace[] = [], contains: NaiPlace[] = [];
  for (const p of PLACES) {
    const hay = `${p.name} ${p.area}`.toLowerCase();
    if (p.name.toLowerCase().startsWith(s)) starts.push(p);
    else if (hay.includes(s)) contains.push(p);
  }
  return [...starts, ...contains].slice(0, limit);
}

// ── Major roads (polylines) for the map base ────────────────────────────────
export interface Road { name: string; pts: LatLng[]; class: "primary" | "secondary" }

export const ROADS: Road[] = [
  { name: "Uhuru Highway", class: "primary", pts: [
    { lat: -1.2895, lng: 36.8120 }, { lat: -1.2930, lng: 36.8130 }, { lat: -1.2990, lng: 36.8160 },
    { lat: -1.3060, lng: 36.8190 }, { lat: -1.3130, lng: 36.8215 }, { lat: -1.3165, lng: 36.8235 }] },
  { name: "Mombasa Road", class: "primary", pts: [
    { lat: -1.3165, lng: 36.8235 }, { lat: -1.3200, lng: 36.8330 }, { lat: -1.3220, lng: 36.8480 },
    { lat: -1.3240, lng: 36.8630 }, { lat: -1.3200, lng: 36.8800 }, { lat: -1.3192, lng: 36.8970 },
    { lat: -1.3300, lng: 36.9150 }, { lat: -1.3380, lng: 36.9330 }] },
  { name: "Thika Road", class: "primary", pts: [
    { lat: -1.2660, lng: 36.8390 }, { lat: -1.2500, lng: 36.8490 }, { lat: -1.2380, lng: 36.8620 },
    { lat: -1.2295, lng: 36.8790 }, { lat: -1.2190, lng: 36.8840 }, { lat: -1.2180, lng: 36.8945 },
    { lat: -1.2090, lng: 36.8960 }, { lat: -1.2000, lng: 36.9080 }] },
  { name: "Waiyaki Way", class: "primary", pts: [
    { lat: -1.2800, lng: 36.8150 }, { lat: -1.2680, lng: 36.8070 }, { lat: -1.2620, lng: 36.8040 },
    { lat: -1.2640, lng: 36.7860 }, { lat: -1.2666, lng: 36.7549 }, { lat: -1.2560, lng: 36.7230 },
    { lat: -1.2220, lng: 36.6900 }, { lat: -1.1948, lng: 36.6774 }] },
  { name: "Ngong Road", class: "primary", pts: [
    { lat: -1.2930, lng: 36.8110 }, { lat: -1.2932, lng: 36.7950 }, { lat: -1.2932, lng: 36.7748 },
    { lat: -1.2960, lng: 36.7610 }, { lat: -1.3090, lng: 36.7530 }, { lat: -1.3180, lng: 36.7350 },
    { lat: -1.3197, lng: 36.7076 }] },
  { name: "Langata Road", class: "secondary", pts: [
    { lat: -1.3160, lng: 36.8210 }, { lat: -1.3229, lng: 36.7977 }, { lat: -1.3320, lng: 36.7860 },
    { lat: -1.3380, lng: 36.7720 }] },
  { name: "Jogoo Road", class: "secondary", pts: [
    { lat: -1.2880, lng: 36.8310 }, { lat: -1.2920, lng: 36.8420 }, { lat: -1.2970, lng: 36.8560 },
    { lat: -1.2990, lng: 36.8730 }, { lat: -1.2980, lng: 36.8850 }] },
  { name: "Outer Ring Road", class: "primary", pts: [
    { lat: -1.2290, lng: 36.8800 }, { lat: -1.2450, lng: 36.8820 }, { lat: -1.2620, lng: 36.8840 },
    { lat: -1.2800, lng: 36.8870 }, { lat: -1.2930, lng: 36.8950 }, { lat: -1.3060, lng: 36.8780 },
    { lat: -1.3180, lng: 36.8690 }, { lat: -1.3240, lng: 36.8630 }] },
  { name: "Limuru Road", class: "secondary", pts: [
    { lat: -1.2600, lng: 36.8060 }, { lat: -1.2420, lng: 36.8000 }, { lat: -1.2211, lng: 36.7964 },
    { lat: -1.2050, lng: 36.7900 }, { lat: -1.1948, lng: 36.7835 }] },
  { name: "Haile Selassie Avenue", class: "secondary", pts: [
    { lat: -1.2841, lng: 36.8220 }, { lat: -1.2860, lng: 36.8320 }, { lat: -1.2870, lng: 36.8400 },
    { lat: -1.2800, lng: 36.8480 }, { lat: -1.2790, lng: 36.8560 }] },
  { name: "Kenyatta Avenue", class: "secondary", pts: [
    { lat: -1.2841, lng: 36.8265 }, { lat: -1.2830, lng: 36.8180 }, { lat: -1.2860, lng: 36.8130 },
    { lat: -1.2895, lng: 36.8120 }] },
  { name: "Juja Road", class: "secondary", pts: [
    { lat: -1.2660, lng: 36.8390 }, { lat: -1.2600, lng: 36.8460 }, { lat: -1.2580, lng: 36.8560 },
    { lat: -1.2560, lng: 36.8750 }, { lat: -1.2580, lng: 36.8910 }] },
  { name: "Eastern Bypass", class: "secondary", pts: [
    { lat: -1.2000, lng: 36.9080 }, { lat: -1.2400, lng: 36.9200 }, { lat: -1.2900, lng: 36.9350 },
    { lat: -1.3300, lng: 36.9250 }] },
  { name: "Southern Bypass", class: "secondary", pts: [
    { lat: -1.3380, lng: 36.7720 }, { lat: -1.3400, lng: 36.8000 }, { lat: -1.3450, lng: 36.8400 },
    { lat: -1.3380, lng: 36.8850 }, { lat: -1.3320, lng: 36.9230 }] },
];

// ── RoutingService (mock): believable polyline between two points ───────────
// Strategy: find the nearest major-road vertex to origin and destination,
// route via road graph if it helps, else smooth direct curve.

function nearestRoadPoint(p: LatLng, maxKm = 3.5): { pt: LatLng; roadIdx: number; vIdx: number } | null {
  let best: { pt: LatLng; roadIdx: number; vIdx: number; d: number } | null = null;
  for (let ri = 0; ri < ROADS.length; ri++) {
    const r = ROADS[ri];
    for (let vi = 0; vi < r.pts.length; vi++) {
      const v = r.pts[vi];
      const d = haversineKm(p, v);
      if (d <= maxKm && (best === null || d < best.d)) best = { pt: v, roadIdx: ri, vIdx: vi, d };
    }
  }
  return best ? { pt: best.pt, roadIdx: best.roadIdx, vIdx: best.vIdx } : null;
}

function roadSegment(a: { roadIdx: number; vIdx: number }, b: { roadIdx: number; vIdx: number }): LatLng[] {
  if (a.roadIdx !== b.roadIdx) return [];
  const r = ROADS[a.roadIdx].pts;
  const [i, j] = a.vIdx < b.vIdx ? [a.vIdx, b.vIdx] : [b.vIdx, a.vIdx];
  const seg = r.slice(i, j + 1);
  return a.vIdx < b.vIdx ? seg : seg.reverse();
}

export function buildRoute(a: LatLng, b: LatLng): LatLng[] {
  const na = nearestRoadPoint(a), nb = nearestRoadPoint(b);
  const path: LatLng[] = [a];
  if (na && nb) {
    const seg = roadSegment(na, nb);
    if (seg.length >= 2 && na.roadIdx === nb.roadIdx) {
      path.push(...(haversineKm(a, na.pt) > 0.15 ? [na.pt, ...seg] : seg));
      if (haversineKm(nb.pt, b) > 0.15) path.push(nb.pt);
      path.push(b);
      return smooth(path);
    }
  }
  if (na && haversineKm(a, na.pt) > 0.15) path.push(na.pt);
  if (nb && haversineKm(b, nb.pt) > 0.15) path.push(nb.pt);
  path.push(b);
  return smooth(path);
}

// Chaikin smoothing for natural-looking routes
function smooth(pts: LatLng[], iterations = 2): LatLng[] {
  let out = pts;
  for (let it = 0; it < iterations; it++) {
    if (out.length < 3) break;
    const next: LatLng[] = [out[0]];
    for (let i = 0; i < out.length - 1; i++) {
      const p = out[i], q = out[i + 1];
      next.push({ lat: p.lat * 0.75 + q.lat * 0.25, lng: p.lng * 0.75 + q.lng * 0.25 });
      next.push({ lat: p.lat * 0.25 + q.lat * 0.75, lng: p.lng * 0.25 + q.lng * 0.75 });
    }
    next.push(out[out.length - 1]);
    out = next;
  }
  return out;
}

export function routeLengthKm(pts: LatLng[]): number {
  let d = 0;
  for (let i = 0; i < pts.length - 1; i++) d += haversineKm(pts[i], pts[i + 1]);
  return d;
}

export function routeDistanceKm(a: LatLng, b: LatLng): number {
  return Math.max(1.5, Math.round(haversineKm(a, b) * 1.32 * 10) / 10); // road factor
}

export function routeDurationMin(distanceKm: number): number {
  return Math.max(8, Math.round(distanceKm / 24 * 60) + 6); // ~24 km/h city average + buffer
}

// position along a polyline at fraction t
export function alongPolyline(pts: LatLng[], t: number): LatLng {
  if (pts.length === 0) return { lat: 0, lng: 0 };
  if (t <= 0) return pts[0];
  if (t >= 1) return pts[pts.length - 1];
  const total = routeLengthKm(pts);
  let target = total * t, acc = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const seg = haversineKm(pts[i], pts[i + 1]);
    if (acc + seg >= target) {
      const f = seg === 0 ? 0 : (target - acc) / seg;
      return { lat: pts[i].lat + (pts[i + 1].lat - pts[i].lat) * f, lng: pts[i].lng + (pts[i + 1].lng - pts[i].lng) * f };
    }
    acc += seg;
  }
  return pts[pts.length - 1];
}

// heading (degrees) at position along route
export function headingAt(pts: LatLng[], t: number): number {
  const a = alongPolyline(pts, Math.max(0, t - 0.01));
  const b = alongPolyline(pts, Math.min(1, t + 0.01));
  const dLat = b.lat - a.lat, dLng = b.lng - a.lng;
  return (Math.atan2(dLng, dLat) * 180) / Math.PI;
}

// speed profile: km/h depending on state
export const SPEED = { toPickup: 26, inTransit: 30 }; // city averages
