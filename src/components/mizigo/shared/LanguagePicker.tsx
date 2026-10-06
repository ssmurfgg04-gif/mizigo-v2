"use client";
// Language picker bottom sheet — 18 languages from the offline dictionary
// (src/lib/i18n.ts). Selection persists via the existing session store
// (useSession().lang, zustand-persisted to localStorage "mizigo-session").
//
// RTL: selecting Arabic sets document.documentElement.dir = "rtl" (any other
// language resets it to "ltr") and the lang attribute — document-level only;
// the effect runs whenever this component mounts (Account tab) and on every
// change, so RTL applies inside the reachable customer shell. The sheet itself
// uses logical utilities (text-start etc.) so it renders correctly in both
// directions without touching globals.css.
//
// NOTE: the brief mentioned "useSettings lang" — reading the code showed
// language state actually lives in useSession (src/store/session.ts);
// useSettings holds platform bootstrap settings only. This picker therefore
// reads/writes the real existing lang store instead of duplicating state.

import { useEffect, useMemo, useState } from "react";
import { Check, Languages, Search, X } from "lucide-react";
import { LANGUAGES, t, type Lang } from "@/lib/i18n";
import { useSession } from "@/store/session";
import { toast } from "@/hooks/use-toast";

export function LanguagePicker({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { lang } = useSession();

  // document-level dir/lang switching (RTL for ar). Runs on mount of the host
  // tab and on every language change — see the RTL note above.
  useEffect(() => {
    const meta = LANGUAGES.find((l) => l.code === lang);
    document.documentElement.dir = meta?.rtl ? "rtl" : "ltr";
    document.documentElement.lang = lang;
  }, [lang]);

  // The sheet is a separate mount-on-open component so its search state resets
  // naturally each time it opens (no reset effect needed).
  if (!open) return null;
  return <LanguageSheet lang={lang} onClose={onClose} />;
}

function LanguageSheet({ lang, onClose }: { lang: Lang; onClose: () => void }) {
  const { setLang } = useSession();
  const [q, setQ] = useState("");

  // Escape closes the sheet
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // 18 rows > 8 → search filter (native name, English name or code)
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return LANGUAGES;
    return LANGUAGES.filter((l) =>
      [l.nativeName, l.englishName, l.code].some((v) => v.toLowerCase().includes(needle))
    );
  }, [q]);

  const pick = (code: Lang) => {
    setLang(code);
    onClose();
    toast({ title: t("language.updated", code) });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end bg-[rgba(23,24,28,0.45)]" onClick={onClose}>
      <div
        className="flex max-h-[82vh] w-full animate-mz-slide-up flex-col rounded-t-[18px] bg-[var(--surface)] sheet-shadow"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Language"
      >
        {/* header */}
        <div className="flex items-center gap-3 border-b border-[var(--line)] px-5 py-4">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[var(--brand-soft)] text-[var(--brand-deep)]">
            <Languages size={17} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[16px] font-extrabold tracking-tight">{t("account.language", lang)}</p>
            <p className="text-[11.5px] font-semibold text-[var(--ink-3)]">{LANGUAGES.length} languages</p>
          </div>
          <button onClick={onClose} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[var(--surface-2)]" aria-label="Close language picker">
            <X size={17} />
          </button>
        </div>

        {/* search */}
        <div className="border-b border-[var(--line)] px-5 py-3">
          <label className="flex items-center gap-2.5 rounded-[12px] bg-[var(--surface-2)] px-3.5 py-2.5">
            <Search size={15} className="shrink-0 text-[var(--ink-3)]" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={t("language.search", lang)}
              aria-label={t("language.search", lang)}
              autoComplete="off"
              className="w-full bg-transparent text-[13.5px] font-semibold text-[var(--ink)] outline-none placeholder:text-[var(--ink-3)]"
            />
          </label>
        </div>

        {/* list */}
        <div className="thin-scrollbar min-h-0 flex-1 overflow-y-auto px-2.5 py-2.5">
          {filtered.length === 0 ? (
            <p className="py-8 text-center text-[13px] font-medium text-[var(--ink-3)]">No languages found</p>
          ) : (
            filtered.map((l) => {
              const active = l.code === lang;
              return (
                <button
                  key={l.code}
                  onClick={() => pick(l.code)}
                  aria-current={active ? "true" : undefined}
                  className={`flex min-h-[44px] w-full items-center gap-3 rounded-[12px] px-3 py-2.5 text-start transition ${active ? "bg-[var(--brand-soft)]" : "hover:bg-[var(--surface-2)]"}`}
                >
                  <span className="min-w-0 flex-1">
                    <span className={`block truncate text-[14px] ${active ? "font-extrabold text-[var(--brand-ink)]" : "font-bold"}`}>{l.nativeName}</span>
                    {l.englishName !== l.nativeName && (
                      <span className="block text-[11.5px] font-semibold text-[var(--ink-3)]">{l.englishName}</span>
                    )}
                  </span>
                  {active && <Check size={17} className="shrink-0 text-[var(--brand-deep)]" />}
                </button>
              );
            })
          )}
        </div>

        {/* iOS safe area */}
        <div className="pb-[env(safe-area-inset-bottom)]" />
      </div>
    </div>
  );
}
