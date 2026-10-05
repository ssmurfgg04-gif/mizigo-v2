"use client";
// Shared customer ↔ driver chat sheet (plan §77): predefined quick messages
// first, optional free text. Phone numbers stay masked — chat happens in-app.

import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Send, X } from "lucide-react";
import { api, post } from "@/lib/api-client";
import type { ShipmentDTO } from "@/lib/types";
import { useSession } from "@/store/session";
import { fmtTimeEAT } from "@/lib/format";
import { toast } from "@/hooks/use-toast";

const QUICK_CUSTOMER = ["I'm at the pickup", "Where are you?", "I'm coming out", "Please call me", "Gate is locked", "I've arrived"];
const QUICK_DRIVER = ["I'm 5 minutes away", "I've arrived", "Please come to the gate", "Call me when ready", "Loading complete"];

export default function ChatSheet({ shipmentId, role, onClose }: { shipmentId: string; role: "CUSTOMER" | "DRIVER"; onClose: () => void }) {
  const qc = useQueryClient();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  const { data } = useQuery({
    queryKey: ["chat", shipmentId],
    queryFn: () => api<{ shipment: ShipmentDTO }>(`/api/shipments/${shipmentId}`),
    enabled: !!shipmentId,
    refetchInterval: 3000,
  });
  const s = data?.shipment;
  const messages = s?.messages ?? [];
  const other = role === "CUSTOMER" ? s?.driver?.name.split(" ")[0] : s?.customer?.name.split(" ")[0];

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  const send = async (body: string) => {
    const clean = body.trim();
    if (!clean || busy) return;
    setBusy(true);
    try {
      await post(`/api/shipments/${shipmentId}/action`, { action: "chat", actor: role, body: clean });
      setText("");
      await qc.invalidateQueries({ queryKey: ["chat", shipmentId] });
      await qc.invalidateQueries({ queryKey: ["shipment", shipmentId] });
    } catch (e) {
      toast({ title: "Message not sent", description: (e as Error).message, variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  const quick = role === "CUSTOMER" ? QUICK_CUSTOMER : QUICK_DRIVER;

  return (
    <div className="fixed inset-0 z-50 flex items-end bg-[rgba(23,24,28,0.45)]" onClick={onClose}>
      <div
        className="flex h-[78%] w-full animate-mz-slide-up flex-col rounded-t-[18px] bg-[var(--surface)] sheet-shadow"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Chat"
      >
        {/* header */}
        <div className="flex items-center gap-3 border-b border-[var(--line)] px-5 py-4">
          <div className="min-w-0 flex-1">
            <p className="text-[16px] font-extrabold tracking-tight">Message {other ?? (role === "CUSTOMER" ? "driver" : "customer")}</p>
            <p className="text-[11.5px] font-semibold text-[var(--ink-3)]">Numbers stay private · chat happens in the app</p>
          </div>
          <button onClick={onClose} className="flex h-10 w-10 items-center justify-center rounded-full bg-[var(--surface-2)]" aria-label="Close chat">
            <X size={17} />
          </button>
        </div>

        {/* messages */}
        <div className="min-h-0 flex-1 space-y-2.5 overflow-y-auto px-5 py-4 thin-scrollbar">
          {messages.length === 0 && (
            <p className="py-8 text-center text-[13px] font-medium text-[var(--ink-3)]">No messages yet. Tap a quick message below.</p>
          )}
          {messages.map((m) => {
            const mine = m.senderRole === role;
            return (
              <div key={m.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
                <div
                  className={`max-w-[80%] rounded-[14px] px-4 py-2.5 text-[13.5px] font-semibold leading-relaxed ${
                    mine ? "rounded-br-[4px] bg-[var(--brand-deep)] text-white" : "rounded-bl-[4px] bg-[var(--surface-2)] text-[var(--ink)]"
                  }`}
                >
                  {m.body}
                  <span className={`mt-0.5 block text-[10px] font-bold ${mine ? "text-white/60" : "text-[var(--ink-3)]"}`}>{fmtTimeEAT(m.at)}</span>
                </div>
              </div>
            );
          })}
          <div ref={endRef} />
        </div>

        {/* quick messages */}
        <div className="border-t border-[var(--line)] px-5 pb-1 pt-3">
          <p className="text-[10.5px] font-extrabold uppercase tracking-widest text-[var(--ink-3)]">Quick messages</p>
          <div className="mt-2 flex gap-2 overflow-x-auto pb-2 thin-scrollbar">
            {quick.map((q) => (
              <button
                key={q}
                onClick={() => send(q)}
                disabled={busy}
                className="shrink-0 rounded-full border border-[var(--line)] bg-[var(--surface-2)] px-3.5 py-2 text-[12.5px] font-bold text-[var(--ink-2)] transition hover:border-[var(--brand)] hover:text-[var(--brand-deep)] disabled:opacity-50"
              >
                {q}
              </button>
            ))}
          </div>
        </div>

        {/* composer */}
        <div className="flex items-center gap-2.5 px-5 pb-[max(env(safe-area-inset-bottom),14px)] pt-1">
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && send(text)}
            placeholder="Type a message…"
            className="h-12 flex-1 rounded-full border border-[var(--line)] bg-[var(--paper)] px-4 text-[14px] font-semibold outline-none focus:border-[var(--brand)]"
            aria-label="Message"
          />
          <button
            onClick={() => send(text)}
            disabled={busy || !text.trim()}
            className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-[var(--brand-deep)] text-white transition active:scale-95 disabled:opacity-40"
            aria-label="Send message"
          >
            <Send size={17} />
          </button>
        </div>
      </div>
    </div>
  );
}
