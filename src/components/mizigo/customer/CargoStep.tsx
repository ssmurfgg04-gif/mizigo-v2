"use client";
// Cargo step — the differentiator. Category → items → rough size → special needs.

import { useMemo, useState } from "react";
import { Minus, Plus, Trash2, Sofa, Refrigerator, Package, HardHat, Wheat, ShoppingBag, Tv, Cog, Box, LucideIcon } from "lucide-react";
import { Button } from "@/components/mizigo/shared/ui";
import { CARGO_CATEGORIES, LOAD_SIZES, SPECIAL_HANDLING } from "@/lib/pricing";
import { useSession } from "@/store/session";
import { toast } from "@/hooks/use-toast";

const CAT_ICONS: Record<string, LucideIcon> = {
  furniture: Sofa, appliances: Refrigerator, household: Package, construction: HardHat,
  farm: Wheat, retail: ShoppingBag, electronics: Tv, machinery: Cog, other: Box,
};

export default function CargoStep({ categories }: { categories: { key: string; name: string }[] }) {
  const { draft, patchDraft, setBookingStep } = useSession();
  const [itemSearch, setItemSearch] = useState("");
  const cat = CARGO_CATEGORIES.find((c) => c.key === draft.category);
  const itemCount = draft.items.reduce((a, i) => a + i.qty, 0);

  const suggestions = useMemo(() => {
    if (!cat) return [];
    const s = itemSearch.toLowerCase();
    return cat.items.filter((i) => !s || i.toLowerCase().includes(s)).slice(0, 6);
  }, [cat, itemSearch]);

  const addItem = (name: string) => {
    const existing = draft.items.find((i) => i.name.toLowerCase() === name.toLowerCase());
    if (existing) {
      patchDraft({ items: draft.items.map((i) => (i.name === existing.name ? { ...i, qty: i.qty + 1 } : i)) });
    } else {
      patchDraft({ items: [...draft.items, { name, qty: 1, weightKg: 0 }] });
    }
    setItemSearch("");
  };

  const setQty = (name: string, delta: number) => {
    const next = draft.items
      .map((i) => (i.name === name ? { ...i, qty: i.qty + delta } : i))
      .filter((i) => i.qty > 0);
    patchDraft({ items: next });
  };

  const next = () => {
    if (!draft.category) {
      toast({ title: "Pick what you're moving", description: "Choose a cargo type to continue." });
      return;
    }
    setBookingStep("pickup");
  };

  return (
    <div className="space-y-6">
      {/* categories */}
      <div className="grid grid-cols-3 gap-2.5">
        {CARGO_CATEGORIES.map((c) => {
          const Icon = CAT_ICONS[c.key] ?? Box;
          const active = draft.category === c.key;
          return (
            <button
              key={c.key}
              onClick={() => patchDraft({ category: c.key })}
              className={`flex flex-col items-center gap-2 rounded-[14px] border-2 px-2 py-3.5 transition active:translate-y-px ${active ? "border-[var(--brand)] bg-[var(--brand-soft)]" : "border-[var(--line)] bg-[var(--surface)] hover:border-[var(--ink-3)]"}`}
              aria-pressed={active}
            >
              <Icon size={20} strokeWidth={2.1} className={active ? "text-[var(--brand)]" : "text-[var(--ink-2)]"} />
              <span className={`text-center text-[10.5px] font-bold leading-tight ${active ? "text-[var(--brand-ink)]" : "text-[var(--ink-2)]"}`}>{c.label}</span>
            </button>
          );
        })}
      </div>

      {cat && (
        <div className="animate-mz-fade-in space-y-6">
          {/* item builder */}
          <section className="rounded-[16px] border border-[var(--line)] bg-[var(--surface)] p-4">
            <p className="text-[15px] font-extrabold tracking-tight">Add items</p>
            <p className="mt-0.5 text-[12.5px] font-medium text-[var(--ink-2)]">Tap what you&apos;re moving. Quantities matter more than weights.</p>
            <div className="mt-3 flex h-12 items-center rounded-[10px] border border-[var(--line)] bg-[var(--surface)] px-3.5 focus-within:border-[var(--brand)]">
              <input
                value={itemSearch}
                onChange={(e) => setItemSearch(e.target.value)}
                placeholder={`Search ${cat.label.toLowerCase()} items…`}
                className="h-full w-full bg-transparent text-[14px] font-semibold outline-none placeholder:font-medium placeholder:text-[var(--ink-3)]"
                aria-label="Search items"
              />
            </div>
            {suggestions.length > 0 && (
              <div className="mt-2.5 flex flex-wrap gap-2">
                {suggestions.map((s) => (
                  <button key={s} onClick={() => addItem(s)} className="rounded-full border border-[var(--line)] bg-[var(--surface-2)] px-3.5 py-2 text-[13px] font-bold transition hover:border-[var(--brand)] hover:text-[var(--brand)]">
                    + {s}
                  </button>
                ))}
              </div>
            )}

            {draft.items.length > 0 && (
              <div className="mt-3.5 space-y-1 divide-y divide-[var(--line)] border-t border-[var(--line)] pt-1.5">
                {draft.items.map((i) => (
                  <div key={i.name} className="flex items-center gap-3 py-2.5">
                    <span className="min-w-0 flex-1 truncate text-[14px] font-bold">{i.name}</span>
                    <div className="flex items-center gap-1">
                      <button onClick={() => setQty(i.name, -1)} className="flex h-9 w-9 items-center justify-center rounded-full border border-[var(--line)] transition hover:bg-[var(--surface-2)]" aria-label={`Reduce ${i.name}`}>
                        <Minus size={14} strokeWidth={2.6} />
                      </button>
                      <span className="tnum w-8 text-center text-[15px] font-extrabold">{i.qty}</span>
                      <button onClick={() => setQty(i.name, 1)} className="flex h-9 w-9 items-center justify-center rounded-full border border-[var(--line)] transition hover:bg-[var(--surface-2)]" aria-label={`Add ${i.name}`}>
                        <Plus size={14} strokeWidth={2.6} />
                      </button>
                      <button onClick={() => patchDraft({ items: draft.items.filter((x) => x.name !== i.name) })} className="ml-1 flex h-9 w-9 items-center justify-center rounded-full text-[var(--ink-3)] transition hover:bg-[var(--danger-soft)] hover:text-[var(--danger)]" aria-label={`Remove ${i.name}`}>
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                ))}
                <p className="pt-2 text-[12.5px] font-semibold text-[var(--ink-2)]">
                  {itemCount} item{itemCount === 1 ? "" : "s"} · weights can be confirmed at pickup
                </p>
              </div>
            )}
          </section>

          {/* rough size */}
          <section>
            <p className="text-[15px] font-extrabold tracking-tight">Roughly how much?</p>
            <div className="mt-3 space-y-2">
              {LOAD_SIZES.map((l) => (
                <button
                  key={l.key}
                  onClick={() => patchDraft({ load: l.key })}
                  className={`flex w-full items-center justify-between rounded-[12px] border-2 px-4 py-3 text-left transition ${draft.load === l.key ? "border-[var(--brand)] bg-[var(--brand-soft)]" : "border-[var(--line)] bg-[var(--surface)] hover:border-[var(--ink-3)]"}`}
                >
                  <span>
                    <span className={`block text-[14.5px] font-extrabold ${draft.load === l.key ? "text-[var(--brand-ink)]" : ""}`}>{l.label}</span>
                    <span className="block text-[12px] font-medium text-[var(--ink-2)]">{l.hint}</span>
                  </span>
                  {draft.load === l.key && <span className="h-3 w-3 rounded-full bg-[var(--brand)]" />}
                </button>
              ))}
            </div>
          </section>

          {/* special handling */}
          <section>
            <p className="text-[15px] font-extrabold tracking-tight">Anything we should know?</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {SPECIAL_HANDLING.map((s) => {
                const on = draft.special.includes(s.key);
                return (
                  <button
                    key={s.key}
                    onClick={() => patchDraft({ special: on ? draft.special.filter((x) => x !== s.key) : [...draft.special, s.key] })}
                    className={`rounded-full border px-4 py-2.5 text-[13px] font-bold transition ${on ? "border-[var(--ink)] bg-[var(--ink)] text-white" : "border-[var(--line)] bg-[var(--surface)] text-[var(--ink-2)] hover:border-[var(--ink-3)]"}`}
                  >
                    {s.label}
                  </button>
                );
              })}
            </div>
            {draft.special.includes("load_help") && (
              <div className="mt-3 flex items-center justify-between rounded-[12px] border border-[var(--line)] bg-[var(--surface)] px-4 py-3">
                <span className="text-[13.5px] font-bold">Loading helpers</span>
                <div className="flex items-center gap-1">
                  <button onClick={() => patchDraft({ helpers: Math.max(0, draft.helpers - 1) })} className="flex h-9 w-9 items-center justify-center rounded-full border border-[var(--line)]" aria-label="Fewer helpers"><Minus size={14} strokeWidth={2.6} /></button>
                  <span className="tnum w-8 text-center text-[15px] font-extrabold">{draft.helpers}</span>
                  <button onClick={() => patchDraft({ helpers: Math.min(4, draft.helpers + 1) })} className="flex h-9 w-9 items-center justify-center rounded-full border border-[var(--line)]" aria-label="More helpers"><Plus size={14} strokeWidth={2.6} /></button>
                </div>
              </div>
            )}
          </section>

          <p className="rounded-[10px] bg-[var(--surface-2)] px-4 py-3 text-[12.5px] font-medium leading-relaxed text-[var(--ink-2)]">
            Not sure about the size? Estimate. Your driver can confirm before loading.
          </p>
        </div>
      )}

      <div className="sticky bottom-4">
        <Button variant="brand" className="w-full" onClick={next}>
          {draft.category ? `Continue${itemCount ? ` · ${itemCount} item${itemCount === 1 ? "" : "s"}` : ""}` : "Continue"}
        </Button>
      </div>
    </div>
  );
}
