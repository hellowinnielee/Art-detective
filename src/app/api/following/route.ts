import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/server/requestAuth";
import { listFollowing } from "@/lib/server/store";
import { errorResponse } from "@/lib/server/validation";

export async function GET(req: NextRequest) {
  try {
    const { userId, email } = getAuthUser(req);
    return NextResponse.json({ artists: listFollowing(userId, email) });
  } catch (error) {
    return errorResponse(error);
  }
}
