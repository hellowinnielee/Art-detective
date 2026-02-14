import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/server/requestAuth";
import { deleteWatchlistItem } from "@/lib/server/store";
import { errorResponse, HttpError } from "@/lib/server/validation";

type Params = { params: Promise<{ listingId: string }> };

export async function DELETE(req: NextRequest, context: Params) {
  try {
    const { userId } = getAuthUser(req);
    const { listingId } = await context.params;
    if (!listingId) throw new HttpError("Listing ID is required.", 400);

    const result = deleteWatchlistItem(userId, listingId);
    if (result.state === "not_found") {
      return NextResponse.json(
        {
          ok: true,
          state: "not_found",
          message: "Listing is already removed.",
        },
        { status: 200 }
      );
    }

    return NextResponse.json({
      ok: true,
      state: result.state,
      listingId,
      undoToken: result.undoToken,
      undoExpiresAt: result.undoExpiresAt,
    });
  } catch (error) {
    return errorResponse(error);
  }
}
