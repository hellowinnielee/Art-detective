import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/server/requestAuth";
import { listAlerts } from "@/lib/server/store";
import { errorResponse } from "@/lib/server/validation";

export async function GET(req: NextRequest) {
  try {
    const { userId } = getAuthUser(req);
    return NextResponse.json({ items: listAlerts(userId) });
  } catch (error) {
    return errorResponse(error);
  }
}
