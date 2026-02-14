import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/server/requestAuth";
import { listFollowing } from "@/lib/server/store";
import { discoverForArtists } from "@/lib/server/discover";
import { errorResponse } from "@/lib/server/validation";

export async function GET(req: NextRequest) {
  try {
    const { userId } = getAuthUser(req);
    const artists = listFollowing(userId);
    if (!artists.length) {
      return NextResponse.json({ items: [], message: "Follow artists to unlock Discover listings." });
    }
    const items = await discoverForArtists(artists);
    return NextResponse.json({ items, followedArtists: artists.length });
  } catch (error) {
    return errorResponse(error);
  }
}
