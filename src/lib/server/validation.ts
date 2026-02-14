import { NextRequest, NextResponse } from "next/server";
import { ZodError, ZodType } from "zod";

export class HttpError extends Error {
  constructor(
    message: string,
    public readonly status = 400
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export async function parseJsonBody<T>(req: NextRequest, schema: ZodType<T>): Promise<T> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    throw new HttpError("Invalid JSON payload.", 400);
  }
  try {
    return schema.parse(raw);
  } catch (error) {
    if (error instanceof ZodError) {
      const first = error.issues[0];
      throw new HttpError(first?.message ?? "Request payload failed validation.", 400);
    }
    throw error;
  }
}

export function errorResponse(error: unknown): NextResponse {
  if (error instanceof HttpError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  const message = (error as Error)?.message || "Internal server error.";
  const status = /bearer|token/i.test(message) ? 401 : 500;
  return NextResponse.json({ error: message }, { status });
}
