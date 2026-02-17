"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import Image, { type ImageLoaderProps } from "next/image";
import { apiRequest } from "@/lib/client/api";
import { clearSession, getSession, saveSession } from "@/lib/client/session";
import { DISCOVER_MOCK_ITEMS, type DiscoverItem } from "@/lib/shared/discoverMock";

type Tab = "Discover" | "Detective" | "Profile";
type DetectiveView = "home" | "snapshot";

type SnapshotResponse = {
  source: string;
  snapshot: {
    score: number;
    status: "Good" | "Needs review" | "Missing evidence";
    recommendedAction: "Proceed" | "Ask seller for docs" | "Wait/monitor";
    topPositiveSignals: string[];
    topMissingOrSuspiciousSignals: string[];
    buckets: Array<{
      key: "authenticity" | "provenance" | "price" | "risk" | "visual";
      label: string;
      score: number;
      weight: number;
      status: "Good" | "Needs review" | "Missing evidence";
      explanation: string;
      checks: Array<{
        label: string;
        value: "Good" | "Needs review" | "Missing evidence";
        detail: string;
      }>;
    }>;
  };
  artworkOverview: {
    imageUrls: string[];
    artistName: string;
    title: string;
    dimensions: string;
    price?: number;
    currency: string;
  };
};

type WatchlistItem = {
  listingId: string;
  source: string;
  title: string;
  url: string;
  thumbnailUrl?: string;
  price?: number;
  currency?: string;
};

type CachedSnapshotRecord = {
  snapshot: SnapshotResponse;
  savedAt: string;
};

type UndoDeleteState = {
  item: WatchlistItem;
  undoToken: string;
  undoExpiresAt: string;
};

const SNAPSHOT_CACHE_KEY = "art_detective_snapshot_cache_v1";
const WATCHLIST_CACHE_KEY_PREFIX = "art_detective_watchlist_";

function formatArtistName(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/\b([a-z])/g, (letter) => letter.toUpperCase());
}

function symbol(currency?: string): string {
  const c = (currency ?? "").toUpperCase();
  if (c === "GBP") return "£";
  if (c === "EUR") return "€";
  if (c === "USD") return "$";
  if (c === "JPY") return "¥";
  return c ? `${c} ` : "";
}

function passthroughImageLoader({ src }: ImageLoaderProps): string {
  return src;
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&apos;|&#39;/g, "'")
    .replace(/&quot;|&#34;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function formatSourceLabel(source: string): string {
  const trimmed = decodeHtmlEntities(source).trim();
  if (!trimmed) return "Unknown source";
  if (trimmed.toLowerCase() === "ebay") return "eBay";
  return trimmed
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\b([a-z])/g, (char) => char.toUpperCase());
}

function formatPrice(value?: number, currency?: string): string {
  if (typeof value !== "number") return "Price unavailable";
  return `${symbol(currency)}${value.toLocaleString()}`;
}

function discoverFromFollowing(artists: string[]): DiscoverItem[] {
  const followed = artists.map((a) => a.trim().toLowerCase()).filter(Boolean);
  if (!followed.length) return [];
  return DISCOVER_MOCK_ITEMS.filter((item) =>
    followed.some((artist) => {
      const candidate = item.artist.toLowerCase();
      return candidate.includes(artist) || artist.includes(candidate);
    })
  );
}

function resolveCanonicalArtistName(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return "";
  const normalized = trimmed.toLowerCase();
  const exact = DISCOVER_MOCK_ITEMS.find((item) => item.artist.toLowerCase() === normalized);
  if (exact) return exact.artist;
  const partial = DISCOVER_MOCK_ITEMS.find((item) => item.artist.toLowerCase().includes(normalized));
  if (partial) return partial.artist;
  return formatArtistName(trimmed);
}

function statusClass(status: "Good" | "Needs review" | "Missing evidence"): string {
  if (status === "Good") return "chipGood";
  if (status === "Needs review") return "chipReview";
  return "chipMissing";
}

function normalizeUrlKey(input: string): string {
  try {
    const parsed = new URL(input.trim());
    parsed.hash = "";
    const trackingParams = [
      "utm_source",
      "utm_medium",
      "utm_campaign",
      "utm_term",
      "utm_content",
      "gclid",
      "fbclid",
    ];
    for (const key of trackingParams) parsed.searchParams.delete(key);
    const pathname = parsed.pathname.replace(/\/+$/, "");
    const normalizedPath = pathname || "/";
    return `${parsed.protocol}//${parsed.hostname.toLowerCase()}${normalizedPath}${parsed.search}`;
  } catch {
    return input.trim();
  }
}

