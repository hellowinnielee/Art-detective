import { randomUUID } from "node:crypto";
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
const followsByUser = new Map<string, Set<string>>();
const watchlistByUser = new Map<string, WatchlistItem[]>();
const deletedWatchlistByUser = new Map<string, Map<string, DeletedWatchlistRecord>>();
const alertsByUser = new Map<string, Array<{ id: string; type: string; message: string; createdAt: string }>>();
const listingsById = new Map<string, ListingRecord>();
const UNDO_TTL_MS = 10_000;

function normalizeUrlKey(url: string): string {
  return url.trim().toLowerCase();
}

export function ensureUser(email: string): User {
  const key = email.trim().toLowerCase();
  const existing = usersByEmail.get(key);
  if (existing) return existing;
  const user: User = { id: `usr_${randomUUID().slice(0, 12)}`, email: key };
  usersByEmail.set(key, user);
  return user;
}

export function getUserById(userId: string): User | undefined {
  for (const user of usersByEmail.values()) {
    if (user.id === userId) return user;
  }
  return undefined;
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

export function followArtist(userId: string, artist: string): void {
  const set = followsByUser.get(userId) ?? new Set<string>();
  set.add(artist);
  followsByUser.set(userId, set);
}

export function unfollowArtist(userId: string, artist: string): void {
  const set = followsByUser.get(userId);
  if (!set) return;
  set.delete(artist);
  followsByUser.set(userId, set);
}

export function listFollowing(userId: string): string[] {
  return [...(followsByUser.get(userId) ?? new Set<string>()).values()];
}

export function addWatchlist(userId: string, item: WatchlistItem): void {
  const list = watchlistByUser.get(userId) ?? [];
  const incomingUrlKey = normalizeUrlKey(item.url);
  const deduped = [
    item,
    ...list.filter(
      (entry) => entry.listingId !== item.listingId && normalizeUrlKey(entry.url) !== incomingUrlKey
    ),
  ];
  watchlistByUser.set(userId, deduped);

  const deleted = deletedWatchlistByUser.get(userId);
  if (!deleted) return;
  for (const [key, record] of deleted.entries()) {
    if (record.item.listingId === item.listingId || normalizeUrlKey(record.item.url) === incomingUrlKey) {
      deleted.delete(key);
    }
  }
}

export function listWatchlist(userId: string): WatchlistItem[] {
  return watchlistByUser.get(userId) ?? [];
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
