import { createHmac, randomUUID } from "node:crypto";

const secret = process.env.AUTH_SECRET ?? "dev-next-secret";

type TokenPayload = {
  sub: string;
  email?: string;
  exp: number;
};

function encode(payload: TokenPayload): string {
  const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const sig = createHmac("sha256", secret).update(encoded).digest("base64url");
  return `${encoded}.${sig}`;
}

function decode(token: string): TokenPayload {
  const [payload, sig] = token.split(".");
  if (!payload || !sig) throw new Error("Invalid token");
  const expected = createHmac("sha256", secret).update(payload).digest("base64url");
  if (expected !== sig) throw new Error("Invalid token signature");
  const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as TokenPayload;
  if (parsed.exp < Math.floor(Date.now() / 1000)) throw new Error("Token expired");
  return parsed;
}

export function issueAccessToken(userId: string, email: string): string {
  return encode({ sub: userId, email, exp: Math.floor(Date.now() / 1000) + 3600 });
}

export function issueRefreshToken(): string {
  return `rt_${randomUUID().replace(/-/g, "")}`;
}

export function verifyAccessToken(token: string): { userId: string; email?: string } {
  const payload = decode(token);
  return { userId: payload.sub, email: payload.email };
}
