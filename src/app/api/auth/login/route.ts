import { NextRequest, NextResponse } from "next/server";
import { ensureUser, storeRefresh } from "@/lib/server/store";
import { issueAccessToken, issueRefreshToken } from "@/lib/server/auth";
import { parseJsonBody, errorResponse } from "@/lib/server/validation";
import { emailPayloadSchema } from "@/lib/server/schemas";

export async function POST(req: NextRequest) {
  try {
    const { email } = await parseJsonBody(req, emailPayloadSchema);
    const user = ensureUser(email);
    const accessToken = issueAccessToken(user.id, user.email);
    const refreshToken = issueRefreshToken();
    storeRefresh(refreshToken, user.id);
    return NextResponse.json({ user, tokens: { accessToken, refreshToken } }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
