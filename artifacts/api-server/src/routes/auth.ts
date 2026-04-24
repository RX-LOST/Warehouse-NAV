import { Router, type IRouter, type Request, type Response } from "express";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { logger } from "../lib/logger";

const router: IRouter = Router();

const DATA_DIR = process.env.DATA_DIR ?? path.resolve(process.cwd(), "data");
const AUTH_DIR = path.join(DATA_DIR, "auth");
const HASH_FILE = path.join(AUTH_DIR, "password.hash");
const DEFAULT_PASSWORD = "1234";

fs.mkdirSync(AUTH_DIR, { recursive: true });

// In-memory token store: token -> expiry ms
const tokens = new Map<string, number>();

// Clean up expired tokens periodically
setInterval(() => {
  const now = Date.now();
  for (const [tok, exp] of tokens.entries()) {
    if (now > exp) tokens.delete(tok);
  }
}, 60 * 60 * 1000); // every hour

async function hashPassword(password: string): Promise<string> {
  const salt = crypto.randomBytes(16).toString("hex");
  const key = await new Promise<Buffer>((res, rej) =>
    crypto.scrypt(password, salt, 64, (err, k) => (err ? rej(err) : res(k))),
  );
  return `${salt}:${key.toString("hex")}`;
}

async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const key = await new Promise<Buffer>((res, rej) =>
    crypto.scrypt(password, salt, 64, (err, k) => (err ? rej(err) : res(k))),
  );
  const hashBuf = Buffer.from(hash, "hex");
  if (key.length !== hashBuf.length) return false;
  return crypto.timingSafeEqual(hashBuf, key);
}

function readStoredHash(): string | null {
  if (!fs.existsSync(HASH_FILE)) return null;
  return fs.readFileSync(HASH_FILE, "utf8").trim();
}

async function ensureDefaultPassword() {
  if (!fs.existsSync(HASH_FILE)) {
    const h = await hashPassword(DEFAULT_PASSWORD);
    fs.writeFileSync(HASH_FILE, h, "utf8");
    logger.info("Default admin password initialized (1234)");
  }
}

ensureDefaultPassword().catch((e) => logger.error({ e }, "Failed to init password"));

function createToken(): string {
  const token = crypto.randomBytes(32).toString("hex");
  tokens.set(token, Date.now() + 8 * 60 * 60 * 1000); // 8h TTL
  return token;
}

function isValidToken(token: string): boolean {
  const exp = tokens.get(token);
  if (!exp) return false;
  if (Date.now() > exp) {
    tokens.delete(token);
    return false;
  }
  return true;
}

router.post("/auth/login", async (req: Request, res: Response) => {
  const { password } = req.body as { password?: string };
  if (!password) {
    res.status(400).json({ error: "password required" });
    return;
  }
  const stored = readStoredHash();
  if (!stored) {
    res.status(500).json({ error: "Password not configured" });
    return;
  }
  const ok = await verifyPassword(password, stored).catch(() => false);
  if (!ok) {
    res.status(401).json({ error: "Incorrect password" });
    return;
  }
  const token = createToken();
  logger.info("Admin login successful");
  res.json({ token });
});

router.post("/auth/logout", (req: Request, res: Response) => {
  const { token } = req.body as { token?: string };
  if (token) tokens.delete(token);
  res.json({ ok: true });
});

router.post("/auth/change-password", async (req: Request, res: Response) => {
  const { token, newPassword } = req.body as { token?: string; newPassword?: string };
  if (!token || !isValidToken(token)) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }
  if (!newPassword || newPassword.length < 4) {
    res.status(400).json({ error: "Password must be at least 4 characters" });
    return;
  }
  const h = await hashPassword(newPassword).catch(() => null);
  if (!h) {
    res.status(500).json({ error: "Failed to hash password" });
    return;
  }
  fs.writeFileSync(HASH_FILE, h, "utf8");
  logger.info("Admin password changed");
  res.json({ ok: true });
});

router.get("/auth/check", (req: Request, res: Response) => {
  const token = String(req.headers["x-admin-token"] ?? "");
  res.json({ valid: isValidToken(token) });
});

export { isValidToken };
export default router;
