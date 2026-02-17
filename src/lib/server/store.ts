import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ListingRecord } from "./types";

type User = {
  id: string;
  email: string;
};

export type WatchlistItem = {
  listingId: string;
  source: string;
  url: string;
  title: string;
  thumbnailUrl?: string;
  price?: number;
  currency?: string;
};

type DeletedWatchlistRecord = {
  item: WatchlistItem;
  deletedAt: string;
  undoToken: string;
  undoExpiresAt: string;
};

type DeleteWatchlistResult =
  | {
      state: "deleted" | "already_deleted";
      undoToken: string;
      undoExpiresAt: string;
      item: WatchlistItem;
    }
  | { state: "not_found" };

type RestoreWatchlistResult =
  | { state: "restored"; item: WatchlistItem }
  | { state: "not_found" | "expired" | "invalid_token" };

const usersByEmail = new Map<string, User>();
const refreshToUserId = new Map<string, string>();
const followsByEmail = new Map<string, Set<string>>();
const watchlistByUser = new Map<string, WatchlistItem[]>();
const deletedWatchlistByUser = new Map<string, Map<string, DeletedWatchlistRecord>>();
const alertsByUser = new Map<string, Array<{ id: string; type: string; message: string; createdAt: string }>>();
const listingsById = new Map<string, ListingRecord>();
const UNDO_TTL_MS = 10_000;
const DATA_DIR = join(process.cwd(), ".data");
const STATE_FILE = join(DATA_DIR, "store-state.json");
const TEMP_STATE_FILE = join(DATA_DIR, "store-state.tmp.json");
let lastPersistedMtimeMs = 0;

type PersistedStoreState = {
  usersByEmail: Array<[string, User]>;
  followsByEmail?: Array<[string, string[]]>;
  // Backward compatibility for older persisted shape.
  followsByUser?: Array<[string, string[]]>;
};

function loadPersistentState(force = false): void {
  if (!existsSync(STATE_FILE)) return;
  const mtimeMs = statSync(STATE_FILE).mtimeMs;
  if (!force && mtimeMs <= lastPersistedMtimeMs) return;
  const raw = readFileSync(STATE_FILE, "utf8");
  const parsed = JSON.parse(raw) as PersistedStoreState;
  usersByEmail.clear();
  followsByEmail.clear();
  for (const [email, user] of parsed.usersByEmail ?? []) {
    usersByEmail.set(email, user);
  }
  for (const [email, artists] of parsed.followsByEmail ?? []) {
    followsByEmail.set(email, new Set(artists));
  }
  if (!parsed.followsByEmail?.length && parsed.followsByUser?.length) {
    for (const [userId, artists] of parsed.followsByUser) {
      const user = findUserByIdInMemory(userId);
      if (!user) continue;
      followsByEmail.set(user.email, new Set(artists));
    }
  }
  lastPersistedMtimeMs = mtimeMs;
}

function persistState(): void {
  try {
    mkdirSync(DATA_DIR, { recursive: true });
    const payload: PersistedStoreState = {
      usersByEmail: [...usersByEmail.entries()],
      followsByEmail: [...followsByEmail.entries()].map(([email, artists]) => [email, [...artists.values()]]),
    };
    writeFileSync(TEMP_STATE_FILE, JSON.stringify(payload), "utf8");
    renameSync(TEMP_STATE_FILE, STATE_FILE);
    lastPersistedMtimeMs = statSync(STATE_FILE).mtimeMs;
  } catch {
    // Best effort persistence: app should still work in-memory if filesystem write is unavailable.
    try {
      unlinkSync(TEMP_STATE_FILE);
    } catch {}
  }
}

loadPersistentState(true);

function findUserByIdInMemory(userId: string): User | undefined {
  for (const user of usersByEmail.values()) {
    if (user.id === userId) return user;
  }
  return undefined;
}

function normalizeUrlKey(url: string): string {
  const trimmed = url.trim();
  if (!trimmed) return "";
  try {
    const parsed = new URL(trimmed);
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
    const pathname = parsed.pathname.replace(/\/+$/, "") || "/";
    return `${parsed.protocol}//${parsed.hostname.toLowerCase()}${pathname}${parsed.search}`;
  } catch {
    return trimmed.toLowerCase();
  }
}

function dedupeWatchlist(items: WatchlistItem[]): WatchlistItem[] {
  const seenListingIds = new Set<string>();
  const seenUrls = new Set<string>();
  const result: WatchlistItem[] = [];

  for (const item of items) {
    const listingId = item.listingId?.trim();
    const urlKey = normalizeUrlKey(item.url);
    if (!listingId || !urlKey) continue;
    if (seenListingIds.has(listingId) || seenUrls.has(urlKey)) continue;
    seenListingIds.add(listingId);
    seenUrls.add(urlKey);
    result.push(item);
  }

  return result;
}

export function ensureUser(email: string): User {
  loadPersistentState();
  const key = email.trim().toLowerCase();
  const existing = usersByEmail.get(key);
  if (existing) return existing;
  const user: User = { id: `usr_${randomUUID().slice(0, 12)}`, email: key };
  usersByEmail.set(key, user);
  persistState();
  return user;
}

export function getUserById(userId: string): User | undefined {
  loadPersistentState();
  return findUserByIdInMemory(userId);
}

function resolveEmailKey(userId: string, email?: string): string | undefined {
  const direct = email?.trim().toLowerCase();
  if (direct) return direct;
  const user = getUserById(userId);
  return user?.email;
}

