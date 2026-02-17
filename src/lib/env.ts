import { z } from "zod";

const publicEnvSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.url().optional(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1).optional(),
});

const serverEnvSchema = publicEnvSchema.extend({
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1).optional(),
  SNAPSHOT_PLACEHOLDER_TARGET_URL: z.url().optional(),
  SNAPSHOT_PLACEHOLDER_TARGET_URLS: z.string().optional(),
});

function parseBoolean(value: string | undefined): boolean {
  if (!value) return false;
  return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
}

const parsed = serverEnvSchema.safeParse({
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
  SNAPSHOT_PLACEHOLDER_TARGET_URL: process.env.SNAPSHOT_PLACEHOLDER_TARGET_URL,
  SNAPSHOT_PLACEHOLDER_TARGET_URLS: process.env.SNAPSHOT_PLACEHOLDER_TARGET_URLS,
});

if (!parsed.success) {
  console.warn("Invalid environment shape detected:", parsed.error.flatten().fieldErrors);
}

const parsedPublic = publicEnvSchema.safeParse({
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
});

export const env = {
  NEXT_PUBLIC_SUPABASE_URL: parsed.success ? parsed.data.NEXT_PUBLIC_SUPABASE_URL : undefined,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: parsed.success ? parsed.data.NEXT_PUBLIC_SUPABASE_ANON_KEY : undefined,
  SUPABASE_SERVICE_ROLE_KEY: parsed.success ? parsed.data.SUPABASE_SERVICE_ROLE_KEY : undefined,
  SNAPSHOT_PLACEHOLDER_MODE: parseBoolean(process.env.SNAPSHOT_PLACEHOLDER_MODE),
  SNAPSHOT_PLACEHOLDER_TARGET_URL: parsed.success ? parsed.data.SNAPSHOT_PLACEHOLDER_TARGET_URL : undefined,
  SNAPSHOT_PLACEHOLDER_TARGET_URLS: parsed.success ? parsed.data.SNAPSHOT_PLACEHOLDER_TARGET_URLS : undefined,
  hasSupabasePublic: parsedPublic.success,
  hasSupabaseService: Boolean(parsed.success && parsed.data.SUPABASE_SERVICE_ROLE_KEY),
};
