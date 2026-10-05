"use client";
// Trips, Wallet, Account — the secondary customer surfaces.

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Banknote, Bell, ChevronRight, CreditCard, LogOut, MapPin, PackageOpen, Smartphone, ChevronDown } from "lucide-react";
import { api, post } from "@/lib/api-client";
import type { CustomerHome, ShipmentDTO } from "@/lib/types";
import { useSession } from "@/store/session";
import { Button, EmptyState, ListSkeleton, Row, SectionTitle, StatusBadge, toneForStatus } from "@/components/mizigo/shared/ui";
import VehicleAvatar from "@/components/mizigo/shared/VehicleAvatar";
import MapCanvas from "@/components/mizigo/shared/MapCanvas";
import { kes, fmtDateTimeEAT, relTimeEAT } from "@/lib/format";
import { STATUS_LABEL } from "@/lib/state-machine";
import { toast } from "@/hooks/use-toast";

// ─── Trips ───
export function TripsScreen() {
  const { user, focusShipmentId, setFocusShipment, setBookingStep } = useSession();
  const [tab, setTab] = useState<"ALL" | "ACTIVE" | "COMPLETED" | "CANCELLED">("ALL");

  const { data, isLoading } = useQuery({
    queryKey: ["customer-home", user?.id],
    queryFn: () => api<CustomerHome>(`/api/customer?userId=${user!.id}`),
    enabled: !!user,
    refetchInterval: 8000,
  });

  const all = [...(data?.active ? [data.active] : []), ...(data?.trips ?? [])];
  const filtered = all.filter((t) =>
    tab === "ALL" ? true :
    tab === "ACTIVE" ? !["COMPLETED", "CANCELLED"].includes(t.status) :
    t.status === tab
  );
  const detail = focusShipmentId ? all.find((t) => t.id === focusShipmentId) : null;

  if (detail) return <TripDetail shipment={detail} onBack={() => setFocusShipment(null)} />;

  return (
    <div className="space-y-4 pb-6">
      <h1 className="px-1 pt-1 text-[24px] font-extrabold tracking-tight">Your deliveries</h1>
      <div className="flex gap-2">
        {(["ALL", "ACTIVE", "COMPLETED", "CANCELLED"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`rounded-full px-4 py-2 text-[12.5px] font-bold capitalize transition ${tab === t ? "bg-[var(--ink)] text-white" : "bg-[var(--surface)] text-[var(--ink-2)] border border-[var(--line)]"}`}
          >
            {t.toLowerCase()}
          </button>
        ))}
      </div>
      {isLoading ? (
        <ListSkeleton rows={4} />
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={<PackageOpen size={22} />}
          title="No deliveries here"
          body={tab === "ALL" ? "You'll see your completed deliveries here." : `No ${tab.toLowerCase()} deliveries yet.`}
          action={<Button variant="outline" onClick={() => setBookingStep("cargo")}>Move something</Button>}
        />
      ) : (
        <div className="space-y-2.5">
          {filtered.map((t) => (
            <button
              key={t.id}
              onClick={() => setFocusShipment(t.id)}
              className="flex w-full items-center gap-3.5 rounded-[14px] border border-[var(--line)] bg-[var(--surface)] p-3.5 text-left transition hover:border-[var(--ink-3)] active:translate-y-px"
            >
              <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-[var(--surface-2)]">
                <VehicleAvatar category={t.category.key} size={34} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[14px] font-bold">{t.route.pickup.area} → {t.route.dropoff.area}</span>
                <span className="block text-[12px] font-medium text-[var(--ink-3)]">{relTimeEAT(t.createdAt)} · {t.code}</span>
              </span>
              <span className="text-right">
                <span className="tnum block text-[14px] font-extrabold">{kes(t.fare.total)}</span>
                <StatusBadge tone={toneForStatus(t.status)} className="mt-1">{STATUS_LABEL[t.status] ?? t.status}</StatusBadge>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function TripDetail({ shipment: s, onBack }: { shipment: ShipmentDTO; onBack: () => void }) {
  const { setBookingStep, setFocusShipment, setTrackToken } = useSession();
  const [podOpen, setPodOpen] = useState(true);
  const canRepeat = s.status === "COMPLETED";

  return (
    <div className="space-y-4 pb-6">
      <div className="flex items-center gap-3 pt-1">
        <button onClick={onBack} className="flex h-11 w-11 items-center justify-center rounded-[10px] border border-[var(--line)]" aria-label="Back">
          <ChevronDown size={18} className="rotate-90" />
        </button>
        <div>
          <h1 className="tnum text-[18px] font-extrabold tracking-tight">{s.code}</h1>
          <StatusBadge tone={toneForStatus(s.status)}>{STATUS_LABEL[s.status] ?? s.status}</StatusBadge>
        </div>
      </div>

      <div className="overflow-hidden rounded-[16px] border border-[var(--line)] bg-[var(--surface)]">
        <div className="relative h-44">
          <MapCanvas
            route={s.status === "COMPLETED" || s.status === "CANCELLED" ? s.route.polyline : undefined}
            markers={[
              { kind: "pickup", lat: s.route.pickup.lat, lng: s.route.pickup.lng },
              { kind: "dropoff", lat: s.route.dropoff.lat, lng: s.route.dropoff.lng },
            ]}
            showLabels={false} className="absolute inset-0" fitPad={130}
          />
        </div>
        <div className="p-4">
          <Row label="Pickup" value={s.route.pickup.name} />
          <Row label="Drop-off" value={s.route.dropoff.name} />
          <Row label="Vehicle" value={`${s.category.name}${s.vehicle ? ` · ${s.vehicle.registration}` : ""}`} />
          <Row label="Driver" value={s.driver ? `${s.driver.name} · ★ ${s.driver.rating.toFixed(1)}` : "—"} />
          <Row label="Distance" value={`${s.route.distanceKm.toFixed(1)} km`} />
          <Row label="Payment" value={s.payment.method === "MPESA" ? "M-PESA" : s.payment.method} />
          <Row label="Total" value={kes(s.fare.total)} strong />
        </div>
      </div>

      {/* POD */}
      {s.pod && (
        <div className="rounded-[16px] border border-[var(--line)] bg-[var(--surface)] p-4">
          <SectionTitle>Proof of delivery</SectionTitle>
          <div className="mt-2">
            <Row label="Received by" value={s.pod.recipient} />
            <Row label="Time" value={fmtDateTimeEAT(s.pod.verifiedAt)} />
            <Row label="Location" value="GPS recorded" />
            <Row label="Photo" value={s.pod.photo ? "Attached" : "—"} />
            <Row label="OTP" value="Verified" />
          </div>
        </div>
      )}

      {/* chain of custody */}
      <div className="rounded-[16px] border border-[var(--line)] bg-[var(--surface)] p-4">
        <SectionTitle>Trip timeline</SectionTitle>
        <div className="mt-3">
          {s.events.map((e) => (
            <div key={e.id} className="flex gap-3 border-l-2 border-[var(--line)] pb-4 pl-4 last:pb-0" style={{ borderColor: e.type === "COMPLETED" ? "var(--success)" : undefined }}>
              <div>
                <p className="text-[13px] font-bold">{e.label}</p>
                <p className="tnum text-[11.5px] font-semibold text-[var(--ink-3)]">{fmtDateTimeEAT(e.at)} · {e.actor.toLowerCase()}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* unrated delivered shipment → rate first */}
      {(s.status === "COMPLETED" || s.status === "POD_CONFIRMED") && !s.ratings.some((r) => r.byRole === "CUSTOMER") && (
        <Button variant="brand" className="w-full" onClick={() => setBookingStep("rate")}>
          Rate this delivery
        </Button>
      )}

      <div className="grid grid-cols-2 gap-2.5">
        {canRepeat && (
          <Button variant="outline" onClick={() => toast({ title: "Book again", description: "Locations, vehicle and cargo pre-filled." })}>
            Book again
          </Button>
        )}
        <Button variant="outline" onClick={() => { setTrackToken(s.shareToken); navigator.clipboard?.writeText(`${location.origin}/?view=track&token=${s.shareToken}`).catch(() => {}); toast({ title: "Tracking link copied" }); }}>
          Share tracking
        </Button>
      </div>
    </div>
  );
}

// ─── Wallet ───
export function WalletScreen() {
  const { user } = useSession();
  const { data } = useQuery({
    queryKey: ["customer-home", user?.id],
    queryFn: () => api<CustomerHome>(`/api/customer?userId=${user!.id}`),
    enabled: !!user,
  });

  return (
    <div className="space-y-4 pb-6">
      <h1 className="px-1 pt-1 text-[24px] font-extrabold tracking-tight">Wallet</h1>

      <SectionTitle>Payment methods</SectionTitle>
      <div className="space-y-2.5">
        {[
          { icon: Smartphone, label: "M-PESA", desc: `0${user?.phone.slice(1) ?? ""} · default`, active: true },
          { icon: Banknote, label: "Cash", desc: "Pay the driver on completion", active: false },
          { icon: CreditCard, label: "Card", desc: "Coming soon", active: false },
        ].map((m) => (
          <div key={m.label} className={`flex items-center gap-3.5 rounded-[14px] border-2 bg-[var(--surface)] p-4 ${m.active ? "border-[var(--brand)]" : "border-[var(--line)]"}`}>
            <span className={`flex h-11 w-11 items-center justify-center rounded-full ${m.active ? "bg-[var(--brand)] text-white" : "bg-[var(--surface-2)] text-[var(--ink-2)]"}`}>
              <m.icon size={18} />
            </span>
            <span className="flex-1">
              <span className="block text-[15px] font-extrabold">{m.label}</span>
              <span className="block text-[12.5px] font-medium text-[var(--ink-2)]">{m.desc}</span>
            </span>
            {m.active && <span className="text-[11px] font-extrabold uppercase tracking-widest text-[var(--brand)]">Active</span>}
          </div>
        ))}
      </div>

      <SectionTitle>Notifications</SectionTitle>
      <div className="overflow-hidden rounded-[16px] border border-[var(--line)] bg-[var(--surface)]">
        {(data?.notifications?.length ?? 0) === 0 ? (
          <EmptyState icon={<Bell size={22} />} title="You're all caught up" body="Delivery updates will appear here." />
        ) : (
          data!.notifications.map((n) => (
            <div key={n.id} className="flex items-start gap-3 border-b border-[var(--line)] px-4 py-3.5 last:border-b-0">
              <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--brand-soft)] text-[var(--brand)]"><Bell size={14} /></span>
              <span className="flex-1">
                <span className="block text-[13.5px] font-bold">{n.title}</span>
                <span className="block text-[12px] font-medium text-[var(--ink-2)]">{n.body}</span>
                <span className="block text-[11px] font-semibold text-[var(--ink-3)]">{relTimeEAT(n.createdAt)}</span>
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

// ─── Account ───
export function AccountScreen() {
  const { user, logout, setSurface, setCustomerTab } = useSession();
  const { data } = useQuery({
    queryKey: ["customer-home", user?.id],
    queryFn: () => api<CustomerHome>(`/api/customer?userId=${user!.id}`),
    enabled: !!user,
  });
  const u = data?.user;

  return (
    <div className="space-y-5 pb-6">
      <h1 className="px-1 pt-1 text-[24px] font-extrabold tracking-tight">Account</h1>

      <div className="flex items-center gap-4 rounded-[16px] border border-[var(--line)] bg-[var(--surface)] p-4">
        <span className="flex h-14 w-14 items-center justify-center rounded-full bg-[var(--ink)] text-[18px] font-extrabold text-white">
          {(u?.name ?? "J").split(" ").map((w) => w[0]).slice(0, 2).join("")}
        </span>
        <div className="flex-1">
          <p className="text-[17px] font-extrabold tracking-tight">{u?.name}</p>
          <p className="tnum text-[13px] font-semibold text-[var(--ink-2)]">0{u?.phone.slice(1) ?? ""}</p>
          {u?.business && <p className="text-[12px] font-bold text-[var(--brand)]">{u.business} · Business</p>}
        </div>
      </div>

      <div className="overflow-hidden rounded-[16px] border border-[var(--line)] bg-[var(--surface)]">
        {[
          { icon: MapPin, label: "Saved places", value: `${data?.saved?.length ?? 0}` },
          { icon: Banknote, label: "Payment methods", value: "M-PESA" },
        ].map((r) => (
          <button key={r.label} onClick={() => setCustomerTab("wallet")} className="flex w-full items-center gap-3.5 border-b border-[var(--line)] px-4 py-4 text-left last:border-b-0 transition hover:bg-[var(--surface-2)]">
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-[var(--surface-2)] text-[var(--ink-2)]"><r.icon size={16} /></span>
            <span className="flex-1 text-[14.5px] font-bold">{r.label}</span>
            <span className="text-[13px] font-semibold text-[var(--ink-3)]">{r.value}</span>
            <ChevronRight size={16} className="text-[var(--ink-3)]" />
          </button>
        ))}
      </div>

      <div className="overflow-hidden rounded-[16px] border border-[var(--line)] bg-[var(--surface)]">
        <div className="border-b border-[var(--line)] px-4 py-4">
          <p className="text-[11.5px] font-extrabold uppercase tracking-widest text-[var(--ink-3)]">Saved places</p>
          {(data?.saved?.length ?? 0) === 0 ? (
            <p className="mt-1 text-[13px] font-medium text-[var(--ink-2)]">No saved places yet.</p>
          ) : (
            <div className="mt-2 space-y-1.5">
              {data!.saved.map((sp) => (
                <div key={sp.id} className="flex items-center gap-3">
                  <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[var(--brand-soft)] text-[10.5px] font-extrabold text-[var(--brand-ink)]">{sp.label.slice(0, 2)}</span>
                  <span className="flex-1 text-[13.5px] font-bold">{sp.name}</span>
                  <span className="text-[12px] font-medium text-[var(--ink-3)]">{sp.area}</span>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="px-4 py-4">
          <p className="text-[11.5px] font-extrabold uppercase tracking-widest text-[var(--ink-3)]">Help &amp; support</p>
          <div className="mt-2 space-y-2">
            <button onClick={() => toast({ title: "Support", description: "Reach us on support@mizigo.demo or 0800 000 000 (sandbox)." })} className="w-full rounded-[10px] bg-[var(--surface-2)] px-4 py-3 text-left text-[13.5px] font-bold">Get help with a delivery</button>
            <button onClick={() => toast({ title: "Safety centre", description: "Verify plates, share tracking, emergency contacts." })} className="w-full rounded-[10px] bg-[var(--surface-2)] px-4 py-3 text-left text-[13.5px] font-bold">Safety centre</button>
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-2.5">
        <Button variant="outline" className="w-full" onClick={() => { setSurface("welcome"); }}>
          Switch to driver app
        </Button>
        <Button variant="ghost" className="w-full" onClick={logout}>
          <LogOut size={15} /> Log out
        </Button>
      </div>
      <p className="text-center text-[11.5px] font-medium text-[var(--ink-3)]">Mizigo · Nairobi, Kenya · v0.1 sandbox</p>
    </div>
  );
}
