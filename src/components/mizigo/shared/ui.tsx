"use client";
// MIZIGO domain UI kit — status language, buttons, sheets, empty/error/skeleton states.

import { ReactNode, ButtonHTMLAttributes } from "react";
import { CheckCircle2, Circle, Clock, Loader2, TriangleAlert, XCircle, ChevronRight, SearchX } from "lucide-react";
import { C } from "@/lib/palette";

export function cx(...parts: (string | false | null | undefined)[]) {
  return parts.filter(Boolean).join(" ");
}

// ── Status language: icon + text + color, never color alone ──
type Tone = "success" | "active" | "pending" | "warn" | "danger" | "info" | "neutral";

const TONES: Record<Tone, { wrap: string; icon: ReactNode }> = {
  success: { wrap: "bg-[var(--success-soft)] text-[var(--success)]", icon: <CheckCircle2 size={13} strokeWidth={2.4} /> },
  active: { wrap: "bg-[var(--brand-soft)] text-[var(--brand-deep)]", icon: <Loader2 size={13} strokeWidth={2.4} className="animate-spin" /> },
  pending: { wrap: "bg-[var(--surface-2)] text-[var(--ink-3)]", icon: <Circle size={13} strokeWidth={2.4} /> },
  warn: { wrap: "bg-[var(--warn-soft)] text-[var(--warn)]", icon: <Clock size={13} strokeWidth={2.4} /> },
  danger: { wrap: "bg-[var(--danger-soft)] text-[var(--danger)]", icon: <XCircle size={13} strokeWidth={2.4} /> },
  info: { wrap: "bg-[var(--surface-2)] text-[var(--info)]", icon: <TriangleAlert size={13} strokeWidth={2.4} /> },
  neutral: { wrap: "bg-[var(--surface-2)] text-[var(--ink-2)]", icon: <Circle size={13} strokeWidth={2.4} /> },
};

export function StatusBadge({ tone, children, className = "" }: { tone: Tone; children: ReactNode; className?: string }) {
  const t = TONES[tone];
  return (
    <span className={cx("inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] font-bold", t.wrap, className)}>
      {t.icon}
      {children}
    </span>
  );
}

export function toneForStatus(status: string): Tone {
  if (["COMPLETED", "DELIVERED", "POD_CONFIRMED", "PAYMENT_CONFIRMED"].includes(status)) return "success";
  if (["MATCHING", "DRIVER_ASSIGNED", "DRIVER_EN_ROUTE", "DRIVER_ARRIVED", "LOADING", "LOADED", "IN_TRANSIT", "ARRIVING"].includes(status)) return "active";
  if (["CANCELLED"].includes(status)) return "danger";
  if (["DISPUTED", "NO_DRIVERS"].includes(status)) return "warn";
  if (["PAYMENT_PENDING", "PRICED", "DRAFT"].includes(status)) return "pending";
  return "neutral";
}

// ── Buttons ──
interface BtnProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "ink" | "brand" | "outline" | "ghost" | "danger";
  loading?: boolean;
}

export function Button({ variant = "ink", loading, className = "", children, disabled, ...rest }: BtnProps) {
  const styles: Record<string, string> = {
    ink: "bg-[var(--ink)] text-white hover:bg-[#2A2C33] active:translate-y-px",
    brand: "bg-[var(--brand-deep)] text-white hover:bg-[var(--brand)] active:translate-y-px",
    outline: "border border-[var(--line)] bg-[var(--surface)] text-[var(--ink)] hover:bg-[var(--surface-2)] active:translate-y-px",
    ghost: "text-[var(--ink-2)] hover:bg-[var(--surface-2)] active:translate-y-px",
    danger: "border border-[var(--danger)] text-[var(--danger)] hover:bg-[var(--danger-soft)] active:translate-y-px",
  };
  return (
    <button
      className={cx(
        "inline-flex h-14 items-center justify-center gap-2 rounded-[10px] px-6 text-[15px] font-bold tracking-tight transition-all duration-150 disabled:pointer-events-none disabled:opacity-45",
        styles[variant], className
      )}
      disabled={disabled || loading}
      {...rest}
    >
      {loading && <Loader2 size={17} className="animate-spin" />}
      {children}
    </button>
  );
}

// ── Brand mark ──
export function Logo({ size = "md", wordmark = true, tone = "ink" }: { size?: "sm" | "md" | "lg" | "xl"; wordmark?: boolean; tone?: "ink" | "light" }) {
  const dims = { sm: 20, md: 26, lg: 34, xl: 46 }[size];
  const word = { sm: "text-[15px]", md: "text-[19px]", lg: "text-[25px]", xl: "text-[34px]" }[size];
  const c = tone === "ink" ? "text-[var(--ink)]" : "text-white";
  return (
    <span className={cx("inline-flex items-center gap-2 font-extrabold tracking-[-0.03em]", c)}>
      {/* route-M: an M drawn as a delivery route — origin leg, two arcs, and an
          orange waypoint dot where the cargo lands. Reads as M + map pin. */}
      <svg width={dims} height={dims} viewBox="0 0 32 32" aria-hidden="true">
        <rect x="1" y="1" width="30" height="30" rx="9" fill={tone === "ink" ? C.ink : C.white} />
        <g
          stroke={tone === "ink" ? C.white : C.ink}
          strokeWidth="2.7"
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
        >
          <path d="M8.5 22.7 L8.5 9.3 L13.3 16" />
          <path d="M18.7 16 L23.5 9.3 L23.5 22.7" />
        </g>
        <circle cx="16" cy="18.2" r="2.9" fill={C.brand} />
      </svg>
      {wordmark && <span className={word}>MIZIGO</span>}
    </span>
  );
}

