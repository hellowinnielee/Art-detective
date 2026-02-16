import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/server/requestAuth";
import { buildSnapshotFromUrl } from "@/lib/server/snapshot";
import { resolveSnapshotWithPlaceholder } from "@/lib/server/snapshotPlaceholder";
import { parseJsonBody, errorResponse } from "@/lib/server/validation";
import { urlPayloadSchema } from "@/lib/server/schemas";

function buildActionableSnapshotError(message: string, url?: string): {
  status: number;
  error: string;
  hint: string;
} {
  const lower = message.toLowerCase();
  const isEbay = typeof url === "string" && /(?:^|\.)ebay\./i.test(new URL(url).hostname);

  if (lower.includes("bot-protected") || lower.includes("captcha") || lower.includes("robot check")) {
    return {
      status: 503,
      error: "Snapshot access is temporarily blocked by the listing site.",
      hint: isEbay
        ? "eBay sometimes rate-limits automated fetches. Open the listing in a browser, wait 30-60 seconds, and retry. If it still fails, try another listing URL."
        : "The source marketplace appears to be blocking automated access. Retry shortly or try another listing URL.",
    };
  }

  if (lower.includes("could not fetch listing (404)") || lower.includes("could not fetch listing (410)")) {
    return {
      status: 404,
      error: "That listing is unavailable or no longer public.",
      hint: "Check that the URL is correct and publicly accessible, then try again.",
    };
  }

  if (lower.includes("abort") || lower.includes("timeout")) {
    return {
      status: 504,
      error: "The snapshot request timed out while fetching the listing.",
      hint: "Please retry in a few seconds. If this keeps happening, use a different listing URL to confirm source availability.",
    };
  }

  if (lower.includes("could not fetch listing")) {
    return {
      status: 502,
      error: "Unable to retrieve listing content right now.",
      hint: "The marketplace may be temporarily unavailable or blocking requests. Retry shortly.",
    };
  }

  return {
    status: 500,
    error: "Snapshot could not be generated from this listing.",
    hint: "Please verify the URL and try again. If the issue persists, test with a different listing source.",
  };
}

export async function POST(req: NextRequest) {
  let requestedUrl: string | undefined;
  try {
    getAuthUser(req);
    const { url } = await parseJsonBody(req, urlPayloadSchema);
    requestedUrl = url;
    const result = await resolveSnapshotWithPlaceholder(url, buildSnapshotFromUrl);
    if (result.mode === "placeholder-cache") {
      console.info(`[snapshot] placeholder cache hit for ${url}`);
    } else if (result.mode === "live-seeded-placeholder") {
      console.info(`[snapshot] live fetch seeded placeholder for ${url}`);
    } else {
      console.info(`[snapshot] live fetch for ${url}`);
    }
    return NextResponse.json(result.data);
  } catch (error) {
    const message = (error as Error)?.message ?? "";
    const actionable = buildActionableSnapshotError(message, requestedUrl);
    if (requestedUrl) {
      return NextResponse.json(
        {
          error: actionable.error,
          hint: actionable.hint,
        },
        { status: actionable.status }
      );
    }
    return errorResponse(error);
  }
}
