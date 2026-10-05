"use client";
// Customer onboarding: phone → OTP → account type. Mock OTP is shown in-app (sandbox).

import { useState } from "react";
import { ArrowLeft, ArrowRight, Building2, Smartphone, User } from "lucide-react";
import { Button, Logo, AvatarInitials } from "@/components/mizigo/shared/ui";
import { post } from "@/lib/api-client";
import { fmtPhone } from "@/lib/format";
import { useSession } from "@/store/session";
import { toast } from "@/hooks/use-toast";

export default function Onboarding() {
  const { setUser, setSurface } = useSession();
  const [step, setStep] = useState<"phone" | "otp" | "usage">("phone");
  const [phone, setPhone] = useState("");
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [devCode, setDevCode] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [accountType, setAccountType] = useState<"PERSONAL" | "BUSINESS">("PERSONAL");
  const [businessName, setBusinessName] = useState("");

  const requestOtp = async () => {
    const p = phone.replace(/\D/g, "");
    if (!/^0(7|1)\d{8}$/.test(p)) {
      toast({ title: "Check the number", description: "Enter a Kenyan number like 0712 345 678.", variant: "destructive" });
      return;
    }
    setBusy(true);
    try {
      const r = await post<{ devCode: string }>("/api/auth", { action: "otp", phone: p });
      setDevCode(r.devCode);
      setStep("otp");
    } catch (e) {
      toast({ title: "Couldn't send code", description: (e as Error).message, variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  const verify = async () => {
    if (code.replace(/\D/g, "").length !== 6) {
      toast({ title: "Enter the 6-digit code" });
      return;
    }
    setBusy(true);
    try {
      await post("/api/auth", { action: "verify", phone: phone.replace(/\D/g, ""), code, role: "CUSTOMER" });
      setStep("usage");
    } catch (e) {
      toast({ title: "Wrong code", description: (e as Error).message, variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  const finish = async () => {
    setBusy(true);
    try {
      const r = await post<{ user: { id: string; phone: string; name: string; role: string; accountType: string; businessName: string | null; avatarSeed: string } }>("/api/auth", {
        action: "verify", phone: phone.replace(/\D/g, ""), code, name: name || undefined, accountType, businessName: businessName || undefined, role: "CUSTOMER",
      });
      setUser(r.user);
    } catch (e) {
      toast({ title: "Couldn't set up your account", description: (e as Error).message, variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  const demoLogin = async (p: string) => {
    setPhone(p);
    setBusy(true);
    try {
      const r = await post<{ user: { id: string; phone: string; name: string; role: string; accountType: string; businessName: string | null; avatarSeed: string } }>("/api/auth", {
        action: "verify", phone: p, code: "000000",
      });
      setUser(r.user);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-full flex-col bg-[var(--paper)]">
      {/* splash */}
      {step === "phone" && (
        <div className="relative flex min-h-full flex-1 flex-col">
          <div className="flex flex-1 flex-col items-center justify-center px-8 text-center">
            <div className="animate-mz-fade-in">
              <Logo size="xl" />
              <p className="mt-3 text-[14px] font-semibold text-[var(--ink-2)]">Move anything. Anywhere.</p>
            </div>
          </div>
          <div className="animate-mz-slide-up rounded-t-[18px] bg-[var(--surface)] px-6 pb-8 pt-7 sheet-shadow">
            <h1 className="text-[24px] font-extrabold leading-tight tracking-tight">Moving something?</h1>
            <p className="mt-1.5 text-[13.5px] font-medium leading-relaxed text-[var(--ink-2)]">
              Book the right vehicle and track your delivery from pickup to drop-off.
            </p>
            <label className="mt-6 block">
              <span className="text-[12px] font-bold uppercase tracking-wide text-[var(--ink-3)]">Phone number</span>
              <div className="mt-2 flex h-14 items-center gap-3 rounded-[10px] border border-[var(--line)] bg-[var(--surface)] px-4 focus-within:border-[var(--brand)]">
                <span className="flex items-center gap-1.5 border-r border-[var(--line)] pr-3 text-[15px] font-bold text-[var(--ink)]">
                  <Smartphone size={15} /> +254
                </span>
                <input
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && requestOtp()}
                  placeholder="712 345 678"
                  inputMode="tel"
                  className="h-full w-full bg-transparent text-[16px] font-semibold tracking-wide outline-none placeholder:font-medium placeholder:text-[var(--ink-3)]"
                  aria-label="Phone number"
                />
              </div>
            </label>
            <Button className="mt-4 w-full" onClick={requestOtp} loading={busy}>
              Continue <ArrowRight size={16} strokeWidth={2.6} />
            </Button>
            <div className="mt-5 border-t border-[var(--line)] pt-4">
              <p className="text-center text-[11.5px] font-semibold uppercase tracking-wide text-[var(--ink-3)]">Sandbox demo</p>
              <div className="mt-2.5 grid grid-cols-2 gap-2">
                <button onClick={() => demoLogin("0712000001")} className="flex items-center gap-2 rounded-[10px] border border-[var(--line)] px-3 py-2.5 text-left transition hover:bg-[var(--surface-2)]">
                  <AvatarInitials initials="JK" size={32} tone="ink" />
                  <span className="text-[12px] font-bold leading-tight">John K.<br /><span className="font-medium text-[var(--ink-3)]">Personal</span></span>
                </button>
                <button onClick={() => demoLogin("0722000033")} className="flex items-center gap-2 rounded-[10px] border border-[var(--line)] px-3 py-2.5 text-left transition hover:bg-[var(--surface-2)]">
                  <AvatarInitials initials="AB" size={32} tone="brand" />
                  <span className="text-[12px] font-bold leading-tight">ABC Traders<br /><span className="font-medium text-[var(--ink-3)]">Business</span></span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {step === "otp" && (
        <div className="flex min-h-full flex-1 flex-col px-6 pb-8 pt-6">
          <button onClick={() => setStep("phone")} className="flex h-11 w-11 items-center justify-center rounded-[10px] border border-[var(--line)]" aria-label="Back">
            <ArrowLeft size={18} />
          </button>
          <h1 className="mt-6 text-[26px] font-extrabold leading-tight tracking-tight">Enter the code</h1>
          <p className="mt-1.5 text-[13.5px] font-medium text-[var(--ink-2)]">
            We sent a 6-digit code to <span className="font-bold text-[var(--ink)]">+254 {fmtPhone(phone)}</span>
          </p>
          {devCode && (
            <div className="mt-4 rounded-[10px] border border-dashed border-[var(--brand)] bg-[var(--brand-soft)] px-4 py-3 text-[13px] font-semibold text-[var(--brand-ink)]">
              Sandbox SMS: your code is <span className="tnum text-[15px] font-extrabold">{devCode}</span>
            </div>
          )}
          <input
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
            onKeyDown={(e) => e.key === "Enter" && verify()}
            inputMode="numeric"
            placeholder="••••••"
            className="tnum mt-6 h-16 w-full rounded-[12px] border border-[var(--line)] bg-[var(--surface)] text-center text-[28px] font-extrabold tracking-[0.35em] outline-none focus:border-[var(--brand)]"
            aria-label="6 digit code"
          />
          <Button className="mt-5 w-full" onClick={verify} loading={busy}>Verify</Button>
          <div className="mt-4 flex justify-between text-[13px] font-semibold">
            <button onClick={requestOtp} className="text-[var(--brand)]">Resend code</button>
            <button onClick={() => setStep("phone")} className="text-[var(--ink-2)]">Change number</button>
          </div>
        </div>
      )}

      {step === "usage" && (
        <div className="flex min-h-full flex-1 flex-col px-6 pb-8 pt-6">
          <h1 className="mt-2 text-[26px] font-extrabold leading-tight tracking-tight">What are you using Mizigo for?</h1>
          <p className="mt-1.5 text-[13.5px] font-medium text-[var(--ink-2)]">We&apos;ll tailor receipts and saved places to how you move things.</p>
          <div className="mt-6 space-y-3">
            <button
              onClick={() => setAccountType("PERSONAL")}
              className={`flex w-full items-center gap-4 rounded-[14px] border-2 p-4 text-left transition ${accountType === "PERSONAL" ? "border-[var(--brand)] bg-[var(--brand-soft)]" : "border-[var(--line)] bg-[var(--surface)]"}`}
            >
              <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-[var(--ink)] text-white"><User size={20} /></span>
              <span>
                <span className="block text-[15px] font-extrabold">Personal</span>
                <span className="block text-[12.5px] font-medium text-[var(--ink-2)]">Moving house, deliveries, one-off jobs</span>
              </span>
            </button>
            <button
              onClick={() => setAccountType("BUSINESS")}
              className={`flex w-full items-center gap-4 rounded-[14px] border-2 p-4 text-left transition ${accountType === "BUSINESS" ? "border-[var(--brand)] bg-[var(--brand-soft)]" : "border-[var(--line)] bg-[var(--surface)]"}`}
            >
              <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-[var(--brand-deep)] text-white"><Building2 size={20} /></span>
              <span>
                <span className="block text-[15px] font-extrabold">Business</span>
                <span className="block text-[12.5px] font-medium text-[var(--ink-2)]">Shop stock, invoices, multiple bookings</span>
              </span>
            </button>
          </div>
          {accountType === "BUSINESS" && (
            <label className="mt-4 block animate-mz-fade-in">
              <span className="text-[12px] font-bold uppercase tracking-wide text-[var(--ink-3)]">Business name</span>
              <input
                value={businessName} onChange={(e) => setBusinessName(e.target.value)}
                placeholder="e.g. ABC Traders Ltd"
                className="mt-2 h-14 w-full rounded-[10px] border border-[var(--line)] bg-[var(--surface)] px-4 text-[15px] font-semibold outline-none focus:border-[var(--brand)]"
              />
            </label>
          )}
          <label className="mt-4 block">
            <span className="text-[12px] font-bold uppercase tracking-wide text-[var(--ink-3)]">Your name</span>
            <input
              value={name} onChange={(e) => setName(e.target.value)}
              placeholder="e.g. John Kariuki"
              className="mt-2 h-14 w-full rounded-[10px] border border-[var(--line)] bg-[var(--surface)] px-4 text-[15px] font-semibold outline-none focus:border-[var(--brand)]"
            />
          </label>
          <div className="mt-auto pt-6">
            <Button className="w-full" onClick={finish} loading={busy}>Start moving <ArrowRight size={16} strokeWidth={2.6} /></Button>
          </div>
        </div>
      )}
    </div>
  );
}