// ── Sections ──
export function SectionTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex items-center justify-between">
      <h2 className="text-[17px] font-extrabold tracking-tight text-[var(--ink)]">{children}</h2>
      {action}
    </div>
  );
}

export function Row({ label, value, strong }: { label: ReactNode; value: ReactNode; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between py-1.5">
      <span className={cx("text-[13.5px]", strong ? "font-bold text-[var(--ink)]" : "font-medium text-[var(--ink-2)]")}>{label}</span>
      <span className={cx("text-[13.5px] tnum", strong ? "font-extrabold text-[var(--ink)]" : "font-semibold text-[var(--ink)]")}>{value}</span>
    </div>
  );
}

// ── States ──
export function EmptyState({ icon, title, body, action }: { icon?: ReactNode; title: string; body: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-8 py-14 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[var(--surface-2)] text-[var(--ink-3)]">
        {icon ?? <SearchX size={22} />}
      </div>
      <div>
        <p className="text-[16px] font-bold text-[var(--ink)]">{title}</p>
        <p className="mt-1 max-w-[260px] text-[13px] font-medium leading-relaxed text-[var(--ink-2)]">{body}</p>
      </div>
      {action}
    </div>
  );
}

export function ErrorState({ title, body, actions }: { title: string; body: string; actions?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-8 py-12 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[var(--danger-soft)] text-[var(--danger)]">
        <TriangleAlert size={22} />
      </div>
      <div>
        <p className="text-[16px] font-bold text-[var(--ink)]">{title}</p>
        <p className="mt-1 max-w-[280px] text-[13px] font-medium leading-relaxed text-[var(--ink-2)]">{body}</p>
      </div>
      {actions && <div className="flex flex-col gap-2 self-stretch">{actions}</div>}
    </div>
  );
}

// Skeletons match final layouts
export function VehicleSkeleton() {
  return (
    <div className="flex items-center gap-4 rounded-[14px] border border-[var(--line)] bg-[var(--surface)] p-4">
      <div className="h-14 w-14 animate-pulse rounded-xl bg-[var(--surface-2)]" />
      <div className="flex-1 space-y-2.5">
        <div className="h-3.5 w-1/3 animate-pulse rounded bg-[var(--surface-2)]" />
        <div className="h-3 w-1/2 animate-pulse rounded bg-[var(--surface-2)]" />
      </div>
      <div className="h-6 w-20 animate-pulse rounded bg-[var(--surface-2)]" />
    </div>
  );
}

export function ListSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="space-y-3">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-4 rounded-[14px] border border-[var(--line)] bg-[var(--surface)] p-4" style={{ opacity: 1 - i * 0.15 }}>
          <div className="h-11 w-11 animate-pulse rounded-full bg-[var(--surface-2)]" />
          <div className="flex-1 space-y-2">
            <div className="h-3 w-2/3 animate-pulse rounded bg-[var(--surface-2)]" />
            <div className="h-2.5 w-1/3 animate-pulse rounded bg-[var(--surface-2)]" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function ChevronLink({ children, onClick }: { children: ReactNode; onClick?: () => void }) {
  return (
    <button type="button" onClick={onClick} className="inline-flex items-center gap-0.5 text-[13px] font-bold text-[var(--brand-deep)]">
      {children}
      <ChevronRight size={14} strokeWidth={2.6} />
    </button>
  );
}

export function Stars({ value, size = 14, className = "" }: { value: number; size?: number; className?: string }) {
  return (
    <span className={cx("inline-flex items-center gap-0.5", className)} aria-label={`${value} out of 5 stars`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <svg key={i} width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
          <path
            d="M12 2.6 L14.9 8.6 L21.5 9.5 L16.7 14.1 L17.9 20.7 L12 17.6 L6.1 20.7 L7.3 14.1 L2.5 9.5 L9.1 8.6 Z"
            fill={i <= Math.round(value) ? C.brand : C.line}
          />
        </svg>
      ))}
    </span>
  );
}

export function AvatarInitials({ initials, size = 46, tone = "ink" }: { initials: string; size?: number; tone?: "ink" | "brand" | "surface" }) {
  const styles = {
    ink: "bg-[var(--ink)] text-white",
    brand: "bg-[var(--brand-deep)] text-white",
    surface: "bg-[var(--surface-2)] text-[var(--ink)]",
  }[tone];
  return (
    <span
      className={cx("inline-flex shrink-0 items-center justify-center rounded-full font-extrabold tracking-tight", styles)}
      style={{ width: size, height: size, fontSize: size * 0.36 }}
      aria-hidden="true"
    >
      {initials}
    </span>
  );
}
