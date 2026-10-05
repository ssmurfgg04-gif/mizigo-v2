// MIZIGO — formatting helpers. Currency KES, phones Kenyan, time Africa/Nairobi.

export function kes(amount: number, opts?: { compact?: boolean }): string {
  if (opts?.compact && amount >= 1000000) return `KES ${(amount / 1000000).toFixed(1)}M`;
  if (opts?.compact && amount >= 1000) return `KES ${Math.round(amount / 1000)}K`;
  return `KES ${amount.toLocaleString("en-KE")}`;
}

export function fmtPhone(phone: string): string {
  const p = phone.replace(/\D/g, "");
  if (p.length === 10 && p.startsWith("0")) return `${p.slice(0, 4)} ${p.slice(4, 7)} ${p.slice(7)}`;
  if (p.length === 12 && p.startsWith("254")) return `0${p.slice(3, 6)} ${p.slice(6, 9)} ${p.slice(9)}`;
  if (p.length === 9) return `${p.slice(0, 3)} ${p.slice(3, 6)} ${p.slice(6)}`;
  return phone;
}

export function maskPhone(phone: string): string {
  const p = fmtPhone(phone);
  return p.length > 6 ? `${p.slice(0, 6)}··· ${p.slice(-3)}` : p;
}

// East Africa Time (UTC+3) formatting without Intl timezone data dependency
const EAT_OFFSET_MS = 3 * 60 * 60 * 1000;

export function eatNow(): Date {
  return new Date();
}

export function fmtTimeEAT(d: Date | string): string {
  const date = typeof d === "string" ? new Date(d) : d;
  const t = new Date(date.getTime() + EAT_OFFSET_MS);
  let h = t.getUTCHours();
  const m = t.getUTCMinutes();
  const ampm = h >= 12 ? "PM" : "AM";
  h = h % 12 || 12;
  return `${h}:${String(m).padStart(2, "0")} ${ampm}`;
}

export function fmtDateEAT(d: Date | string): string {
  const date = typeof d === "string" ? new Date(d) : d;
  const t = new Date(date.getTime() + EAT_OFFSET_MS);
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${String(t.getUTCDate()).padStart(2, "0")} ${months[t.getUTCMonth()]} ${t.getUTCFullYear()}`;
}

export function fmtDateTimeEAT(d: Date | string): string {
  return `${fmtDateEAT(d)} · ${fmtTimeEAT(d)}`;
}

/** Build a Date at a given EAT wall-clock time (hours/mins in Nairobi local time). */
export function atEAT(base: Date, hour: number, minute = 0): Date {
  // EAT = UTC+3: shift base to EAT wall-clock, set the time, shift back to UTC
  const eat = new Date(base.getTime() + EAT_OFFSET_MS);
  eat.setUTCHours(hour, minute, 0, 0);
  return new Date(eat.getTime() - EAT_OFFSET_MS);
}

/** ISO string → value for <input type="datetime-local"> displayed in EAT. */
export function toDatetimeLocalEAT(iso: string): string {
  return new Date(new Date(iso).getTime() + EAT_OFFSET_MS).toISOString().slice(0, 16);
}

/** <input type="datetime-local"> value (EAT wall-clock) → ISO string (UTC). */
export function fromDatetimeLocalEAT(value: string): string {
  return new Date(new Date(`${value}:00Z`).getTime() - EAT_OFFSET_MS).toISOString();
}

export function relTimeEAT(d: Date | string): string {
  const date = typeof d === "string" ? new Date(d) : d;
  const diff = Date.now() - date.getTime();
  const mins = Math.round(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs} hr${hrs > 1 ? "s" : ""} ago`;
  return fmtDateEAT(date);
}

export function minutesAgoEAT(d: Date | string): number {
  const date = typeof d === "string" ? new Date(d) : d;
  return Math.max(0, Math.round((Date.now() - date.getTime()) / 60000));
}

export function shipmentCode(): string {
  return `MZG-${Math.floor(100000 + Math.random() * 900000)}`;
}

export function mpesaRef(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let s = "";
  for (let i = 0; i < 10; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

export function shareToken(): string {
  return Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 6);
}

export function initials(name: string): string {
  return name.split(" ").filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? "").join("");
}

export function etaText(min: number): string {
  if (min <= 1) return "Arriving now";
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60), m = min % 60;
  return m ? `${h} hr ${m} min` : `${h} hr`;
}

export function fmtKm(km: number): string {
  return `${km.toFixed(1)} km`;
}
