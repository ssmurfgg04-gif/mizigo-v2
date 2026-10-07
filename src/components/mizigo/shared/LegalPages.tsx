// MIZIGO legal pages — shared shell. Static, server-rendered, print-friendly.
// These pages exist for two reasons: users deserve plain-language policies,
// and M-Pesa Daraja onboarding requires a live privacy + refund policy on the
// site (see docs/research/KENYA_MARKET_PLAYBOOK.md §7).

import type { ReactNode } from "react";

export function LegalShell({ title, updated, children }: { title: string; updated: string; children: ReactNode }) {
  return (
    <div className="min-h-screen bg-[var(--paper)] px-5 py-8 print:bg-white">
      <div className="mx-auto max-w-2xl">
        <a href="/" className="text-[13px] font-extrabold text-[var(--brand-deep)]">← Back to MIZIGO</a>
        <h1 className="mt-4 text-[28px] font-extrabold tracking-tight">{title}</h1>
        <p className="tnum mt-1 text-[12.5px] font-semibold text-[var(--ink-3)]">Last updated {updated} · MIZIGO, Nairobi, Kenya</p>
        <div className="mt-6 space-y-6 text-[14px] font-medium leading-relaxed text-[var(--ink-2)]">{children}</div>
        <p className="mt-10 border-t border-[var(--line)] pt-4 text-[12px] font-semibold text-[var(--ink-3)]">
          Questions? Call {`0800 724 343`} (free from Safaricom lines) or email legal@mizigo.co.ke · MIZIGO is a product of MIZIGO Ltd, registered in Kenya.
        </p>
        <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-[12.5px] font-bold text-[var(--brand-deep)]">
          <a href="/privacy">Privacy Policy</a>
          <a href="/terms">Terms of Service</a>
          <a href="/refund">Refund Policy</a>
        </div>
      </div>
    </div>
  );
}

export function H2({ children }: { children: ReactNode }) {
  return <h2 className="text-[17px] font-extrabold tracking-tight text-[var(--ink)]">{children}</h2>;
}

export function UL({ items }: { items: ReactNode[] }) {
  return (
    <ul className="list-disc space-y-1.5 pl-5">
      {items.map((item, i) => (
        <li key={i} className="text-left">{item}</li>
      ))}
    </ul>
  );
}
