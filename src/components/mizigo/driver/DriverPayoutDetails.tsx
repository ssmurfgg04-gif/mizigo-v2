"use client";
// Driver payout destination — where the money lands (marketplace hold-then-
// payout). Set once: M-Pesa wallet (default, cheapest transfer rail) or a
// Kenyan bank account. Saved via /api/driver action payout-setup, which
// creates the reusable Paystack transfer recipient server-side.
// The account number never leaves the server after saving (only masked display).

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Banknote, Check, Smartphone } from "lucide-react";
import { api, post } from "@/lib/api-client";
import type { DriverHome } from "@/lib/types";
import { formatPhoneInput, normalizeKePhone } from "@/lib/format";
import { Button, Row, SectionTitle } from "@/components/mizigo/shared/ui";
import { toast } from "@/hooks/use-toast";

interface Bank {
  name: string;
  code: string;
  type: "mobile_money" | "kepss" | string;
}

export default function DriverPayoutDetails({ data }: { data: DriverHome }) {
  const qc = useQueryClient();
  const saved = data.driver.payout;
  const [editing, setEditing] = useState(!saved?.recipientCode);
  const [kind, setKind] = useState<"mobile_money" | "kepss">(
    saved?.type === "kepss" ? "kepss" : "mobile_money",
  );
  const [account, setAccount] = useState(saved?.accountNumber?.replace(/^254/, "0") ?? "");
  const [bankCode, setBankCode] = useState(saved?.bankCode ?? "");
  const [busy, setBusy] = useState(false);

  const { data: bankList } = useQuery({
    queryKey: ["payout-banks"],
    queryFn: () => api<{ banks: Bank[] }>("/api/paystack/banks"),
    staleTime: 24 * 60 * 60_000,
    enabled: editing,
  });
  const banks = bankList?.banks ?? [];
  const wallets = banks.filter((b) => b.type === "mobile_money");
  const keBanks = banks.filter((b) => b.type === "kepss");

  const save = async () => {
    const trimmed = account.trim();
    if (!trimmed) {
      toast({ title: "Enter your account details", variant: "destructive" });
      return;
    }
    if (kind === "mobile_money" && !normalizeKePhone(trimmed)) {
      toast({ title: "Check the number", description: "Enter your M-Pesa number like 0712 345 678.", variant: "destructive" });
      return;
    }
    if (kind === "kepss" && !bankCode) {
      toast({ title: "Choose your bank", variant: "destructive" });
      return;
    }
    setBusy(true);
    try {
      const r = await post<{ note: string }>("/api/driver/action", {
        action: "payout-setup",
        type: kind,
        accountNumber: kind === "mobile_money" ? normalizeKePhone(trimmed) : trimmed.replace(/\s/g, ""),
        bankCode: kind === "mobile_money" ? "MPESA" : bankCode,
      });
      toast({ title: "Payout details saved", description: r.note });
      setEditing(false);
      await qc.invalidateQueries({ queryKey: ["driver-home"] });
    } catch (e) {
      toast({ title: "Couldn't save", description: (e as Error).message, variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-[16px] border border-[var(--line)] bg-[var(--surface)] p-4">
      <SectionTitle>Where we pay you</SectionTitle>

      {!editing && saved?.recipientCode ? (
        <div className="mt-3">
          <div className="flex items-center gap-3 rounded-[12px] bg-[var(--surface-2)] px-4 py-3.5">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[var(--success-soft)] text-[var(--success)]">
              {saved.type === "kepss" ? <Banknote size={17} /> : <Smartphone size={17} />}
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[14px] font-extrabold">{saved.bankName ?? (saved.type === "kepss" ? "Bank account" : "M-PESA")}</p>
              <p className="tnum text-[12.5px] font-semibold text-[var(--ink-2)]">
                {saved.type === "kepss" ? `Account ${saved.accountNumber}` : `0${(saved.accountNumber ?? "").replace(/^254/, "")}`}
              </p>
            </div>
            <span className="flex items-center gap-1 text-[11px] font-extrabold uppercase tracking-widest text-[var(--success)]">
              <Check size={13} strokeWidth={3} /> Active
            </span>
          </div>
          <p className="mt-2 text-[12px] font-medium leading-relaxed text-[var(--ink-2)]">
            Your share of every completed delivery is sent here automatically after proof of delivery — no withdrawal needed.
          </p>
          <button onClick={() => setEditing(true)} className="mt-2 text-[12.5px] font-bold text-[var(--brand-deep)] underline underline-offset-4">
            Change payout details
          </button>
        </div>
      ) : (
        <div className="mt-3 space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => setKind("mobile_money")}
              className={`flex items-center gap-2 rounded-[12px] border-2 px-3 py-3 text-left transition ${kind === "mobile_money" ? "border-[var(--brand)] bg-[var(--brand-soft)]" : "border-[var(--line)]"}`}
            >
              <Smartphone size={16} className={kind === "mobile_money" ? "text-[var(--brand-deep)]" : "text-[var(--ink-3)]"} />
              <span>
                <span className="block text-[13px] font-extrabold">M-Pesa</span>
                <span className="block text-[11px] font-semibold text-[var(--ink-3)]">Fastest · lowest fee</span>
              </span>
            </button>
            <button
              onClick={() => setKind("kepss")}
              className={`flex items-center gap-2 rounded-[12px] border-2 px-3 py-3 text-left transition ${kind === "kepss" ? "border-[var(--brand)] bg-[var(--brand-soft)]" : "border-[var(--line)]"}`}
            >
              <Banknote size={16} className={kind === "kepss" ? "text-[var(--brand-deep)]" : "text-[var(--ink-3)]"} />
              <span>
                <span className="block text-[13px] font-extrabold">Bank</span>
                <span className="block text-[11px] font-semibold text-[var(--ink-3)]">Kenyan account</span>
              </span>
            </button>
          </div>

          <label className="block">
            <span className="text-[11.5px] font-bold uppercase tracking-widest text-[var(--ink-3)]">
              {kind === "mobile_money" ? "M-Pesa number" : "Account number"}
            </span>
            <input
              value={account}
              onChange={(e) => setAccount(kind === "mobile_money" ? formatPhoneInput(e.target.value) : e.target.value.replace(/[^\w\s-]/g, "").slice(0, 20))}
              placeholder={kind === "mobile_money" ? "0712 345 678" : "e.g. 1234567890"}
              inputMode={kind === "mobile_money" ? "tel" : "numeric"}
              className="tnum mt-1.5 h-12 w-full rounded-[10px] border border-[var(--line)] bg-[var(--surface)] px-3.5 text-[14px] font-semibold outline-none focus:border-[var(--brand)]"
            />
          </label>

          {kind === "kepss" && (
            <label className="block">
              <span className="text-[11.5px] font-bold uppercase tracking-widest text-[var(--ink-3)]">Bank</span>
              <select
                value={bankCode}
                onChange={(e) => setBankCode(e.target.value)}
                className="mt-1.5 h-12 w-full rounded-[10px] border border-[var(--line)] bg-[var(--surface)] px-3 text-[14px] font-semibold outline-none focus:border-[var(--brand)]"
              >
                <option value="">Choose your bank…</option>
                {keBanks.map((b) => (
                  <option key={b.code} value={b.code}>{b.name}</option>
                ))}
              </select>
            </label>
          )}

          {kind === "mobile_money" && wallets.length > 0 && (
            <p className="text-[11.5px] font-medium text-[var(--ink-3)]">
              {wallets.find((w) => w.code === "MPESA")?.name ?? "M-PESA"} selected. Airtel and Telkom wallets are available on request from support.
            </p>
          )}

          <div className="flex gap-2">
            <Button variant="brand" className="flex-1" onClick={save} loading={busy}>Save payout details</Button>
            {saved?.recipientCode && (
              <Button variant="outline" onClick={() => setEditing(false)}>Cancel</Button>
            )}
          </div>
          <Row label="First payout" value="After your first completed delivery" />
        </div>
      )}
    </div>
  );
}
