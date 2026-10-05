"use client";
// Admin console — desktop-first operations. High density, ops-priority over vanity.

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Activity, BarChart3, Ban, Banknote, Building2, CheckCircle2, FileWarning, LayoutDashboard,
  LifeBuoy, Loader2, Map as MapIcon, Package, Pencil, Plus, Search, Settings, ShieldCheck, Tag, Truck, Users, Wallet, XCircle,
} from "lucide-react";
import { api, post, loginWithOtp } from "@/lib/api-client";
import type { AdminOverview, ShipmentDTO } from "@/lib/types";
import { useSession } from "@/store/session";
import { Button, Row, SectionTitle, StatusBadge, toneForStatus, AvatarInitials } from "@/components/mizigo/shared/ui";
import MapCanvas from "@/components/mizigo/shared/MapCanvas";
import { kes, fmtDateTimeEAT, relTimeEAT, etaText } from "@/lib/format";
import { STATUS_LABEL } from "@/lib/state-machine";
import { toast } from "@/hooks/use-toast";
import type { SessionUser } from "@/store/session";

/** Sandbox operations sign-in — the same mock-OTP handshake as every surface. */
function AdminLogin() {
  const { setUser, setSurface } = useSession();
  const [busy, setBusy] = useState(false);
  const login = async () => {
    setBusy(true);
    try {
      const user = await loginWithOtp<SessionUser>("0733000011");
      if (user.role !== "ADMIN") {
        toast({ title: "That account isn't an operator", variant: "destructive" });
      } else {
        setUser(user);
      }
    } catch (e) {
      toast({ title: "Login failed", description: (e as Error).message, variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex h-full min-h-[100dvh] flex-col items-center justify-center gap-6 bg-[var(--paper)] px-8 text-center">
      <div className="max-w-sm">
        <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-[12px] bg-[var(--ink)] text-white"><Building2 size={20} /></span>
        <h1 className="mt-4 text-[24px] font-extrabold tracking-tight">Operations console</h1>
        <p className="mt-1.5 text-[13.5px] font-medium text-[var(--ink-2)]">The network, pricing, dispatch and disputes — live.</p>
      </div>
      <Button variant="brand" className="w-full max-w-xs" onClick={login} loading={busy}>
        Continue as Ops Control (sandbox)
      </Button>
      <button onClick={() => setSurface("welcome")} className="text-[13px] font-bold text-[var(--ink-3)] underline underline-offset-4">
        Back to role select
      </button>
    </div>
  );
}

const NAV = [
  { key: "overview", label: "Dashboard", icon: LayoutDashboard },
  { key: "live", label: "Live Deliveries", icon: MapIcon },
  { key: "shipments", label: "Bookings", icon: Package },
  { key: "drivers", label: "Drivers", icon: Users },
  { key: "vehicles", label: "Vehicles", icon: Truck },
  { key: "customers", label: "Customers", icon: Users },
  { key: "pricing", label: "Pricing", icon: Banknote },
  { key: "payments", label: "Payments", icon: Banknote },
  { key: "payouts", label: "Payouts", icon: Wallet },
  { key: "disputes", label: "Disputes", icon: FileWarning },
  { key: "support", label: "Support", icon: LifeBuoy },
  { key: "promotions", label: "Promotions", icon: Tag },
  { key: "analytics", label: "Analytics", icon: BarChart3 },
  { key: "settings", label: "Settings", icon: Settings },
  { key: "audit", label: "Audit Log", icon: ShieldCheck },
] as const;

export default function AdminApp() {
  const { adminTab, setAdminTab, setSurface, user } = useSession();

  // ops console is admin-only — sign in with the sandbox operations account
  if (user?.role !== "ADMIN") return <AdminLogin />;

  return (
    <div className="flex h-full min-h-0 bg-[var(--paper)]">
      {/* sidebar */}
      <aside className="flex w-60 shrink-0 flex-col border-r border-[var(--line)] bg-[var(--surface)]">
        <div className="flex h-16 items-center gap-2.5 border-b border-[var(--line)] px-5">
          <span className="flex h-8 w-8 items-center justify-center rounded-[9px] bg-[var(--ink)] text-white"><Truck size={15} /></span>
          <div>
            <p className="text-[15px] font-extrabold tracking-tight">MIZIGO</p>
            <p className="text-[10px] font-bold uppercase tracking-widest text-[var(--ink-3)]">Operations</p>
          </div>
        </div>
        <nav className="flex-1 space-y-0.5 overflow-y-auto p-2.5 thin-scrollbar">
          {NAV.map((n) => {
            const active = adminTab === n.key;
            return (
              <button
                key={n.key}
                onClick={() => setAdminTab(n.key)}
                className={`flex w-full items-center gap-3 rounded-[8px] px-3 py-2.5 text-left text-[13.5px] font-bold transition ${active ? "bg-[var(--ink)] text-white" : "text-[var(--ink-2)] hover:bg-[var(--surface-2)]"}`}
              >
                <n.icon size={16} strokeWidth={active ? 2.4 : 2} />
                {n.label}
              </button>
            );
          })}
        </nav>
        <div className="border-t border-[var(--line)] p-3">
          <button onClick={() => setSurface("welcome")} className="flex w-full items-center gap-3 rounded-[8px] px-3 py-2.5 text-[13px] font-bold text-[var(--ink-2)] transition hover:bg-[var(--surface-2)]">
            <Settings size={15} /> Switch surface
          </button>
        </div>
      </aside>

      {/* content */}
      <main className="min-w-0 flex-1 overflow-y-auto thin-scrollbar">
        {adminTab === "overview" && <OverviewTab />}
        {adminTab === "live" && <LiveTab />}
        {adminTab === "shipments" && <ShipmentsTab />}
        {adminTab === "drivers" && <DriversTab />}
        {adminTab === "vehicles" && <VehiclesTab />}
        {adminTab === "customers" && <CustomersTab />}
        {adminTab === "pricing" && <PricingTab />}
        {adminTab === "payments" && <PaymentsTab />}
        {adminTab === "payouts" && <PayoutsTab />}
        {adminTab === "disputes" && <DisputesTab />}
        {adminTab === "support" && <SupportTab />}
        {adminTab === "promotions" && <PromotionsTab />}
        {adminTab === "analytics" && <AnalyticsTab />}
        {adminTab === "settings" && <SettingsTab />}
        {adminTab === "audit" && <AuditTab />}
      </main>
    </div>
  );
}

// ─── Overview ───
function OverviewTab() {
  const { data } = useQuery({
    queryKey: ["admin-overview"],
    queryFn: () => api<AdminOverview>("/api/admin?tab=overview"),
    refetchInterval: 4000,
  });
  const k = data?.kpis;

  const kpis = [
    { label: "Active deliveries", value: k?.activeDeliveries ?? "—", tone: "brand" as const },
    { label: "Today's bookings", value: k?.todayBookings ?? "—", tone: "ink" },
    { label: "Revenue today", value: k ? kes(k.revenueToday, { compact: true }) : "—", tone: "ink" },
    { label: "Platform earnings", value: k ? kes(k.platformEarningsToday, { compact: true }) : "—", tone: "ink" },
    { label: "Drivers online", value: k ? `${k.onlineDrivers}/${k.totalDrivers}` : "—", tone: "success" },
    { label: "Return legs live", value: k ? `${k.returnLoadsLive} · −${k.returnLoadsAvgDiscount}%` : "—", tone: "success" },
    { label: "Cancellation rate", value: k ? `${k.cancellationRate}%` : "—", tone: "ink" },
    { label: "Avg delivery time", value: k ? `${k.avgDeliveryTime} min` : "—", tone: "ink" },
    { label: "Open disputes", value: k?.pendingDisputes ?? "—", tone: k?.pendingDisputes ? "danger" : "ink" },
  ];

  return (
    <div className="p-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-[22px] font-extrabold tracking-tight">Operations dashboard</h1>
          <p className="text-[13px] font-medium text-[var(--ink-2)]">Nairobi network · live</p>
        </div>
        <StatusBadge tone="active"><Activity size={12} /> Live · updates every 4s</StatusBadge>
      </header>

      {/* KPIs */}
      <div className="mt-5 grid grid-cols-3 gap-3 lg:grid-cols-5">
        {kpis.map((x) => (
          <div key={x.label} className="rounded-[12px] border border-[var(--line)] bg-[var(--surface)] p-4">
            <p className="text-[11px] font-bold uppercase tracking-widest text-[var(--ink-3)]">{x.label}</p>
            <p className={`tnum mt-1.5 text-[24px] font-extrabold tracking-tight ${x.tone === "brand" ? "text-[var(--brand)]" : x.tone === "success" ? "text-[var(--success)]" : x.tone === "danger" ? "text-[var(--danger)]" : ""}`}>
              {x.value}
            </p>
          </div>
        ))}
      </div>

      <div className="mt-5 grid grid-cols-5 gap-4">
        {/* live map */}
        <div className="col-span-3 overflow-hidden rounded-[14px] border border-[var(--line)] bg-[var(--surface)]">
          <div className="flex items-center justify-between border-b border-[var(--line)] px-4 py-3">
            <SectionTitle>Live network</SectionTitle>
            <span className="text-[11.5px] font-bold text-[var(--ink-3)]">{data?.live.length ?? 0} active · {data?.drivers.filter((d) => d.status === "ONLINE").length ?? 0} available</span>
          </div>
          <div className="relative h-[420px]">
            <MapCanvas
              markers={[
                ...(data?.live.filter((s) => s.live).map((s) => ({ kind: "vehicle" as const, lat: s.live!.lat, lng: s.live!.lng, heading: s.live!.heading })) ?? []),
                ...(data?.drivers.filter((d) => d.status === "ONLINE").map((d) => ({ kind: "nearby" as const, lat: d.lat, lng: d.lng })) ?? []),
                ...(data?.live.map((s) => ({ kind: "dropoff" as const, lat: s.route.dropoff.lat, lng: s.route.dropoff.lng })) ?? []),
              ]}
              showLabels
              className="absolute inset-0"
              fitPad={30}
            />
          </div>
        </div>

        {/* live deliveries list */}
        <div className="col-span-2 overflow-hidden rounded-[14px] border border-[var(--line)] bg-[var(--surface)]">
          <div className="border-b border-[var(--line)] px-4 py-3">
            <SectionTitle>Active deliveries</SectionTitle>
          </div>
          <div className="max-h-[420px] divide-y divide-[var(--line)] overflow-y-auto thin-scrollbar">
            {(data?.live ?? []).map((s) => (
              <div key={s.id} className="px-4 py-3">
                <div className="flex items-center justify-between">
                  <span className="tnum text-[12px] font-bold text-[var(--ink-3)]">{s.code}</span>
                  <StatusBadge tone={toneForStatus(s.status)}>{STATUS_LABEL[s.status] ?? s.status}</StatusBadge>
                </div>
                <p className="mt-1 text-[13.5px] font-bold">{s.route.pickup.area} → {s.route.dropoff.area}</p>
                <p className="text-[12px] font-medium text-[var(--ink-2)]">
                  {s.driver?.name ?? "Matching…"} · {s.vehicle?.registration ?? ""} {s.live?.etaMin != null && s.live.leg !== "IDLE" ? `· ETA ${etaText(s.live.etaMin)}` : ""}
                </p>
              </div>
            ))}
            {(data?.live ?? []).length === 0 && (
              <p className="px-4 py-8 text-center text-[13px] font-medium text-[var(--ink-2)]">No active deliveries right now.</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Live map ───
function LiveTab() {
  const [filter, setFilter] = useState<"ALL" | "AVAILABLE" | "BUSY" | "DELIVERIES">("ALL");
  const { data } = useQuery({
    queryKey: ["admin-overview"],
    queryFn: () => api<AdminOverview>("/api/admin?tab=overview"),
    refetchInterval: 3000,
  });

  const markers = (() => {
    const m: { kind: "vehicle" | "nearby" | "dropoff" | "problem"; lat: number; lng: number; heading?: number }[] = [];
    if (filter === "ALL" || filter === "DELIVERIES") data?.live.filter((s) => s.live).forEach((s) => m.push({ kind: "vehicle", lat: s.live!.lat, lng: s.live!.lng, heading: s.live!.heading }));
    if (filter === "ALL" || filter === "DELIVERIES") data?.live.forEach((s) => m.push({ kind: "dropoff", lat: s.route.dropoff.lat, lng: s.route.dropoff.lng }));
    if (filter === "ALL" || filter === "AVAILABLE") data?.drivers.filter((d) => d.status === "ONLINE").forEach((d) => m.push({ kind: "nearby", lat: d.lat, lng: d.lng }));
    if (filter === "BUSY") data?.drivers.filter((d) => d.status === "BUSY").forEach((d) => m.push({ kind: "nearby", lat: d.lat, lng: d.lng }));
    return m;
  })();

  return (
    <div className="flex h-full flex-col p-6">
      <header className="flex items-center justify-between">
        <h1 className="text-[22px] font-extrabold tracking-tight">Live operations map</h1>
        <div className="flex gap-1.5">
          {(["ALL", "AVAILABLE", "BUSY", "DELIVERIES"] as const).map((f) => (
            <button key={f} onClick={() => setFilter(f)} className={`rounded-full px-3.5 py-1.5 text-[12px] font-bold transition ${filter === f ? "bg-[var(--ink)] text-white" : "border border-[var(--line)] bg-[var(--surface)] text-[var(--ink-2)]"}`}>
              {f[0] + f.slice(1).toLowerCase()}
            </button>
          ))}
        </div>
      </header>
      <div className="relative mt-4 min-h-0 flex-1 overflow-hidden rounded-[14px] border border-[var(--line)]">
        <MapCanvas markers={markers} showLabels className="absolute inset-0" fitPad={30} />
        <div className="absolute bottom-4 left-4 rounded-[10px] bg-[var(--surface)]/95 px-4 py-3 text-[12px] font-semibold shadow-lg backdrop-blur">
          <p className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-sm bg-[var(--ink)]" /> Vehicle on a delivery</p>
          <p className="mt-1 flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full bg-[var(--ink)]/75" /> Available driver</p>
          <p className="mt-1 flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full bg-[var(--brand)]" /> Drop-off</p>
        </div>
      </div>
    </div>
  );
}

// ─── Shipments table ───
function ShipmentsTab() {
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("ALL");
  const [detail, setDetail] = useState<ShipmentDTO | null>(null);
  const qc = useQueryClient();
  const [assignOpen, setAssignOpen] = useState(false);
  const { data } = useQuery({
    queryKey: ["admin-shipments", status, q],
    queryFn: () => api<{ shipments: ShipmentDTO[]; dispatchDrivers: { id: string; name: string; rating: number; vehicle: string; registration: string; categories: string[] }[] }>(`/api/admin?tab=shipments&status=${status}&q=${encodeURIComponent(q)}`),
    refetchInterval: 6000,
  });

  const assign = async (driverId: string) => {
    if (!detail) return;
    try {
      await post("/api/admin/action", { action: "assign-driver", shipmentId: detail.id, driverId });
      await qc.invalidateQueries({ queryKey: ["admin-shipments"] });
      setAssignOpen(false);
      setDetail(null);
      toast({ title: "Driver dispatched", description: `${detail.code} assigned manually — driver has been notified.` });
    } catch (e) {
      toast({ title: "Couldn't assign driver", description: (e as Error).message, variant: "destructive" });
    }
  };

  return (
    <div className="p-6">
      <header className="flex items-center justify-between gap-4">
        <h1 className="text-[22px] font-extrabold tracking-tight">Bookings</h1>
        <div className="flex items-center gap-2">
          <div className="flex h-10 w-64 items-center gap-2 rounded-[8px] border border-[var(--line)] bg-[var(--surface)] px-3">
            <Search size={14} className="text-[var(--ink-3)]" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="ID, phone, plate, name…" className="h-full w-full bg-transparent text-[13px] font-semibold outline-none" />
          </div>
          <select value={status} onChange={(e) => setStatus(e.target.value)} className="h-10 rounded-[8px] border border-[var(--line)] bg-[var(--surface)] px-3 text-[13px] font-bold outline-none">
            {["ALL", "QUOTED", "MATCHING", "NO_DRIVERS", "DRIVER_ASSIGNED", "DRIVER_EN_ROUTE", "IN_TRANSIT", "COMPLETED", "CANCELLED"].map((s) => (
              <option key={s} value={s}>{s === "ALL" ? "All statuses" : STATUS_LABEL[s] ?? s}</option>
            ))}
          </select>
        </div>
      </header>

      <div className="mt-4 overflow-hidden rounded-[14px] border border-[var(--line)] bg-[var(--surface)]">
        <table className="w-full text-left">
          <thead>
            <tr className="border-b border-[var(--line)] text-[11px] font-extrabold uppercase tracking-widest text-[var(--ink-3)]">
              <th className="px-4 py-3">ID</th><th className="px-4 py-3">Customer</th><th className="px-4 py-3">Route</th>
              <th className="px-4 py-3">Vehicle</th><th className="px-4 py-3">Driver</th><th className="px-4 py-3">Status</th>
              <th className="px-4 py-3 text-right">Fare</th><th className="px-4 py-3 text-right">Date</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--line)]">
            {(data?.shipments ?? []).map((s) => (
              <tr key={s.id} onClick={() => setDetail(s)} className="cursor-pointer text-[13px] transition hover:bg-[var(--surface-2)]">
                <td className="tnum px-4 py-3 font-extrabold">{s.code}</td>
                <td className="px-4 py-3 font-semibold">{s.customer.name}</td>
                <td className="px-4 py-3 font-medium text-[var(--ink-2)]">{s.route.pickup.area} → {s.route.dropoff.area}</td>
                <td className="px-4 py-3 font-semibold">{s.category.name}</td>
                <td className="px-4 py-3 font-semibold">{s.driver?.name ?? "—"}</td>
                <td className="px-4 py-3"><StatusBadge tone={toneForStatus(s.status)}>{STATUS_LABEL[s.status] ?? s.status}</StatusBadge></td>
                <td className="tnum px-4 py-3 text-right font-extrabold">{kes(s.fare.total)}</td>
                <td className="px-4 py-3 text-right text-[12px] font-medium text-[var(--ink-3)]">{relTimeEAT(s.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {(data?.shipments ?? []).length === 0 && <p className="py-10 text-center text-[13px] font-medium text-[var(--ink-2)]">No bookings match.</p>}
      </div>

      {detail && (
        <div className="fixed inset-0 z-50 flex justify-end bg-[rgba(23,24,28,0.35)]" onClick={() => setDetail(null)}>
          <div className="h-full w-[440px] animate-mz-slide-up overflow-y-auto bg-[var(--surface)] p-6 thin-scrollbar" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between">
              <div>
                <p className="tnum text-[19px] font-extrabold tracking-tight">{detail.code}</p>
                <StatusBadge tone={toneForStatus(detail.status)} className="mt-1">{STATUS_LABEL[detail.status] ?? detail.status}</StatusBadge>
              </div>
              <button onClick={() => setDetail(null)} className="text-[var(--ink-3)]"><XCircle size={20} /></button>
            </div>
            <div className="mt-4 space-y-3">
              <div className="rounded-[12px] bg-[var(--surface-2)] p-4">
                <Row label="Customer" value={detail.customer.name} />
                <Row label="Phone" value={`0${detail.customer.phone.slice(1)}`} />
                <Row label="Pickup" value={detail.route.pickup.name} />
                <Row label="Drop-off" value={detail.route.dropoff.name} />
                <Row label="Vehicle" value={detail.vehicle ? `${detail.vehicle.make} ${detail.vehicle.model} · ${detail.vehicle.registration}` : "—"} />
                <Row label="Driver" value={detail.driver?.name ?? "—"} />
                <Row label="Distance" value={`${detail.route.distanceKm.toFixed(1)} km`} />
                <Row label="Payment" value={`${detail.payment.method} · ${detail.payment.status}`} />
                <Row label="Total" value={kes(detail.fare.total)} strong />
              </div>
              {(detail.status === "MATCHING" || detail.status === "NO_DRIVERS") && (
                <div className="rounded-[12px] border-2 border-dashed border-[var(--brand)] p-4">
                  <SectionTitle>Manual dispatch</SectionTitle>
                  <p className="mt-1 text-[12.5px] font-medium text-[var(--ink-2)]">Assign a verified online driver — the human-ops path (final brief §19).</p>
                  <div className="mt-2.5 space-y-2">
                    {(data?.dispatchDrivers ?? []).filter((d) => d.categories.includes(detail.category.key)).map((d) => (
                      <button key={d.id} onClick={() => assign(d.id)} className="flex w-full items-center gap-3 rounded-[10px] bg-[var(--surface-2)] px-3.5 py-2.5 text-left transition hover:bg-[var(--brand-soft)]">
                        <span className="flex-1">
                          <span className="block text-[13px] font-extrabold">{d.name} · ★ {d.rating.toFixed(1)}</span>
                          <span className="block text-[11.5px] font-semibold text-[var(--ink-3)]">{d.vehicle} · {d.registration}</span>
                        </span>
                        <span className="text-[11.5px] font-extrabold text-[var(--brand)]">Assign</span>
                      </button>
                    ))}
                    {(data?.dispatchDrivers ?? []).filter((d) => d.categories.includes(detail.category.key)).length === 0 && (
                      <p className="text-[12.5px] font-medium text-[var(--ink-2)]">No online {detail.category.name} drivers right now.</p>
                    )}
                  </div>
                </div>
              )}
              {detail.quotes?.length > 0 && (
                <div className="rounded-[12px] border border-[var(--line)] p-4">
                  <SectionTitle>Driver quotes</SectionTitle>
                  <div className="mt-2 divide-y divide-[var(--line)]">
                    {detail.quotes.map((qt) => (
                      <div key={qt.id} className="flex items-center justify-between py-2 text-[12.5px]">
                        <span className="font-bold">{qt.driver?.name ?? "Driver"} <span className="font-medium text-[var(--ink-3)]">· ★ {qt.driver?.rating.toFixed(1)} · {qt.vehicle ? `${qt.vehicle.make} ${qt.vehicle.registration}` : ""}</span></span>
                        <span className="flex items-center gap-2">
                          <span className="tnum font-extrabold">{kes(qt.amount)}</span>
                          <StatusBadge tone={qt.status === "ACCEPTED" ? "success" : qt.status === "PENDING" ? "active" : "warn"}>{qt.status[0] + qt.status.slice(1).toLowerCase()}</StatusBadge>
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              <div className="rounded-[12px] border border-[var(--line)] p-4">
                <SectionTitle>Chain of custody</SectionTitle>
                <div className="mt-3">
                  {detail.events.map((e) => (
                    <div key={e.id} className="border-l-2 border-[var(--line)] pb-3 pl-3.5 last:pb-0">
                      <p className="text-[12.5px] font-bold">{e.label}</p>
                      <p className="tnum text-[11px] font-semibold text-[var(--ink-3)]">{fmtDateTimeEAT(e.at)} · {e.actor.toLowerCase()}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Drivers ───
function DriversTab() {
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: ["admin-drivers"],
    queryFn: () => api<{ drivers: { id: string; name: string; phone: string; status: string; rating: number; trips: number; acceptanceRate: number; onTimePickup: number; onTimeDelivery: number; cancellationRate: number; incidents: number; verification: string; licenceClass: string; vehicles: { make: string; model: string; registration: string; category: string; docs: { registration: string; insurance: string; inspection: string } }[] }[] }>("/api/admin?tab=drivers"),
    refetchInterval: 10000,
  });
  const [detail, setDetail] = useState<string | null>(null);
  const driver = data?.drivers.find((d) => d.id === detail);

  const act = async (action: "driver-verify" | "driver-suspend", driverId: string) => {
    await post("/api/admin/action", { action, driverId });
    toast({ title: action === "driver-verify" ? "Driver approved" : "Driver suspended" });
    qc.invalidateQueries({ queryKey: ["admin-drivers"] });
  };

  return (
    <div className="p-6">
      <h1 className="text-[22px] font-extrabold tracking-tight">Drivers</h1>
      <div className="mt-4 overflow-hidden rounded-[14px] border border-[var(--line)] bg-[var(--surface)]">
        <table className="w-full text-left">
          <thead>
            <tr className="border-b border-[var(--line)] text-[11px] font-extrabold uppercase tracking-widest text-[var(--ink-3)]">
              <th className="px-4 py-3">Name</th><th className="px-4 py-3">Vehicle</th><th className="px-4 py-3">Status</th>
              <th className="px-4 py-3 text-right">Rating</th><th className="px-4 py-3 text-right">Trips</th>
              <th className="px-4 py-3 text-right">On-time</th><th className="px-4 py-3">Verification</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--line)]">
            {(data?.drivers ?? []).map((d) => (
              <tr key={d.id} onClick={() => setDetail(d.id)} className="cursor-pointer text-[13px] transition hover:bg-[var(--surface-2)]">
                <td className="px-4 py-3">
                  <span className="flex items-center gap-2.5">
                    <AvatarInitials initials={d.name.split(" ").map((w) => w[0]).slice(0, 2).join("")} size={30} />
                    <span className="font-bold">{d.name}</span>
                  </span>
                </td>
                <td className="px-4 py-3 font-medium text-[var(--ink-2)]">{d.vehicles[0] ? `${d.vehicles[0].make} ${d.vehicles[0].model} · ${d.vehicles[0].registration}` : "—"}</td>
                <td className="px-4 py-3">
                  <StatusBadge tone={d.status === "ONLINE" ? "success" : d.status === "BUSY" ? "active" : "pending"}>{d.status[0] + d.status.slice(1).toLowerCase()}</StatusBadge>
                </td>
                <td className="tnum px-4 py-3 text-right font-extrabold">★ {d.rating.toFixed(1)}</td>
                <td className="tnum px-4 py-3 text-right font-semibold">{d.trips}</td>
                <td className="tnum px-4 py-3 text-right font-semibold">{Math.round(d.onTimeDelivery * 100)}%</td>
                <td className="px-4 py-3">
                  <StatusBadge tone={d.verification === "VERIFIED" ? "success" : d.verification === "PENDING" ? "warn" : "danger"}>{d.verification[0] + d.verification.slice(1).toLowerCase()}</StatusBadge>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {driver && (
        <div className="fixed inset-0 z-50 flex justify-end bg-[rgba(23,24,28,0.35)]" onClick={() => setDetail(null)}>
          <div className="h-full w-[440px] animate-mz-slide-up overflow-y-auto bg-[var(--surface)] p-6 thin-scrollbar" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-3.5">
                <AvatarInitials initials={driver.name.split(" ").map((w) => w[0]).slice(0, 2).join("")} size={52} />
                <div>
                  <p className="text-[19px] font-extrabold tracking-tight">{driver.name}</p>
                  <p className="tnum text-[13px] font-semibold text-[var(--ink-2)]">0{driver.phone.slice(1)} · Licence {driver.licenceClass}</p>
                </div>
              </div>
              <button onClick={() => setDetail(null)} className="text-[var(--ink-3)]"><XCircle size={20} /></button>
            </div>

            <div className="mt-5 rounded-[12px] bg-[var(--surface-2)] p-4">
              <Row label="Rating" value={`★ ${driver.rating.toFixed(1)}`} />
              <Row label="Completed trips" value={`${driver.trips}`} />
              <Row label="Acceptance" value={`${Math.round(driver.acceptanceRate * 100)}%`} />
              <Row label="On-time pickup" value={`${Math.round(driver.onTimePickup * 100)}%`} />
              <Row label="On-time delivery" value={`${Math.round(driver.onTimeDelivery * 100)}%`} />
              <Row label="Cancellations" value={`${(driver.cancellationRate * 100).toFixed(1)}%`} />
              <Row label="Cargo incidents" value={`${driver.incidents}`} strong />
            </div>

            {driver.vehicles.map((v) => (
              <div key={v.registration} className="mt-3 rounded-[12px] border border-[var(--line)] p-4">
                <SectionTitle>{v.make} {v.model}</SectionTitle>
                <div className="mt-2">
                  <Row label="Registration" value={v.registration} />
                  <Row label="Category" value={v.category} />
                  <Row label="Docs · registration" value={v.docs.registration} />
                  <Row label="Docs · insurance" value={v.docs.insurance} />
                  <Row label="Docs · inspection" value={v.docs.inspection} />
                </div>
              </div>
            ))}

            <div className="mt-5 flex gap-2.5">
              <Button variant="brand" className="flex-1" onClick={() => act("driver-verify", driver.id)} disabled={driver.verification === "VERIFIED"}>
                <CheckCircle2 size={15} /> Approve
              </Button>
              <Button variant="danger" className="flex-1" onClick={() => act("driver-suspend", driver.id)} disabled={driver.verification === "SUSPENDED"}>
                <Ban size={15} /> Suspend
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Vehicles ───
function VehiclesTab() {
  const { data } = useQuery({
    queryKey: ["admin-vehicles"],
    queryFn: () => api<{ vehicles: { id: string; make: string; model: string; registration: string; capacityKg: number; bodyType: string; driver: string; category: string; docs: { registration: string; insurance: string; inspection: string }; active: boolean }[]; categories: { id: string; key: string; name: string; capacityKg: number; description: string }[] }>("/api/admin?tab=vehicles"),
  });
  return (
    <div className="p-6">
      <h1 className="text-[22px] font-extrabold tracking-tight">Vehicles</h1>
      <div className="mt-4 overflow-hidden rounded-[14px] border border-[var(--line)] bg-[var(--surface)]">
        <table className="w-full text-left">
          <thead>
            <tr className="border-b border-[var(--line)] text-[11px] font-extrabold uppercase tracking-widest text-[var(--ink-3)]">
              <th className="px-4 py-3">Registration</th><th className="px-4 py-3">Vehicle</th><th className="px-4 py-3">Category</th>
              <th className="px-4 py-3 text-right">Capacity</th><th className="px-4 py-3">Driver</th><th className="px-4 py-3">Docs</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--line)]">
            {(data?.vehicles ?? []).map((v) => (
              <tr key={v.id} className="text-[13px]">
                <td className="px-4 py-3 font-extrabold">{v.registration}</td>
                <td className="px-4 py-3 font-semibold">{v.make} {v.model}</td>
                <td className="px-4 py-3 font-medium text-[var(--ink-2)]">{v.category}</td>
                <td className="tnum px-4 py-3 text-right font-semibold">{v.capacityKg.toLocaleString()} kg</td>
                <td className="px-4 py-3 font-semibold">{v.driver}</td>
                <td className="px-4 py-3">
                  <span className="flex gap-1.5">
                    <StatusBadge tone={v.docs.registration === "VERIFIED" ? "success" : "warn"}>Reg</StatusBadge>
                    <StatusBadge tone={v.docs.insurance === "VERIFIED" ? "success" : "warn"}>Ins</StatusBadge>
                    <StatusBadge tone={v.docs.inspection === "VERIFIED" ? "success" : "warn"}>Chk</StatusBadge>
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Pricing ───
function PricingTab() {
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: ["admin-pricing"],
    queryFn: () => api<{ zones: { id: string; key: string; name: string; basePrice: number; pricePerKm: number; pricePerMin: number; minimumPrice: number; waitingRateMin: number; loadingFee: number; extraStopFee: number; peakMultiplier: number; nightMultiplier: number; scheduledDiscount: number; platformFee: number; commissionRate: number }[]; categories: { id: string; key: string; name: string; baseFare: number; perKmRate: number; perMinRate: number; minimumFare: number; loadingFee: number; extraStopFee: number; capacityKg: number }[] }>("/api/admin?tab=pricing"),
  });
  const [editing, setEditing] = useState<Record<string, string>>({});

  const saveZone = async (zoneId: string) => {
    const fields = ["basePrice", "pricePerKm", "pricePerMin", "minimumPrice", "waitingRateMin", "loadingFee", "extraStopFee", "peakMultiplier", "nightMultiplier", "scheduledDiscount", "platformFee", "commissionRate"];
    const body: Record<string, number> = {};
    fields.forEach((f) => {
      const key = `${zoneId}:${f}`;
      if (editing[key] !== undefined) body[f] = Number(editing[key]);
    });
    if (Object.keys(body).length === 0) return;
    await post("/api/admin/action", { action: "pricing-zone", id: zoneId, ...body });
    toast({ title: "Tariff updated", description: "New prices apply to the next quote instantly." });
    setEditing({});
    qc.invalidateQueries({ queryKey: ["admin-pricing"] });
  };

  const saveCategory = async (catId: string) => {
    const fields = ["baseFare", "perKmRate", "perMinRate", "minimumFare", "loadingFee", "extraStopFee", "capacityKg"];
    const body: Record<string, number> = {};
    fields.forEach((f) => {
      const key = `${catId}:c:${f}`;
      if (editing[key] !== undefined) body[f] = Number(editing[key]);
    });
    if (Object.keys(body).length === 0) return;
    await post("/api/admin/action", { action: "pricing-category", id: catId, ...body });
    toast({ title: "Category rates updated" });
    setEditing({});
    qc.invalidateQueries({ queryKey: ["admin-pricing"] });
  };

  const zone = data?.zones[0];

  const NumCell = ({ id, field, value, prefix = "" }: { id: string; field: string; value: number; prefix?: string }) => {
    const key = `${id}:${field}`;
    const isCat = field.includes("c:");
    const k = isCat ? key : key;
    return (
      <input
        defaultValue={editing[k] ?? String(value)}
        onChange={(e) => setEditing({ ...editing, [k]: e.target.value })}
        className="tnum h-9 w-24 rounded-[6px] border border-[var(--line)] bg-[var(--surface)] px-2 text-right text-[12.5px] font-bold outline-none focus:border-[var(--brand)]"
        aria-label={`${field} ${value}`}
      />
    );
  };

  return (
    <div className="p-6">
      <h1 className="text-[22px] font-extrabold tracking-tight">Pricing</h1>
      <p className="mt-1 text-[13px] font-medium text-[var(--ink-2)]">Every rate lives in the database. Edits apply to new quotes immediately, no redeploy.</p>

      {zone && (
        <div className="mt-4 rounded-[14px] border border-[var(--line)] bg-[var(--surface)] p-5">
          <div className="flex items-center justify-between">
            <SectionTitle>Zone · {zone.name}</SectionTitle>
            <Button variant="brand" className="h-10 px-5 text-[13px]" onClick={() => saveZone(zone.id)}>Save tariff</Button>
          </div>
          <div className="mt-4 grid grid-cols-5 gap-4">
            {[
              ["basePrice", "Base price", zone.basePrice],
              ["pricePerKm", "Price / km", zone.pricePerKm],
              ["pricePerMin", "Price / min", zone.pricePerMin],
              ["minimumPrice", "Minimum", zone.minimumPrice],
              ["waitingRateMin", "Waiting / min", zone.waitingRateMin],
              ["loadingFee", "Loading fee", zone.loadingFee],
              ["extraStopFee", "Extra stop", zone.extraStopFee],
              ["peakMultiplier", "Peak ×", zone.peakMultiplier],
              ["nightMultiplier", "Night ×", zone.nightMultiplier],
              ["scheduledDiscount", "Planned −%", zone.scheduledDiscount],
              ["platformFee", "Platform fee", zone.platformFee],
              ["commissionRate", "Commission", zone.commissionRate],
            ].map(([f, label, val]) => (
              <label key={f as string} className="block">
                <span className="text-[10.5px] font-extrabold uppercase tracking-widest text-[var(--ink-3)]">{label}</span>
                <div className="mt-1.5"><NumCell id={zone.id} field={f as string} value={val as number} /></div>
              </label>
            ))}
          </div>
        </div>
      )}

      <div className="mt-5 overflow-hidden rounded-[14px] border border-[var(--line)] bg-[var(--surface)]">
        <table className="w-full text-left">
          <thead>
            <tr className="border-b border-[var(--line)] text-[11px] font-extrabold uppercase tracking-widest text-[var(--ink-3)]">
              <th className="px-4 py-3">Category</th><th className="px-4 py-3 text-right">Base</th><th className="px-4 py-3 text-right">Per km</th>
              <th className="px-4 py-3 text-right">Per min</th><th className="px-4 py-3 text-right">Minimum</th><th className="px-4 py-3 text-right">Loading</th>
              <th className="px-4 py-3 text-right">Capacity</th><th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--line)]">
            {(data?.categories ?? []).map((c) => (
              <tr key={c.id} className="text-[13px]">
                <td className="px-4 py-3 font-extrabold">{c.name}</td>
                <td className="px-4 py-3 text-right"><NumCell id={c.id} field="c:baseFare" value={c.baseFare} /></td>
                <td className="px-4 py-3 text-right"><NumCell id={c.id} field="c:perKmRate" value={c.perKmRate} /></td>
                <td className="px-4 py-3 text-right"><NumCell id={c.id} field="c:perMinRate" value={c.perMinRate} /></td>
                <td className="px-4 py-3 text-right"><NumCell id={c.id} field="c:minimumFare" value={c.minimumFare} /></td>
                <td className="px-4 py-3 text-right"><NumCell id={c.id} field="c:loadingFee" value={c.loadingFee} /></td>
                <td className="px-4 py-3 text-right"><NumCell id={c.id} field="c:capacityKg" value={c.capacityKg} /></td>
                <td className="px-4 py-3 text-right">
                  <button onClick={() => saveCategory(c.id)} className="inline-flex items-center gap-1.5 rounded-[6px] bg-[var(--ink)] px-3.5 py-2 text-[12px] font-bold text-white">
                    <Pencil size={12} /> Save
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Payments ───
function PaymentsTab() {
  const { data } = useQuery({
    queryKey: ["admin-payments"],
    queryFn: () => api<{ payments: { id: string; code: string; customer: string; method: string; amount: number; status: string; mpesaReceipt: string | null; createdAt: string }[] }>("/api/admin?tab=payments"),
    refetchInterval: 8000,
  });
  const confirmed = (data?.payments ?? []).filter((p) => p.status === "CONFIRMED");
  const total = confirmed.reduce((a, p) => a + p.amount, 0);
  const failed = (data?.payments ?? []).filter((p) => ["FAILED", "TIMEOUT", "REFUNDED"].includes(p.status));
  return (
    <div className="p-6">
      <div className="flex items-baseline justify-between">
        <h1 className="text-[22px] font-extrabold tracking-tight">Payments</h1>
        <p className="text-[13px] font-semibold text-[var(--ink-2)]">
          Collected: <span className="tnum font-extrabold text-[var(--ink)]">{kes(total)}</span> · Exceptions: <span className="tnum font-extrabold text-[var(--danger)]">{failed.length}</span>
        </p>
      </div>
      <div className="mt-4 overflow-hidden rounded-[14px] border border-[var(--line)] bg-[var(--surface)]">
        <div className="border-b border-[var(--line)] px-4 py-3"><SectionTitle>Customer payments · C2B</SectionTitle></div>
        <div className="max-h-[620px] divide-y divide-[var(--line)] overflow-y-auto thin-scrollbar">
          {(data?.payments ?? []).length === 0 && <p className="px-4 py-10 text-center text-[13px] font-medium text-[var(--ink-2)]">No payments yet.</p>}
          {(data?.payments ?? []).map((p) => (
            <div key={p.id} className="flex items-center justify-between px-4 py-3 text-[13px]">
              <div>
                <p className="tnum font-extrabold">{p.code} <span className="font-semibold text-[var(--ink-2)]">· {p.customer}</span></p>
                <p className="text-[11.5px] font-semibold text-[var(--ink-3)]">{p.method} · {p.mpesaReceipt ?? "—"} · {relTimeEAT(p.createdAt)}</p>
              </div>
              <div className="text-right">
                <p className="tnum font-extrabold">{kes(p.amount)}</p>
                <StatusBadge tone={p.status === "CONFIRMED" ? "success" : p.status === "PENDING" ? "active" : "danger"}>{p.status[0] + p.status.slice(1).toLowerCase()}</StatusBadge>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Payouts (plan §48) ───
function PayoutsTab() {
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: ["admin-payouts"],
    queryFn: () => api<{
      payouts: { id: string; driver: string; amount: number; method: string; status: string; ref: string | null; createdAt: string }[];
      ledger: { id: string; code: string; driver: string; customer: string; gross: number; commission: number; net: number }[];
    }>("/api/admin?tab=payouts"),
    refetchInterval: 10000,
  });
  const [busy, setBusy] = useState<string | null>(null);
  const payNow = async (payoutId: string) => {
    setBusy(payoutId);
    try {
      await post("/api/admin/action", { action: "payout-pay", payoutId });
      await qc.invalidateQueries({ queryKey: ["admin-payouts"] });
      toast({ title: "Payout released", description: "M-PESA B2C disbursement marked paid (sandbox)." });
    } catch (e) {
      toast({ title: "Couldn't release payout", description: (e as Error).message, variant: "destructive" });
    } finally {
      setBusy(null);
    }
  };
  const totalPaid = (data?.payouts ?? []).filter((p) => p.status === "PAID").reduce((a, p) => a + p.amount, 0);
  return (
    <div className="p-6">
      <div className="flex items-baseline justify-between">
        <h1 className="text-[22px] font-extrabold tracking-tight">Driver payouts</h1>
        <p className="text-[13px] font-semibold text-[var(--ink-2)]">Paid out: <span className="tnum font-extrabold text-[var(--ink)]">{kes(totalPaid)}</span></p>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-4">
        <div className="overflow-hidden rounded-[14px] border border-[var(--line)] bg-[var(--surface)]">
          <div className="border-b border-[var(--line)] px-4 py-3"><SectionTitle>Withdrawals · B2C</SectionTitle></div>
          <div className="max-h-[560px] divide-y divide-[var(--line)] overflow-y-auto thin-scrollbar">
            {(data?.payouts ?? []).length === 0 && <p className="px-4 py-8 text-center text-[13px] font-medium text-[var(--ink-2)]">No payouts yet.</p>}
            {(data?.payouts ?? []).map((p) => (
              <div key={p.id} className="flex items-center justify-between px-4 py-3 text-[13px]">
                <div>
                  <p className="font-extrabold">{p.driver}</p>
                  <p className="tnum text-[11.5px] font-semibold text-[var(--ink-3)]">{kes(p.amount)} · {p.method} · {p.ref ?? "—"} · {relTimeEAT(p.createdAt)}</p>
                </div>
                <div className="flex items-center gap-2.5">
                  {p.status !== "PAID" && (
                    <Button variant="outline" className="h-8 text-[11.5px]" loading={busy === p.id} onClick={() => payNow(p.id)}>Release</Button>
                  )}
                  <StatusBadge tone={p.status === "PAID" ? "success" : p.status === "PROCESSING" ? "active" : "warn"}>{p.status[0] + p.status.slice(1).toLowerCase()}</StatusBadge>
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className="overflow-hidden rounded-[14px] border border-[var(--line)] bg-[var(--surface)]">
          <div className="border-b border-[var(--line)] px-4 py-3"><SectionTitle>Trip ledger · commission per trip</SectionTitle></div>
          <div className="max-h-[560px] divide-y divide-[var(--line)] overflow-y-auto thin-scrollbar">
            {(data?.ledger ?? []).length === 0 && <p className="px-4 py-8 text-center text-[13px] font-medium text-[var(--ink-2)]">No completed trips yet.</p>}
            {(data?.ledger ?? []).map((l) => (
              <div key={l.id} className="flex items-center justify-between px-4 py-3 text-[13px]">
                <div>
                  <p className="tnum font-extrabold">{l.code}</p>
                  <p className="text-[11.5px] font-semibold text-[var(--ink-3)]">{l.driver} · {l.customer}</p>
                </div>
                <div className="flex items-center gap-4 text-right">
                  <span className="tnum text-[12px] font-semibold text-[var(--ink-2)]">gross {kes(l.gross)}</span>
                  <span className="tnum text-[12px] font-semibold text-[var(--brand)]">platform {kes(l.commission)}</span>
                  <span className="tnum font-extrabold">net {kes(l.net)}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Disputes ───
function DisputesTab() {
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: ["admin-disputes"],
    queryFn: () => api<{ disputes: { id: string; type: string; notes: string; status: string; createdAt: string; code: string; customer: string; driver: string; resolution: string | null }[] }>("/api/admin?tab=disputes"),
  });
  const [resolve, setResolve] = useState<{ id: string; text: string } | null>(null);

  return (
    <div className="p-6">
      <h1 className="text-[22px] font-extrabold tracking-tight">Disputes</h1>
      <div className="mt-4 space-y-3">
        {(data?.disputes ?? []).length === 0 && (
          <div className="rounded-[14px] border border-[var(--line)] bg-[var(--surface)] px-4 py-10 text-center">
            <p className="text-[14px] font-bold">No disputes open</p>
            <p className="mt-1 text-[12.5px] font-medium text-[var(--ink-2)]">Evidence-backed records make disputes rare.</p>
          </div>
        )}
        {(data?.disputes ?? []).map((d) => (
          <div key={d.id} className="rounded-[14px] border border-[var(--line)] bg-[var(--surface)] p-4">
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-2">
                <StatusBadge tone={d.status === "RESOLVED" ? "success" : "warn"}>{d.status[0] + d.status.slice(1).toLowerCase()}</StatusBadge>
                <span className="tnum text-[12px] font-bold text-[var(--ink-3)]">{d.code} · {fmtDateTimeEAT(d.createdAt)}</span>
              </span>
              {d.status !== "RESOLVED" && (
                <button onClick={() => setResolve({ id: d.id, text: "" })} className="rounded-[6px] bg-[var(--ink)] px-3.5 py-2 text-[12px] font-bold text-white">Resolve</button>
              )}
            </div>
            <p className="mt-2 text-[14px] font-bold">{d.type.replace(/_/g, " ").toLowerCase()}</p>
            <p className="mt-0.5 text-[13px] font-medium text-[var(--ink-2)]">{d.notes}</p>
            <p className="mt-1 text-[12px] font-semibold text-[var(--ink-3)]">Customer: {d.customer} · Driver: {d.driver}</p>
            {d.resolution && <p className="mt-2 rounded-[8px] bg-[var(--success-soft)] px-3 py-2 text-[12.5px] font-bold text-[var(--success)]">Resolution: {d.resolution}</p>}
          </div>
        ))}
      </div>

      {resolve && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(23,24,28,0.4)]" onClick={() => setResolve(null)}>
          <div className="w-[400px] animate-mz-slide-up rounded-[14px] bg-[var(--surface)] p-5" onClick={(e) => e.stopPropagation()}>
            <p className="text-[16px] font-extrabold">Resolve dispute</p>
            <textarea
              value={resolve.text} onChange={(e) => setResolve({ ...resolve, text: e.target.value })}
              placeholder="Resolution notes (visible in the audit log)…"
              className="mt-3 h-28 w-full resize-none rounded-[10px] border border-[var(--line)] bg-[var(--surface)] p-3 text-[13.5px] font-medium outline-none focus:border-[var(--brand)]"
            />
            <div className="mt-3 flex gap-2.5">
              <Button variant="brand" className="flex-1" onClick={async () => {
                await post("/api/admin/action", { action: "dispute-resolve", disputeId: resolve.id, resolution: resolve.text });
                toast({ title: "Dispute resolved" });
                setResolve(null);
                qc.invalidateQueries({ queryKey: ["admin-disputes"] });
              }}>Mark resolved</Button>
              <Button variant="ghost" className="flex-1" onClick={() => setResolve(null)}>Cancel</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Analytics ───
function AnalyticsTab() {
  const { data } = useQuery({
    queryKey: ["admin-analytics"],
    queryFn: () => api<{ days: { day: string; bookings: number; revenue: number; completed: number; cancelled: number }[]; topRoutes: { route: string; count: number }[]; categories: { name: string; count: number }[]; topDrivers: { name: string; trips: number; revenue: number }[]; totals: { gmv: number; platform: number; avgFare: number; avgDistance: number; cancellationPct: number; onTimePct: number } }>("/api/admin?tab=analytics"),
  });
  const maxRev = Math.max(...(data?.days ?? []).map((d) => d.revenue), 1);
  const maxCat = Math.max(...(data?.categories ?? []).map((c) => c.count), 1);

  return (
    <div className="p-6">
      <h1 className="text-[22px] font-extrabold tracking-tight">Analytics</h1>
      <div className="mt-4 grid grid-cols-6 gap-3">
        {[
          { label: "GMV (all time)", value: kes(data?.totals.gmv ?? 0, { compact: true }) },
          { label: "Platform revenue", value: kes(data?.totals.platform ?? 0, { compact: true }) },
          { label: "Avg fare", value: kes(data?.totals.avgFare ?? 0) },
          { label: "Avg distance", value: `${data?.totals.avgDistance ?? 0} km` },
          { label: "Cancellation", value: `${data?.totals.cancellationPct ?? 0}%` },
          { label: "On-time delivery", value: `${data?.totals.onTimePct ?? 0}%` },
        ].map((k) => (
          <div key={k.label} className="rounded-[12px] border border-[var(--line)] bg-[var(--surface)] p-4">
            <p className="text-[11px] font-bold uppercase tracking-widest text-[var(--ink-3)]">{k.label}</p>
            <p className="tnum mt-1.5 text-[22px] font-extrabold">{k.value}</p>
          </div>
        ))}
      </div>

      <div className="mt-5 grid grid-cols-3 gap-4">
        <div className="col-span-2 rounded-[14px] border border-[var(--line)] bg-[var(--surface)] p-5">
          <SectionTitle>Revenue · last 14 days</SectionTitle>
          <div className="mt-5 flex h-48 items-end gap-1.5">
            {(data?.days ?? []).map((d) => (
              <div key={d.day} className="group flex flex-1 flex-col items-center gap-1">
                <div className="flex w-full flex-1 items-end">
                  <div className="w-full rounded-t-[4px] bg-[var(--brand)] transition-all group-hover:opacity-80" style={{ height: `${Math.max(4, (d.revenue / maxRev) * 100)}%` }} title={`${d.day}: ${kes(d.revenue)}`} />
                </div>
                <span className="text-[9px] font-bold text-[var(--ink-3)]">{d.day}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="rounded-[14px] border border-[var(--line)] bg-[var(--surface)] p-5">
          <SectionTitle>Vehicle mix</SectionTitle>
          <div className="mt-4 space-y-3">
            {(data?.categories ?? []).map((c) => (
              <div key={c.name}>
                <div className="flex justify-between text-[12.5px] font-bold">
                  <span>{c.name}</span><span className="tnum text-[var(--ink-2)]">{c.count}</span>
                </div>
                <div className="mt-1 h-2 overflow-hidden rounded-full bg-[var(--surface-2)]">
                  <div className="h-full rounded-full bg-[var(--ink)]" style={{ width: `${(c.count / maxCat) * 100}%` }} />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="mt-5 rounded-[14px] border border-[var(--line)] bg-[var(--surface)] p-5">
        <SectionTitle>Top routes</SectionTitle>
        <div className="mt-3 grid grid-cols-3 gap-3">
          {(data?.topRoutes ?? []).map((r) => (
            <div key={r.route} className="flex items-center justify-between rounded-[10px] bg-[var(--surface-2)] px-4 py-3">
              <span className="text-[13px] font-bold">{r.route}</span>
              <span className="tnum text-[13px] font-extrabold text-[var(--brand)]">{r.count}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="mt-5 rounded-[14px] border border-[var(--line)] bg-[var(--surface)] p-5">
        <SectionTitle>Top drivers (plan §79)</SectionTitle>
        <div className="mt-3 overflow-hidden rounded-[10px] border border-[var(--line)]">
          <table className="w-full text-left text-[13px]">
            <thead>
              <tr className="border-b border-[var(--line)] text-[11px] font-extrabold uppercase tracking-widest text-[var(--ink-3)]">
                <th className="px-4 py-2.5">Driver</th><th className="px-4 py-2.5 text-right">Completed trips</th><th className="px-4 py-2.5 text-right">Revenue</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--line)]">
              {(data?.topDrivers ?? []).map((d) => (
                <tr key={d.name}>
                  <td className="px-4 py-2.5 font-bold">{d.name}</td>
                  <td className="tnum px-4 py-2.5 text-right font-semibold">{d.trips}</td>
                  <td className="tnum px-4 py-2.5 text-right font-extrabold">{kes(d.revenue)}</td>
                </tr>
              ))}
              {(data?.topDrivers ?? []).length === 0 && <tr><td colSpan={3} className="px-4 py-6 text-center font-medium text-[var(--ink-2)]">No completed trips yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ─── Customers (plan §41 Customers/Businesses) ───
function CustomersTab() {
  const [filter, setFilter] = useState<"ALL" | "PERSONAL" | "BUSINESS">("ALL");
  const { data } = useQuery({
    queryKey: ["admin-customers"],
    queryFn: () => api<{ customers: { id: string; name: string; phone: string; accountType: string; businessName: string | null; shipments: number; completed: number; spent: number; cancelled: number; joined: string }[] }>("/api/admin?tab=customers"),
    refetchInterval: 15000,
  });
  const rows = (data?.customers ?? []).filter((c) => (filter === "ALL" ? true : c.accountType === filter));
  const business = (data?.customers ?? []).filter((c) => c.accountType === "BUSINESS");
  return (
    <div className="p-6">
      <div className="flex items-baseline justify-between">
        <h1 className="text-[22px] font-extrabold tracking-tight">Customers</h1>
        <div className="flex gap-1.5">
          {(["ALL", "PERSONAL", "BUSINESS"] as const).map((f) => (
            <button key={f} onClick={() => setFilter(f)} className={`rounded-full px-3.5 py-1.5 text-[12px] font-bold transition ${filter === f ? "bg-[var(--ink)] text-white" : "border border-[var(--line)] bg-[var(--surface)] text-[var(--ink-2)]"}`}>
              {f === "ALL" ? `All (${data?.customers.length ?? 0})` : f === "BUSINESS" ? `Businesses (${business.length})` : "Personal"}
            </button>
          ))}
        </div>
      </div>
      <div className="mt-4 overflow-hidden rounded-[14px] border border-[var(--line)] bg-[var(--surface)]">
        <table className="w-full text-left">
          <thead>
            <tr className="border-b border-[var(--line)] text-[11px] font-extrabold uppercase tracking-widest text-[var(--ink-3)]">
              <th className="px-4 py-3">Name</th><th className="px-4 py-3">Phone</th><th className="px-4 py-3">Account</th>
              <th className="px-4 py-3 text-right">Deliveries</th><th className="px-4 py-3 text-right">Completed</th>
              <th className="px-4 py-3 text-right">Cancelled</th><th className="px-4 py-3 text-right">Spent</th><th className="px-4 py-3 text-right">Joined</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--line)]">
            {rows.map((c) => (
              <tr key={c.id} className="text-[13px] transition hover:bg-[var(--surface-2)]">
                <td className="px-4 py-3 font-extrabold">
                  {c.name}
                  {c.businessName && <span className="ml-1.5 rounded-full bg-[var(--brand-soft)] px-2 py-0.5 text-[10.5px] font-extrabold text-[var(--brand-ink)]">{c.businessName}</span>}
                </td>
                <td className="tnum px-4 py-3 font-semibold">0{c.phone.slice(1)}</td>
                <td className="px-4 py-3">
                  <StatusBadge tone={c.accountType === "BUSINESS" ? "active" : "neutral"}>{c.accountType === "BUSINESS" ? "Business" : "Personal"}</StatusBadge>
                </td>
                <td className="tnum px-4 py-3 text-right font-semibold">{c.shipments}</td>
                <td className="tnum px-4 py-3 text-right font-semibold text-[var(--success)]">{c.completed}</td>
                <td className="tnum px-4 py-3 text-right font-semibold text-[var(--danger)]">{c.cancelled}</td>
                <td className="tnum px-4 py-3 text-right font-extrabold">{kes(c.spent)}</td>
                <td className="px-4 py-3 text-right text-[12px] font-medium text-[var(--ink-3)]">{relTimeEAT(c.joined)}</td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={8} className="py-10 text-center text-[13px] font-medium text-[var(--ink-2)]">No customers yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Support: exception inbox (final brief §19 human dispatch) ───
function SupportTab() {
  const { data } = useQuery({
    queryKey: ["admin-support"],
    queryFn: () => api<{ queue: { id: string; kind: string; shipmentId: string; code: string; customer: string; detail: string; at: string }[]; supportPhone: string }>("/api/admin?tab=support"),
    refetchInterval: 6000,
  });
  const tone: Record<string, "danger" | "warn" | "active"> = { CARGO_MISMATCH: "warn", NO_DRIVERS: "danger", AWAITING_DISPATCH: "active", PAYMENT_TIMEOUT: "warn", DISPUTE: "danger" };
  return (
    <div className="p-6">
      <div className="flex items-baseline justify-between">
        <h1 className="text-[22px] font-extrabold tracking-tight">Support · exception queue</h1>
        <p className="text-[13px] font-semibold text-[var(--ink-2)]">Hotline <span className="tnum font-extrabold text-[var(--ink)]">{data?.supportPhone ?? "0800 000 000"}</span> · {data?.queue.length ?? 0} open</p>
      </div>
      <p className="mt-1 text-[13px] font-medium text-[var(--ink-2)]">Automate the boring 90%, human-manage the exceptions — every item links to its booking.</p>
      <div className="mt-4 space-y-2">
        {(data?.queue ?? []).map((x) => (
          <div key={x.id} className="flex items-center gap-4 rounded-[12px] border border-[var(--line)] bg-[var(--surface)] px-4 py-3.5">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--surface-2)]"><LifeBuoy size={15} className="text-[var(--ink-2)]" /></span>
            <div className="min-w-0 flex-1">
              <p className="flex items-center gap-2 text-[13.5px] font-extrabold">
                {x.code}
                <StatusBadge tone={tone[x.kind] ?? "warn"}>{x.kind.replace(/_/g, " ")}</StatusBadge>
              </p>
              <p className="truncate text-[12.5px] font-semibold text-[var(--ink-2)]">{x.customer} · {x.detail}</p>
            </div>
            <span className="shrink-0 text-[11.5px] font-semibold text-[var(--ink-3)]">{relTimeEAT(x.at)}</span>
          </div>
        ))}
        {(data?.queue ?? []).length === 0 && (
          <p className="rounded-[14px] border border-dashed border-[var(--line)] bg-[var(--surface)] py-12 text-center text-[13.5px] font-semibold text-[var(--ink-2)]">All clear — no exceptions right now.</p>
        )}
      </div>
    </div>
  );
}

// ─── Promotions (plan §75) ───
function PromotionsTab() {
  const qc = useQueryClient();
  const [code, setCode] = useState("");
  const [kind, setKind] = useState<"FLAT" | "PERCENT">("FLAT");
  const [value, setValue] = useState("");
  const [minFare, setMinFare] = useState("");
  const [firstOnly, setFirstOnly] = useState(false);
  const [bizOnly, setBizOnly] = useState(false);
  const [busy, setBusy] = useState(false);

  const { data } = useQuery({
    queryKey: ["admin-promotions"],
    queryFn: () => api<{ promos: { id: string; code: string; kind: string; value: number; minFare: number; firstBookingOnly: boolean; businessOnly: boolean; active: boolean; expiresAt: string | null; uses: number }[] }>("/api/admin?tab=promotions"),
    refetchInterval: 15000,
  });

  const create = async () => {
    setBusy(true);
    try {
      await post("/api/admin/action", { action: "promo-create", code, kind, value: Number(value), minFare: Number(minFare) || 0, firstBookingOnly: firstOnly, businessOnly: bizOnly });
      await qc.invalidateQueries({ queryKey: ["admin-promotions"] });
      setCode(""); setValue(""); setMinFare(""); setFirstOnly(false); setBizOnly(false);
      toast({ title: "Promo created", description: `${code.toUpperCase()} is live for customers.` });
    } catch (e) {
      toast({ title: "Couldn't create promo", description: (e as Error).message, variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  const toggle = async (promoId: string) => {
    await post("/api/admin/action", { action: "promo-toggle", promoId }).catch(() => null);
    await qc.invalidateQueries({ queryKey: ["admin-promotions"] });
  };

  return (
    <div className="p-6">
      <h1 className="text-[22px] font-extrabold tracking-tight">Promotions</h1>
      <div className="mt-4 grid grid-cols-3 gap-4">
        {/* create form */}
        <div className="rounded-[14px] border border-[var(--line)] bg-[var(--surface)] p-5">
          <SectionTitle>Create promo code</SectionTitle>
          <label className="mt-3 block">
            <span className="text-[11px] font-bold uppercase tracking-widest text-[var(--ink-3)]">Code</span>
            <input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="e.g. WESTLANDS500" className="mt-1 h-10 w-full rounded-[8px] border border-[var(--line)] bg-[var(--paper)] px-3 text-[13px] font-bold tracking-wide outline-none focus:border-[var(--brand)]" />
          </label>
          <div className="mt-2.5 grid grid-cols-2 gap-2.5">
            <label className="block">
              <span className="text-[11px] font-bold uppercase tracking-widest text-[var(--ink-3)]">Type</span>
              <select value={kind} onChange={(e) => setKind(e.target.value as "FLAT" | "PERCENT")} className="mt-1 h-10 w-full rounded-[8px] border border-[var(--line)] bg-[var(--paper)] px-2.5 text-[13px] font-bold outline-none">
                <option value="FLAT">KES off</option>
                <option value="PERCENT">% off</option>
              </select>
            </label>
            <label className="block">
              <span className="text-[11px] font-bold uppercase tracking-widest text-[var(--ink-3)]">{kind === "FLAT" ? "Amount (KES)" : "Percent"}</span>
              <input value={value} onChange={(e) => setValue(e.target.value.replace(/\D/g, ""))} placeholder="500" inputMode="numeric" className="tnum mt-1 h-10 w-full rounded-[8px] border border-[var(--line)] bg-[var(--paper)] px-3 text-[13px] font-bold outline-none focus:border-[var(--brand)]" />
            </label>
          </div>
          <label className="mt-2.5 block">
            <span className="text-[11px] font-bold uppercase tracking-widest text-[var(--ink-3)]">Minimum fare (KES)</span>
            <input value={minFare} onChange={(e) => setMinFare(e.target.value.replace(/\D/g, ""))} placeholder="0" inputMode="numeric" className="tnum mt-1 h-10 w-full rounded-[8px] border border-[var(--line)] bg-[var(--paper)] px-3 text-[13px] font-bold outline-none focus:border-[var(--brand)]" />
          </label>
          <div className="mt-3 space-y-2">
            <label className="flex items-center gap-2.5 text-[12.5px] font-bold">
              <input type="checkbox" checked={firstOnly} onChange={(e) => setFirstOnly(e.target.checked)} className="h-4 w-4 accent-[var(--brand)]" />
              First booking only
            </label>
            <label className="flex items-center gap-2.5 text-[12.5px] font-bold">
              <input type="checkbox" checked={bizOnly} onChange={(e) => setBizOnly(e.target.checked)} className="h-4 w-4 accent-[var(--brand)]" />
              Business accounts only
            </label>
          </div>
          <Button variant="brand" className="mt-4 w-full" disabled={!code || !value} loading={busy} onClick={create}>
            <Plus size={15} /> Create promo
          </Button>
        </div>

        {/* list */}
        <div className="col-span-2 overflow-hidden rounded-[14px] border border-[var(--line)] bg-[var(--surface)]">
          <div className="border-b border-[var(--line)] px-4 py-3"><SectionTitle>Codes · usage</SectionTitle></div>
          <div className="divide-y divide-[var(--line)]">
            {(data?.promos ?? []).map((p) => (
              <div key={p.id} className="flex items-center gap-4 px-4 py-3.5">
                <span className="tnum w-36 text-[14px] font-extrabold tracking-wide">{p.code}</span>
                <span className="flex-1 text-[12.5px] font-semibold text-[var(--ink-2)]">
                  {p.kind === "PERCENT" ? `${p.value}% off` : `${kes(p.value)} off`}
                  {p.minFare > 0 && ` · min ${kes(p.minFare)}`}
                  {p.firstBookingOnly && " · first booking"}
                  {p.businessOnly && " · business only"}
                </span>
                <span className="tnum text-[12.5px] font-bold text-[var(--ink-2)]">{p.uses} uses</span>
                <button onClick={() => toggle(p.id)} className={`h-8 rounded-full px-3.5 text-[11.5px] font-extrabold transition ${p.active ? "bg-[var(--success-soft)] text-[var(--success)]" : "bg-[var(--surface-2)] text-[var(--ink-3)]"}`}>
                  {p.active ? "Active" : "Paused"}
                </button>
              </div>
            ))}
            {(data?.promos ?? []).length === 0 && <p className="px-4 py-10 text-center text-[13px] font-medium text-[var(--ink-2)]">No promos yet.</p>}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Settings (plan §34/§41) ───
function SettingsTab() {
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: ["admin-settings"],
    queryFn: () => api<{ settings: { key: string; value: string; updatedAt: string }[] }>("/api/admin?tab=settings"),
  });
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);

  const META: Record<string, { label: string; hint: string; type: "number" | "text" | "toggle" }> = {
    advanceBookingDays: { label: "Advance booking window (days)", hint: "How far ahead customers can schedule deliveries (plan §34)", type: "number" },
    autoDispatch: { label: "Auto-dispatch matching", hint: "Off = bookings wait in MATCHING for manual dispatch (final brief §19)", type: "toggle" },
    quoteExpiryMinutes: { label: "Quote expiry (minutes)", hint: "How long marketplace quotes stay valid (plan §33)", type: "number" },
    supportPhone: { label: "Support hotline", hint: "Shown on customer + driver help screens", type: "text" },
  };

  const save = async (key: string) => {
    setBusy(key);
    try {
      await post("/api/admin/action", { action: "setting-update", key, value: drafts[key] });
      await qc.invalidateQueries({ queryKey: ["admin-settings"] });
      toast({ title: "Setting saved", description: `${META[key]?.label ?? key} updated.` });
    } catch (e) {
      toast({ title: "Couldn't save", description: (e as Error).message, variant: "destructive" });
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="p-6">
      <h1 className="text-[22px] font-extrabold tracking-tight">Platform settings</h1>
      <p className="mt-1 text-[13px] font-medium text-[var(--ink-2)]">Live configuration — changes apply immediately and are written to the audit log.</p>
      <div className="mt-4 max-w-2xl space-y-3">
        {(data?.settings ?? []).map((s) => {
          const meta = META[s.key] ?? { label: s.key, hint: "", type: "text" as const };
          const draftVal = drafts[s.key] ?? s.value;
          const dirty = draftVal !== s.value;
          return (
            <div key={s.key} className="rounded-[14px] border border-[var(--line)] bg-[var(--surface)] p-4">
              <div className="flex items-center justify-between gap-4">
                <div className="min-w-0">
                  <p className="text-[14px] font-extrabold">{meta.label}</p>
                  <p className="text-[12px] font-medium text-[var(--ink-2)]">{meta.hint}</p>
                </div>
                <div className="flex shrink-0 items-center gap-2.5">
                  {meta.type === "toggle" ? (
                    <button
                      onClick={() => setDrafts({ ...drafts, [s.key]: draftVal === "true" ? "false" : "true" })}
                      className={`h-9 w-[74px] rounded-full px-1 transition ${draftVal === "true" ? "bg-[var(--success)]" : "bg-[var(--line)]"}`}
                      aria-pressed={draftVal === "true"}
                    >
                      <span className={`block h-7 w-7 rounded-full bg-white shadow transition-transform ${draftVal === "true" ? "translate-x-[38px]" : ""}`} />
                    </button>
                  ) : (
                    <input
                      value={draftVal}
                      onChange={(e) => setDrafts({ ...drafts, [s.key]: e.target.value })}
                      inputMode={meta.type === "number" ? "numeric" : "text"}
                      className="tnum h-10 w-40 rounded-[8px] border border-[var(--line)] bg-[var(--paper)] px-3 text-[13.5px] font-bold outline-none focus:border-[var(--brand)]"
                    />
                  )}
                  {dirty && (
                    <Button variant="brand" className="h-9 text-[12px]" loading={busy === s.key} onClick={() => save(s.key)}>Save</Button>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
      <p className="mt-6 text-[12px] font-medium text-[var(--ink-3)]">Vehicle capacity, zone tariffs and category pricing live in the Pricing tab. Every change is audited.</p>
    </div>
  );
}

// ─── Audit ───
function AuditTab() {
  const { data } = useQuery({
    queryKey: ["admin-audit"],
    queryFn: () => api<{ logs: { id: string; actor: string; action: string; target: string; detail: string | null; createdAt: string }[] }>("/api/admin?tab=audit"),
  });
  return (
    <div className="p-6">
      <h1 className="text-[22px] font-extrabold tracking-tight">Audit log</h1>
      <p className="mt-1 text-[13px] font-medium text-[var(--ink-2)]">Every admin mutation is recorded immutably.</p>
      <div className="mt-4 divide-y divide-[var(--line)] rounded-[14px] border border-[var(--line)] bg-[var(--surface)]">
        {(data?.logs ?? []).map((l) => (
          <div key={l.id} className="flex items-center gap-4 px-4 py-3 text-[13px]">
            <span className="tnum w-40 font-bold text-[var(--ink-3)]">{fmtDateTimeEAT(l.createdAt)}</span>
            <StatusBadge tone="neutral">{l.action.replaceAll("_", " ").toLowerCase()}</StatusBadge>
            <span className="font-semibold">{l.target}</span>
            <span className="ml-auto text-[12px] font-medium text-[var(--ink-2)]">{l.actor}</span>
          </div>
        ))}
        {(data?.logs ?? []).length === 0 && <p className="px-4 py-8 text-center text-[13px] font-medium text-[var(--ink-2)]">No admin actions yet. Edit pricing or verify a driver to see entries.</p>}
      </div>
    </div>
  );
}
