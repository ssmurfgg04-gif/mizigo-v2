"use client";
// Customer home — the most important screen. Booking card first, active delivery
// dominating when present, recent deliveries below. No dashboard vanity.

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { ArrowRight, Bell, ChevronRight, Clock3, Home as HomeIcon, MapPin, Package, PackageOpen, Sofa, Building2, HardHat, Star } from "lucide-react";
import { api } from "@/lib/api-client";
import type { CustomerHome } from "@/lib/types";
import { kes, etaText, relTimeEAT, fmtTimeEAT } from "@/lib/format";
import { useSession } from "@/store/session";
import { t } from "@/lib/i18n";
import { Button, ChevronLink, EmptyState, ErrorState, ListSkeleton, SectionTitle, StatusBadge, toneForStatus, Stars } from "@/components/mizigo/shared/ui";
import MapCanvas from "@/components/mizigo/shared/MapCanvas";
import VehicleAvatar from "@/components/mizigo/shared/VehicleAvatar";
import ReturnLoadDeals from "./ReturnLoadDeals";
import NotificationsSheet from "./NotificationsSheet";
import { isRateable } from "./RatingSheet";
import { SystemNotifications } from "./useSystemNotifications";
import { STATUS_LABEL } from "@/lib/state-machine";

const SHORTCUTS = [
  { key: "household", label: "Move household", icon: HomeIcon },
  { key: "furniture", label: "Deliver furniture", icon: Sofa },
  { key: "retail", label: "Business delivery", icon: Building2 },
  { key: "construction", label: "Construction materials", icon: HardHat },
];

