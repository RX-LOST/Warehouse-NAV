import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { AUTH_DIR, TOKEN_TTL_MS } from "../config.js";
import { logger } from "../lib/logger.js";

const HASH_FILE = path.join(AUTH_DIR, "password.hash");
const DEFAULT_PASSWORD = "1234";
const tokens = new Map<string, number>();

fs.mkdirSync(AUTH_DIR, { recursive: true });

setInterval(() => {
  const now = Date.now();
  for (const [tok, exp] of tokens) {
    if (now > exp) tokens.delete(tok);
  }
}, 60 * 60 * 1000);

function hashPassword(password: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const salt = crypto.randomBytes(16).toString("hex");
    crypto.scrypt(password, salt, 64, (err, key) => {
      if (err) reject(err);
      else resolve(`${salt}:${key.toString("hex")}`);
    });
  });
}

function verifyPassword(password: string, stored: string): Promise<boolean> {
  return new Promise((resolve) => {
    const [salt, hash] = stored.split(":");
    if (!salt || !hash) return resolve(false);
    crypto.scrypt(password, salt, 64, (err, key) => {
      if (err) return resolve(false);
      const hashBuf = Buffer.from(hash, "hex");
      if (key.length !== hashBuf.length) return resolve(false);
      try {
        resolve(crypto.timingSafeEqual(hashBuf, key));
      } catch {
        resolve(false);
      }
    });
  });
}

function readStoredHash(): string | null {
  try {
    return fs.readFileSync(HASH_FILE, "utf8").trim();
  } catch {
    return null;
  }
}

async function ensureDefaultPassword(): Promise<void> {
  if (!fs.existsSync(HASH_FILE)) {
    const h = await hashPassword(DEFAULT_PASSWORD);
    fs.writeFileSync(HASH_FILE, h, "utf8");
    logger.info("Default admin password initialized (1234)");
  }
}

ensureDefaultPassword().catch((e) => logger.error({ err: e }, "Failed to init password"));

export function createToken(): string {
  const token = crypto.randomBytes(32).toString("hex");
  tokens.set(token, Date.now() + TOKEN_TTL_MS);
  return token;
}

export function isValidToken(token: string): boolean {
  const exp = tokens.get(token);
  if (!exp) return false;
  if (Date.now() > exp) {
    tokens.delete(token);
    return false;
  }
  return true;
}

export function revokeToken(token: string): void {
  tokens.delete(token);
}

export async function login(password: string): Promise<string | null> {
  const stored = readStoredHash();
  if (!stored) return null;
  const ok = await verifyPassword(password, stored);
  if (!ok) return null;
  return createToken();
}

export async function changePassword(token: string, newPassword: string): Promise<boolean> {
  if (!isValidToken(token)) return false;
  if (!newPassword || newPassword.length < 4) return false;
  const h = await hashPassword(newPassword);
  if (!h) return false;
  fs.writeFileSync(HASH_FILE, h, "utf8");
  logger.info("Admin password changed");
  return true;
}
