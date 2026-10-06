"use client";
// MIZIGO OpsTab — live operations telemetry (perf task 10-E).
// Standalone, props-less: AdminApp mounts it on the "telemetry" tab later.
// Data: GET /api/admin?tab=telemetry → { telemetry: { metrics, business, recent } }
// Auto-refreshes every 10s (TanStack Query). Design tokens match the console.

import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Activity, AlertTriangle, ArrowDownRight, ArrowRight, ArrowUpRight, CheckCircle2,
  Clock3, Gauge, ListChecks, Loader2, RefreshCw, XCircle,
} from "lucide-react";
import { api } from "@/lib/api-client";
import { Button, ErrorState, SectionTitle, StatusBadge } from "@/components/mizigo/shared/ui";

// ── payload types (mirror src/lib/telemetry.ts) ─────────────────────────────

interface RouteSnapshot {
  count: number;
  errors: number;
  p50: number;
  p95: number;
  max: number;
}

interface TelemetryPayload {
  telemetry: {
    metrics: {
      startedAt: string;
      routes: Record<string, RouteSnapshot>;
      totalRequests: number;
      totalErrors: number;
    };
    business: {
      timeToMatchMin: number | null;
      completionRate: number;
      cancellationRate: number;
      onTimeRate: number;
      onTimeSample: number;
      shipmentTotal: number;
    };
    recent: {
      ts: string;
      traceId: string;
      level: string;
      route: string;
      action?: string;
      shipmentId?: string;
      ok?: boolean;
      latencyMs?: number;
      status?: number;
    }[];
  };
}

// ── helpers ──────────────────────────────────────────────────────────────────

/** Latency colour scale (ms): fast → success, moderate → warn, slow → danger. */
function latencyTone(ms: number): string {
  if (ms < 150) return "text-[var(--success)]";
  if (ms < 600) return "text-[var(--warn)]";
  return "text-[var(--danger)]";
}

function Trend({ current, previous, upIsGood }: { current: number | null; previous: number | null; upIsGood: boolean }) {
  if (current === null || previous === null || previous === current) {
    return <ArrowRight size={14} className="text-[var(--ink-3)]" aria-label="no change" />;
  }
  const up = current > previous;
  const good = up === upIsGood;
  return up ? (
    <ArrowUpRight size={14} className={good ? "text-[var(--success)]" : "text-[var(--danger)]"} aria-label="trending up" />
  ) : (
    <ArrowDownRight size={14} className={good ? "text-[var(--success)]" : "text-[var(--danger)]"} aria-label="trending down" />
  );
}

function pct(v: number): string {
  return `${Math.round(v * 100)}%`;
}

function fmtTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  } catch {
    return iso;
  }
}

// ── component ────────────────────────────────────────────────────────────────

