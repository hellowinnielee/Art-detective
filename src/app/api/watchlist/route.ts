import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/server/requestAuth";
import { addWatchlist, listWatchlist } from "@/lib/server/store";
import { buildSnapshotFromUrl } from "@/lib/server/snapshot";
import { parseJsonBody, errorResponse } from "@/lib/server/validation";
import { urlPayloadSchema } from "@/lib/server/schemas";

export async function GET(req: NextRequest) {
  try {
    const { userId } = getAuthUser(req);
    return NextResponse.json({ items: listWatchlist(userId) });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(req: NextRequest) {
  try {
    const { userId } = getAuthUser(req);
    const { url } = await parseJsonBody(req, urlPayloadSchema);
    const snap = await buildSnapshotFromUrl(url);
    addWatchlist(userId, {
      listingId: snap.snapshot.listingId,
      url,
      source: snap.source,
      title: snap.artworkOverview.title || "Untitled listing",
      thumbnailUrl: snap.artworkOverview.imageUrls[0],
      price: snap.artworkOverview.price,
      currency: snap.artworkOverview.currency,
    });
    return NextResponse.json({ ok: true, listingId: snap.snapshot.listingId }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
