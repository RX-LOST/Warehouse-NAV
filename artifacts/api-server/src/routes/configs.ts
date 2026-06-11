import { Router } from "express";
import fs from "node:fs";
import path from "node:path";
import {
  listConfigNames,
  configNameExists,
  deleteConfigDir,
  ensureConfigDir,
  getConfigDir,
  saveConfigJson,
  readConfigJson,
  getActiveConfigName,
  setActiveConfigName,
  copyToConfig,
  getConfigFilePath,
} from "../services/fileStore.js";

const router = Router();

// ---------------------------------------------------------------------------
// List configs
// ---------------------------------------------------------------------------
router.get("/configs", (_req, res) => {
  const names = listConfigNames();
  res.json({ configs: names });
});

// ---------------------------------------------------------------------------
// Active config
// ---------------------------------------------------------------------------
router.get("/configs/active", (_req, res) => {
  const name = getActiveConfigName();
  if (!name) {
    res.json({ name: null, config: null });
    return;
  }
  const data = readConfigJson<Record<string, unknown>>(name);
  if (!data) {
    res.json({ name: null, config: null });
    return;
  }
  res.json({ name, ...data });
});

router.post("/configs/activate", (req, res) => {
  const { name } = req.body ?? {};
  if (!name || typeof name !== "string") {
    res.status(400).json({ error: "Bad Request", message: "Config name is required" });
    return;
  }
  if (!configNameExists(name)) {
    res.status(404).json({ error: "Not Found", message: `Config "${name}" does not exist` });
    return;
  }
  setActiveConfigName(name);
  res.json({ success: true, name });
});

// ---------------------------------------------------------------------------
// Serve files from config folders
// GET /configs/files/:name/:type/:filename
// ---------------------------------------------------------------------------
router.get("/configs/files/:name/:type/:filename", (req, res) => {
  const { name, type, filename } = req.params as Record<string, string>;
  const filePath = getConfigFilePath(name, type, filename);
  if (!filePath) {
    res.status(404).json({ error: "Not Found", message: "File not found" });
    return;
  }
  const ext = path.extname(filePath).toLowerCase();
  const mimeMap: Record<string, string> = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".glb": "model/gltf-binary",
    ".gltf": "model/gltf+json",
    ".ksplat": "application/octet-stream",
    ".splat": "application/octet-stream",
    ".ply": "application/octet-stream",
  };
  res.type(mimeMap[ext] ?? "application/octet-stream").sendFile(filePath);
});

// ---------------------------------------------------------------------------
// Get single config
// ---------------------------------------------------------------------------
router.get("/configs/:name", (req, res) => {
  const name = req.params["name"]!;
  const data = readConfigJson<Record<string, unknown>>(name);
  if (!data) {
    res.status(404).json({ error: "Not Found", message: `Config "${name}" not found` });
    return;
  }
  res.json({ name, ...data });
});

// ---------------------------------------------------------------------------
// Save / create config
//
// Receives { name, config: { glbUrl, splatUrl, shelves, objects, ... } }
// Copies referenced files from staging or old configs into the config folder,
// rewrites URLs, and saves config.json.
// ---------------------------------------------------------------------------
router.post("/configs", (req, res) => {
  const { name, config: bodyConfig } = req.body ?? {};
  if (!name || typeof name !== "string") {
    res.status(400).json({ error: "Bad Request", message: "Config name is required" });
    return;
  }

  const cfg = bodyConfig ?? {};
  const configName = name.replace(/\.json$/i, "");

  // Check for duplicate (skip for update — same name is OK)
  const alreadySaved = readConfigJson(configName);
  if (!alreadySaved && configNameExists(configName)) {
    // This shouldn't happen normally, but guard against name collisions
  }

  // Ensure the config folder exists
  ensureConfigDir(configName);

  // Helper: resolve and copy a file, return the new URL or the original if unchanged
  const resolveFile = (
    url: string | null | undefined,
    subdir: string,
    destName: string,
  ): string | null | undefined => {
    if (!url || typeof url !== "string") return url;
    // Skip blob URLs and external URLs
    if (url.startsWith("blob:") || url.startsWith("http://") || url.startsWith("https://")) return url;
    const result = copyToConfig(url, configName, subdir, destName);
    return result ?? url;
  };

  const ext = (url: string): string => path.extname(url).toLowerCase();

  // --- glbUrl → glb/scene.glb ---
  cfg.glbUrl = resolveFile(cfg.glbUrl, "glb", "scene.glb") ?? null;

  // --- splatUrl → splat/scene.{ext} ---
  if (cfg.splatUrl && typeof cfg.splatUrl === "string" && !cfg.splatUrl.startsWith("blob:") && !cfg.splatUrl.startsWith("http")) {
    const splatExt = ext(cfg.splatUrl) || ".ksplat";
    cfg.splatUrl = resolveFile(cfg.splatUrl, "splat", `scene${splatExt}`) ?? null;
  }

  // --- Scene objects → glb/<original-filename> ---
  if (Array.isArray(cfg.objects)) {
    cfg.objects = cfg.objects.map((o: Record<string, unknown>) => {
      if (o.url && typeof o.url === "string") {
        // Extract original filename from URL path
        const urlPath = o.url;
        const originalName = urlPath.split("/").pop() || "object.glb";
        o.url = resolveFile(o.url, "glb", originalName) ?? "";
      }
      return o;
    });
  }

  // --- Shelves → 360/<shelf-id>.<ext> ---
  if (cfg.shelves && typeof cfg.shelves === "object") {
    const updatedShelves: Record<string, unknown> = {};
    for (const [shelfId, shelf] of Object.entries(cfg.shelves as Record<string, unknown>)) {
      const s = { ...(shelf as Record<string, unknown>) };
      if (s.panoramaUrl && typeof s.panoramaUrl === "string" && !s.panoramaUrl.startsWith("blob:") && !s.panoramaUrl.startsWith("http")) {
        const panoramaExt = ext(s.panoramaUrl) || ".jpg";
        s.panoramaUrl = resolveFile(s.panoramaUrl, "360", `${shelfId}${panoramaExt}`) ?? null;
      }
      updatedShelves[shelfId] = s;
    }
    cfg.shelves = updatedShelves;
  }

  // Save config.json
  saveConfigJson(configName, cfg);

  // Auto-activate
  setActiveConfigName(configName);

  // Return the updated config so the frontend can update its URLs
  res.json({ success: true, name: configName, config: cfg });
});

// ---------------------------------------------------------------------------
// Delete config
// ---------------------------------------------------------------------------
router.delete("/configs/:name", (req, res) => {
  const name = req.params["name"]!;
  if (!configNameExists(name)) {
    res.status(404).json({ error: "Not Found", message: `Config "${name}" not found` });
    return;
  }
  deleteConfigDir(name);

  // If deleted config was active, clear active
  if (getActiveConfigName() === name) {
    setActiveConfigName("");
  }

  res.json({ success: true });
});

export default router;
