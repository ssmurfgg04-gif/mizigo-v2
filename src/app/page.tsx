"use client";
// MIZIGO — single-route shell. Surfaces switch client-side (?role=customer|driver|admin,
// ?view=track&token=…). Customer/driver are presented in a phone frame on desktop.

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Building2, Smartphone, Truck, ArrowRight, Wifi, WifiOff } from "lucide-react";
import { useSession } from "@/store/session";
import Providers from "./providers";
import CustomerApp from "@/components/mizigo/customer/CustomerApp";
import DriverApp from "@/components/mizigo/driver/DriverApp";
import AdminApp from "@/components/mizigo/admin/AdminApp";
import TrackView from "@/components/mizigo/customer/TrackView";
import { Logo } from "@/components/mizigo/shared/ui";

export default function Page() {
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
      {/* phone frame for mobile surfaces on desktop */}
      {!isAdmin && !isTrack ? (
        <div className="mx-auto flex min-h-[100dvh] max-w-[1200px] items-center justify-center gap-16 px-4 py-6 lg:px-8">
          {/* ambient context (desktop only) */}
          <aside className="hidden max-w-sm flex-1 lg:block">
            <div className="text-white">
              <Logo size="lg" tone="light" />
              <h2 className="mt-5 text-[34px] font-extrabold leading-[1.05] tracking-[-0.03em]">
                Move anything.<br />Anywhere in Nairobi.
              </h2>
              <p className="mt-4 max-w-[42ch] text-[14px] font-medium leading-relaxed text-white/55">
                Cargo-first booking, price locked before you commit, a driver you can verify,
                live tracking and proof of delivery. Tuk-tuks to 10-tonne lorries, one network.
              </p>
              <div className="mt-7 space-y-3.5">
                {[
                  "Tell us what you're moving, we pick the vehicle",
                  "M-PESA built in, receipts and invoices",
                  "Recipients track without an account",
                ].map((t) => (
                  <p key={t} className="flex items-center gap-3 text-[13.5px] font-semibold text-white/75">
                    <span className="h-1.5 w-1.5 rounded-full bg-[var(--brand)]" /> {t}
                  </p>
                ))}
              </div>
              <p className="mt-10 text-[11.5px] font-semibold uppercase tracking-widest text-white/35">
                Sandbox demo · mock payments, simulated GPS
              </p>
            </div>
          </aside>

          {/* device */}
          <div className="relative w-full max-w-[405px]">
            <div className="overflow-hidden rounded-[44px] bg-[var(--night)] p-[10px] shadow-[0_40px_120px_rgba(0,0,0,0.5)]">
              <div className="relative h-[82dvh] max-h-[850px] min-h-[620px] overflow-hidden rounded-[36px] bg-[var(--paper)]">
                {/* status notch */}
                <div className="pointer-events-none absolute left-1/2 top-2 z-50 h-6 w-32 -translate-x-1/2 rounded-full bg-[var(--night)]" />
                <div className="h-full overflow-hidden">{body}</div>
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
          <WifiOff size={14} /> No connection · showing cached delivery · will sync automatically
        </div>
      )}
      {online && surface === "customer" && null /* Wifi icon reserved */}
    </div>
    </Providers>
  );
}

function Welcome() {
  const { setSurface } = useSession();
  return (
    <div className="relative flex h-full flex-col overflow-hidden bg-[var(--paper)]">
      {/* hero */}
      <div className="relative flex flex-1 flex-col justify-center px-8 pb-6">
        <div className="animate-mz-fade-in">
          <Logo size="lg" />
          <h1 className="mt-5 text-[32px] font-extrabold leading-[1.08] tracking-[-0.03em]">
            Moving<br />something?
          </h1>
          <p className="mt-3 max-w-[30ch] text-[14px] font-medium leading-relaxed text-[var(--ink-2)]">
            Book the right vehicle and track your delivery from pickup to drop-off.
          </p>
        </div>

        {/* decorative mini-map */}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-40 opacity-60">
          <svg viewBox="0 0 400 160" className="h-full w-full" aria-hidden="true">
            <g stroke="#17181C" strokeOpacity="0.12" strokeWidth="4" fill="none" strokeLinecap="round">
              <path d="M-20 100 C 90 80, 200 130, 420 60" />
              <path d="M60 -20 C 80 60, 40 120, 120 180" />
              <path d="M180 -20 C 200 50, 260 90, 240 180" />
            </g>
            <path d="M40 130 C 120 100, 220 120, 330 40" fill="none" stroke="#E8590C" strokeWidth="4" strokeDasharray="1 14" strokeLinecap="round" className="animate-mz-dash" />
            <circle cx="40" cy="130" r="8" fill="#15803D" />
            <g transform="translate(330 40)">
              <rect x="-11" y="-11" width="22" height="22" rx="7" fill="#17181C" />
              <path d="M-4.5 2 L-4.5 -2 L-2 -5 L2.5 -5 L4.5 -2 L4.5 2 Z" fill="none" stroke="#FFFFFF" strokeWidth="1.8" strokeLinejoin="round" />
            </g>
          </svg>
        </div>
      </div>

      {/* role cards */}
      <div className="animate-mz-slide-up space-y-2.5 rounded-t-[22px] bg-[var(--surface)] px-6 pb-8 pt-5 sheet-shadow">
        <button
          onClick={() => setSurface("customer")}
          className="flex w-full items-center gap-4 rounded-[14px] border-2 border-[var(--ink)] bg-[var(--surface)] p-4 text-left transition hover:bg-[var(--surface-2)] active:translate-y-px"
        >
          <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-[var(--ink)] text-white"><Smartphone size={20} /></span>
          <span className="flex-1">
            <span className="block text-[16px] font-extrabold tracking-tight">Get started</span>
            <span className="block text-[12.5px] font-medium text-[var(--ink-2)]">Move cargo as a customer</span>
          </span>
          <ArrowRight size={18} className="text-[var(--ink-3)]" />
        </button>

        <button
          onClick={() => setSurface("driver")}
          className="flex w-full items-center gap-4 rounded-[14px] border-2 border-[var(--line)] bg-[var(--surface)] p-4 text-left transition hover:border-[var(--ink-3)] active:translate-y-px"
        >
          <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-[var(--brand-deep)] text-white"><Truck size={20} /></span>
          <span className="flex-1">
            <span className="block text-[16px] font-extrabold tracking-tight">Drive &amp; earn</span>
            <span className="block text-[12.5px] font-medium text-[var(--ink-2)]">Accept loads near you</span>
          </span>
          <ArrowRight size={18} className="text-[var(--ink-3)]" />
        </button>

        <button
          onClick={() => setSurface("admin")}
          className="flex w-full items-center gap-4 rounded-[14px] border-2 border-[var(--line)] bg-[var(--surface)] p-4 text-left transition hover:border-[var(--ink-3)] active:translate-y-px"
        >
          <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-[var(--surface-2)] text-[var(--ink)]"><Building2 size={20} /></span>
          <span className="flex-1">
            <span className="block text-[16px] font-extrabold tracking-tight">Operations console</span>
            <span className="block text-[12.5px] font-medium text-[var(--ink-2)]">Admin · live network, pricing, disputes</span>
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
