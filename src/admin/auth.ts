import crypto from "crypto";
import { config } from "../config.js";

interface TokenEntry {
  token: string;
  createdAt: number;
}

const TOKEN_TTL_MS = 24 * 60 * 60 * 1000; // 24h
const tokens = new Set<string>();
const tokenTimestamps = new Map<string, number>();

export function login(password: string): string | null {
  if (password !== config.ADMIN_PASSWORD) return null;
  const token = crypto.randomBytes(32).toString("hex");
  tokens.add(token);
  tokenTimestamps.set(token, Date.now());
  return token;
}

export function validateToken(token: string): boolean {
  if (!tokens.has(token)) return false;
  const created = tokenTimestamps.get(token)!;
  if (Date.now() - created > TOKEN_TTL_MS) {
    tokens.delete(token);
    tokenTimestamps.delete(token);
    return false;
  }
  return true;
}

// Cleanup expired tokens every hour
setInterval(() => {
  const now = Date.now();
  for (const [token, created] of tokenTimestamps) {
    if (now - created > TOKEN_TTL_MS) {
      tokens.delete(token);
      tokenTimestamps.delete(token);
    }
  }
}, 60 * 60 * 1000);
