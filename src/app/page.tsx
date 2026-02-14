"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import Image, { type ImageLoaderProps } from "next/image";
import { apiRequest } from "@/lib/client/api";
import { clearSession, getSession, saveSession } from "@/lib/client/session";

type Tab = "Discover" | "Detective" | "Saved" | "Profile";

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

type DiscoverItem = {
  id: string;
  artist: string;
  title: string;
  year?: string;
  medium?: string;
  source: string;
  imageUrl?: string;
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
  if (tab === "Saved") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M7 4h10a1 1 0 0 1 1 1v15l-6-3.6L6 20V5a1 1 0 0 1 1-1z" />
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
  const [email, setEmail] = useState("collector@example.com");
  const [authed, setAuthed] = useState(false);
  const [url, setUrl] = useState("");
  const [artistInput, setArtistInput] = useState("");
  const [following, setFollowing] = useState<string[]>([]);
  const [discoverItems, setDiscoverItems] = useState<DiscoverItem[]>([]);
  const [watchlist, setWatchlist] = useState<WatchlistItem[]>([]);
  const [snapshot, setSnapshot] = useState<SnapshotResponse | null>(null);
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

  useEffect(() => {
    const session = getSession();
    if (session) {
      setAuthed(true);
      setEmail(session.email);
      refreshAll().catch((err) => handleApiError(err));
    }
    // Intentionally run only once on first load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (authed && tab === "Discover") {
      refreshDiscover().catch(() => undefined);
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
      setCachedSnapshotAt(null);
    }
    if (savedListingUrl && nextValue.trim() !== savedListingUrl) {
      setSavedListingUrl("");
    }
  }

  function clearListingField() {
    setUrl("");
    setSnapshot(null);
    setCachedSnapshotAt(null);
    setError("");
  }

  async function refreshFollowing() {
    const data = await apiRequest<{ artists: string[] }>("/api/following");
    setFollowing(data.artists);
  }

  async function refreshDiscover() {
    const data = await apiRequest<{ items: DiscoverItem[] }>("/api/discover");
    setDiscoverItems(data.items);
  }

  async function refreshSaved() {
    const w = await apiRequest<{ items: WatchlistItem[] }>("/api/watchlist");
    setWatchlist(w.items);
  }

  async function refreshAll() {
    await Promise.all([refreshFollowing(), refreshDiscover(), refreshSaved()]);
  }

  function handleApiError(err: unknown) {
    const message = (err as Error)?.message ?? "Request failed.";
    if (/session refresh failed|invalid refresh token|missing bearer token|invalid token|token expired|user not found/i.test(message)) {
      clearSession();
      setAuthed(false);
      setSnapshot(null);
      setFollowing([]);
      setDiscoverItems([]);
      setWatchlist([]);
      setError("Session expired. Please sign in again.");
      return;
    }
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
      saveSession(data.tokens.accessToken, data.tokens.refreshToken, data.user.email);
      setAuthed(true);
      await refreshAll();
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
    setSnapshot(null);
    setFollowing([]);
    setDiscoverItems([]);
    setWatchlist([]);
  }

  async function runSnapshot() {
    const normalized = normalizeListingUrl(url);
    if (!normalized) return;
    setLoadingSnapshot(true);
    setError("");
    try {
      const data = await apiRequest<SnapshotResponse>("/api/snapshot", {
        method: "POST",
        body: JSON.stringify({ url: normalized }),
      });
      setSnapshot(data);
      saveCachedSnapshot(normalized, data);
      setCachedSnapshotAt(null);
    } catch (err) {
      const cached = getCachedSnapshot(normalized);
      if (cached) {
        setSnapshot(cached.snapshot);
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
    setTab("Detective");
    setUrl(normalized);
    setLoadingSnapshot(true);
    setError("");
    try {
      const data = await apiRequest<SnapshotResponse>("/api/snapshot", {
        method: "POST",
        body: JSON.stringify({ url: normalized }),
      });
      setSnapshot(data);
      saveCachedSnapshot(normalized, data);
      setCachedSnapshotAt(null);
      setSavedListingUrl(normalized);
    } catch (err) {
      const cached = getCachedSnapshot(normalized);
      if (cached) {
        setSnapshot(cached.snapshot);
        setCachedSnapshotAt(cached.savedAt);
        setSavedListingUrl(normalized);
        setError(`${(err as Error).message} Showing last saved snapshot for this listing.`);
      } else {
        setCachedSnapshotAt(null);
        handleApiError(err);
      }
    } finally {
      setLoadingSnapshot(false);
    }
  }

  async function followArtist() {
    const artist = formatArtistName(artistInput);
    if (!artist) return;
    try {
      await apiRequest(`/api/follow/${encodeURIComponent(artist)}`, { method: "POST" });
      setArtistInput("");
      await Promise.all([refreshFollowing(), refreshDiscover()]);
    } catch (err) {
      handleApiError(err);
    }
  }

  async function unfollowArtist(artist: string) {
    try {
      await apiRequest(`/api/follow/${encodeURIComponent(artist)}`, { method: "DELETE" });
      await Promise.all([refreshFollowing(), refreshDiscover()]);
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
  const isCurrentListingSaved = Boolean(normalizedUrl && normalizedUrl === savedListingUrl);
  const saveButtonLabel = savingListing ? "Saving..." : isCurrentListingSaved ? "Saved ✓" : "Save Listing";

  return (
    <main className="frameRoot">
      <div className="phoneFrame">
        <div className="content">
          <h1>Art Detective</h1>

          {!authed ? (
            <form className="card" onSubmit={login}>
              <h2>Sign in</h2>
              <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
              <button type="submit">Sign in</button>
            </form>
          ) : null}

          {authed && tab === "Detective" ? (
            <section className="card">
              <h2>Analyse a listing</h2>
              <p className="sub">Paste any listing URL to get a confidence snapshot in seconds.</p>
              <div className="listingInputRow">
                <input value={url} onChange={(e) => handleListingUrlChange(e.target.value)} placeholder="https://..." />
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
                <button onClick={runSnapshot} disabled={!url.trim() || loadingSnapshot}>
                  {loadingSnapshot ? "Loading..." : "Get Snapshot"}
                </button>
                <button
                  className={`secondary ${isCurrentListingSaved ? "savedStateButton" : ""}`}
                  onClick={saveListing}
                  disabled={!url.trim() || loadingSnapshot || savingListing || isCurrentListingSaved}
                >
                  {saveButtonLabel}
                </button>
              </div>
            </section>
          ) : null}

          {authed && tab === "Detective" && snapshot ? (
            <section className="card">
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
                {snapshot.snapshot.buckets.map((bucket) => (
                  <div key={bucket.key} className="bucketCard">
                    <div className="bucketHeader">
                      <p>{bucket.label}</p>
                      <span className={`statusChip ${statusClass(bucket.status)}`}>{bucket.status}</span>
                    </div>
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
                ))}
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
            </section>
          ) : null}

          {authed && tab === "Discover" ? (
            <section className="card">
              <h2>Discover</h2>
              <p className="sub">Listings from live APIs for artists you follow.</p>
              <input
                value={artistInput}
                onChange={(e) => setArtistInput(e.target.value)}
                placeholder="Artist Jane Doe"
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    followArtist().catch(() => undefined);
                  }
                }}
              />
              <button className="secondary" onClick={followArtist} disabled={!artistInput.trim()}>
                Follow
              </button>
              {following.map((artist) => (
                <div key={artist} className="followRow">
                  <span>+ {decodeHtmlEntities(artist)}</span>
                  <button className="tiny" onClick={() => unfollowArtist(artist)}>
                    Unfollow
                  </button>
                </div>
              ))}
              <button className="secondary" onClick={refreshDiscover}>
                Refresh Discover
              </button>
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
                    <p>
                      {decodeHtmlEntities(item.source)}
                      {item.year ? ` | ${item.year}` : ""}
                    </p>
                    {item.medium ? <p>{decodeHtmlEntities(item.medium)}</p> : null}
                  </div>
                </div>
              ))}
            </section>
          ) : null}

          {authed && tab === "Saved" ? (
            <>
              <section className="card">
                <h2>Watchlist</h2>
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
                              width={56}
                              height={56}
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
            </>
          ) : null}

          {authed && tab === "Profile" ? (
            <section className="card">
              <h2>Profile</h2>
              <label>First name</label>
              <input
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                placeholder="First name"
              />
              <label>Last name</label>
              <input
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                placeholder="Last name"
              />
              <p>Signed in: {email}</p>
              <button className="secondary" onClick={logout}>
                Logout
              </button>
            </section>
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
                This removes <strong>{decodeHtmlEntities(pendingDeleteItem.title)}</strong> from your Saved tab.
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

        <nav className="tabBar">
          {(["Discover", "Detective", "Saved", "Profile"] as Tab[]).map((item) => (
            <button key={item} className={tab === item ? "tab active" : "tab"} onClick={() => setTab(item)}>
              <span className="tabIcon" aria-hidden="true">
                <TabIcon tab={item} />
              </span>
              <span className="tabLabel">{item}</span>
            </button>
          ))}
        </nav>
      </div>
    </main>
  );
}
