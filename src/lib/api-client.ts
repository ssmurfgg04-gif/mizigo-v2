// Client API helpers — thin fetch wrappers with consistent error shaping.

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

/** Broadcast a session-expired event (page.tsx listens → clean logout). */
const SESSION_EVENT = "mizigo:session-expired";

export async function api<T = unknown>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    cache: "no-store",
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : {};
  if (!res.ok) {
    // expired/invalid session (except on the auth endpoints themselves)
    if (res.status === 401 && !path.startsWith("/api/auth")) {
      if (typeof window !== "undefined") window.dispatchEvent(new Event(SESSION_EVENT));
    }
    throw new ApiError(data.error ?? "Something went wrong. Please try again.", res.status);
  }
  return data as T;
}

export const post = <T = unknown>(path: string, body: unknown) =>
  api<T>(path, { method: "POST", body: JSON.stringify(body) });

/** Two-step sandbox login: request the mock OTP, then verify with the shown code. */
export async function loginWithOtp<T = Record<string, unknown>>(
  phone: string,
  extra?: { name?: string; role?: string; accountType?: string; businessName?: string }
): Promise<T> {
  const otp = await post<{ devCode: string }>("/api/auth", { action: "otp", phone });
  const v = await post<{ user: T }>("/api/auth", {
    action: "verify",
    phone,
    code: otp.devCode,
    ...extra,
  });
  return v.user;
}