export function storeRefresh(refreshToken: string, userId: string): void {
  refreshToUserId.set(refreshToken, userId);
}

export function getUserIdByRefresh(refreshToken: string): string | undefined {
  return refreshToUserId.get(refreshToken);
}

export function revokeRefresh(refreshToken: string): void {
  refreshToUserId.delete(refreshToken);
}

export function followArtist(userId: string, artist: string, email?: string): void {
  loadPersistentState();
  const emailKey = resolveEmailKey(userId, email);
  if (!emailKey) return;
  const set = followsByEmail.get(emailKey) ?? new Set<string>();
  set.add(artist);
  followsByEmail.set(emailKey, set);
  persistState();
}

export function unfollowArtist(userId: string, artist: string, email?: string): void {
  loadPersistentState();
  const emailKey = resolveEmailKey(userId, email);
  if (!emailKey) return;
  const set = followsByEmail.get(emailKey);
  if (!set) return;
  set.delete(artist);
  followsByEmail.set(emailKey, set);
  persistState();
}

export function listFollowing(userId: string, email?: string): string[] {
  loadPersistentState();
  const emailKey = resolveEmailKey(userId, email);
  if (!emailKey) return [];
  return [...(followsByEmail.get(emailKey) ?? new Set<string>()).values()];
}

export function addWatchlist(userId: string, item: WatchlistItem): void {
  const list = dedupeWatchlist(watchlistByUser.get(userId) ?? []);
  const incomingUrlKey = normalizeUrlKey(item.url);
  const next = dedupeWatchlist([
    item,
    ...list.filter(
      (entry) => entry.listingId !== item.listingId && normalizeUrlKey(entry.url) !== incomingUrlKey
    ),
  ]);
  watchlistByUser.set(userId, next);

  const deleted = deletedWatchlistByUser.get(userId);
  if (!deleted) return;
  for (const [key, record] of deleted.entries()) {
    if (record.item.listingId === item.listingId || normalizeUrlKey(record.item.url) === incomingUrlKey) {
      deleted.delete(key);
    }
  }
}

export function listWatchlist(userId: string): WatchlistItem[] {
  const deduped = dedupeWatchlist(watchlistByUser.get(userId) ?? []);
  watchlistByUser.set(userId, deduped);
  return deduped;
}

function getDeletedMap(userId: string): Map<string, DeletedWatchlistRecord> {
  const existing = deletedWatchlistByUser.get(userId);
  if (existing) return existing;
  const created = new Map<string, DeletedWatchlistRecord>();
  deletedWatchlistByUser.set(userId, created);
  return created;
}

function pruneExpiredDeleted(userId: string): void {
  const deleted = deletedWatchlistByUser.get(userId);
  if (!deleted) return;
  const now = Date.now();
  for (const [listingId, record] of deleted.entries()) {
    if (new Date(record.undoExpiresAt).getTime() <= now) {
      deleted.delete(listingId);
    }
  }
}

export function deleteWatchlistItem(userId: string, listingId: string): DeleteWatchlistResult {
  pruneExpiredDeleted(userId);
  const list = watchlistByUser.get(userId) ?? [];
  const match = list.find((entry) => entry.listingId === listingId);
  if (match) {
    watchlistByUser.set(
      userId,
      list.filter((entry) => entry.listingId !== listingId)
    );
    const deleted = getDeletedMap(userId);
    const now = Date.now();
    const record: DeletedWatchlistRecord = {
      item: match,
      deletedAt: new Date(now).toISOString(),
      undoToken: randomUUID().replace(/-/g, ""),
      undoExpiresAt: new Date(now + UNDO_TTL_MS).toISOString(),
    };
    deleted.set(listingId, record);
    return {
      state: "deleted",
      undoToken: record.undoToken,
      undoExpiresAt: record.undoExpiresAt,
      item: match,
    };
  }

  const deleted = deletedWatchlistByUser.get(userId);
  const existing = deleted?.get(listingId);
  if (!existing) {
    return { state: "not_found" };
  }

  return {
    state: "already_deleted",
    undoToken: existing.undoToken,
    undoExpiresAt: existing.undoExpiresAt,
    item: existing.item,
  };
}

export function restoreWatchlistItem(userId: string, listingId: string, undoToken?: string): RestoreWatchlistResult {
  pruneExpiredDeleted(userId);
  const deleted = deletedWatchlistByUser.get(userId);
  const existing = deleted?.get(listingId);
  if (!existing) return { state: "not_found" };

  if (new Date(existing.undoExpiresAt).getTime() <= Date.now()) {
    deleted?.delete(listingId);
    return { state: "expired" };
  }

  if (undoToken && existing.undoToken !== undoToken) {
    return { state: "invalid_token" };
  }

  deleted?.delete(listingId);
  addWatchlist(userId, existing.item);
  return { state: "restored", item: existing.item };
}

export function addAlert(userId: string, type: string, message: string): void {
  const list = alertsByUser.get(userId) ?? [];
  list.unshift({ id: `alt_${randomUUID().slice(0, 10)}`, type, message, createdAt: new Date().toISOString() });
  alertsByUser.set(userId, list.slice(0, 30));
}

export function listAlerts(userId: string): Array<{ id: string; type: string; message: string; createdAt: string }> {
  return alertsByUser.get(userId) ?? [];
}

export function saveListing(listing: ListingRecord): void {
  listingsById.set(listing.listingId, listing);
}

export function getListing(listingId: string): ListingRecord | undefined {
  return listingsById.get(listingId);
}
