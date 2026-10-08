"use client";
// Install-app affordance (PWA). Chrome/Android fire `beforeinstallprompt` —
// we capture it and surface a one-tap install row. iOS Safari never fires the
// event, so there we show the Share → Add to Home Screen instruction sheet.
// When already running standalone the component renders nothing.

import { useEffect, useState } from "react";
import { Share, Smartphone, PlusCircle, X } from "lucide-react";
import { toast } from "@/hooks/use-toast";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (window.navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

function isIOS(): boolean {
  if (typeof window === "undefined") return false;
  // coarse but sufficient: no beforeinstallprompt support on iOS Safari
  return /iphone|ipad|ipod/i.test(window.navigator.userAgent);
}

/** True when the "Install app" row should render at all. */
export function useCanInstall(): { canInstall: boolean; install: () => void } {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [ios, setIos] = useState(false);
  const [standalone, setStandalone] = useState(true);

  useEffect(() => {
    setStandalone(isStandalone());
    setIos(isIOS());
    const onBip = (e: Event) => {
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
    };
    const onInstalled = () => {
      setDeferred(null);
      setStandalone(true);
    };
    window.addEventListener("beforeinstallprompt", onBip);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onBip);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  const install = () => {
    if (deferred) {
      void deferred.prompt().then(async () => {
        const choice = await deferred.userChoice;
        if (choice.outcome === "accepted") toast({ title: "Installing Mizigo", description: "Look for Mizigo on your home screen." });
        setDeferred(null);
      });
    }
  };

  return { canInstall: !standalone && (!!deferred || ios), install };
}

/** iOS instruction sheet content (also used standalone by the account row). */
export function IosInstallSteps({ onClose }: { onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-6" role="dialog" aria-label="Install app instructions">
      <div className="w-full max-w-md rounded-t-[18px] bg-[var(--surface)] px-6 pb-8 pt-6 sheet-shadow sm:rounded-[18px]">
        <div className="flex items-start justify-between">
          <span className="flex h-11 w-11 items-center justify-center rounded-[12px] bg-[var(--brand-soft)] text-[var(--brand-deep)]"><Smartphone size={20} /></span>
          <button onClick={onClose} className="flex h-9 w-9 items-center justify-center rounded-full bg-[var(--surface-2)]" aria-label="Close">
            <X size={16} />
          </button>
        </div>
        <h2 className="mt-3 text-[20px] font-extrabold tracking-tight">Install Mizigo on your iPhone</h2>
        <p className="mt-1 text-[13.5px] font-medium text-[var(--ink-2)]">It works like a normal app — full screen, its own icon, no app store.</p>
        <ol className="mt-4 space-y-3">
          <li className="flex items-center gap-3 rounded-[12px] bg-[var(--surface-2)] px-4 py-3">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--ink)] text-[13px] font-extrabold text-white">1</span>
            <span className="text-[13.5px] font-semibold">Tap the <span className="font-extrabold">Share</span> button <Share size={13} className="inline" /> in Safari&apos;s toolbar</span>
          </li>
          <li className="flex items-center gap-3 rounded-[12px] bg-[var(--surface-2)] px-4 py-3">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--ink)] text-[13px] font-extrabold text-white">2</span>
            <span className="text-[13.5px] font-semibold">Choose <span className="font-extrabold">Add to Home Screen</span></span>
          </li>
          <li className="flex items-center gap-3 rounded-[12px] bg-[var(--surface-2)] px-4 py-3">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--ink)] text-[13px] font-extrabold text-white">3</span>
            <span className="text-[13.5px] font-semibold">Tap <span className="font-extrabold">Add</span> — Mizigo will be on your home screen</span>
          </li>
        </ol>
      </div>
    </div>
  );
}

/** One-row install affordance for settings/account screens. */
export function InstallAppRow() {
  const { canInstall, install } = useCanInstall();
  const [iosOpen, setIosOpen] = useState(false);
  const [ios, setIos] = useState(false);

  useEffect(() => { setIos(isIOS() && !isStandalone()); }, []);

  if (!canInstall && !ios) return null;

  return (
    <>
      <button
        onClick={() => (ios ? setIosOpen(true) : install())}
        className="flex w-full items-center gap-3.5 px-4 py-4 text-left transition hover:bg-[var(--surface-2)]"
      >
        <span className="flex h-9 w-9 items-center justify-center rounded-full bg-[var(--surface-2)] text-[var(--ink-2)]"><PlusCircle size={16} /></span>
        <span className="flex-1 text-[14.5px] font-bold">Install app</span>
        <span className="text-[12px] font-semibold text-[var(--ink-3)]">Home screen</span>
      </button>
      {iosOpen && <IosInstallSteps onClose={() => setIosOpen(false)} />}
    </>
  );
}