function readSnapshotCache(): Record<string, CachedSnapshotRecord> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(SNAPSHOT_CACHE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, CachedSnapshotRecord>;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writeSnapshotCache(cache: Record<string, CachedSnapshotRecord>) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(SNAPSHOT_CACHE_KEY, JSON.stringify(cache));
}

function saveCachedSnapshot(url: string, snapshot: SnapshotResponse) {
  const key = normalizeUrlKey(url);
  if (!key) return;
  const cache = readSnapshotCache();
  cache[key] = {
    snapshot,
    savedAt: new Date().toISOString(),
  };
  writeSnapshotCache(cache);
}

function getCachedSnapshot(url: string): CachedSnapshotRecord | null {
  const key = normalizeUrlKey(url);
  if (!key) return null;
  const cache = readSnapshotCache();
  return cache[key] ?? null;
}

function readCachedSnapshotForListingUrl(rawUrl: string): CachedSnapshotRecord | null {
  const normalized = normalizeListingUrl(rawUrl);
  if (!normalized) return null;
  return getCachedSnapshot(normalized);
}

function formatCachedTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "unknown time";
  return date.toLocaleString();
}

function normalizeListingUrl(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

function watchlistCacheKey(email: string): string {
  return `${WATCHLIST_CACHE_KEY_PREFIX}${email.trim().toLowerCase()}`;
}

function mergeWatchlistItems(primary: WatchlistItem[], secondary: WatchlistItem[]): WatchlistItem[] {
  const merged: WatchlistItem[] = [];
  const seenListingIds = new Set<string>();
  const seenUrls = new Set<string>();

  for (const item of [...primary, ...secondary]) {
    const listingId = item.listingId?.trim();
    const urlKey = normalizeUrlKey(item.url);
    if (!listingId || !urlKey) continue;
    if (seenListingIds.has(listingId) || seenUrls.has(urlKey)) continue;
    seenListingIds.add(listingId);
    seenUrls.add(urlKey);
    merged.push(item);
  }

  return merged;
}

function readWatchlistCache(email: string): WatchlistItem[] {
  if (typeof window === "undefined") return [];
  const key = watchlistCacheKey(email);
  if (!key) return [];
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is WatchlistItem => {
      return (
        Boolean(item) &&
        typeof item === "object" &&
        typeof (item as WatchlistItem).listingId === "string" &&
        typeof (item as WatchlistItem).url === "string" &&
        typeof (item as WatchlistItem).source === "string" &&
        typeof (item as WatchlistItem).title === "string"
      );
    });
  } catch {
    return [];
  }
}

function writeWatchlistCache(email: string, items: WatchlistItem[]) {
  if (typeof window === "undefined") return;
  const key = watchlistCacheKey(email);
  if (!key) return;
  window.localStorage.setItem(key, JSON.stringify(items));
}

function TabIcon({ tab }: { tab: Tab }) {
  if (tab === "Discover") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="12" cy="12" r="9" />
        <path d="M14.8 9.2l-2.1 5.6-5.6 2.1 2.1-5.6z" />
      </svg>
    );
  }
  if (tab === "Detective") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="11" cy="11" r="6.5" />
        <path d="M16 16l4 4" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="8.2" r="3.4" />
      <path d="M5 19c1.7-3.2 4-4.8 7-4.8s5.3 1.6 7 4.8" />
    </svg>
  );
}

