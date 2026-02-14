import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/server/requestAuth";
import { getUserById } from "@/lib/server/store";
import { errorResponse } from "@/lib/server/validation";

export async function GET(req: NextRequest) {
  try {
    const auth = getAuthUser(req);
    const user = getUserById(auth.userId);
    if (!user) return NextResponse.json({ error: "User not found." }, { status: 404 });
    return NextResponse.json({ user });
  } catch (error) {
    return errorResponse(error);
  }
}
