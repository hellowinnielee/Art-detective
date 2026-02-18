"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import Image, { type ImageLoaderProps } from "next/image";
import { apiRequest } from "@/lib/client/api";
import { clearSession, getSession, saveSession } from "@/lib/client/session";
import { CURATED_ARTWORKS_MOCK_ITEMS, DISCOVER_MOCK_ITEMS } from "@/lib/shared/discoverMock";

type Tab = "Discover" | "Detective" | "Dossier" | "Profile";
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
    medium: string;
    yearOfRelease: string;
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
const LAST_ANALYSE_SNAPSHOT_KEY = "art_detective_last_analyse_snapshot_v1";
const WATCHLIST_CACHE_KEY_PREFIX = "art_detective_watchlist_";
const VIEW_STATE_KEY = "art_detective_view_state_v1";
const MISSING_ARTWORK_DETAIL_VALUES = new Set([
  "not provided",
  "price not available",
  "unknown artist",
  "untitled",
  "unknown",
  "n/a",
]);

type PersistedViewState = {
  tab: Tab;
  detectiveView: DetectiveView;
};

function isTab(value: unknown): value is Tab {
  return value === "Discover" || value === "Detective" || value === "Dossier" || value === "Profile";
}

function isDetectiveView(value: unknown): value is DetectiveView {
  return value === "home" || value === "snapshot";
}

function readViewState(): PersistedViewState | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(VIEW_STATE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { tab?: unknown; detectiveView?: unknown };
    if (!isTab(parsed.tab) || !isDetectiveView(parsed.detectiveView)) return null;
    return { tab: parsed.tab, detectiveView: parsed.detectiveView };
  } catch {
    return null;
  }
}

function writeViewState(state: PersistedViewState): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(VIEW_STATE_KEY, JSON.stringify(state));
}

function clearViewState(): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(VIEW_STATE_KEY);
}

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

