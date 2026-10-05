"use client";
// Trips, Wallet, Account — the secondary customer surfaces.

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Banknote, Bell, ChevronRight, CreditCard, FileText, Languages, LogOut, MapPin, PackageOpen, Smartphone, Trash2, ChevronDown } from "lucide-react";
import { api, post } from "@/lib/api-client";
import type { CustomerHome, ShipmentDTO } from "@/lib/types";
import { useSession } from "@/store/session";
import { Button, EmptyState, ListSkeleton, Row, SectionTitle, StatusBadge, toneForStatus } from "@/components/mizigo/shared/ui";
import VehicleAvatar from "@/components/mizigo/shared/VehicleAvatar";
import MapCanvas from "@/components/mizigo/shared/MapCanvas";
import { kes, fmtDateTimeEAT, relTimeEAT } from "@/lib/format";
import { STATUS_LABEL, ACTIVE_STATES } from "@/lib/state-machine";
import { LANGUAGES, t } from "@/lib/i18n";
import { toast } from "@/hooks/use-toast";
import { shareTrackLink } from "@/components/mizigo/shared/share";
import { useSettings } from "@/components/mizigo/shared/useSettings";

// ─── Trips ───
export function TripsScreen() {
  const { user, focusShipmentId, setFocusShipment, setBookingStep } = useSession();
  const [tab, setTab] = useState<"ALL" | "ACTIVE" | "COMPLETED" | "CANCELLED">("ALL");

  const { data, isLoading } = useQuery({
    queryKey: ["customer-home", user?.id],
    queryFn: () => api<CustomerHome>("/api/customer"),
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
  const { setBookingStep, setFocusShipment, setTrackToken, patchDraft, resetDraft } = useSession();
  const [podOpen, setPodOpen] = useState(true);
  const canRepeat = s.status === "COMPLETED";

  // plan §70 Book again: preload locations, cargo and vehicle from this trip
  const bookAgain = () => {
    resetDraft(true);
    patchDraft({
      repeatOf: s.id,
      category: s.cargo.category,
      items: s.cargo.items.map((i) => ({ name: i.name, qty: i.qty, weightKg: i.weightKg })),
      load: s.cargo.load,
      helpers: s.cargo.helpers,
      special: s.cargo.special,
      pickup: { name: s.route.pickup.name, area: s.route.pickup.area, category: "saved", lat: s.route.pickup.lat, lng: s.route.pickup.lng },
      dropoff: { name: s.route.dropoff.name, area: s.route.dropoff.area, category: "saved", lat: s.route.dropoff.lat, lng: s.route.dropoff.lng },
      selectedVehicle: s.category.key,
      promoCode: "",
      quoteMode: false,
    });
    setBookingStep("review");
    toast({ title: "Delivery pre-filled", description: `Same cargo and route as ${s.code}. Review and confirm.` });
  };

  const downloadPod = () => {
    const pod = [
      "MIZIGO — PROOF OF DELIVERY",
      `Delivery ID: ${s.code}`,
      `Date: ${fmtDateTimeEAT(s.pod?.verifiedAt ?? s.createdAt)}`,
      `Customer: ${s.customer.name}`,
      `Driver: ${s.driver?.name ?? "—"}`,
      `Vehicle: ${s.vehicle ? `${s.vehicle.make} ${s.vehicle.model} · ${s.vehicle.registration}` : "—"}`,
      `Pickup: ${s.route.pickup.name}`,
      `Destination: ${s.route.dropoff.name}`,
      "",
      "CARGO",
      ...s.cargo.items.map((i) => `  ${i.name} × ${i.qty}${i.weightKg ? ` (${i.weightKg} kg)` : ""}`),
      "",
      "DELIVERY STATUS: COMPLETED",
      `Received by: ${s.pod?.recipient ?? "—"}`,
      `OTP: verified`,
      `Time: ${s.pod ? fmtDateTimeEAT(s.pod.verifiedAt) : "—"}`,
      "Location: GPS recorded",
      `Photos: ${s.pod?.photo ? "attached" : "—"}`,
      "",
      `TOTAL: ${kes(s.fare.total)} · ${s.payment.method === "MPESA" ? "M-PESA" : s.payment.method} ${s.payment.ref ? `· ${s.payment.ref}` : ""}`,
    ].join("\n");
    const blob = new Blob([pod], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `MIZIGO-POD-${s.code}.txt`;
    a.click();
    URL.revokeObjectURL(url);
    toast({ title: "POD downloaded", description: `${s.code} · delivery record saved.` });
  };

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
          <div className="flex items-center justify-between">
            <SectionTitle>Proof of delivery</SectionTitle>
            <button onClick={downloadPod} className="flex items-center gap-1.5 text-[12.5px] font-bold text-[var(--brand)]">
              <FileText size={13} /> Download
            </button>
          </div>
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

      {/* live delivery opened from anywhere → straight to the live map */}
      {ACTIVE_STATES.includes(s.status as never) && (
        <Button variant="brand" className="w-full" onClick={() => setBookingStep("active")}>
          Track delivery live
        </Button>
      )}

      {/* unrated delivered shipment → rate first */}
      {(s.status === "COMPLETED" || s.status === "POD_CONFIRMED") && !s.ratings.some((r) => r.byRole === "CUSTOMER") && (
        <Button variant="brand" className="w-full" onClick={() => setBookingStep("rate")}>
          Rate this delivery
        </Button>
      )}

      <div className="grid grid-cols-2 gap-2.5">
        {canRepeat && (
          <Button variant="brand" className={s.status === "DISPUTED" ? "col-span-2" : ""} onClick={bookAgain}>
            Book again
          </Button>
        )}
        <Button variant="outline" onClick={() => { void shareTrackLink(s.id); }}>
          Share tracking
        </Button>
      </div>

      {!["CANCELLED"].includes(s.status) && (
        <button onClick={() => setBookingStep("problem")} className="w-full text-center text-[12.5px] font-bold text-[var(--ink-3)] underline decoration-dotted underline-offset-4">
          Something wrong? Report a problem
        </button>
      )}
    </div>
  );
}

// ─── Wallet ───
export function WalletScreen() {
  const { user, setFocusShipment, setCustomerTab } = useSession();
  const { data, isLoading } = useQuery({
    queryKey: ["customer-home", user?.id],
    queryFn: () => api<CustomerHome>("/api/customer"),
    enabled: !!user,
  });

  // plan §40: deep-link a notification into the relevant trip
  const openNotification = (code: string | null) => {
    if (!code) return;
    const target = [...(data?.active ? [data.active] : []), ...(data?.trips ?? [])].find((t) => t.code === code);
    if (target) {
      setFocusShipment(target.id);
      setCustomerTab("trips");
    } else {
      toast({ title: "Delivery not found", description: "This delivery may have been removed." });
    }
  };

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
        {isLoading ? (
          <div className="px-4 py-6"><ListSkeleton rows={2} /></div>
        ) : (data?.notifications?.length ?? 0) === 0 ? (
          <EmptyState icon={<Bell size={22} />} title="You're all caught up" body="Delivery updates will appear here." />
        ) : (
          data!.notifications.map((n) => (
            <button
              key={n.id}
              onClick={() => openNotification(n.shipmentCode)}
              className="flex w-full items-start gap-3 border-b border-[var(--line)] px-4 py-3.5 text-left transition last:border-b-0 hover:bg-[var(--surface-2)]"
            >
              <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--brand-soft)] text-[var(--brand)]"><Bell size={14} /></span>
              <span className="flex-1">
                <span className="block text-[13.5px] font-bold">{n.title}</span>
                <span className="block text-[12px] font-medium text-[var(--ink-2)]">{n.body}</span>
                <span className="block text-[11px] font-semibold text-[var(--ink-3)]">{relTimeEAT(n.createdAt)}{n.shipmentCode && n.shipmentCode !== "recent" ? ` · ${n.shipmentCode}` : ""}</span>
              </span>
              <ChevronRight size={15} className="mt-1.5 shrink-0 text-[var(--ink-3)]" />
            </button>
          ))
        )}
      </div>
    </div>
  );
}

