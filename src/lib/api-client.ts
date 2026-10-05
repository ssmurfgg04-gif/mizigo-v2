// Client API helpers — thin fetch wrappers with consistent error shaping.

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export async function api<T = unknown>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    cache: "no-store",
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : {};
  if (!res.ok) {
    throw new ApiError(data.error ?? "Something went wrong. Please try again.", res.status);
  }
  return data as T;
}

export const post = <T = unknown>(path: string, body: unknown) =>
  api<T>(path, { method: "POST", body: JSON.stringify(body) });