function stripMarketplaceSuffix(value: string): string {
  return value.replace(/\s*\|\s*eBay.*$/i, "").trim();
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

function formatBucketLabel(bucket: SnapshotResponse["snapshot"]["buckets"][number]): string {
  if (bucket.key === "authenticity") return "Authenticity";
  return bucket.label;
}

function isMissingArtworkDetail(value?: string | null): boolean {
  if (!value) return true;
  const normalized = decodeHtmlEntities(value).trim().toLowerCase();
  return !normalized || MISSING_ARTWORK_DETAIL_VALUES.has(normalized);
}

function isInterruptionText(value?: string | null): boolean {
  if (!value) return false;
  return /pardon our interruption/i.test(decodeHtmlEntities(value));
}

function discoverArtistCards(searchTerm: string) {
  const byArtist = new Map<string, { artist: string; imageUrl?: string }>();
  for (const item of DISCOVER_MOCK_ITEMS) {
    const key = item.artist.trim().toLowerCase();
    if (!key || byArtist.has(key)) continue;
    byArtist.set(key, { artist: item.artist, imageUrl: item.imageUrl });
  }
  const normalizedSearch = searchTerm.trim().toLowerCase();
  return Array.from(byArtist.values())
    .filter((artistCard) => (normalizedSearch ? artistCard.artist.toLowerCase().includes(normalizedSearch) : true))
    .sort((a, b) => a.artist.localeCompare(b.artist, undefined, { sensitivity: "base" }));
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

function confidenceLabel(status: "Good" | "Needs review" | "Missing evidence"): "High" | "Medium" | "Low" {
  if (status === "Good") return "High";
  if (status === "Needs review") return "Medium";
  return "Low";
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

function getCachedSnapshotByUrlKey(urlKey: string): CachedSnapshotRecord | null {
  if (!urlKey) return null;
  const cache = readSnapshotCache();
  return cache[urlKey] ?? null;
}

function readLastAnalyseSnapshotKey(): string {
  if (typeof window === "undefined") return "";
  return window.localStorage.getItem(LAST_ANALYSE_SNAPSHOT_KEY) ?? "";
}

function writeLastAnalyseSnapshotKey(urlKey: string) {
  if (typeof window === "undefined") return;
  if (!urlKey) {
    window.localStorage.removeItem(LAST_ANALYSE_SNAPSHOT_KEY);
    return;
  }
  window.localStorage.setItem(LAST_ANALYSE_SNAPSHOT_KEY, urlKey);
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

const PROFILE_PHOTO_CANDIDATES = [
  "/profile/profile-shot.png",
  "/profile/profile_shot.png",
  "/profile/profile-shot.jpg",
  "/profile/profile_shot.jpg",
  "/profile/profile.png",
  "/profile/profile.jpg",
  "/artworks/kaws.jpg",
];

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
  if (tab === "Dossier") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <rect x="4" y="7" width="16" height="12" rx="2" ry="2" />
        <path d="M9 7V5.8A1.8 1.8 0 0 1 10.8 4h2.4A1.8 1.8 0 0 1 15 5.8V7" />
        <path d="M4 12h16" />
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

function ControlAdjustIcon() {
  return (
    <svg viewBox="0 0 24 24" role="presentation" aria-hidden="true">
      <line x1="4" y1="7" x2="20" y2="7" />
      <line x1="4" y1="12" x2="20" y2="12" />
      <line x1="4" y1="17" x2="20" y2="17" />
      <circle cx="9" cy="7" r="2" />
      <circle cx="15" cy="12" r="2" />
      <circle cx="11" cy="17" r="2" />
    </svg>
  );
}

function useDecryptTypewriter(
  target: string,
  active: boolean,
  options?: { tickMs?: number; maxJitter?: number },
): string {
  const tickMs = options?.tickMs ?? 34;
  const maxJitter = options?.maxJitter ?? 2;
  const charset = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789#@$%&*";
  const [value, setValue] = useState(active ? "" : target);

  useEffect(() => {
    if (!active) {
      setValue(target);
      return;
    }

    let frame = 0;
    const timer = window.setInterval(() => {
      frame += 1;

      const settledCount = Math.min(target.length, Math.floor(frame / 2));
      const next = target
        .split("")
        .map((char, index) => {
          if (index < settledCount) return char;
          if (char === " ") return " ";
          const jitter = Math.max(0, maxJitter - Math.floor(frame / 10));
          if (Math.random() < 0.06 * jitter) return char;
          return charset[Math.floor(Math.random() * charset.length)];
        })
        .join("");

      setValue(next);

      if (settledCount >= target.length) {
        window.clearInterval(timer);
        setValue(target);
      }
    }, tickMs);

    return () => window.clearInterval(timer);
  }, [active, maxJitter, target, tickMs]);

  return value;
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
  const [watchlist, setWatchlist] = useState<WatchlistItem[]>([]);
  const [snapshot, setSnapshot] = useState<SnapshotResponse | null>(null);
  const [reportSnapshot, setReportSnapshot] = useState<SnapshotResponse | null>(null);
  const [reportUrl, setReportUrl] = useState("");
  const [snapshotUrlKey, setSnapshotUrlKey] = useState("");
  const [error, setError] = useState("");
  const [loadingSnapshot, setLoadingSnapshot] = useState(false);
  const [savingListing, setSavingListing] = useState(false);
  const [savedListingUrl, setSavedListingUrl] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [profilePhotoIndex, setProfilePhotoIndex] = useState(0);
  const [cachedSnapshotAt, setCachedSnapshotAt] = useState<string | null>(null);
  const [reportCachedSnapshotAt, setReportCachedSnapshotAt] = useState<string | null>(null);
  const [lastAnalyseSnapshotKey, setLastAnalyseSnapshotKey] = useState("");
  const [hasTriggeredScanForInput, setHasTriggeredScanForInput] = useState(false);
  const [deletingListingIds, setDeletingListingIds] = useState<string[]>([]);
  const [undoDelete, setUndoDelete] = useState<UndoDeleteState | null>(null);
  const [pendingDeleteItem, setPendingDeleteItem] = useState<WatchlistItem | null>(null);
  const [expandedBucketKey, setExpandedBucketKey] = useState<string | null>(null);

  useEffect(() => {
    const session = getSession();
    if (session) {
      const savedViewState = readViewState();
      if (savedViewState) {
        setTab(savedViewState.tab);
        setDetectiveView(savedViewState.detectiveView);
      }
      setAuthed(true);
      setEmail(session.email);
      setWatchlist(readWatchlistCache(session.email));
      refreshAll(session.email).catch((err) => handleApiError(err));
    }
    // Intentionally run only once on first load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
    setLastAnalyseSnapshotKey(readLastAnalyseSnapshotKey());
  }, [authed]);

  useEffect(() => {
    if (!authed) return;
    writeViewState({ tab, detectiveView });
  }, [authed, tab, detectiveView]);

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
  }, [snapshotUrlKey, reportSnapshot]);

  const activeSnapshot = detectiveView === "snapshot" ? reportSnapshot : snapshot;
  const activeUrl = detectiveView === "snapshot" ? reportUrl : url;
  const activeCachedSnapshotAt = detectiveView === "snapshot" ? reportCachedSnapshotAt : cachedSnapshotAt;
  const scoreClass = useMemo(() => {
    const score = activeSnapshot?.snapshot.score ?? 0;
    if (score >= 75) return "good";
    if (score >= 50) return "review";
    return "missing";
  }, [activeSnapshot?.snapshot.score]);
  const snapshotScore = activeSnapshot?.snapshot.score ?? 0;
  const clampedSnapshotScore = Math.min(100, Math.max(0, snapshotScore));
  const artworkDetailRows = activeSnapshot
    ? [
        { label: "Artist", value: decodeHtmlEntities(activeSnapshot.artworkOverview.artistName) },
        { label: "Title", value: decodeHtmlEntities(stripMarketplaceSuffix(activeSnapshot.artworkOverview.title)) },
        { label: "Size", value: decodeHtmlEntities(activeSnapshot.artworkOverview.dimensions) },
        {
          label: "Price",
          value:
            typeof activeSnapshot.artworkOverview.price === "number"
              ? `${symbol(activeSnapshot.artworkOverview.currency)}${activeSnapshot.artworkOverview.price.toLocaleString()}`
              : null,
        },
        { label: "Medium", value: decodeHtmlEntities(activeSnapshot.artworkOverview.medium) },
        { label: "Year of release", value: decodeHtmlEntities(activeSnapshot.artworkOverview.yearOfRelease) },
      ]
    : [];
  const discoverCards = useMemo(() => discoverArtistCards(artistInput), [artistInput]);
  const followedArtists = useMemo(() => new Set(following.map((artist) => artist.trim().toLowerCase())), [following]);

  function handleListingUrlChange(nextValue: string) {
    setUrl(nextValue);
    setHasTriggeredScanForInput(false);
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
    setHasTriggeredScanForInput(false);
    setDetectiveView("home");
    setSnapshot(null);
    setReportSnapshot(null);
    setReportUrl("");
    setSnapshotUrlKey("");
    setCachedSnapshotAt(null);
    setReportCachedSnapshotAt(null);
    setError("");
  }

  async function refreshFollowing() {
    const data = await apiRequest<{ artists: string[] }>("/api/following");
    setFollowing(data.artists);
    return data.artists;
  }

  async function refreshSaved(cacheEmail = email) {
    const w = await apiRequest<{ items: WatchlistItem[] }>("/api/watchlist");
    const cached = readWatchlistCache(cacheEmail);
    const merged = mergeWatchlistItems(w.items, cached);
    setWatchlist(merged);
    writeWatchlistCache(cacheEmail, merged);
  }

  async function refreshAll(cacheEmail = email) {
    await refreshFollowing();
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
    clearViewState();
    setAuthed(false);
    setDetectiveView("home");
    setSnapshot(null);
    setReportSnapshot(null);
    setReportUrl("");
    setSnapshotUrlKey("");
    setCachedSnapshotAt(null);
    setReportCachedSnapshotAt(null);
    setLastAnalyseSnapshotKey("");
    setFollowing([]);
    setWatchlist([]);
  }

  async function runSnapshot() {
    const normalized = normalizeListingUrl(url);
    if (!normalized) return;
    setHasTriggeredScanForInput(true);
    const normalizedKey = normalizeUrlKey(normalized);
    setSnapshot(null);
    setSnapshotUrlKey("");
    setCachedSnapshotAt(null);
    setLoadingSnapshot(true);
    setError("");
    try {
      const data = await apiRequest<SnapshotResponse>("/api/snapshot", {
        method: "POST",
        body: JSON.stringify({ url: normalized }),
      });
      setSnapshot(data);
      setSnapshotUrlKey(normalizedKey);
      saveCachedSnapshot(normalized, data);
      setLastAnalyseSnapshotKey(normalizedKey);
      writeLastAnalyseSnapshotKey(normalizedKey);
      setCachedSnapshotAt(null);
    } catch (err) {
      const cached = getCachedSnapshot(normalized);
      if (cached) {
        setSnapshot(cached.snapshot);
        setSnapshotUrlKey(normalizedKey);
        setLastAnalyseSnapshotKey(normalizedKey);
        writeLastAnalyseSnapshotKey(normalizedKey);
        setCachedSnapshotAt(cached.savedAt);
        setError(`${(err as Error).message} Showing last saved snapshot for this listing.`);
      } else {
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
    setDetectiveView("snapshot");
    setReportUrl(normalized);
    setReportSnapshot(null);
    setReportCachedSnapshotAt(null);
    setLoadingSnapshot(true);
    setError("");
    try {
      const data = await apiRequest<SnapshotResponse>("/api/snapshot", {
        method: "POST",
        body: JSON.stringify({ url: normalized }),
      });
      setReportSnapshot(data);
      saveCachedSnapshot(normalized, data);
      setReportCachedSnapshotAt(null);
      setSavedListingUrl(normalized);
    } catch (err) {
      const cached = getCachedSnapshot(normalized);
      if (cached) {
        setReportSnapshot(cached.snapshot);
        setReportCachedSnapshotAt(cached.savedAt);
        setSavedListingUrl(normalized);
        setError(`${(err as Error).message} Showing last saved snapshot for this listing.`);
      } else {
        setReportCachedSnapshotAt(null);
        handleApiError(err);
      }
    } finally {
      setLoadingSnapshot(false);
    }
  }

  async function followArtistByName(artistName: string) {
    const artist = resolveCanonicalArtistName(artistName);
    if (!artist) return;
    try {
      await apiRequest(`/api/follow/${encodeURIComponent(artist)}`, { method: "POST" });
      await refreshFollowing();
    } catch (err) {
      handleApiError(err);
    }
  }

  async function unfollowArtist(artist: string) {
    try {
      await apiRequest(`/api/follow/${encodeURIComponent(artist)}`, { method: "DELETE" });
      await refreshFollowing();
    } catch (err) {
      handleApiError(err);
    }
  }

  async function toggleFollowArtist(artist: string) {
    const normalizedArtist = artist.trim().toLowerCase();
    if (!normalizedArtist) return;
    if (followedArtists.has(normalizedArtist)) {
      await unfollowArtist(artist);
      return;
    }
    await followArtistByName(artist);
  }

  async function saveListing(listingUrl: string = url, syncAnalyseUrl = true) {
    const normalized = normalizeListingUrl(listingUrl);
    if (!normalized) return;
    setSavingListing(true);
    try {
      await apiRequest("/api/watchlist", { method: "POST", body: JSON.stringify({ url: normalized }) });
      setSavedListingUrl(normalized);
      if (syncAnalyseUrl) {
        setUrl(normalized);
      }
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
  const activeNormalizedUrl = activeUrl.trim();
  const lastAnalyseSnapshot = getCachedSnapshotByUrlKey(lastAnalyseSnapshotKey);
  const canViewLastSnapshot = Boolean(lastAnalyseSnapshot && !hasTriggeredScanForInput);
  const isCurrentListingSaved = Boolean(activeNormalizedUrl && activeNormalizedUrl === savedListingUrl);
  const saveButtonLabel = savingListing ? "Saving..." : isCurrentListingSaved ? "Listing saved" : "Save Listing";
  const shouldShowInlineReport =
    authed && tab === "Detective" && detectiveView === "home" && Boolean(normalizedUrl) && (loadingSnapshot || Boolean(snapshot));
  const shouldShowInlineErrorReport =
    authed &&
    tab === "Detective" &&
    detectiveView === "home" &&
    Boolean(normalizedUrl) &&
    !loadingSnapshot &&
    !snapshot &&
    Boolean(error);
  const shouldShowSnapshotErrorReport =
    authed &&
    detectiveView === "snapshot" &&
    (tab === "Detective" || tab === "Dossier") &&
    Boolean(activeNormalizedUrl) &&
    !loadingSnapshot &&
    !reportSnapshot &&
    Boolean(error);
  const showAwkwardFallback =
    Boolean(activeSnapshot) &&
    (isInterruptionText(activeSnapshot?.artworkOverview.artistName) ||
      isInterruptionText(activeSnapshot?.artworkOverview.title));
  const confidenceRatingText = showAwkwardFallback ? "Unknown" : `${clampedSnapshotScore}%`;

  function viewLastSnapshot() {
    if (!lastAnalyseSnapshotKey || !lastAnalyseSnapshot) return;
    setUrl(lastAnalyseSnapshotKey);
    setSnapshot(lastAnalyseSnapshot.snapshot);
    setSnapshotUrlKey(lastAnalyseSnapshotKey);
    setCachedSnapshotAt(lastAnalyseSnapshot.savedAt);
    setError("");
  }

  const artworkReportCard = activeSnapshot ? (
    <>
      {activeCachedSnapshotAt ? (
        <p className="sub cachedSnapshotNote">Showing last saved snapshot from {formatCachedTime(activeCachedSnapshotAt)}.</p>
      ) : null}
      <div className="carousel">
        {showAwkwardFallback ? (
          <div className="imgFallback imgErrorFallback">
            <p className="imgErrorMessage">
              <strong>This is awkward… Intel unavailable.</strong>
              <br />
              Our apologies, HQ is resolving the issue – you’ll be notified when data is recovered.
            </p>
          </div>
        ) : (
          (activeSnapshot.artworkOverview.imageUrls.length ? activeSnapshot.artworkOverview.imageUrls : [""]).map((img, i) =>
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
          )
        )}
      </div>
      <h3 className="snapshotDetailsHeading">DETAILS OF ARTWORK</h3>
      <div className="snapshotDetailList" aria-label="Artwork details">
        {artworkDetailRows.map((row) => (
          <div key={row.label} className="snapshotDetailRow">
            <span className="snapshotDetailLabel">{row.label}</span>
            <span className="snapshotDetailValue">
              {((showAwkwardFallback && (row.label === "Artist" || row.label === "Title")) || isMissingArtworkDetail(row.value)) ? (
                <span className="snapshotDetailPlaceholder" role="img" aria-label="Not provided">
                  <span className="srOnly">Not provided</span>
                </span>
              ) : (
                row.value
              )}
            </span>
          </div>
        ))}
      </div>
      <div className="scoreSliderBlock" role="group" aria-label="Confidence score, read-only">
        <p className="scoreSliderValue">Confidence rating: {confidenceRatingText}</p>
        <p className="scoreSliderCaption">Calculated from listing signals</p>
        <div className="scoreSlider" aria-hidden="true">
          <div className={`scoreSliderFill ${scoreClass}`} style={{ width: `${clampedSnapshotScore}%` }} />
        </div>
        <div className="scoreSliderScale" aria-hidden="true">
          <span>0%</span>
          <span>100%</span>
        </div>
      </div>
      <p className="snapshotAction">
        RECOMMENDED ACTION:{" "}
        <span className={`statusChip ${statusClass(activeSnapshot.snapshot.status)}`}>{activeSnapshot.snapshot.recommendedAction}</span>
      </p>

      <div className="bucketGrid">
        {activeSnapshot.snapshot.buckets.map((bucket) => {
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
                  <p>{formatBucketLabel(bucket)}</p>
                  <div className="bucketHeaderRight">
                    <span className={`statusChip ${statusClass(bucket.status)}`}>{bucket.status}</span>
                    <span className="bucketChevron" aria-hidden="true">
                      {isExpanded ? "−" : "+"}
                    </span>
                  </div>
                </div>
              </button>
              {isExpanded ? (
                <div id={`bucket-panel-${bucket.key}`} className="bucketDetails" aria-hidden={false}>
                  <p className="bucketMeta">
                    Confidence rating: {confidenceLabel(bucket.status)} · Weight {bucket.weight}%
                  </p>
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

      <aside className="aiWarning" aria-label="AI warning">
        <span className="aiWarningIcon" aria-hidden="true">
          <svg viewBox="0 0 24 24" role="presentation" focusable="false">
            <path d="M12 2.4 5.2 5v5.3c0 4.6 2.8 8.9 6.8 10.3 4-1.4 6.8-5.7 6.8-10.3V5L12 2.4Z" />
            <path d="M12 8.2v5.3" />
            <circle cx="12" cy="16.3" r="0.8" />
          </svg>
        </span>
        <p className="aiWarningText">
          Art Detective delivers AI-powered intel. Intelligence. Not infallible. Verify before you act.
        </p>
      </aside>

      {!showAwkwardFallback ? (
        <button
          className={`otpButton snapshotSaveButton ${isCurrentListingSaved ? "savedStateButton" : ""}`}
          onClick={() => saveListing(activeUrl, detectiveView !== "snapshot")}
          disabled={!activeNormalizedUrl || loadingSnapshot || savingListing || isCurrentListingSaved}
        >
          {saveButtonLabel}
        </button>
      ) : null}
      <button
        className="analyseScanButton"
        onClick={() => window.open(activeUrl, "_blank")}
        disabled={!activeNormalizedUrl}
      >
        View source
      </button>
    </>
  ) : (
    <p className="sub">Building snapshot...</p>
  );

  const artworkErrorCard = (
    <>
      <div className="carousel">
        <div className="imgFallback imgErrorFallback">
          <p className="imgErrorMessage">
            Well, this is awkward… Intel unavailable. Our apologies, HQ is resolving the issue, stand by.
          </p>
        </div>
      </div>
      <h3 className="snapshotDetailsHeading">DETAILS OF ARTWORK</h3>
      <div className="snapshotDetailList" aria-label="Artwork details unavailable">
        {["Artist", "Title"].map((label) => (
          <div key={label} className="snapshotDetailRow">
            <span className="snapshotDetailLabel">{label}</span>
            <span className="snapshotDetailValue">
              <span className="snapshotDetailPlaceholder" role="img" aria-label="Not provided">
                <span className="srOnly">Not provided</span>
              </span>
            </span>
          </div>
        ))}
      </div>
      <div className="scoreSliderBlock" role="group" aria-label="Confidence score unavailable">
        <p className="scoreSliderValue">Confidence rating: Unknown</p>
      </div>
    </>
  );

  const profileIntelActive = authed && tab === "Profile";
  const loginPromptActive = !authed;
  const emailPlaceholder = useDecryptTypewriter("Name or Email", loginPromptActive, { tickMs: 30, maxJitter: 2 });
  const accessCodePlaceholder = useDecryptTypewriter("Access code", loginPromptActive, { tickMs: 34, maxJitter: 2 });
  const accessIdValue = useDecryptTypewriter("Alex Smith", profileIntelActive);
  const locationValue = useDecryptTypewriter("London, UK", profileIntelActive);
  const artworkBudgetValue = useDecryptTypewriter("£5,000", profileIntelActive);
  const profilePhotoSrc = PROFILE_PHOTO_CANDIDATES[Math.min(profilePhotoIndex, PROFILE_PHOTO_CANDIDATES.length - 1)];

  return (
    <main className="frameRoot">
      <div className="phoneFrame">
        <div className={authed ? "content contentWithNav" : "content"}>
          {!authed ? (
            <>
              <section className="analyseTopBar loginTopBar" aria-label="Initiate access header">
                <h1 className="appTitle loginLogo">The Art Detective</h1>
                <div className="analyseBadge">Log in</div>
              </section>

              <form className="card analyseInputCard" onSubmit={login}>
                <input 
                  value={email} 
                  onChange={(e) => setEmail(e.target.value)} 
                  placeholder={emailPlaceholder} 
                  autoComplete="username"
                />
                <input 
                  type="password"
                  value={password} 
                  onChange={(e) => setPassword(e.target.value)} 
                  placeholder={accessCodePlaceholder}
                  autoComplete="current-password"
                />
                <div className="row">
                  <button className="analyseScanButton" type="submit">Initiate access</button>
                </div>
                <button type="button" className="otpButton">Clearance scan (Face ID)</button>
                <p className="forgotText">
                  Forgot your <button type="button" className="forgotLink">access credentials</button>?
                </p>
              </form>
            </>
          ) : null}

          {authed && tab === "Detective" && detectiveView === "home" ? (
            <>
              <section className="analyseTopBar" aria-label="Analyse header">
                <div className="analyseBadge">Analyse</div>
              </section>

              <section className="card analyseInputCard">
                <div className="listingInputRow">
                  <input
                    value={url}
                    onChange={(e) => handleListingUrlChange(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        runSnapshot().catch(() => undefined);
                      }
                    }}
                    placeholder="Enter listing URL"
                  />
                  {url ? (
                    <button
                      type="button"
                      className="clearInputButton"
                      onPointerDown={(event) => {
                        event.preventDefault();
                        clearListingField();
                      }}
                      onClick={clearListingField}
                      aria-label="Clear listing URL"
                    >
                      ×
                    </button>
                  ) : null}
                </div>
                <div className="row">
                  <button className="analyseScanButton" onClick={runSnapshot} disabled={!url.trim() || loadingSnapshot}>
                    {loadingSnapshot ? (
                      "Loading..."
                    ) : (
                      <span className="scanButtonLabel">
                        Scan listing
                      </span>
                    )}
                  </button>
                  {canViewLastSnapshot ? (
                    <button
                      type="button"
                      className="otpButton viewLastSnapshotButton"
                      onClick={viewLastSnapshot}
                      disabled={loadingSnapshot}
                    >
                      View last scan
                    </button>
                  ) : null}
                </div>
              </section>
              {shouldShowInlineReport || shouldShowInlineErrorReport ? (
                <section className="card">
                  <h2 className="savedReportsTitle">Artwork report</h2>
                  {shouldShowInlineErrorReport ? artworkErrorCard : artworkReportCard}
                </section>
              ) : null}
              <section className="card curatedSectionCard" aria-label="Curated artworks">
                <div className="curatedHeader">
                  <div className="curatedHeadingGroup">
                    <h2 className="curatedTitle">Curated for you</h2>
                    <p className="curatedSubtitle">Based on the artists you follow</p>
                  </div>
                  <button type="button" className="sortButton curatedSortButton" aria-label="Sort curated artworks">
                    <ControlAdjustIcon />
                    Sort
                  </button>
                </div>
                <div className="curatedGrid">
                  {CURATED_ARTWORKS_MOCK_ITEMS.map((item) => (
                    <article key={item.id} className="curatedArtworkCard">
                      {item.imageUrl ? (
                        <Image
                          loader={passthroughImageLoader}
                          unoptimized
                          src={item.imageUrl}
                          alt={`${decodeHtmlEntities(item.title)} by ${decodeHtmlEntities(item.artist)}`}
                          width={300}
                          height={300}
                          className="curatedArtworkImage"
                        />
                      ) : (
                        <div className="curatedArtworkImageFallback">No image</div>
                      )}
                      <p className="curatedArtworkTitle">{decodeHtmlEntities(item.title)}</p>
                      <p className="curatedArtworkArtist">{decodeHtmlEntities(item.artist)}</p>
                      <p className="curatedArtworkSource">{formatSourceLabel(item.source)}</p>
                      <p className="curatedArtworkPrice">{formatPrice(item.price, item.currency)}</p>
                      <p className="curatedArtworkStatus">
                        <span className={`curatedStatusDot ${item.isAvailable ? "isAvailable" : "isUnavailable"}`} />
                        {item.isAvailable ? "Available" : "Unavailable"}
                      </p>
                    </article>
                  ))}
                </div>
              </section>
            </>
          ) : null}

          {authed && tab === "Dossier" && detectiveView === "home" ? (
            <>
              <section className="analyseTopBar" aria-label="Dossier header">
                <div className="analyseBadge">Dossier</div>
              </section>
              <section className="card savedReportsCard">
                <h2 className="savedReportsTitle">Saved reports</h2>
                <div className="savedListMeta">
                  <p className="sub">{watchlist.length} Artwork{watchlist.length === 1 ? "" : "s"}</p>
                  <button type="button" className="sortButton" aria-label="Sort saved reports">
                    <ControlAdjustIcon />
                    Sort
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
                            <strong>{decodeHtmlEntities(stripMarketplaceSuffix(item.title))}</strong>
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
            </>
          ) : null}

          {authed && detectiveView === "snapshot" && (tab === "Detective" || tab === "Dossier") ? (
            <>
              <section className="analyseTopBar snapshotTopBar" aria-label="Artwork report header">
                <button
                  type="button"
                  className="snapshotBackIconButton"
                  onClick={() => {
                    setTab("Dossier");
                    setDetectiveView("home");
                  }}
                  aria-label="Back"
                >
                  ←
                </button>
                <div className="analyseBadge artworkReportBadge">Artwork report</div>
              </section>
              <section className="card">
                {shouldShowSnapshotErrorReport ? artworkErrorCard : artworkReportCard}
              </section>
            </>
          ) : null}

          {authed && tab === "Discover" ? (
            <>
              <section className="analyseTopBar" aria-label="Discover header">
                <div className="analyseBadge">Discover</div>
              </section>

              <section className="card analyseInputCard discoverSearchCard">
                <div className="listingInputRow">
                  <input
                    value={artistInput}
                    onChange={(e) => setArtistInput(e.target.value)}
                    placeholder="Search artist"
                    aria-label="Search artist"
                  />
                  {artistInput ? (
                    <button
                      type="button"
                      className="clearInputButton"
                      onPointerDown={(event) => {
                        event.preventDefault();
                        setArtistInput("");
                      }}
                      onClick={() => setArtistInput("")}
                      aria-label="Clear artist search"
                    >
                      ×
                    </button>
                  ) : null}
                </div>
              </section>

              <section className="card discoverArtistsCard">
                <h2 className="discoverArtistsTitle">Artists</h2>
                <button type="button" className="discoverFilterButton" aria-label="Filter artists">
                  <ControlAdjustIcon />
                  Filter
                </button>
                {discoverCards.length === 0 ? <p className="sub">No artists found.</p> : null}
                <div className="discoverArtistGrid">
                  {discoverCards.map((item) => {
                    const isFollowed = followedArtists.has(item.artist.trim().toLowerCase());
                    return (
                      <article key={item.artist} className="discoverArtistCard">
                        {item.imageUrl ? (
                          <Image
                            loader={passthroughImageLoader}
                            unoptimized
                            src={item.imageUrl}
                            alt={item.artist}
                            width={220}
                            height={220}
                            className="discoverArtistImage"
                          />
                        ) : (
                          <div className="discoverArtistImageFallback">No image</div>
                        )}
                        <p className="discoverArtistName">{decodeHtmlEntities(item.artist)}</p>
                        <button
                          type="button"
                          className={`discoverFollowButton ${isFollowed ? "isFollowed" : "isUnfollowed"}`}
                          onClick={() => toggleFollowArtist(item.artist).catch(() => undefined)}
                        >
                          {isFollowed ? "Followed" : "Follow"}
                        </button>
                      </article>
                    );
                  })}
                </div>
              </section>
            </>
          ) : null}

          {authed && tab === "Profile" ? (
            <>
              <section className="analyseTopBar" aria-label="Profile header">
                <div className="analyseBadge">Profile</div>
              </section>

              <section className="card analyseInputCard profileIntelCard">
                <div className="profileIntelPortraitWrap">
                  <Image
                    src={profilePhotoSrc}
                    alt="Agent profile photo"
                    width={140}
                    height={180}
                    className="profileIntelPortrait"
                    onError={() =>
                      setProfilePhotoIndex((current) =>
                        Math.min(current + 1, PROFILE_PHOTO_CANDIDATES.length - 1),
                      )
                    }
                  />
                  <Image
                    src="/profile/confidential.svg"
                    alt=""
                    aria-hidden="true"
                    width={209}
                    height={56}
                    className="profileIntelStamp"
                  />
                </div>

                <div className="profileIntelField">
                  <span className="profileIntelFieldValue">{accessIdValue}</span>
                  <span className="profileIntelFieldLabel">Access ID</span>
                </div>
                <div className="profileIntelField">
                  <span className="profileIntelFieldValue">{locationValue}</span>
                  <span className="profileIntelFieldLabel">Location</span>
                </div>
                <div className="profileIntelField">
                  <span className="profileIntelFieldValue">{artworkBudgetValue}</span>
                  <span className="profileIntelFieldLabel">Artwork budget</span>
                </div>

                <div className="profileIntelInsightRow">
                  <span className="profileAiBeacon" aria-hidden="true">
                    <span className="profileAiBeaconPulse" />
                    <span className="profileAiBeaconRing" />
                    <Image src="/profile/AI-icon.svg" alt="" aria-hidden="true" width={42} height={42} />
                  </span>
                  <p className="profileIntelInsightText">
                    We analyse your field data to recommend a personalised dossier of targets.
                  </p>
                </div>

                <button className="profileSignOffButton" type="button" onClick={logout}>
                  Sign off
                </button>
                <button className="profileRulesLink" type="button">
                  Rules of Engagement (T&amp;Cs)
                </button>
              </section>
            </>
          ) : null}

          {error ? <p className="err">{error}</p> : null}
          {tab === "Dossier" && undoDelete ? (
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
            {(["Detective", "Dossier", "Discover", "Profile"] as Tab[]).map((item) => (
              <button
                key={item}
                className={tab === item ? "tab active" : "tab"}
                onClick={() => {
                  setTab(item);
                  setDetectiveView("home");
                }}
              >
                <span className="tabIcon" aria-hidden="true">
                  <TabIcon tab={item} />
                </span>
                <span className="tabLabel">{item === "Detective" ? "Analyse" : item}</span>
              </button>
            ))}
          </nav>
        ) : null}
      </div>
    </main>
  );
}
