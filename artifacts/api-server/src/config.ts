import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP_ROOT = path.resolve(__dirname, "..");

export const PORT = Number(process.env["PORT"] ?? "8080");
export const HOST = process.env["HOST"] ?? "0.0.0.0";
export const NODE_ENV = process.env["NODE_ENV"] ?? "development";
export const IS_PRODUCTION = NODE_ENV === "production";
export const LOG_LEVEL = process.env["LOG_LEVEL"] ?? (IS_PRODUCTION ? "info" : "debug");

export const DATA_DIR = path.resolve(APP_ROOT, "data");
export const GLB_DIR = path.join(DATA_DIR, "glbs");
export const PHOTO_DIR = path.join(DATA_DIR, "photos");
export const CONFIG_DIR = path.join(DATA_DIR, "configs");
export const AUTH_DIR = path.join(DATA_DIR, "auth");
export const STAGING_DIR = path.join(DATA_DIR, "staging");

export const MAX_FILE_SIZE = 512 * 1024 * 1024;
export const TOKEN_TTL_MS = 8 * 60 * 60 * 1000;

export const FRONTEND_DIST = path.resolve(APP_ROOT, "..", "warehouse-nav", "dist", "public");
