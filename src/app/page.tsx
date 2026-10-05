"use client";
// MIZIGO — single-route shell. Surfaces switch client-side (?role=customer|driver|admin,
// ?view=track&token=…).
// Layout: mobile = full-bleed edge-to-edge app; lg+ = cinematic hero field with
// ambient copy + device frame. Welcome (login) is a dark cinematic HUD over
// Nairobi freight-yard photography (Terminal-industries inspired, webp ~60KB).

import { Suspense, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import dynamic from "next/dynamic";
import { useSearchParams } from "next/navigation";
import { Building2, Smartphone, Truck, ArrowRight, Wifi, WifiOff } from "lucide-react";
import { useSession } from "@/store/session";
import Providers from "./providers";
import { Logo } from "@/components/mizigo/shared/ui";
import { api } from "@/lib/api-client";
import { toast } from "@/hooks/use-toast";

// per-surface code splitting: a customer visitor never downloads the driver/admin bundles
const CustomerApp = dynamic(() => import("@/components/mizigo/customer/CustomerApp"), { ssr: false });
const DriverApp = dynamic(() => import("@/components/mizigo/driver/DriverApp"), { ssr: false });
const AdminApp = dynamic(() => import("@/components/mizigo/admin/AdminApp"), { ssr: false });
const TrackView = dynamic(() => import("@/components/mizigo/customer/TrackView"), {
  ssr: false,
  loading: () => <div className="min-h-[100dvh] bg-[var(--paper)]" />,
});

export default function Page() {
  // useSearchParams needs a Suspense boundary for static prerender
  return (
    <Suspense fallback={<div className="min-h-[100dvh] bg-[var(--night)]" />}>
      <PageContent />
    </Suspense>
  );
}

/** cinematic photo field + scrim + HUD grid + scanline */
function HeroField({ picture, className = "" }: { picture: React.ReactNode; className?: string }) {
  return (
    <div className={`absolute inset-0 overflow-hidden ${className}`} aria-hidden="true">
      <div className="absolute inset-0 animate-mz-kenburns will-change-transform">{picture}</div>
      {/* scrims: darken top for chrome, bottom for sheet, left for desktop copy */}
      <div className="absolute inset-0 bg-[linear-gradient(to_bottom,rgba(11,12,14,0.82),rgba(11,12,14,0.18)_38%,rgba(11,12,14,0.06)_58%,rgba(11,12,14,0.78))]" />
      <div className="absolute inset-0 hidden bg-[linear-gradient(to_right,rgba(11,12,14,0.7),rgba(11,12,14,0.12)_52%,rgba(11,12,14,0.3))] lg:block" />
      <div className="mz-telemetry-grid absolute inset-0" />
      {/* slow telemetry scanline sweep */}
      <div className="absolute inset-x-0 top-0 h-[38%] animate-mz-scan bg-[linear-gradient(to_bottom,transparent,rgba(255,255,255,0.055),transparent)]" />
    </div>
  );
}

/** keyboard/AT users who prefer reduced motion shouldn't get SMIL animations */
const REDUCE_MQ = "(prefers-reduced-motion: reduce)";
function subscribeReduce(cb: () => void) {
  const mq = window.matchMedia(REDUCE_MQ);
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
}
function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(subscribeReduce, () => window.matchMedia(REDUCE_MQ).matches, () => false);
}

