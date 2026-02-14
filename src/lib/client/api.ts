import { clearSession, getSession, saveSession } from "./session";

async function refreshAccessToken(refreshToken: string): Promise<{ accessToken: string; refreshToken: string }> {
  const response = await fetch("/api/auth/refresh", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refreshToken }),
  });
  if (!response.ok) throw new Error("Unable to refresh token.");
  const data = (await response.json()) as { tokens: { accessToken: string; refreshToken: string } };
  return data.tokens;
}

export async function apiRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const session = getSession();
  const headers = new Headers(init?.headers ?? {});
  if (session?.accessToken) headers.set("Authorization", `Bearer ${session.accessToken}`);
  if (!headers.has("Content-Type") && !(init?.body instanceof FormData)) {
    headers.set("Content-Type", "application/json");
  }

  let response = await fetch(path, { ...init, headers });

  if (response.status === 401 && session?.refreshToken) {
    try {
      const refreshed = await refreshAccessToken(session.refreshToken);
      saveSession(refreshed.accessToken, refreshed.refreshToken, session.email);
      const retry = new Headers(init?.headers ?? {});
      retry.set("Authorization", `Bearer ${refreshed.accessToken}`);
      if (!retry.has("Content-Type") && !(init?.body instanceof FormData)) retry.set("Content-Type", "application/json");
      response = await fetch(path, { ...init, headers: retry });
    } catch {
      clearSession();
      throw new Error("Session refresh failed.");
    }
  }

  const data = await response.json();
  if (!response.ok) {
    const payload = data as { error?: string; hint?: string };
    const base = payload.error ?? "Request failed.";
    const message = payload.hint ? `${base} ${payload.hint}` : base;
    throw new Error(message);
  }
  return data as T;
}
