import { NextRequest, NextResponse } from "next/server";
import { revokeRefresh } from "@/lib/server/store";
import { parseJsonBody, errorResponse } from "@/lib/server/validation";
import { refreshPayloadSchema } from "@/lib/server/schemas";
import { z } from "zod";

export async function POST(req: NextRequest) {
  try {
    const optionalRefreshSchema = refreshPayloadSchema.or(z.object({}));
    const parsed = await parseJsonBody(req, optionalRefreshSchema);
    if ("refreshToken" in parsed && parsed.refreshToken) revokeRefresh(parsed.refreshToken);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}
