const ACCESS_TOKEN_KEY = "art_detective_next_access_token";
const REFRESH_TOKEN_KEY = "art_detective_next_refresh_token";
const USER_EMAIL_KEY = "art_detective_next_user_email";

export function saveSession(accessToken: string, refreshToken: string, email: string): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(ACCESS_TOKEN_KEY, accessToken);
  window.localStorage.setItem(REFRESH_TOKEN_KEY, refreshToken);
  window.localStorage.setItem(USER_EMAIL_KEY, email);
}

export function clearSession(): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(ACCESS_TOKEN_KEY);
  window.localStorage.removeItem(REFRESH_TOKEN_KEY);
  window.localStorage.removeItem(USER_EMAIL_KEY);
}

export function getSession(): { accessToken: string; refreshToken: string; email: string } | null {
  if (typeof window === "undefined") return null;
  const accessToken = window.localStorage.getItem(ACCESS_TOKEN_KEY);
  const refreshToken = window.localStorage.getItem(REFRESH_TOKEN_KEY);
  const email = window.localStorage.getItem(USER_EMAIL_KEY);
  if (!accessToken || !refreshToken || !email) return null;
  return { accessToken, refreshToken, email };
}