export default function Home() {
  const [tab, setTab] = useState<Tab>("Detective");
  const [detectiveView, setDetectiveView] = useState<DetectiveView>("home");
  const [email, setEmail] = useState("collector@example.com");
  const [password, setPassword] = useState("");
  const [authed, setAuthed] = useState(false);
  const [url, setUrl] = useState("");
  const [artistInput, setArtistInput] = useState("");
  const [following, setFollowing] = useState<string[]>([]);
  const [discoverItems, setDiscoverItems] = useState<DiscoverItem[]>([]);
  const [watchlist, setWatchlist] = useState<WatchlistItem[]>([]);
  const [snapshot, setSnapshot] = useState<SnapshotResponse | null>(null);
  const [snapshotUrlKey, setSnapshotUrlKey] = useState("");
  const [error, setError] = useState("");
  const [loadingSnapshot, setLoadingSnapshot] = useState(false);
  const [savingListing, setSavingListing] = useState(false);
  const [savedListingUrl, setSavedListingUrl] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [cachedSnapshotAt, setCachedSnapshotAt] = useState<string | null>(null);
  const [deletingListingIds, setDeletingListingIds] = useState<string[]>([]);
  const [undoDelete, setUndoDelete] = useState<UndoDeleteState | null>(null);
  const [pendingDeleteItem, setPendingDeleteItem] = useState<WatchlistItem | null>(null);
  const [expandedBucketKey, setExpandedBucketKey] = useState<string | null>(null);

  useEffect(() => {
    const session = getSession();
    if (session) {
      setAuthed(true);
      setEmail(session.email);
      setWatchlist(readWatchlistCache(session.email));
      refreshAll(session.email).catch((err) => handleApiError(err));
    }
    // Intentionally run only once on first load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (authed && tab === "Discover") {
      refreshDiscover();
    }
  }, [authed, tab]);

  useEffect(() => {
    if (typeof window === "undefined" || !authed) return;
    const key = `art_detective_profile_${email.trim().toLowerCase()}`;
    try {
      const raw = window.localStorage.getItem(key);
      if (!raw) return;
      const parsed = JSON.parse(raw) as { firstName?: string; lastName?: string };
      setFirstName(parsed.firstName ?? "");
      setLastName(parsed.lastName ?? "");
    } catch {
      // Ignore malformed local profile records.
    }
  }, [authed, email]);

  useEffect(() => {
    if (typeof window === "undefined" || !authed) return;
    const key = `art_detective_profile_${email.trim().toLowerCase()}`;
    window.localStorage.setItem(key, JSON.stringify({ firstName, lastName }));
  }, [authed, email, firstName, lastName]);

  useEffect(() => {
    if (typeof window === "undefined" || !authed) return;
    writeWatchlistCache(email, watchlist);
  }, [authed, email, watchlist]);

  useEffect(() => {
    if (!authed) return;
    if (!url.trim() || loadingSnapshot) return;
    const normalized = normalizeListingUrl(url);
    const currentKey = normalizeUrlKey(normalized);
    if (!currentKey) return;
    if (snapshot && snapshotUrlKey === currentKey) return;
    const cached = readCachedSnapshotForListingUrl(url);
    if (!cached) return;
    setSnapshot(cached.snapshot);
    setSnapshotUrlKey(currentKey);
    setCachedSnapshotAt(cached.savedAt);
  }, [authed, url, snapshot, snapshotUrlKey, loadingSnapshot]);

  useEffect(() => {
    if (!undoDelete) return;
    const remaining = new Date(undoDelete.undoExpiresAt).getTime() - Date.now();
    if (remaining <= 0) {
      setUndoDelete(null);
      return;
    }
    const timer = window.setTimeout(() => setUndoDelete(null), remaining);
    return () => window.clearTimeout(timer);
  }, [undoDelete]);

  useEffect(() => {
    if (!pendingDeleteItem) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setPendingDeleteItem(null);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [pendingDeleteItem]);

  useEffect(() => {
    // Reset accordion state when a new snapshot record is loaded.
    setExpandedBucketKey(null);
  }, [snapshotUrlKey]);

  const scoreClass = useMemo(() => {
    const score = snapshot?.snapshot.score ?? 0;
    if (score >= 75) return "good";
    if (score >= 50) return "review";
    return "missing";
  }, [snapshot?.snapshot.score]);

  function handleListingUrlChange(nextValue: string) {
    setUrl(nextValue);
    if (!nextValue.trim()) {
      setSnapshot(null);
      setSnapshotUrlKey("");
      setCachedSnapshotAt(null);
    }
    if (savedListingUrl && nextValue.trim() !== savedListingUrl) {
      setSavedListingUrl("");
    }
  }

  function clearListingField() {
    setUrl("");
    setDetectiveView("home");
    setSnapshot(null);
    setSnapshotUrlKey("");
    setCachedSnapshotAt(null);
    setError("");
  }

  async function refreshFollowing() {
    const data = await apiRequest<{ artists: string[] }>("/api/following");
    setFollowing(data.artists);
    return data.artists;
  }

  function refreshDiscover(artists = following) {
    setDiscoverItems(discoverFromFollowing(artists));
  }

  async function refreshSaved(cacheEmail = email) {
    const w = await apiRequest<{ items: WatchlistItem[] }>("/api/watchlist");
    const cached = readWatchlistCache(cacheEmail);
    const merged = mergeWatchlistItems(w.items, cached);
    setWatchlist(merged);
    writeWatchlistCache(cacheEmail, merged);
  }

  async function refreshAll(cacheEmail = email) {
    const artists = await refreshFollowing();
    refreshDiscover(artists);
    await refreshSaved(cacheEmail);
  }

  function handleApiError(err: unknown) {
    const message = (err as Error)?.message ?? "Request failed.";
    setError(message);
  }

  async function login(e: FormEvent) {
    e.preventDefault();
    setError("");
    try {
      const data = await apiRequest<{
        user: { email: string };
        tokens: { accessToken: string; refreshToken: string };
      }>("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ email }),
      });
      setEmail(data.user.email);
      setWatchlist(readWatchlistCache(data.user.email));
      const cached = readCachedSnapshotForListingUrl(url);
      if (cached) {
        setSnapshot(cached.snapshot);
        setSnapshotUrlKey(normalizeUrlKey(normalizeListingUrl(url)));
        setCachedSnapshotAt(cached.savedAt);
      }
      saveSession(data.tokens.accessToken, data.tokens.refreshToken, data.user.email);
      setAuthed(true);
      await refreshAll(data.user.email);
    } catch (err) {
      handleApiError(err);
    }
  }

  async function logout() {
    const session = getSession();
    if (session) {
      await apiRequest("/api/auth/logout", {
        method: "POST",
        body: JSON.stringify({ refreshToken: session.refreshToken }),
      }).catch(() => undefined);
    }
    clearSession();
    setAuthed(false);
    setDetectiveView("home");
    setSnapshot(null);
    setSnapshotUrlKey("");
    setFollowing([]);
    setDiscoverItems([]);
    setWatchlist([]);
  }

  async function runSnapshot() {
    const normalized = normalizeListingUrl(url);
    if (!normalized) return;
    setDetectiveView("snapshot");
    setLoadingSnapshot(true);
    setError("");
    try {
      const data = await apiRequest<SnapshotResponse>("/api/snapshot", {
        method: "POST",
        body: JSON.stringify({ url: normalized }),
      });
      setSnapshot(data);
      setSnapshotUrlKey(normalizeUrlKey(normalized));
      saveCachedSnapshot(normalized, data);
      setCachedSnapshotAt(null);
    } catch (err) {
      const cached = getCachedSnapshot(normalized);
      if (cached) {
        setSnapshot(cached.snapshot);
        setSnapshotUrlKey(normalizeUrlKey(normalized));
        setCachedSnapshotAt(cached.savedAt);
        setError(`${(err as Error).message} Showing last saved snapshot for this listing.`);
      } else {
        setDetectiveView("home");
        setCachedSnapshotAt(null);
        handleApiError(err);
      }
    } finally {
      setLoadingSnapshot(false);
    }
  }

  async function runSnapshotForWatchlist(item: WatchlistItem) {
    const normalized = item.url?.trim();
    if (!normalized) return;
    setTab("Detective");
    setDetectiveView("snapshot");
    setUrl(normalized);
    setLoadingSnapshot(true);
    setError("");
    try {
      const data = await apiRequest<SnapshotResponse>("/api/snapshot", {
        method: "POST",
        body: JSON.stringify({ url: normalized }),
      });
      setSnapshot(data);
      setSnapshotUrlKey(normalizeUrlKey(normalized));
      saveCachedSnapshot(normalized, data);
      setCachedSnapshotAt(null);
      setSavedListingUrl(normalized);
    } catch (err) {
      const cached = getCachedSnapshot(normalized);
      if (cached) {
        setSnapshot(cached.snapshot);
        setSnapshotUrlKey(normalizeUrlKey(normalized));
        setCachedSnapshotAt(cached.savedAt);
        setSavedListingUrl(normalized);
        setError(`${(err as Error).message} Showing last saved snapshot for this listing.`);
      } else {
        setDetectiveView("home");
        setCachedSnapshotAt(null);
        handleApiError(err);
      }
    } finally {
      setLoadingSnapshot(false);
    }
  }

  async function followArtist() {
    const artist = resolveCanonicalArtistName(artistInput);
    if (!artist) return;
    try {
      await apiRequest(`/api/follow/${encodeURIComponent(artist)}`, { method: "POST" });
      setArtistInput("");
      const artists = await refreshFollowing();
      refreshDiscover(artists);
    } catch (err) {
      handleApiError(err);
    }
  }

  async function unfollowArtist(artist: string) {
    try {
      await apiRequest(`/api/follow/${encodeURIComponent(artist)}`, { method: "DELETE" });
      const artists = await refreshFollowing();
      refreshDiscover(artists);
    } catch (err) {
      handleApiError(err);
    }
  }

  async function saveListing() {
    const normalized = normalizeListingUrl(url);
    if (!normalized) return;
    setSavingListing(true);
    try {
      await apiRequest("/api/watchlist", { method: "POST", body: JSON.stringify({ url: normalized }) });
      setSavedListingUrl(normalized);
      setUrl(normalized);
      await refreshSaved();
    } catch (err) {
      handleApiError(err);
    } finally {
      setSavingListing(false);
    }
  }

  async function deleteSavedListing(item: WatchlistItem) {
    const listingId = item.listingId;
    setDeletingListingIds((current) => [...current, listingId]);
    setWatchlist((current) => current.filter((entry) => entry.listingId !== listingId));
    try {
      const response = await apiRequest<{
        state: "deleted" | "already_deleted" | "not_found";
        undoToken?: string;
        undoExpiresAt?: string;
      }>(`/api/watchlist/${encodeURIComponent(listingId)}`, { method: "DELETE" });
      if (response.undoToken && response.undoExpiresAt) {
        setUndoDelete({
          item,
          undoToken: response.undoToken,
          undoExpiresAt: response.undoExpiresAt,
        });
      } else {
        setUndoDelete(null);
      }
      setSavedListingUrl((current) => (current === item.url ? "" : current));
    } catch (err) {
      setWatchlist((current) => [item, ...current.filter((entry) => entry.listingId !== item.listingId)]);
      setError((err as Error).message);
    } finally {
      setDeletingListingIds((current) => current.filter((id) => id !== listingId));
    }
  }

  async function undoDeleteListing() {
    if (!undoDelete) return;
    const { item, undoToken } = undoDelete;
    setUndoDelete(null);
    try {
      await apiRequest(`/api/watchlist/${encodeURIComponent(item.listingId)}/restore`, {
        method: "POST",
        body: JSON.stringify({ undoToken }),
      });
      setWatchlist((current) => [item, ...current.filter((entry) => entry.listingId !== item.listingId)]);
      setSavedListingUrl((current) => (current || item.url));
    } catch (err) {
      setError((err as Error).message);
      await refreshSaved();
    }
  }

  async function confirmDeleteListing() {
    if (!pendingDeleteItem) return;
    const item = pendingDeleteItem;
    setPendingDeleteItem(null);
    await deleteSavedListing(item);
  }

  const normalizedUrl = url.trim();
  const normalizedListingUrl = normalizeListingUrl(url);
  const currentSnapshotKey = normalizedListingUrl ? normalizeUrlKey(normalizedListingUrl) : "";
  const hasInMemorySnapshotForCurrentUrl = Boolean(snapshot && currentSnapshotKey && snapshotUrlKey === currentSnapshotKey);
  const hasCachedSnapshotForCurrentUrl = Boolean(currentSnapshotKey && getCachedSnapshot(normalizedListingUrl));
  const canViewLastSnapshot = Boolean(currentSnapshotKey && (hasInMemorySnapshotForCurrentUrl || hasCachedSnapshotForCurrentUrl));
  const isCurrentListingSaved = Boolean(normalizedUrl && normalizedUrl === savedListingUrl);
  const saveButtonLabel = savingListing ? "Saving..." : isCurrentListingSaved ? "Saved ✓" : "Save Listing";

  function viewLastSnapshot() {
    if (!currentSnapshotKey) return;
    if (hasInMemorySnapshotForCurrentUrl) {
      setDetectiveView("snapshot");
      return;
    }
    const cached = readCachedSnapshotForListingUrl(url);
    if (!cached) return;
    setSnapshot(cached.snapshot);
    setSnapshotUrlKey(currentSnapshotKey);
    setCachedSnapshotAt(cached.savedAt);
    setDetectiveView("snapshot");
  }

  return (
    <main className="frameRoot">
      <div className="phoneFrame">
        <div className={authed ? "content contentWithNav" : "content"}>
          {!(authed && (tab === "Detective" || tab === "Profile" || tab === "Discover")) ? (
            <h1 className="appTitle">Art Detective</h1>
          ) : null}

          {!authed ? (
            <>
              <section className="missionTopBar" aria-label="Sign in header">
                <div className="missionBadge">Sign in</div>
              </section>

              <form className="card missionInputCard" onSubmit={login}>
                <input 
                  value={email} 
                  onChange={(e) => setEmail(e.target.value)} 
                  placeholder="Name or Email" 
                  autoComplete="username"
                />
                <input 
                  type="password"
                  value={password} 
                  onChange={(e) => setPassword(e.target.value)} 
                  placeholder="Password"
                  autoComplete="current-password"
                />
                <div className="row">
                  <button className="missionScanButton" type="submit">Sign in</button>
                </div>
                <button type="button" className="otpButton">Send one-time passcode</button>
                <p className="forgotText">
                  Forgot your <button type="button" className="forgotLink">username</button> or <button type="button" className="forgotLink">password</button>?
                </p>
              </form>
            </>
          ) : null}

          {authed && tab === "Detective" && detectiveView === "home" ? (
            <>
              <section className="missionTopBar" aria-label="Mission header">
                <div className="missionBadge">Mission</div>
              </section>

              <section className="card missionInputCard">
                <div className="listingInputRow">
                  <input value={url} onChange={(e) => handleListingUrlChange(e.target.value)} placeholder="Enter URL" />
                  {url ? (
                    <button
                      type="button"
                      className="clearInputButton"
                      onClick={clearListingField}
                      aria-label="Clear listing URL"
                    >
                      ×
                    </button>
                  ) : null}
                </div>
                <div className="row">
                  <button className="missionScanButton" onClick={runSnapshot} disabled={!url.trim() || loadingSnapshot}>
                    {loadingSnapshot ? (
                      "Loading..."
                    ) : (
                      <span className="scanButtonLabel">
                        <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
                          <path d="M10 7.5C8.61929 7.5 7.5 8.61929 7.5 10C7.5 11.3807 8.61929 12.5 10 12.5C11.3807 12.5 12.5 11.3807 12.5 10C12.5 8.61929 11.3807 7.5 10 7.5Z" fill="currentColor"/>
                          <path d="M3.33333 10C4.16667 6.66667 6.66667 4.16667 10 4.16667C13.3333 4.16667 15.8333 6.66667 16.6667 10C15.8333 13.3333 13.3333 15.8333 10 15.8333C6.66667 15.8333 4.16667 13.3333 3.33333 10Z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                        </svg>
                        Scan listing
                      </span>
                    )}
                  </button>
                  {canViewLastSnapshot ? (
                    <button type="button" className="otpButton" onClick={viewLastSnapshot} disabled={loadingSnapshot}>
                      View last snapshot
                    </button>
                  ) : null}
                </div>
              </section>
            </>
          ) : null}

          {authed && tab === "Detective" && detectiveView === "home" ? (
            <section className="card savedReportsCard">
              <h2 className="savedReportsTitle">Saved reports</h2>
              <div className="savedListMeta">
                <p className="sub">{watchlist.length} Artwork{watchlist.length === 1 ? "" : "s"}</p>
                <button type="button" className="sortButton" aria-label="Sort saved reports">
                  <span aria-hidden="true">☷</span> Sort
                </button>
              </div>
              {watchlist.length === 0 ? <p className="sub">No saved listings yet.</p> : null}
              {watchlist.map((item) => (
                <div key={item.listingId} className="lineItem">
                  <div className="savedItemContainer">
                    <button
                      type="button"
                      className="lineItemButton"
                      onClick={() => runSnapshotForWatchlist(item)}
                      aria-label={`Open latest snapshot for ${item.title}`}
                    >
                      <div className="savedItemRow">
                        {item.thumbnailUrl ? (
                          <Image
                            loader={passthroughImageLoader}
                            unoptimized
                            src={item.thumbnailUrl}
                            alt={item.title}
                            width={130}
                            height={130}
                            className="savedThumb"
                          />
                        ) : (
                          <div className="savedThumbFallback">No image</div>
                        )}
                        <div className="savedItemBody">
                          <strong>{decodeHtmlEntities(item.title)}</strong>
                          <p>{formatSourceLabel(item.source)}</p>
                          <p className="savedItemPrice">{formatPrice(item.price, item.currency)}</p>
                        </div>
                      </div>
                    </button>
                    <button
                      type="button"
                      className="deleteListingButton"
                      onClick={() => setPendingDeleteItem(item)}
                      disabled={deletingListingIds.includes(item.listingId)}
                      aria-label={`Delete saved listing ${item.title}`}
                      title="Delete listing"
                    >
                      {deletingListingIds.includes(item.listingId) ? "…" : "×"}
                    </button>
                  </div>
                </div>
              ))}
            </section>
          ) : null}

          {authed && tab === "Detective" && detectiveView === "snapshot" ? (
            <section className="card">
              <div className="snapshotPageHeader">
                <button type="button" className="secondary backButton" onClick={() => setDetectiveView("home")}>
                  ← Back
                </button>
                <h2>Artwork report</h2>
              </div>
              {snapshot ? (
                <>
                  <h2>Confidence Snapshot</h2>
                  {cachedSnapshotAt ? (
                    <p className="sub">Showing last saved snapshot from {formatCachedTime(cachedSnapshotAt)}.</p>
                  ) : null}
                  <div className="carousel">
                    {(snapshot.artworkOverview.imageUrls.length ? snapshot.artworkOverview.imageUrls : [""]).map((img, i) =>
                      img ? (
                        <Image
                          key={`${img}-${i}`}
                          loader={passthroughImageLoader}
                          unoptimized
                          src={img}
                          alt="Artwork"
                          width={300}
                          height={200}
                          className="snapshotImage"
                        />
                      ) : (
                        <div key={i} className="imgFallback">No main photo</div>
                      )
                    )}
                  </div>
                  <label>Artist</label>
                  <p className="value">{decodeHtmlEntities(snapshot.artworkOverview.artistName)}</p>
                  <label>Title</label>
                  <p className="value">{decodeHtmlEntities(snapshot.artworkOverview.title)}</p>
                  <label>Size/Dimensions</label>
                  <p className="value">{decodeHtmlEntities(snapshot.artworkOverview.dimensions)}</p>
                  <label>Price</label>
                  <p className="value">
                    {typeof snapshot.artworkOverview.price === "number"
                      ? `${symbol(snapshot.artworkOverview.currency)}${snapshot.artworkOverview.price.toLocaleString()}`
                      : "Price not available"}
                  </p>
                  <p className={`score ${scoreClass}`}>{snapshot.snapshot.score}/100</p>
                  <p className="snapshotAction">
                    Recommended action:{" "}
                    <span className={`statusChip ${statusClass(snapshot.snapshot.status)}`}>{snapshot.snapshot.recommendedAction}</span>
                  </p>

                  <div className="bucketGrid">
                    {snapshot.snapshot.buckets.map((bucket) => {
                      const isExpanded = expandedBucketKey === bucket.key;
                      return (
                        <div key={bucket.key} className={`bucketCard ${isExpanded ? "expanded" : ""}`}>
                          <button
                            type="button"
                            className="bucketToggle"
                            onClick={() => setExpandedBucketKey((current) => (current === bucket.key ? null : bucket.key))}
                            aria-expanded={isExpanded}
                            aria-controls={`bucket-panel-${bucket.key}`}
                          >
                            <div className="bucketHeader">
                              <p>{bucket.label}</p>
                              <div className="bucketHeaderRight">
                                <span className={`statusChip ${statusClass(bucket.status)}`}>{bucket.status}</span>
                                <span className={`bucketChevron ${isExpanded ? "open" : ""}`} aria-hidden="true">
                                  ▾
                                </span>
                              </div>
                            </div>
                          </button>
                          {isExpanded ? (
                            <div id={`bucket-panel-${bucket.key}`} className="bucketDetails" aria-hidden={false}>
                              <p className="bucketMeta">
                                {bucket.score}/100 · weight {bucket.weight}%
                              </p>
                              <p className="bucketExplain">{bucket.explanation}</p>
                              {bucket.checks.slice(0, 3).map((check) => (
                                <p key={check.label} className="bucketCheck">
                                  {check.label}: <span className={statusClass(check.value)}>{check.value}</span>
                                </p>
                              ))}
                            </div>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>

                  <div className="signalBlock">
                    <p className="signalTitle">Top 3 positive signals</p>
                    {snapshot.snapshot.topPositiveSignals.slice(0, 3).map((signal) => (
                      <p key={signal} className="signalGood">
                        + {decodeHtmlEntities(signal)}
                      </p>
                    ))}
                  </div>

                  <div className="signalBlock">
                    <p className="signalTitle">Top 3 missing/suspicious signals</p>
                    {snapshot.snapshot.topMissingOrSuspiciousSignals.slice(0, 3).map((signal) => (
                      <p key={signal} className="signalMissing">
                        - {decodeHtmlEntities(signal)}
                      </p>
                    ))}
                  </div>

                  <button
                    className={`otpButton snapshotSaveButton ${isCurrentListingSaved ? "savedStateButton" : ""}`}
                    onClick={saveListing}
                    disabled={!url.trim() || loadingSnapshot || savingListing || isCurrentListingSaved}
                  >
                    {saveButtonLabel}
                  </button>
                  <button
                    className="missionScanButton"
                    onClick={() => window.open(url, "_blank")}
                    disabled={!url.trim()}
                  >
                    View source
                  </button>
                </>
              ) : (
                <p className="sub">Building snapshot...</p>
              )}
            </section>
          ) : null}

          {authed && tab === "Discover" ? (
            <>
              <section className="missionTopBar" aria-label="Discover header">
                <div className="missionBadge">Discover</div>
              </section>

              <section className="card missionInputCard">
                <input
                  value={artistInput}
                  onChange={(e) => setArtistInput(e.target.value)}
                  placeholder="Enter artist name"
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      followArtist().catch(() => undefined);
                    }
                  }}
                />
                <div className="row">
                  <button className="missionScanButton" onClick={followArtist} disabled={!artistInput.trim()}>
                    Follow
                  </button>
                </div>
              </section>

              <section className="card">
              {following.map((artist) => (
                <div key={artist} className="followRow">
                  <span>+ {decodeHtmlEntities(artist)}</span>
                  <button className="tiny" onClick={() => unfollowArtist(artist)}>
                    Unfollow
                  </button>
                </div>
              ))}
              {discoverItems.map((item) => (
                <div key={item.id} className="discoverItem">
                  {item.imageUrl ? (
                    <Image
                      loader={passthroughImageLoader}
                      unoptimized
                      src={item.imageUrl}
                      alt={item.title}
                      width={72}
                      height={72}
                      className="discoverThumb"
                    />
                  ) : (
                    <div className="thumbFallback">No image</div>
                  )}
                  <div>
                    <strong>{decodeHtmlEntities(item.title)}</strong>
                    <p>{decodeHtmlEntities(item.artist)}</p>
                    {item.shopName ? <p>{decodeHtmlEntities(item.shopName)}</p> : null}
                    {typeof item.price === "number" ? <p>{formatPrice(item.price, item.currency)}</p> : null}
                  </div>
                </div>
              ))}
              </section>
            </>
          ) : null}

          {authed && tab === "Profile" ? (
            <>
              <section className="missionTopBar" aria-label="Profile header">
                <div className="missionBadge">Profile</div>
              </section>

              <section className="card missionInputCard">
                <input
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  placeholder="First Name"
                />
                <input
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                  placeholder="Last Name"
                />
                <p className="profileHelper">Your profile and saved reports are stored locally on your device.</p>
                <div className="profileDivider profileDividerBottom" aria-hidden="true" />
                <button className="profileLogoutButton" type="button" onClick={logout}>
                  Logout
                </button>
              </section>
            </>
          ) : null}

          {loadingSnapshot ? <p className="sub">Building snapshot...</p> : null}
          {error ? <p className="err">{error}</p> : null}
          {undoDelete ? (
            <div className="undoToast" role="status" aria-live="polite">
              <p>Listing removed.</p>
              <button type="button" className="undoButton" onClick={undoDeleteListing}>
                Undo
              </button>
            </div>
          ) : null}
        </div>

        {pendingDeleteItem ? (
          <div
            className="modalBackdrop"
            role="presentation"
            onClick={() => setPendingDeleteItem(null)}
          >
            <div
              className="modalCard"
              role="dialog"
              aria-modal="true"
              aria-labelledby="delete-listing-title"
              aria-describedby="delete-listing-description"
              onClick={(event) => event.stopPropagation()}
            >
              <h3 id="delete-listing-title">Delete saved listing?</h3>
              <p id="delete-listing-description">
                This removes <strong>{decodeHtmlEntities(pendingDeleteItem.title)}</strong> from your Detective watchlist.
              </p>
              <div className="modalActions">
                <button type="button" className="secondary" onClick={() => setPendingDeleteItem(null)}>
                  Cancel
                </button>
                <button type="button" className="dangerButton" onClick={confirmDeleteListing}>
                  Delete
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {authed ? (
          <nav className="tabBar">
            {(["Detective", "Discover", "Profile"] as Tab[]).map((item) => (
              <button
                key={item}
                className={tab === item ? "tab active" : "tab"}
                onClick={() => {
                  setTab(item);
                  if (item !== "Detective") {
                    setDetectiveView("home");
                  }
                }}
              >
                <span className="tabIcon" aria-hidden="true">
                  <TabIcon tab={item} />
                </span>
                <span className="tabLabel">{item === "Detective" ? "Mission" : item}</span>
              </button>
            ))}
          </nav>
        ) : null}
      </div>
    </main>
  );
}