// ─── Account ───
export function AccountScreen() {
  const { user, logout, setSurface, setCustomerTab, lang, setLang } = useSession();
  const qc = useQueryClient();
  const settings = useSettings();
  const { data } = useQuery({
    queryKey: ["customer-home", user?.id],
    queryFn: () => api<CustomerHome>("/api/customer"),
    enabled: !!user,
  });
  const u = data?.user;

  const removePlace = async (placeId: string) => {
    if (!user) return;
    try {
      await post("/api/customer", { action: "remove-place", userId: user.id, placeId });
      await qc.invalidateQueries({ queryKey: ["customer-home"] });
      await qc.invalidateQueries({ queryKey: ["locations"] });
      toast({ title: "Place removed" });
    } catch (e) {
      toast({ title: "Couldn't remove place", description: (e as Error).message, variant: "destructive" });
    }
  };

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
          {u?.businessName && <p className="text-[12px] font-bold text-[var(--brand)]">{u.businessName} · Business</p>}
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
            <p className="mt-1 text-[13px] font-medium text-[var(--ink-2)]">No saved places yet. Star a location while booking to save it.</p>
          ) : (
            <div className="mt-2 space-y-1.5">
              {data!.saved.map((sp) => (
                <div key={sp.id} className="flex items-center gap-3">
                  <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[var(--brand-soft)] text-[10.5px] font-extrabold text-[var(--brand-ink)]">{sp.label.slice(0, 2)}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13.5px] font-bold">{sp.name}</span>
                    <span className="block text-[12px] font-medium text-[var(--ink-3)]">{sp.label} · {sp.area}</span>
                  </span>
                  <button onClick={() => removePlace(sp.id)} className="text-[var(--ink-3)] transition hover:text-[var(--danger)]" aria-label={`Remove ${sp.name}`}>
                    <Trash2 size={15} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* business invoices (plan §23) */}
        {u?.accountType === "BUSINESS" && (
          <div className="border-b border-[var(--line)] px-4 py-4">
            <p className="text-[11.5px] font-extrabold uppercase tracking-widest text-[var(--ink-3)]">Monthly invoices · VAT</p>
            {(data?.invoices?.length ?? 0) === 0 ? (
              <p className="mt-1 text-[13px] font-medium text-[var(--ink-2)]">Invoices appear after your first completed delivery.</p>
            ) : (
              <div className="mt-2 space-y-2">
                {data!.invoices.map((inv) => (
                  <div key={inv.month} className="rounded-[12px] bg-[var(--surface-2)] px-3.5 py-3">
                    <div className="flex items-center justify-between">
                      <span className="text-[13.5px] font-extrabold">{new Date(inv.month + "-01").toLocaleDateString("en-KE", { month: "long", year: "numeric" })}</span>
                      <span className="text-[11px] font-bold text-[var(--success)]">{inv.deliveries} deliveries</span>
                    </div>
                    <div className="mt-1.5">
                      <Row label="Net" value={kes(inv.net)} />
                      <Row label="VAT (16%)" value={kes(inv.vat)} />
                      <Row label="Total due" value={kes(inv.total)} strong />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* language (plan §62) */}
        <div className="border-b border-[var(--line)] px-4 py-4">
          <p className="flex items-center gap-1.5 text-[11.5px] font-extrabold uppercase tracking-widest text-[var(--ink-3)]"><Languages size={12} /> {t("account.language", lang)}</p>
          <div className="mt-2 flex gap-2">
            {LANGUAGES.map((l) => (
              <button
                key={l.key}
                onClick={() => setLang(l.key)}
                className={`flex-1 rounded-[10px] border-2 px-3 py-2.5 text-[13px] font-bold transition ${lang === l.key ? "border-[var(--brand)] bg-[var(--brand-soft)] text-[var(--brand-ink)]" : "border-[var(--line)] text-[var(--ink-2)]"}`}
              >
                {l.label}
              </button>
            ))}
          </div>
        </div>

        <div className="px-4 py-4">
          <p className="text-[11.5px] font-extrabold uppercase tracking-widest text-[var(--ink-3)]">Help &amp; support</p>
          <div className="mt-2 space-y-2">
            <a href={`tel:${settings.supportPhone.replace(/\s/g, "")}`} className="block rounded-[10px] bg-[var(--surface-2)] px-4 py-3 text-[13.5px] font-bold">Get help with a delivery · {settings.supportPhone}</a>
            <button onClick={() => toast({ title: "Safety centre", description: `Verify plates, share tracking and goods-in-transit cover live from an active trip (Get help → Safety centre). 24/7 line: ${settings.supportPhone}` })} className="w-full rounded-[10px] bg-[var(--surface-2)] px-4 py-3 text-left text-[13.5px] font-bold">Safety centre</button>
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-2.5">
        <Button variant="outline" className="w-full" onClick={() => { setSurface("welcome"); }}>
          Switch to driver app
        </Button>
        <Button variant="ghost" className="w-full" onClick={() => { post("/api/auth", { action: "logout" }).catch(() => null); logout(); }}>
          <LogOut size={15} /> Log out
        </Button>
      </div>
      <p className="text-center text-[11.5px] font-medium text-[var(--ink-3)]">Mizigo · Nairobi, Kenya · v2 sandbox</p>
    </div>
  );
}
