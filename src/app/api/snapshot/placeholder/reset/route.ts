import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/server/requestAuth";
import {
  getSnapshotPlaceholderTargetUrl,
  isSnapshotPlaceholderEnabled,
  resetSnapshotPlaceholder,
} from "@/lib/server/snapshotPlaceholder";
import { errorResponse } from "@/lib/server/validation";

export async function POST(req: NextRequest) {
  try {
    getAuthUser(req);
    const reset = resetSnapshotPlaceholder();
    return NextResponse.json({
      ok: true,
      reset,
      placeholderModeEnabled: isSnapshotPlaceholderEnabled(),
      targetUrl: getSnapshotPlaceholderTargetUrl(),
    });
  } catch (error) {
    return errorResponse(error);
  }
}
