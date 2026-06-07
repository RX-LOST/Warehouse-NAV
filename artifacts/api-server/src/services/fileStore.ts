import fs from "node:fs";
import path from "node:path";
import multer from "multer";
import { GLB_DIR, PHOTO_DIR, CONFIG_DIR, MAX_FILE_SIZE } from "../config.js";

[GLB_DIR, PHOTO_DIR, CONFIG_DIR].forEach((dir) => fs.mkdirSync(dir, { recursive: true }));

function sanitizeFilename(name: string): string {
  return path.basename(name).replace(/[^a-zA-Z0-9._-]/g, "_");
}

export const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_FILE_SIZE } });

export function saveUpload(filename: string, buffer: Buffer): string {
  const safeName = sanitizeFilename(filename);
  let dir: string;
  if (safeName.endsWith(".glb")) dir = GLB_DIR;
  else if (safeName.endsWith(".json")) dir = CONFIG_DIR;
  else dir = PHOTO_DIR;
  fs.writeFileSync(path.join(dir, safeName), buffer);
  return safeName;
}

export function getFilePath(filename: string, subpath: "glbs" | "photos" | "configs"): string | null {
  const dir = subpath === "glbs" ? GLB_DIR : subpath === "photos" ? PHOTO_DIR : CONFIG_DIR;
  const safeName = sanitizeFilename(filename);
  const filePath = path.join(dir, safeName);
  if (!fs.existsSync(filePath)) return null;
  return filePath;
}

export function listFiles(subpath: "glbs" | "photos" | "configs"): string[] {
  const dir = subpath === "glbs" ? GLB_DIR : subpath === "photos" ? PHOTO_DIR : CONFIG_DIR;
  try {
    return fs.readdirSync(dir);
  } catch {
    return [];
  }
}

export function readJSONFile<T = unknown>(filename: string): T | null {
  const filePath = getFilePath(filename, "configs");
  if (!filePath) return null;
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}
