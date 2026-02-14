import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/server/requestAuth";
import { restoreWatchlistItem } from "@/lib/server/store";
import { errorResponse, HttpError, parseJsonBody } from "@/lib/server/validation";
import { z } from "zod";

type Params = { params: Promise<{ listingId: string }> };

const undoPayloadSchema = z.object({
  undoToken: z.string().min(1, "undoToken is required.").optional(),
});

export async function POST(req: NextRequest, context: Params) {
  try {
    const { userId } = getAuthUser(req);
    const { listingId } = await context.params;
    if (!listingId) throw new HttpError("Listing ID is required.", 400);

    const { undoToken } = await parseJsonBody(req, undoPayloadSchema);
    const result = restoreWatchlistItem(userId, listingId, undoToken);

    if (result.state === "restored") {
      return NextResponse.json({ ok: true, state: "restored", item: result.item });
    }
    if (result.state === "invalid_token") {
      throw new HttpError("Undo token is invalid for this listing.", 403);
    }
    if (result.state === "expired") {
      throw new HttpError("Undo window expired for this listing.", 410);
    }
    throw new HttpError("Listing cannot be restored.", 404);
  } catch (error) {
    return errorResponse(error);
  }
}