export default function HomeScreen() {
  const { user, setBookingStep, setCustomerTab, setFocusShipment, setRatingShipment, setSurface, draft, patchDraft, lang } = useSession();
  const [notifOpen, setNotifOpen] = useState(false);
  const q = useQuery({
    queryKey: ["customer-home", user?.id],
    queryFn: () => api<CustomerHome>("/api/customer"),
    enabled: !!user,
    retry: 1,
    refetchInterval: (query) => (query.state.data?.active ? 2500 : 15000),
  });
  const d = q.data;

  const hour = new Date().getUTCHours() + 3; // EAT
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  const firstName = (d?.user?.name ?? user?.name ?? "").split(" ")[0] || "there";
  const business = d?.user?.accountType === "BUSINESS" ? d.user.businessName : null;

  const startBooking = (category?: string) => {
    if (category) useSession.getState().patchDraft({ category });
    setBookingStep("cargo");
  };

  const active = d?.active;
  const recent = (d?.trips ?? []).filter((t) => !["CANCELLED"].includes(t.status)).slice(0, 3);
  const isQuoted = active?.status === "QUOTED";
  // most recent unrated terminal delivery → persistent "Rate your driver" banner
  const rateTarget = (d?.trips ?? []).find((t) => isRateable(t)) ?? (active && isRateable(active) ? active : null);
  const unread = d?.unread ?? (d?.notifications ?? []).filter((n) => !n.read).length;

  if (q.isError) {
    return (
      <div className="pt-6">
        <ErrorState
          title="Couldn't load your home"
          body="Check your connection and try again."
          actions={<Button variant="brand" onClick={() => q.refetch()}>Try again</Button>}
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5 pb-6">
      {/* header */}
      <header className="flex items-start justify-between px-1 pt-1">
        <div>
          <p className="text-[13px] font-semibold text-[var(--ink-3)]">{greeting}{business ? "" : ","}</p>
          <h1 className="text-[24px] font-extrabold tracking-tight">{business ?? `${firstName}`}</h1>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setNotifOpen(true)} className="relative flex h-11 w-11 items-center justify-center rounded-full border border-[var(--line)] bg-[var(--surface)]" aria-label={`Notifications${unread > 0 ? ` (${unread} unread)` : ""}`}>
            <Bell size={18} />
            {unread > 0 && (
              <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-[var(--brand-deep)] px-1 text-[10.5px] font-extrabold leading-none text-white" aria-hidden="true">
                {unread > 9 ? "9+" : unread}
              </span>
            )}
          </button>
          <button onClick={() => setCustomerTab("account")} className="flex h-11 w-11 items-center justify-center rounded-full bg-[var(--ink)] text-[15px] font-extrabold text-white" aria-label="Account">
            {firstName.slice(0, 1)}
          </button>
        </div>
      </header>

      {/* rate your driver — the same deep-link as the rate notification */}
      {rateTarget && (
        <button
          onClick={() => {
            setFocusShipment(rateTarget.id);
            setRatingShipment(rateTarget.id);
            setCustomerTab("trips");
          }}
          className="flex w-full items-center gap-3.5 rounded-[16px] border-2 border-[var(--brand)] bg-[var(--brand-soft)] p-4 text-left transition hover:brightness-[0.99] active:translate-y-px"
        >
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[var(--brand)] text-white" aria-hidden="true">
            <Star size={18} className="fill-white" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[14.5px] font-extrabold tracking-tight text-[var(--brand-ink)]">Rate your driver</span>
            <span className="block truncate text-[12.5px] font-semibold text-[var(--ink-2)]">
              {rateTarget.driver ? `${rateTarget.driver.name.split(" ")[0]} · ` : ""}{rateTarget.route.pickup.area} → {rateTarget.route.dropoff.area}
            </span>
          </span>
          <ChevronRight size={16} className="shrink-0 text-[var(--brand-deep)]" />
        </button>
      )}

      {/* active delivery dominates when present */}
      {q.isLoading ? (
        <div className="h-40 animate-pulse rounded-[16px] bg-[var(--surface-2)]" />
      ) : isQuoted && active ? (
        /* quote collection card (plan §33) */
        <button
          onClick={() => { setFocusShipment(active.id); setBookingStep("quotes"); }}
          className="w-full rounded-[16px] border-2 border-[var(--brand)] bg-[var(--surface)] p-4 text-left transition active:translate-y-px"
        >
          <div className="flex items-center justify-between">
            <StatusBadge tone="active">Collecting driver quotes</StatusBadge>
            <span className="tnum text-[12px] font-bold text-[var(--ink-3)]">{active.code}</span>
          </div>
          <p className="mt-2.5 text-[15.5px] font-extrabold tracking-tight">{active.route.pickup.area} → {active.route.dropoff.area}</p>
          <p className="mt-0.5 text-[12.5px] font-semibold text-[var(--ink-2)]">
            {active.quotes.filter((x) => x.status === "PENDING").length} quote{active.quotes.filter((x) => x.status === "PENDING").length === 1 ? "" : "s"} so far · {active.category.name} job
          </p>
          <span className="mt-2.5 inline-flex items-center gap-1 text-[13px] font-bold text-[var(--brand-deep)]">
            Compare quotes <ChevronRight size={14} strokeWidth={2.8} />
          </span>
        </button>
      ) : active ? (
        <button
          onClick={() => { setFocusShipment(active.id); setBookingStep("active"); }}
          className="overflow-hidden rounded-[16px] border border-[var(--line)] bg-[var(--surface)] text-left brand-shadow transition active:translate-y-px"
        >
          <div className="relative h-36">
            <MapCanvas
              route={active.route.polyline}
              markers={[
                { kind: "vehicle", lat: active.live?.lat ?? active.route.pickup.lat, lng: active.live?.lng ?? active.route.pickup.lng, heading: active.live?.heading ?? 0 },
                { kind: "pickup", lat: active.route.pickup.lat, lng: active.route.pickup.lng },
                { kind: "dropoff", lat: active.route.dropoff.lat, lng: active.route.dropoff.lng },
              ]}
              showLabels={false}
              className="absolute inset-0"
              fitPad={170}
            />
            <div className="absolute left-3 top-3">
              <StatusBadge tone={toneForStatus(active.status)}>{STATUS_LABEL[active.status] ?? active.status}</StatusBadge>
            </div>
          </div>
          <div className="p-4">
            <p className="text-[15.5px] font-extrabold tracking-tight">
              {active.status === "IN_TRANSIT" || active.status === "ARRIVING" ? "Your delivery is on the way" : STATUS_LABEL[active.status]}
              {active.live?.etaMin != null && active.live.etaMin > 0 && active.live.leg !== "IDLE" ? ` · ${etaText(active.live.etaMin)}` : ""}
            </p>
            <p className="mt-1 flex flex-wrap items-center gap-1.5 text-[13px] font-semibold text-[var(--ink-2)]">
              {active.driver && <>{active.driver.name.split(" ")[0]} · {active.category.name} · </>}
              {active.route.pickup.area} → {active.route.dropoff.area}
            </p>
            {active.scheduledAt && active.status === "MATCHING" && (
              <p className="mt-1 text-[12px] font-bold text-[var(--ink-3)]">Scheduled · {fmtTimeEAT(active.scheduledAt)}</p>
            )}
            <span className="mt-3 inline-flex items-center gap-1.5 text-[13.5px] font-bold text-[var(--brand-deep)]">
              Track delivery <ChevronRight size={15} strokeWidth={2.8} />
            </span>
          </div>
        </button>
      ) : (
        /* booking card */
        <section className="rounded-[16px] border border-[var(--line)] bg-[var(--surface)] p-5 brand-shadow">
          <h2 className="text-[21px] font-extrabold leading-tight tracking-tight">{t("home.heroTitle", lang)}</h2>
          <p className="mt-1 text-[13px] font-medium text-[var(--ink-2)]">{t("home.heroSub", lang)}</p>

          <button
            onClick={() => startBooking()}
            className="mt-4 flex w-full items-center gap-3.5 rounded-[12px] border border-[var(--line)] bg-[var(--surface)] px-4 py-3.5 text-left transition hover:border-[var(--ink-3)]"
          >
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[var(--success-soft)] text-[var(--success)]"><MapPin size={17} strokeWidth={2.4} /></span>
            <span className="min-w-0 flex-1">
              <span className="block text-[10.5px] font-extrabold uppercase tracking-widest text-[var(--ink-3)]">From</span>
              <span className="block truncate text-[14.5px] font-bold">Pickup location</span>
            </span>
          </button>
          <button
            onClick={() => startBooking()}
            className="mt-2.5 flex w-full items-center gap-3.5 rounded-[12px] border border-[var(--line)] bg-[var(--surface)] px-4 py-3.5 text-left transition hover:border-[var(--ink-3)]"
          >
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[var(--brand-soft)] text-[var(--brand-deep)]"><Package size={17} strokeWidth={2.4} /></span>
            <span className="min-w-0 flex-1">
              <span className="block text-[10.5px] font-extrabold uppercase tracking-widest text-[var(--ink-3)]">To</span>
              <span className="block truncate text-[14.5px] font-bold">Where should it go?</span>
            </span>
          </button>

          <div className="mt-3.5 grid grid-cols-2 gap-2.5">
            <button
              onClick={() => { patchDraft({ when: "NOW", scheduledAt: null }); startBooking(); }}
              className={`rounded-[12px] border-2 bg-[var(--surface-2)] px-3.5 py-3 text-left transition ${draft.when === "NOW" ? "border-[var(--brand)]" : "border-[var(--line)]"}`}
            >
              <span className="text-[10.5px] font-extrabold uppercase tracking-widest text-[var(--ink-3)]">How soon?</span>
              <p className="mt-0.5 flex items-center gap-1.5 text-[13.5px] font-bold"><Clock3 size={13} /> {t("home.now", lang)}</p>
            </button>
            <button
              onClick={() => { patchDraft({ when: "SCHEDULE" }); startBooking(); }}
              className={`rounded-[12px] border-2 bg-[var(--surface-2)] px-3.5 py-3 text-left transition ${draft.when === "SCHEDULE" ? "border-[var(--brand)]" : "border-[var(--line)]"}`}
            >
              <span className="text-[10.5px] font-extrabold uppercase tracking-widest text-[var(--ink-3)]">Schedule</span>
              <p className="mt-0.5 text-[13.5px] font-bold text-[var(--ink-2)]">{t("home.schedule", lang)}</p>
            </button>
          </div>

          <Button variant="brand" className="mt-4 w-full" onClick={() => startBooking()}>
            {t("home.startDelivery", lang)} <ArrowRight size={16} strokeWidth={2.6} />
          </Button>
        </section>
      )}

      {/* shortcuts */}
      <section className="grid grid-cols-4 gap-2.5">
        {SHORTCUTS.map((s) => (
          <button
            key={s.key}
            onClick={() => startBooking(s.key)}
            className="flex flex-col items-center gap-2 rounded-[14px] border border-[var(--line)] bg-[var(--surface)] px-2 py-3.5 transition hover:border-[var(--ink-3)] active:translate-y-px"
          >
            <span className="flex h-10 w-10 items-center justify-center rounded-full bg-[var(--surface-2)] text-[var(--ink)]"><s.icon size={17} strokeWidth={2.2} /></span>
            <span className="text-center text-[10.5px] font-bold leading-tight text-[var(--ink-2)]">{s.label}</span>
          </button>
        ))}
      </section>

      {/* return-load deals — v1's empty-leg marketplace */}
      <ReturnLoadDeals />

      {/* business quick metrics */}
      {business && (
        <section className="rounded-[16px] bg-[var(--ink)] p-5 text-white">
          <div className="grid grid-cols-3 gap-3 text-center">
            <div>
              <p className="tnum text-[20px] font-extrabold">{d?.stats.completed ?? 0}</p>
              <p className="text-[11px] font-semibold text-white/60">Completed</p>
            </div>
            <div>
              <p className="tnum text-[20px] font-extrabold">{kes(d?.stats.spent ?? 0, { compact: true }).replace("KES ", "")}</p>
              <p className="text-[11px] font-semibold text-white/60">Total spent</p>
            </div>
            <div>
              <p className="tnum text-[20px] font-extrabold">{d?.saved?.length ?? 0}</p>
              <p className="text-[11px] font-semibold text-white/60">Saved places</p>
            </div>
          </div>
        </section>
      )}

      {/* recent deliveries */}
      <section>
        <SectionTitle action={<ChevronLink onClick={() => setCustomerTab("trips")}>{t("home.allDeliveries", lang)}</ChevronLink>}>{t("home.recent", lang)}</SectionTitle>
        <div className="mt-3">
          {q.isLoading ? (
            <ListSkeleton rows={2} />
          ) : recent.length === 0 ? (
            <EmptyState
              icon={<PackageOpen size={22} />}
              title={t("home.noDeliveries", lang)}
              body={t("home.noDeliveriesBody", lang)}
              action={<Button variant="outline" onClick={() => startBooking()}>{t("home.moveSomething", lang)}</Button>}
            />
          ) : (
            <div className="space-y-2.5">
              {recent.map((t) => (
                <button
                  key={t.id}
                  onClick={() => { setFocusShipment(t.id); setCustomerTab("trips"); }}
                  className="flex w-full items-center gap-3.5 rounded-[14px] border border-[var(--line)] bg-[var(--surface)] p-3.5 text-left transition hover:border-[var(--ink-3)] active:translate-y-px"
                >
                  <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-[var(--surface-2)]">
                    <VehicleAvatar category={t.category.key} size={34} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[14px] font-bold">{t.route.pickup.area} → {t.route.dropoff.area}</span>
                    <span className="mt-0.5 block text-[12px] font-medium text-[var(--ink-3)]">
                      {relTimeEAT(t.createdAt)} · {t.cargo.items.reduce((a, i) => a + i.qty, 0)} items
                    </span>
                  </span>
                  <span className="text-right">
                    <span className="tnum block text-[14px] font-extrabold">{kes(t.fare.total)}</span>
                    <StatusBadge tone={toneForStatus(t.status)} className="mt-1">
                      {t.status === "COMPLETED" ? "Delivered" : STATUS_LABEL[t.status]}
                    </StatusBadge>
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* driver CTA */}
      <button onClick={() => setSurface("welcome")} className="mx-auto mt-2 text-[12.5px] font-bold text-[var(--ink-3)] underline decoration-dotted underline-offset-4">
        Drive &amp; earn with Mizigo
      </button>

      {notifOpen && (
        <NotificationsSheet notifications={d?.notifications ?? []} trips={d?.trips} active={d?.active} onClose={() => setNotifOpen(false)} />
      )}

      {/* background system notifications (Web Notifications API) */}
      <SystemNotifications />
    </div>
  );
}
