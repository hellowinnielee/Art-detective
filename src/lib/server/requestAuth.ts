import { NextRequest } from "next/server";
import { verifyAccessToken } from "./auth";

export function getAuthUser(req: NextRequest): { userId: string; email?: string } {
  const auth = req.headers.get("authorization");
  if (!auth?.toLowerCase().startsWith("bearer ")) {
    throw new Error("Missing bearer token.");
  }
  const token = auth.slice(7);
  return verifyAccessToken(token);
}
