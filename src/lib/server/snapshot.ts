import { randomUUID } from "node:crypto";
import { ListingRecord, SnapshotBucket, SnapshotBucketCheck, SnapshotResponseBody } from "./types";
import { saveListing } from "./store";

const FETCH_TIMEOUT_MS = 15000;

function isEbayUrl(url: string): boolean {
  return /(?:^|\.)ebay\./i.test(new URL(url).hostname);
}

function isLikelyBotBlock(content: string): boolean {
  return /\b(robot check|access denied|to continue, please verify|security measure|captcha)\b/i.test(content);
}

async function fetchWithTimeout(url: string, init?: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function fetchListingHtml(url: string): Promise<string> {
  const directHeaders: HeadersInit = {
    "User-Agent":
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Cache-Control": "no-cache",
  };

  try {
    const response = await fetchWithTimeout(url, { headers: directHeaders, redirect: "follow" });
    if (!response.ok) throw new Error(`Could not fetch listing (${response.status})`);
    const raw = await response.text();
    if (isLikelyBotBlock(raw)) throw new Error("Listing page appears bot-protected.");
    return raw;
  } catch (error) {
    if (!isEbayUrl(url)) throw error;
    // Fallback proxy for eBay pages when direct fetch is blocked.
    const fallbackUrl = `https://r.jina.ai/http://${url.replace(/^https?:\/\//i, "")}`;
    const fallback = await fetchWithTimeout(fallbackUrl, { headers: { "User-Agent": "ArtDetectiveWeb/1.0" } });
    if (!fallback.ok) {
      throw new Error(`Could not fetch listing (${fallback.status})`);
    }
    return await fallback.text();
  }
}

function inferDimensions(text: string): string | undefined {
  const match = text.match(
    /\b(\d{1,4}(?:\.\d+)?)\s*(?:x|by)\s*(\d{1,4}(?:\.\d+)?)(?:\s*(?:x|by)\s*(\d{1,4}(?:\.\d+)?))?\s*(cm|mm|inches|inch|in|")\b/i
  );
  if (!match) return undefined;
  const unit = match[4].toLowerCase() === '"' ? "in" : match[4].toLowerCase().replace("inches", "in").replace("inch", "in");
  return `${match[1]} x ${match[2]}${match[3] ? ` x ${match[3]}` : ""} ${unit}`;
}

function extractImageUrls(raw: string): string[] {
  const matches = raw.match(/https?:\/\/[^"'<>\s]+?\.(?:jpg|jpeg|png|webp)(?:\?[^"'<>\s]*)?/gi) ?? [];
  return [...new Set(matches)].slice(0, 8);
}

function extractMetaContent(raw: string, key: string): string | undefined {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re1 = new RegExp(`<meta[^>]+(?:property|name)=["']${escaped}["'][^>]+content=["']([^"']+)["']`, "i");
  const re2 = new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${escaped}["']`, "i");
  return raw.match(re1)?.[1] ?? raw.match(re2)?.[1];
}

function extractFromJsonLd(raw: string): { title?: string; price?: number; currency?: string; images?: string[] } {
  const scripts = [...raw.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
  for (const script of scripts) {
    const text = script[1]?.trim();
    if (!text) continue;
    try {
      const parsed = JSON.parse(text) as Record<string, unknown>;
      const offer = (parsed.offers ?? {}) as Record<string, unknown>;
      const title = typeof parsed.name === "string" ? parsed.name : undefined;
      const price = typeof offer.price === "string" || typeof offer.price === "number" ? Number(offer.price) : undefined;
      const currency = typeof offer.priceCurrency === "string" ? offer.priceCurrency : undefined;
      const imageRaw = parsed.image;
      const images =
        typeof imageRaw === "string"
          ? [imageRaw]
          : Array.isArray(imageRaw)
            ? imageRaw.filter((v): v is string => typeof v === "string")
            : undefined;
      if (title || price || currency || images?.length) {
        return { title, price, currency, images };
      }
    } catch {
      // Ignore malformed JSON-LD blocks.
    }
  }
  return {};
}

function computeStatus(score: number): "Good" | "Needs review" | "Missing evidence" {
  if (score >= 75) return "Good";
  if (score >= 50) return "Needs review";
  return "Missing evidence";
}

function toCheck(label: string, good: boolean, detailWhenGood: string, detailWhenMissing: string): SnapshotBucketCheck {
  return {
    label,
    value: good ? "Good" : "Missing evidence",
    detail: good ? detailWhenGood : detailWhenMissing,
  };
}

function computeBucketScore(checks: SnapshotBucketCheck[]): number {
  const total = checks.length;
  const value = checks.reduce((sum, check) => {
    if (check.value === "Good") return sum + 1;
    if (check.value === "Needs review") return sum + 0.5;
    return sum;
  }, 0);
  return Math.round((value / total) * 100);
}

function sanitizeArtistCandidate(value: string): string {
  return value
    .replace(/\s+/g, " ")
    .replace(/^[^A-Za-z]+/, "")
    .replace(/[^A-Za-z.'\-\s]+$/g, "")
    .trim();
}

function looksLikeArtistName(value: string): boolean {
  if (!value) return false;
  if (/\d/.test(value)) return false;
  const words = value.split(/\s+/).filter(Boolean);
  return words.length >= 2 && words.length <= 5;
}

function inferArtistName(title: string): string {
  // Common pattern: "Artist Name \"Work Title\" Print"
  const quoteIndex = title.search(/["'“”]/);
  if (quoteIndex > 0) {
    const quotedPrefix = sanitizeArtistCandidate(title.slice(0, quoteIndex));
    if (looksLikeArtistName(quotedPrefix)) return quotedPrefix;
  }

  // Pattern: "... by Artist Name"
  const byMatch = title.match(/\bby\s+([A-Za-z][A-Za-z .'\-]{1,80})/i);
  if (byMatch?.[1]) {
    const byArtist = sanitizeArtistCandidate(byMatch[1]);
    if (looksLikeArtistName(byArtist)) return byArtist;
  }

  // Pattern: "Artist Name - Listing title"
  const separatorMatch = title.match(/^(.+?)\s*[-|:]/);
  if (separatorMatch?.[1]) {
    const separated = sanitizeArtistCandidate(separatorMatch[1]);
    if (looksLikeArtistName(separated)) return separated;
  }

  const fallback = sanitizeArtistCandidate(title);
  return looksLikeArtistName(fallback) ? fallback : "Unknown artist";
}

export async function buildSnapshotFromUrl(url: string): Promise<SnapshotResponseBody> {
  const raw = await fetchListingHtml(url);
  const searchable = raw.toLowerCase();
  const jsonLd = extractFromJsonLd(raw);
  const titleMatch = raw.match(/<title>([^<]+)<\/title>/i);
  const ogTitle = extractMetaContent(raw, "og:title");
  const title = (
    jsonLd.title ||
    ogTitle ||
    titleMatch?.[1]?.replace(/\s*\|\s*eBay.*$/i, "").trim() ||
    "Untitled listing"
  ).trim();
  const priceJsonMatch = raw.match(/"price"\s*:\s*"?(\d+(?:\.\d+)?)"?/i);
  const priceDollarMatch = raw.match(/\$([0-9,]+(?:\.\d+)?)/);
  const price = typeof jsonLd.price === "number" && Number.isFinite(jsonLd.price)
    ? jsonLd.price
    : priceJsonMatch?.[1]
    ? Number(priceJsonMatch[1])
    : priceDollarMatch?.[1]
      ? Number(priceDollarMatch[1].replace(/,/g, ""))
      : undefined;
  const detectedCurrency = jsonLd.currency || extractMetaContent(raw, "product:price:currency") || "USD";
  const artist = inferArtistName(title);
  const dimensions = inferDimensions(raw) ?? "Not provided";
  const ogImage = extractMetaContent(raw, "og:image");
  const imageUrls = [
    ...(jsonLd.images ?? []),
    ...(ogImage ? [ogImage] : []),
    ...extractImageUrls(raw),
  ].filter((value, index, all) => all.indexOf(value) === index).slice(0, 8);

  const hasCoa = /\b(coa|certificate of authenticity|authenticity certificate)\b/i.test(searchable);
  const hasSignatureEvidence = /\b(signed|signature|hand[- ]signed)\b/i.test(searchable);
  const hasEditionEvidence = /\b(edition|ed\.\s?\d+|\/\d{1,4}|numbered)\b/i.test(searchable);
  const hasProvenance = /\b(provenance|acquired from|from the collection|previous sale|auction|sold at)\b/i.test(searchable);
  const hasReleaseContext = /\b(released|release|drop|year|published)\b/i.test(searchable);
  const hasPriceComparable = /\b(comparable|market|last sale|price history|median|percentile)\b/i.test(searchable);
  const hasReturnPolicy = /\b(return policy|returns accepted|return within|no returns)\b/i.test(searchable);
  const hasInsurance = /\b(shipping insurance|insured shipping|insured)\b/i.test(searchable);
  const hasBuyerProtection = /\b(buyer protection|money back guarantee|guarantee)\b/i.test(searchable);
  const hasSellerReliability = /\b(positive feedback|seller rating|top rated seller|trusted seller)\b/i.test(searchable);
  const hasDetailShots = imageUrls.length >= 2;
  const hasDocs = /\b(receipt|invoice|proof of purchase|documentation)\b/i.test(searchable) || hasCoa;
  const hasImageQuality = imageUrls.length > 0;

  const authenticityChecks: SnapshotBucketCheck[] = [
    toCheck("COA presence", hasCoa, "COA language detected.", "No COA mention found."),
    toCheck("Signature evidence", hasSignatureEvidence, "Signature keywords detected.", "No signature evidence found."),
    toCheck("Edition consistency", hasEditionEvidence, "Edition/numbering clues detected.", "Edition details missing."),
  ];
  const provenanceChecks: SnapshotBucketCheck[] = [
    toCheck("Prior listing/sale mentions", hasProvenance, "Provenance or prior-sale context found.", "No provenance trail mentioned."),
    toCheck("Release context", hasReleaseContext, "Release/date context appears in listing.", "Release context is missing."),
  ];
  const priceChecks: SnapshotBucketCheck[] = [
    {
      label: "Comparable listings/sales",
      value: typeof price === "number" ? "Good" : "Missing evidence",
      detail: typeof price === "number" ? "Current listing includes a concrete price." : "No concrete listing price extracted.",
    },
    toCheck("12-month trend band", hasPriceComparable, "Market-comparison language detected.", "No trend/comparable references found."),
    {
      label: "Percentile position",
      value: typeof price === "number" && hasPriceComparable ? "Needs review" : "Missing evidence",
      detail:
        typeof price === "number" && hasPriceComparable
          ? "Price is available; percentile still requires stronger market feed."
          : "Not enough context to compute percentile position.",
    },
  ];
  const riskChecks: SnapshotBucketCheck[] = [
    toCheck("Return policy", hasReturnPolicy, "Return policy terms detected.", "Return policy not clearly stated."),
    toCheck("Shipping insurance", hasInsurance, "Shipping insurance language detected.", "No shipping insurance mention."),
    toCheck("Buyer protection", hasBuyerProtection, "Buyer protection terms found.", "Buyer protection mention missing."),
    toCheck("Seller reliability", hasSellerReliability, "Seller reliability signals detected.", "Seller reliability signal missing."),
  ];
  const visualChecks: SnapshotBucketCheck[] = [
    toCheck("Image quality score", hasImageQuality, "At least one image detected.", "No listing images detected."),
    toCheck("Detail shots", hasDetailShots, "Multiple images suggest detail coverage.", "No detail-shot coverage detected."),
    toCheck("Docs detection", hasDocs, "COA/receipt-like docs mention detected.", "No COA/receipt docs mention detected."),
  ];

  const baseBuckets: SnapshotBucket[] = [
    {
      key: "authenticity",
      label: "Authenticity",
      weight: 35,
      checks: authenticityChecks,
      score: computeBucketScore(authenticityChecks),
      status: "Needs review",
      explanation: "",
    },
    {
      key: "provenance",
      label: "Provenance",
      weight: 20,
      checks: provenanceChecks,
      score: computeBucketScore(provenanceChecks),
      status: "Needs review",
      explanation: "",
    },
    {
      key: "price",
      label: "Price reassurance",
      weight: 20,
      checks: priceChecks,
      score: computeBucketScore(priceChecks),
      status: "Needs review",
      explanation: "",
    },
    {
      key: "risk",
      label: "Risk reducers",
      weight: 15,
      checks: riskChecks,
      score: computeBucketScore(riskChecks),
      status: "Needs review",
      explanation: "",
    },
    {
      key: "visual",
      label: "Visual proof",
      weight: 10,
      checks: visualChecks,
      score: computeBucketScore(visualChecks),
      status: "Needs review",
      explanation: "",
    },
  ];

  const buckets: SnapshotBucket[] = baseBuckets.map((bucket) => {
    const status = computeStatus(bucket.score);
    const evidenceGood = bucket.checks.filter((check) => check.value === "Good").length;
    const explanation =
      status === "Good"
        ? `${evidenceGood}/${bucket.checks.length} signals are solid in this bucket.`
        : status === "Needs review"
          ? `Partial evidence (${evidenceGood}/${bucket.checks.length}) — verify missing items with seller.`
          : `Low evidence (${evidenceGood}/${bucket.checks.length}) — high uncertainty remains.`;
    return { ...bucket, status, explanation };
  });

  const score = Math.round(buckets.reduce((acc, bucket) => acc + bucket.score * (bucket.weight / 100), 0));
  const status = computeStatus(score);

  const positiveSignals = buckets
    .flatMap((bucket) => bucket.checks.filter((check) => check.value === "Good").map((check) => `[${bucket.label}] ${check.detail}`))
    .slice(0, 3);
  const missingSignals = buckets
    .flatMap((bucket) =>
      bucket.checks
        .filter((check) => check.value !== "Good")
        .map((check) => `[${bucket.label}] ${check.detail}`)
    )
    .slice(0, 3);

  const authenticityOrRiskWeak = buckets.some(
    (bucket) =>
      (bucket.key === "authenticity" || bucket.key === "risk") &&
      bucket.status === "Missing evidence"
  );
  const recommendedAction =
    score >= 75 && !authenticityOrRiskWeak
      ? "Proceed"
      : score >= 50
        ? "Ask seller for docs"
        : "Wait/monitor";

  const listing: ListingRecord = {
    listingId: `lst_${randomUUID().slice(0, 12)}`,
    source: /ebay\./i.test(url) ? "ebay" : /stockx\./i.test(url) ? "stockx" : /artsy\./i.test(url) ? "artsy" : "listing",
    url,
    fetchedAt: new Date().toISOString(),
    currency: detectedCurrency,
    price,
    artwork: { title, dimensions, medium: undefined, yearOfRelease: undefined },
    artist: { name: artist },
    visual: { imageUrls },
  };
  saveListing(listing);

  return {
    source: listing.source,
    snapshot: {
      listingId: listing.listingId,
      score,
      status,
      recommendedAction,
      topPositiveSignals: positiveSignals,
      topMissingOrSuspiciousSignals: missingSignals,
      buckets,
    },
    artworkOverview: {
      imageUrls,
      artistName: listing.artist.name ?? "Unknown artist",
      title: listing.artwork.title ?? "Untitled",
      dimensions: listing.artwork.dimensions ?? "Not provided",
      price: listing.price,
      currency: listing.currency,
      medium: listing.artwork.medium ?? "Not provided",
      yearOfRelease: listing.artwork.yearOfRelease ?? "Not provided",
    },
  };
}