function PageContent() {
  const params = useSearchParams();
  const { surface, setSurface, setTrackToken } = useSession();
  const [online, setOnline] = useState(true);

  // deep links: ?role=… and ?view=track&token=…
  useEffect(() => {
    const role = params.get("role");
    const view = params.get("view");
    const token = params.get("token");
    if (view === "track" && token) {
      setTrackToken(token);
    } else if (role === "customer" || role === "driver" || role === "admin") {
      setSurface(role);
    }
  }, [params, setSurface, setTrackToken]);

  // connectivity banner
  useEffect(() => {
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener("online", up);
    window.addEventListener("offline", down);
    const initial = window.setTimeout(() => setOnline(navigator.onLine), 0);
    return () => {
      window.removeEventListener("online", up);
      window.removeEventListener("offline", down);
      window.clearTimeout(initial);
    };
  }, []);

  // session expiry mid-use → clean logout back to the welcome screen
  useEffect(() => {
    const onExpired = () => {
      const st = useSession.getState();
      if (st.surface !== "welcome" && st.surface !== "track") {
        st.logout();
        toast({ title: "Session expired", description: "Please sign in again." });
      }
    };
    window.addEventListener("mizigo:session-expired", onExpired);
    return () => window.removeEventListener("mizigo:session-expired", onExpired);
  }, []);

  // session restore: remembered client state must match a live server session
  useEffect(() => {
    if (surface !== "customer" && surface !== "driver" && surface !== "admin") return;
    let cancelled = false;
    api<{ user: unknown }>("/api/auth?action=me")
      .then((r) => {
        if (cancelled) return;
        const st = useSession.getState();
        if (!r.user && st.user) st.logout(); // remembered but signed out server-side
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [surface]);

  const body = useMemo(() => {
    if (surface === "track") return <TrackView />;
    if (surface === "admin") return <AdminApp />;
    if (surface === "driver") return <DriverApp />;
    if (surface === "customer") return <CustomerApp />;
    return <Welcome />;
  }, [surface]);

  const isAdmin = surface === "admin";
  const isTrack = surface === "track";

  return (
    <Providers>
    <div className={`min-h-[100dvh] ${isAdmin ? "bg-[var(--surface)]" : "bg-[var(--night)]"}`}>
      {/* mobile app: full-bleed · desktop: hero field + device frame */}
      {!isAdmin && !isTrack ? (
        <div className="relative min-h-[100dvh] overflow-hidden bg-[var(--night)]">
          {/* cinematic freight-yard field (desktop only — the phone paints its own) */}
          <HeroField
            className="hidden lg:block"
            picture={
              <img src="/hero-desktop.webp" alt="" className="h-full w-full object-cover" loading="eager" fetchPriority="high" />
            }
          />

          <div className="relative z-10 mx-auto flex min-h-[100dvh] max-w-[1200px] items-center justify-center gap-16 lg:px-8 lg:py-6">
            {/* ambient context (desktop only) */}
            <aside className="hidden max-w-sm flex-1 lg:block">
              <div className="text-white">
                <Logo size="lg" tone="light" />
                <p className="mt-6 flex items-center gap-2 font-mono text-[10.5px] font-medium uppercase tracking-[0.18em] text-white/45">
                  <span className="relative flex h-1.5 w-1.5">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#4ADE80] opacity-60" />
                    <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-[#4ADE80]" />
                  </span>
                  NBO · −1.2864°, 36.8172° · network live
                </p>
                <h2 className="mt-4 text-[34px] font-extrabold leading-[1.05] tracking-[-0.03em]">
                  Move anything.<br />Anywhere in Nairobi.
                </h2>
                <p className="mt-4 max-w-[42ch] text-[14px] font-medium leading-relaxed text-white/55">
                  Cargo-first booking, price locked before you commit, a driver you can verify,
                  live tracking and proof of delivery. Tuk-tuks to 10-tonne lorries, one network.
                </p>
                {/* v1 trust architecture: the four promises as numbered truths */}
                <div className="mt-7 grid gap-2.5">
                  {[
                    ["01", "Know the price", "Fare locked before you commit — no haggling, no surprises."],
                    ["02", "Know the driver", "Verified operators, documents on file, network-rated."],
                    ["03", "Know the delivery", "Live tracking and proof of delivery, every trip."],
                    ["04", "Covered in transit", "Goods-in-transit cover on every booked delivery."],
                  ].map(([n, title, body]) => (
                    <div key={n} className="flex items-start gap-3">
                      <span className="mt-0.5 font-mono text-[10px] font-bold tracking-[0.14em] text-white/30">{n}</span>
                      <div>
                        <p className="text-[13.5px] font-extrabold tracking-tight text-white/85">{title}</p>
                        <p className="text-[11.5px] font-medium leading-snug text-white/45">{body}</p>
                      </div>
                    </div>
                  ))}
                </div>
                <p className="mt-8 text-[11.5px] font-semibold uppercase tracking-widest text-white/35">
                  Sandbox demo · mock payments, simulated GPS
                </p>
                <p className="mt-1.5 text-[11px] font-semibold uppercase tracking-[0.18em] text-white/25">
                  Built for Kenya · Architected for East Africa
                </p>
              </div>
            </aside>

            {/* device: edge-to-edge on phones, framed above lg */}
            <div className="relative w-full lg:w-auto lg:max-w-[405px]">
              <div className="h-[100dvh] overflow-hidden bg-[var(--night)] lg:rounded-[44px] lg:p-[10px] lg:shadow-[0_40px_120px_rgba(0,0,0,0.55)]">
                <div className="relative h-full overflow-hidden bg-[var(--paper)] lg:h-[max(480px,82dvh)] lg:max-h-[850px] lg:rounded-[36px]">
                  {/* status notch (device frame only) */}
                  <div className="pointer-events-none absolute left-1/2 top-2 z-50 hidden h-6 w-32 -translate-x-1/2 rounded-full bg-[var(--night)] lg:block" />
                  <div className="h-full overflow-hidden">{body}</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="h-[100dvh] overflow-hidden">{body}</div>
      )}

      {/* offline banner */}
      {!online && (
        <div className="fixed inset-x-0 top-0 z-[100] flex items-center justify-center gap-2 bg-[var(--warn)] px-4 py-2.5 text-[12.5px] font-bold text-white">
          <WifiOff size={14} /> No connection — check your network and try again
        </div>
      )}
    </div>
    </Providers>
  );
}

/** animated route line: pickup → dropoff with a moving vehicle dot (SMIL) */
function RouteHud({ still = false }: { still?: boolean }) {
  const route = "M44 118 C 118 84, 206 130, 322 46";
  return (
    <svg viewBox="0 0 400 150" className="h-auto w-full" aria-hidden="true">
      {/* faint corridor roads */}
      <g stroke="#FFFFFF" strokeOpacity="0.09" strokeWidth="4" fill="none" strokeLinecap="round">
        <path d="M-20 96 C 90 76, 200 126, 420 56" />
        <path d="M70 -10 C 90 60, 50 110, 130 160" />
        <path d="M190 -10 C 210 50, 270 90, 250 160" />
      </g>
      {/* the delivery route */}
      <path d={route} fill="none" stroke="#FFFFFF" strokeOpacity="0.16" strokeWidth="3.5" strokeLinecap="round" />
      <path
        d={route} fill="none" stroke="#E8590C" strokeWidth="3.5" strokeLinecap="round"
        strokeDasharray="2 13" className="animate-mz-dash"
      />
      {/* vehicle in motion along the route */}
      <g>
        <circle r="7" fill="#E8590C" opacity="0.18" cx={still ? 183 : undefined} cy={still ? 82 : undefined}>
          {still ? null : <animateMotion dur="7s" repeatCount="indefinite" path={route} />}
        </circle>
        <circle r="3.4" fill="#E8590C" stroke="#FFFFFF" strokeWidth="1.4" cx={still ? 183 : undefined} cy={still ? 82 : undefined}>
          {still ? null : <animateMotion dur="7s" repeatCount="indefinite" path={route} />}
        </circle>
      </g>
      {/* origin */}
      <circle cx="44" cy="118" r="9" fill="#15803D" opacity="0.22" />
      <circle cx="44" cy="118" r="5" fill="#15803D" stroke="#FFFFFF" strokeWidth="1.6" />
      {/* destination pin */}
      <g transform="translate(322 46)">
        <circle r="13" fill="#E8590C" opacity="0.16" className="animate-mz-pulse" />
        <path
          d="M0 9 C -7 0, -8 -4, -8 -7 A 8 8 0 1 1 8 -7 C 8 -4, 7 0, 0 9 Z"
          fill="#E8590C" stroke="#FFFFFF" strokeWidth="1.7"
        />
        <circle cy="-7" r="3" fill="#FFFFFF" />
      </g>
    </svg>
  );
}

function Welcome() {
  const { setSurface } = useSession();
  const reduceMotion = usePrefersReducedMotion();
  return (
    <div className="relative flex h-full flex-col overflow-hidden bg-[var(--night)]">
      {/* cinematic field: freight yard at night, HUD telemetry */}
      <HeroField
        picture={
          <img src="/hero-mobile.webp" alt="" className="h-full w-full object-cover" loading="eager" fetchPriority="high" />
        }
      />

      {/* hero content (scrolls if the viewport is short — sheet always visible) */}
      <div className="no-scrollbar relative z-10 min-h-0 flex-1 overflow-y-auto px-7 pb-3 pt-safe lg:pt-14">
        <div className="flex h-full flex-col animate-mz-fade-in">
          <div className="flex items-center justify-between">
            <Logo size="lg" tone="light" />
            <span className="rounded-full border border-white/15 bg-white/5 px-2.5 py-1 font-mono text-[9.5px] font-medium uppercase tracking-[0.16em] text-white/50 backdrop-blur-sm">
              Sandbox demo
            </span>
          </div>

          <p className="mz-hero-gap mt-10 flex items-center gap-2 font-mono text-[10.5px] font-medium uppercase tracking-[0.14em] text-white/45">
            <span className="relative flex h-1.5 w-1.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#4ADE80] opacity-60" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-[#4ADE80]" />
            </span>
            NBO · −1.29°, 36.82° · network live
          </p>

          <h1 className="mt-3 text-[33px] font-extrabold leading-[1.06] tracking-[-0.03em] text-white">
            Moving<br />something?
          </h1>
          <p className="mt-3 max-w-[30ch] text-[14px] font-medium leading-relaxed text-white/60">
            Book the right vehicle and track your delivery from pickup to drop-off.
          </p>

          {/* route telemetry (decorative — hidden on short viewports) */}
          <div className="mz-hide-short mt-auto pt-6">
            <RouteHud still={reduceMotion} />
            <div className="mt-1 flex flex-wrap gap-1.5">
              {["6 vehicle classes", "Live tracking + POD", "M-PESA built in"].map((t, i) => (
                <span
                  key={t}
                  className="animate-mz-chip-in rounded-full border border-white/12 bg-white/[0.07] px-2.5 py-1 font-mono text-[9.5px] font-medium uppercase tracking-[0.14em] text-white/60 backdrop-blur-sm"
                  style={{ animationDelay: `${0.25 + i * 0.12}s` }}
                >
                  {t}
                </span>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* role cards */}
      <div className="relative z-10 animate-mz-slide-up space-y-2.5 rounded-t-[22px] bg-[var(--surface)] px-6 pb-safe pt-5 sheet-shadow">
        <button
          onClick={() => setSurface("customer")}
          className="flex w-full items-center gap-3.5 rounded-[14px] border-2 border-[var(--ink)] bg-[var(--surface)] p-3.5 text-left transition hover:bg-[var(--surface-2)] active:translate-y-px"
        >
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[var(--ink)] text-white"><Smartphone size={19} /></span>
          <span className="flex-1">
            <span className="block text-[16px] font-extrabold tracking-tight">Get started</span>
            <span className="block text-[12.5px] font-medium text-[var(--ink-2)]">Move cargo as a customer</span>
          </span>
          <ArrowRight size={18} className="text-[var(--ink-3)]" />
        </button>

        <button
          onClick={() => setSurface("driver")}
          className="flex w-full items-center gap-3.5 rounded-[14px] border-2 border-[var(--line)] bg-[var(--surface)] p-3.5 text-left transition hover:border-[var(--ink-3)] active:translate-y-px"
        >
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[var(--brand-deep)] text-white"><Truck size={19} /></span>
          <span className="flex-1">
            <span className="block text-[16px] font-extrabold tracking-tight">Drive &amp; earn</span>
            <span className="block text-[12.5px] font-medium text-[var(--ink-2)]">Accept loads near you</span>
          </span>
          <ArrowRight size={18} className="text-[var(--ink-3)]" />
        </button>

        <button
          onClick={() => setSurface("admin")}
          className="flex w-full items-center gap-3.5 rounded-[14px] border-2 border-[var(--line)] bg-[var(--surface)] p-3.5 text-left transition hover:border-[var(--ink-3)] active:translate-y-px"
        >
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[var(--surface-2)] text-[var(--ink)]"><Building2 size={19} /></span>
          <span className="flex-1">
            <span className="block text-[16px] font-extrabold tracking-tight">Operations console</span>
            <span className="block text-[12.5px] font-medium text-[var(--ink-2)]">Admin · network, pricing, disputes</span>
          </span>
          <ArrowRight size={18} className="text-[var(--ink-3)]" />
        </button>

        <p className="pt-1 text-center text-[11px] font-semibold uppercase tracking-widest text-[var(--ink-3)]">
          Nairobi · KES · M-PESA sandbox
        </p>
      </div>
    </div>
  );
}
