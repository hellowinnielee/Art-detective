import { NextResponse } from "next/server";
import { env } from "@/lib/env";

export async function GET() {
  return NextResponse.json({
    ok: true,
    at: new Date().toISOString(),
    sources: ["ebay", "stockx", "artsy", "independent_gallery"],
    integrations: {
      supabasePublicEnvConfigured: env.hasSupabasePublic,
      supabaseServiceEnvConfigured: env.hasSupabaseService,
    },
  });
}
