import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/server/requestAuth";
import { followArtist, unfollowArtist } from "@/lib/server/store";
import { errorResponse, HttpError } from "@/lib/server/validation";

type Params = { params: Promise<{ artistId: string }> };

export async function POST(req: NextRequest, context: Params) {
  try {
    const { userId, email } = getAuthUser(req);
    const { artistId } = await context.params;
    if (!artistId) throw new HttpError("Artist ID is required.", 400);
    followArtist(userId, artistId, email);
    return NextResponse.json({ ok: true, artistId }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(req: NextRequest, context: Params) {
  try {
    const { userId, email } = getAuthUser(req);
    const { artistId } = await context.params;
    if (!artistId) throw new HttpError("Artist ID is required.", 400);
    unfollowArtist(userId, artistId, email);
    return NextResponse.json({ ok: true, artistId });
  } catch (error) {
    return errorResponse(error);
  }
}
