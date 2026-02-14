import { z } from "zod";

export const emailPayloadSchema = z.object({
  email: z.email("Valid email is required.").transform((value) => value.trim().toLowerCase()),
});

export const refreshPayloadSchema = z.object({
  refreshToken: z.string().min(1, "refreshToken required."),
});

export const urlPayloadSchema = z.object({
  url: z.url("A valid URL is required.").refine((value) => /^https?:\/\//i.test(value), "URL must use http or https."),
});