export default function OpsTab() {
  const queryClient = useQueryClient();
  const { data, isLoading, isError, error, isFetching, refetch } = useQuery({
    queryKey: ["admin-telemetry"],
    queryFn: () => api<TelemetryPayload>("/api/admin?tab=telemetry"),
    refetchInterval: 10_000,
  });

  // trend arrows need the previous snapshot (kept across refetches) —
  // stored in state (ref reads during render are forbidden by the React
  // compiler lint and unsafe under concurrent rendering)
  const business = data?.telemetry.business ?? null;
  const [history, setHistory] = useState<{ cur: TelemetryPayload["telemetry"]["business"] | null; prev: TelemetryPayload["telemetry"]["business"] | null }>({ cur: null, prev: null });
  // render-phase adjust (React's blessed "previous value" pattern): when a
  // fresh snapshot arrives, the old current becomes prev — no effect, no
  // cascading setState
  if (business && business !== history.cur) {
    setHistory({ cur: business, prev: history.cur });
  }

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center gap-3 p-6 text-[14px] font-bold text-[var(--ink-2)]" role="status" aria-live="polite">
        <Loader2 size={18} className="animate-spin" /> Loading telemetry…
      </div>
    );
  }

  if (isError) {
    return (
      <div className="p-6">
        <ErrorState
          title="Telemetry unavailable"
          body={(error as Error)?.message ?? "Could not load the telemetry snapshot."}
          actions={<Button variant="ink" onClick={() => refetch()}>Try again</Button>}
        />
      </div>
    );
  }

  const t = data!.telemetry;
  const b = t.business;
  const routes = Object.entries(t.metrics.routes).sort((a, x) => x[1].p95 - a[1].p95); // slowest first
  const events = [...t.recent].reverse(); // newest first
  const prev = history.prev;

  const businessKpis = [
    { label: "Avg time to match", value: b.timeToMatchMin != null ? `${b.timeToMatchMin} min` : "—", icon: Clock3, cur: b.timeToMatchMin, prev: prev?.timeToMatchMin ?? null, upIsGood: false, tone: "ink" as const },
    { label: "Completion rate", value: pct(b.completionRate), icon: CheckCircle2, cur: b.completionRate, prev: prev?.completionRate ?? null, upIsGood: true, tone: "success" as const },
    { label: "Cancellation rate", value: pct(b.cancellationRate), icon: XCircle, cur: b.cancellationRate, prev: prev?.cancellationRate ?? null, upIsGood: false, tone: "danger" as const },
    { label: "On-time delivery", value: pct(b.onTimeRate), icon: ListChecks, cur: b.onTimeRate, prev: prev?.onTimeRate ?? null, upIsGood: true, tone: "ink" as const },
  ];

  return (
    <div className="p-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-[22px] font-extrabold tracking-tight">Operations telemetry</h1>
          <p className="text-[13px] font-medium text-[var(--ink-2)]">
            Per-instance request health + marketplace quality · since {fmtTime(t.metrics.startedAt)}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <StatusBadge tone="active"><Activity size={12} /> Live · every 10s</StatusBadge>
          <Button
            variant="outline"
            onClick={() => {
              void queryClient.invalidateQueries({ queryKey: ["admin-telemetry"] });
            }}
            aria-label="Refresh telemetry now"
          >
            {isFetching ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />} Refresh
          </Button>
        </div>
      </header>

      {/* headline counters */}
      <div className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <div className="rounded-[12px] border border-[var(--line)] bg-[var(--surface)] p-4">
          <p className="text-[11px] font-bold uppercase tracking-widest text-[var(--ink-3)]">Requests served</p>
          <p className="tnum mt-1.5 text-[24px] font-extrabold tracking-tight">{t.metrics.totalRequests.toLocaleString()}</p>
        </div>
        <div className="rounded-[12px] border border-[var(--line)] bg-[var(--surface)] p-4">
          <p className="text-[11px] font-bold uppercase tracking-widest text-[var(--ink-3)]">Failed requests</p>
          <p className={`tnum mt-1.5 text-[24px] font-extrabold tracking-tight ${t.metrics.totalErrors ? "text-[var(--danger)]" : "text-[var(--success)]"}`}>
            {t.metrics.totalErrors.toLocaleString()}
          </p>
        </div>
        <div className="rounded-[12px] border border-[var(--line)] bg-[var(--surface)] p-4">
          <p className="text-[11px] font-bold uppercase tracking-widest text-[var(--ink-3)]">Routes tracked</p>
          <p className="tnum mt-1.5 text-[24px] font-extrabold tracking-tight">{routes.length}</p>
        </div>
        <div className="rounded-[12px] border border-[var(--line)] bg-[var(--surface)] p-4">
          <p className="text-[11px] font-bold uppercase tracking-widest text-[var(--ink-3)]">Shipments on record</p>
          <p className="tnum mt-1.5 text-[24px] font-extrabold tracking-tight">{b.shipmentTotal.toLocaleString()}</p>
        </div>
      </div>

      {/* business metrics with trend arrows */}
      <section aria-label="Business metrics" className="mt-5">
        <SectionTitle>Marketplace health</SectionTitle>
        <div className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
          {businessKpis.map((k) => (
            <div key={k.label} className="rounded-[12px] border border-[var(--line)] bg-[var(--surface)] p-4">
              <div className="flex items-center justify-between">
                <p className="text-[11px] font-bold uppercase tracking-widest text-[var(--ink-3)]">{k.label}</p>
                <Trend current={k.cur} previous={k.prev} upIsGood={k.upIsGood} />
              </div>
              <p className={`tnum mt-1.5 text-[24px] font-extrabold tracking-tight ${k.tone === "success" ? "text-[var(--success)]" : k.tone === "danger" ? "text-[var(--danger)]" : ""}`}>
                {k.value}
              </p>
            </div>
          ))}
        </div>
        <p className="mt-2 text-[11.5px] font-medium text-[var(--ink-3)]">
          On-time = paid → proof-of-delivery within the quoted duration + 20% grace · sample {b.onTimeSample} · trends compare against the previous 10s snapshot.
        </p>
      </section>

      {/* per-route latency */}
      <section aria-label="Route latency" className="mt-6">
        <SectionTitle>Route latency (p50 / p95)</SectionTitle>
        <div className="mt-3 overflow-hidden rounded-[14px] border border-[var(--line)] bg-[var(--surface)]">
          <table className="w-full text-left text-[13px]">
            <thead>
              <tr className="border-b border-[var(--line)] text-[11px] font-bold uppercase tracking-widest text-[var(--ink-3)]">
                <th scope="col" className="px-4 py-3">Route</th>
                <th scope="col" className="px-4 py-3 text-right">Requests</th>
                <th scope="col" className="px-4 py-3 text-right">p50</th>
                <th scope="col" className="px-4 py-3 text-right">p95</th>
                <th scope="col" className="px-4 py-3 text-right">Max</th>
                <th scope="col" className="px-4 py-3 text-right">Errors</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--line)]">
              {routes.map(([route, m]) => (
                <tr key={route} className="transition hover:bg-[var(--surface-2)]">
                  <td className="px-4 py-3 font-bold"><span className="inline-flex items-center gap-2"><Gauge size={13} className="text-[var(--ink-3)]" />{route}</span></td>
                  <td className="tnum px-4 py-3 text-right font-semibold">{m.count.toLocaleString()}</td>
                  <td className={`tnum px-4 py-3 text-right font-bold ${latencyTone(m.p50)}`}>{m.p50} ms</td>
                  <td className={`tnum px-4 py-3 text-right font-bold ${latencyTone(m.p95)}`}>{m.p95} ms</td>
                  <td className="tnum px-4 py-3 text-right font-semibold text-[var(--ink-2)]">{m.max} ms</td>
                  <td className={`tnum px-4 py-3 text-right font-bold ${m.errors ? "text-[var(--danger)]" : "text-[var(--ink-3)]"}`}>
                    {m.errors ? <span className="inline-flex items-center gap-1.5"><AlertTriangle size={13} />{m.errors}</span> : "0"}
                  </td>
                </tr>
              ))}
              {routes.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center font-medium text-[var(--ink-2)]">
                    No requests recorded yet — traffic will appear here.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-[11.5px] font-medium text-[var(--ink-3)]">
          Colour scale: <span className="font-bold text-[var(--success)]">under 150 ms</span> · <span className="font-bold text-[var(--warn)]">150–600 ms</span> · <span className="font-bold text-[var(--danger)]">over 600 ms</span>
        </p>
      </section>

      {/* recent events */}
      <section aria-label="Recent events" className="mt-6">
        <SectionTitle>Recent events (last 50)</SectionTitle>
        <div className="mt-3 max-h-96 divide-y divide-[var(--line)] overflow-y-auto rounded-[14px] border border-[var(--line)] bg-[var(--surface)] thin-scrollbar">
          {events.map((e) => (
            <div key={e.traceId} className="flex items-center gap-3 px-4 py-2.5 text-[12.5px]">
              <span className="tnum w-[72px] shrink-0 font-bold text-[var(--ink-3)]">{fmtTime(e.ts)}</span>
              {e.ok === false || e.level === "error" ? (
                <XCircle size={14} className="shrink-0 text-[var(--danger)]" aria-label="failed" />
              ) : (
                <CheckCircle2 size={14} className="shrink-0 text-[var(--success)]" aria-label="ok" />
              )}
              <span className="min-w-0 flex-1 truncate font-bold">{e.route}{e.action ? <span className="font-medium text-[var(--ink-3)]"> · {e.action}</span> : ""}</span>
              {e.shipmentId && <span className="hidden shrink-0 font-medium text-[var(--ink-3)] sm:inline" title={e.shipmentId}>…{e.shipmentId.slice(-6)}</span>}
              {e.latencyMs !== undefined && <span className={`tnum shrink-0 font-bold ${latencyTone(e.latencyMs)}`}>{e.latencyMs} ms</span>}
            </div>
          ))}
          {events.length === 0 && (
            <p className="px-4 py-8 text-center text-[13px] font-medium text-[var(--ink-2)]">No events yet.</p>
          )}
        </div>
      </section>
    </div>
  );
}
