import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/server/requestAuth";
import { listWatchlist } from "@/lib/server/store";
import { errorResponse } from "@/lib/server/validation";

export async function POST(req: NextRequest) {
  try {
    const { userId } = getAuthUser(req);
    const items = listWatchlist(userId);
    return NextResponse.json({
      rescanned: items.length,
      results: items.map((item) => ({ listingId: item.listingId, updated: true, missingFields: [] })),
    });
  } catch (error) {
    return errorResponse(error);
  }
}
