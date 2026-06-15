import fs from "node:fs";
import path from "node:path";
import multer from "multer";
import { DATA_DIR, CONFIG_DIR, STAGING_DIR, MAX_FILE_SIZE } from "../config.js";

// Ensure all base directories exist
[CONFIG_DIR, STAGING_DIR].forEach((dir) => fs.mkdirSync(dir, { recursive: true }));

// ---------------------------------------------------------------------------
// Migration from old flat-file format (configs/<name>.json) to new directory
// format (configs/<name>/config.json). Also migrates old file URLs and GLB
// locations. Runs once on module load.
// ---------------------------------------------------------------------------
function migrateOldConfigs(): void {
  let entries: string[];
  try { entries = fs.readdirSync(CONFIG_DIR); } catch { return; }

  for (const entry of entries) {
    if (entry === "_active" || entry === ".gitkeep") continue;

    const fullPath = path.join(CONFIG_DIR, entry);
    if (fs.statSync(fullPath).isDirectory()) continue;

    const name = entry.replace(/\.json$/i, "");
    if (!name) continue;

    try {
      const raw = fs.readFileSync(fullPath, "utf8");
      const data = JSON.parse(raw) as Record<string, unknown>;

      const OLD_GLBS_DIR = path.join(DATA_DIR, "glbs");
      const oldGlbUrl = data.glbUrl as string | undefined;
      if (oldGlbUrl && oldGlbUrl.startsWith("/api/files/glbs/")) {
        const filename = oldGlbUrl.slice("/api/files/glbs/".length);
        const oldFile = path.join(OLD_GLBS_DIR, filename);
        if (fs.existsSync(oldFile)) {
          const configDir = ensureConfigDir(name);
          fs.mkdirSync(path.join(configDir, "glb"), { recursive: true });
          fs.copyFileSync(oldFile, path.join(configDir, "glb", "scene.glb"));
          data.glbUrl = `/api/configs/files/${name}/glb/scene.glb`;
        }
      }

      saveConfigJson(name, data);
      fs.unlinkSync(fullPath);
    } catch {
      // skip corrupt entries
    }
  }

  if (!getActiveConfigName()) {
    const names = listConfigNames();
    if (names.length > 0) {
      setActiveConfigName(names[0]!);
    }
  }
}

migrateOldConfigs();

function sanitizeFilename(name: string): string {
  return path.basename(name).replace(/[^a-zA-Z0-9._-]/g, "_");
}

// ---------------------------------------------------------------------------
// Multer upload (memory storage — used directly by storage route)
// ---------------------------------------------------------------------------
export const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_FILE_SIZE } });

// ---------------------------------------------------------------------------
// Staging (temp upload area)
// ---------------------------------------------------------------------------
export function saveToStaging(originalname: string, buffer: Buffer): string {
  const safe = sanitizeFilename(originalname);
  fs.writeFileSync(path.join(STAGING_DIR, safe), buffer);
  return safe;
}

export function getStagingFilePath(filename: string): string | null {
  const safe = sanitizeFilename(filename);
  const p = path.join(STAGING_DIR, safe);
  return fs.existsSync(p) ? p : null;
}

// ---------------------------------------------------------------------------
// Config folder management
// ---------------------------------------------------------------------------
export function getConfigDir(name: string): string {
  return path.join(CONFIG_DIR, sanitizeFilename(name));
}

export function ensureConfigDir(name: string): string {
  const dir = getConfigDir(name);
  fs.mkdirSync(path.join(dir, "glb"), { recursive: true });
  fs.mkdirSync(path.join(dir, "360"), { recursive: true });
  fs.mkdirSync(path.join(dir, "splat"), { recursive: true });
  return dir;
}

export function deleteConfigDir(name: string): void {
  const dir = getConfigDir(name);
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

export function configNameExists(name: string): boolean {
  const dir = getConfigDir(name);
  return fs.existsSync(dir) && fs.statSync(dir).isDirectory();
}

export function listConfigNames(): string[] {
  try {
    return fs.readdirSync(CONFIG_DIR).filter((entry) => {
      if (entry === "_active" || entry === ".gitkeep") return false;
      const full = path.join(CONFIG_DIR, entry);
      return fs.statSync(full).isDirectory();
    });
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// File copying to config folder
// ---------------------------------------------------------------------------

/** Resolve a source file from a URL (staging or existing config) to an absolute path, or null. */
export function resolveSourcePath(url: string): string | null {
  if (url.startsWith("/api/staging/")) {
    const filename = url.slice("/api/staging/".length);
    return getStagingFilePath(filename);
  }
  const prefix = "/api/configs/files/";
  if (url.startsWith(prefix)) {
    const rel = url.slice(prefix.length);
    const parts = rel.split("/");
    if (parts.length >= 3) {
      const [configName, subdir, ...rest] = parts;
      const filename = rest.join("/");
      const p = path.join(CONFIG_DIR, sanitizeFilename(configName), subdir, filename);
      if (fs.existsSync(p)) return p;
    }
  }
  return null;
}

/**
 * Copy a file from a source URL into a config's subfolder, returning the new
 * public URL path (relative to /api/configs/files/<configName>/).
 */
export function copyToConfig(
  sourceUrl: string,
  configName: string,
  subdir: string,
  destFilename: string,
): string | null {
  const srcPath = resolveSourcePath(sourceUrl);
  if (!srcPath) return null;

  const configDir = ensureConfigDir(configName);
  const destPath = path.join(configDir, subdir, destFilename);
  fs.mkdirSync(path.dirname(destPath), { recursive: true });
  fs.copyFileSync(srcPath, destPath);
  return `/api/configs/files/${sanitizeFilename(configName)}/${subdir}/${destFilename}`;
}

// ---------------------------------------------------------------------------
// Config JSON read/write
// ---------------------------------------------------------------------------
export function saveConfigJson(name: string, data: unknown): void {
  const dir = ensureConfigDir(name);
  fs.writeFileSync(path.join(dir, "config.json"), JSON.stringify(data, null, 2), "utf8");
}

export function readConfigJson<T = unknown>(name: string): T | null {
  const dir = getConfigDir(name);
  const filePath = path.join(dir, "config.json");
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Active config
// ---------------------------------------------------------------------------
const ACTIVE_FILE = path.join(CONFIG_DIR, "_active");

export function getActiveConfigName(): string | null {
  try {
    const name = fs.readFileSync(ACTIVE_FILE, "utf8").trim();
    return name || null;
  } catch {
    return null;
  }
}

export function setActiveConfigName(name: string): void {
  fs.writeFileSync(ACTIVE_FILE, name, "utf8");
}

// ---------------------------------------------------------------------------
//  Config file path resolution for serving
// ---------------------------------------------------------------------------
export function getConfigFilePath(configName: string, subdir: string, filename: string): string | null {
  const safeName = sanitizeFilename(configName);
  const p = path.join(CONFIG_DIR, safeName, subdir, filename);
  if (!fs.existsSync(p)) return null;
  return p;
}


