import { env } from "@/lib/env";
import { SnapshotResponseBody } from "./types";

const DEFAULT_TARGET_URL =
  "https://www.ebay.co.uk/itm/396331445766?_trkparms=amclksrc%3DITM%26aid%3D777008%26algo%3DPERSONAL.TOPIC%26ao%3D1%26asc%3D20250417133020%26meid%3Dafb6ffaaff9546b49705346d1bc28b5d%26pid%3D102726%26rk%3D1%26rkt%3D1%26itm%3D396331445766%26pmt%3D0%26noa%3D1%26pg%3D4375194%26algv%3DRecentlyViewedItemsV2DWebWithPSItemDRV2_BP&_trksid=p4375194.c102726.m162918";

type PlaceholderCache = {
  response: SnapshotResponseBody;
  capturedAt: string;
};

type SnapshotResolution =
  | { mode: "live"; data: SnapshotResponseBody }
  | { mode: "live-seeded-placeholder"; data: SnapshotResponseBody }
  | { mode: "placeholder-cache"; data: SnapshotResponseBody };

const placeholderCache = new Map<string, PlaceholderCache>();

function normalizeHost(hostname: string): string {
  return hostname.toLowerCase().replace(/^www\./, "");
}

function normalizeUrl(input: string): URL | null {
  try {
    return new URL(input);
  } catch {
    return null;
  }
}

function readEbayItemId(url: URL): string | null {
  const pathMatch = url.pathname.match(/\/itm\/(?:[^/]+\/)?(\d+)/i);
  if (pathMatch?.[1]) return pathMatch[1];
  const itmParam = url.searchParams.get("itm");
  if (itmParam) return itmParam;
  return null;
}

function readEbayItemIdFromText(value: string): string | null {
  const pathMatch = value.match(/\/itm\/(?:[^/\s]+\/)?(\d+)/i);
  if (pathMatch?.[1]) return pathMatch[1];
  const queryMatch = value.match(/[?&]itm=(\d+)/i);
  if (queryMatch?.[1]) return queryMatch[1];
  return null;
}

function sameTargetListing(inputUrl: string, targetUrl: string): boolean {
  // Compare by eBay item ID first from raw text so matching still works
  // even if query strings contain malformed percent-encoding.
  const inputItemIdFromText = readEbayItemIdFromText(inputUrl);
  const targetItemIdFromText = readEbayItemIdFromText(targetUrl);
  if (inputItemIdFromText && targetItemIdFromText) {
    return inputItemIdFromText === targetItemIdFromText;
  }

  const input = normalizeUrl(inputUrl);
  const target = normalizeUrl(targetUrl);
  if (!input || !target) return false;

  const inputItemId = readEbayItemId(input);
  const targetItemId = readEbayItemId(target);
  if (inputItemId && targetItemId) return inputItemId === targetItemId;

  return normalizeHost(input.hostname) === normalizeHost(target.hostname) && input.pathname === target.pathname;
}

export function getSnapshotPlaceholderTargetUrl(): string {
  const configuredTarget = process.env.SNAPSHOT_PLACEHOLDER_TARGET_URL?.trim();
  return configuredTarget || env.SNAPSHOT_PLACEHOLDER_TARGET_URL || DEFAULT_TARGET_URL;
}

export function getSnapshotPlaceholderTargetUrls(): string[] {
  const runtimeRawList = process.env.SNAPSHOT_PLACEHOLDER_TARGET_URLS?.trim();
  const envRawList = env.SNAPSHOT_PLACEHOLDER_TARGET_URLS?.trim();
  const rawList = runtimeRawList || envRawList;
  if (!rawList) return [getSnapshotPlaceholderTargetUrl()];
  const parsed = rawList
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  return parsed.length ? parsed : [getSnapshotPlaceholderTargetUrl()];
}

export function isSnapshotPlaceholderEnabled(): boolean {
  const rawFlag = process.env.SNAPSHOT_PLACEHOLDER_MODE;
  const runtimeFlag = rawFlag ? ["1", "true", "yes", "on"].includes(rawFlag.trim().toLowerCase()) : undefined;
  return process.env.NODE_ENV !== "production" && (runtimeFlag ?? env.SNAPSHOT_PLACEHOLDER_MODE);
}

function readListingCacheKey(value: string): string {
  const itemIdFromText = readEbayItemIdFromText(value);
  if (itemIdFromText) return `ebay:${itemIdFromText}`;

  const parsed = normalizeUrl(value);
  if (!parsed) return value.trim().toLowerCase();

  const itemId = readEbayItemId(parsed);
  if (itemId) return `ebay:${itemId}`;

  return `${normalizeHost(parsed.hostname)}${parsed.pathname}`;
}

export function resetSnapshotPlaceholder(): boolean {
  const hadCache = placeholderCache.size > 0;
  placeholderCache.clear();
  return hadCache;
}

export async function resolveSnapshotWithPlaceholder(
  url: string,
  buildSnapshot: (url: string) => Promise<SnapshotResponseBody>
): Promise<SnapshotResolution> {
  if (!isSnapshotPlaceholderEnabled()) {
    return { mode: "live", data: await buildSnapshot(url) };
  }

  const targetUrl = getSnapshotPlaceholderTargetUrls().find((target) => sameTargetListing(url, target));
  if (!targetUrl) {
    return { mode: "live", data: await buildSnapshot(url) };
  }

  const cacheKey = readListingCacheKey(targetUrl);
  const cached = placeholderCache.get(cacheKey);
  if (cached) {
    return { mode: "placeholder-cache", data: cached.response };
  }

  // First call for the configured target runs the real flow, then seeds placeholder data.
  const data = await buildSnapshot(url);
  placeholderCache.set(cacheKey, {
    response: data,
    capturedAt: new Date().toISOString(),
  });
  return { mode: "live-seeded-placeholder", data };
}
