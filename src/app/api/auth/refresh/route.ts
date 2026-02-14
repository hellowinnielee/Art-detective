import { NextRequest, NextResponse } from "next/server";
import { getUserById, getUserIdByRefresh, revokeRefresh, storeRefresh } from "@/lib/server/store";
import { issueAccessToken, issueRefreshToken } from "@/lib/server/auth";
import { parseJsonBody, errorResponse, HttpError } from "@/lib/server/validation";
import { refreshPayloadSchema } from "@/lib/server/schemas";

export async function POST(req: NextRequest) {
  try {
    const { refreshToken } = await parseJsonBody(req, refreshPayloadSchema);
    const userId = getUserIdByRefresh(refreshToken);
    if (!userId) {
      throw new HttpError("Invalid refresh token.", 401);
    }
    const user = getUserById(userId);
    if (!user) {
      throw new HttpError("User not found.", 401);
    }
    revokeRefresh(refreshToken);
    const nextRefresh = issueRefreshToken();
    storeRefresh(nextRefresh, user.id);
    const accessToken = issueAccessToken(user.id, user.email);
    return NextResponse.json({ tokens: { accessToken, refreshToken: nextRefresh } });
  } catch (error) {
    return errorResponse(error);
  }
}
