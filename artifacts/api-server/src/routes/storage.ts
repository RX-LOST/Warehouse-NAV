import { Router, type IRouter, type Request, type Response } from "express";
import multer from "multer";
import path from "node:path";
import fs from "node:fs";
import { logger } from "../lib/logger";

const router: IRouter = Router();

const DATA_DIR = process.env.DATA_DIR ?? path.resolve(process.cwd(), "data");
const DIRS = {
  glbs: path.join(DATA_DIR, "glbs"),
  photos: path.join(DATA_DIR, "photos"),
  configs: path.join(DATA_DIR, "configs"),
};

for (const dir of Object.values(DIRS)) {
  fs.mkdirSync(dir, { recursive: true });
}

function makeStorage(subdir: "glbs" | "photos") {
  return multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, DIRS[subdir]),
    filename: (_req, file, cb) => {
      const safe = file.originalname.replace(/[^a-zA-Z0-9._-]/g, "_");
      const dest = path.join(DIRS[subdir], safe);
      if (fs.existsSync(dest)) {
        const ext = path.extname(safe);
        const base = path.basename(safe, ext);
        cb(null, `${base}_${Date.now()}${ext}`);
      } else {
        cb(null, safe);
      }
    },
  });
}

const uploadGlb = multer({
  storage: makeStorage("glbs"),
  limits: { fileSize: 512 * 1024 * 1024 }, // 512 MB
  fileFilter: (_req, file, cb) => {
    if (file.originalname.match(/\.(glb|gltf)$/i)) cb(null, true);
    else cb(new Error("Only .glb and .gltf files are allowed"));
  },
});

const uploadPhoto = multer({
  storage: makeStorage("photos"),
  limits: { fileSize: 64 * 1024 * 1024 }, // 64 MB
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith("image/")) cb(null, true);
    else cb(new Error("Only image files are allowed"));
  },
});

// ---- File listing ----
router.get("/files", (_req: Request, res: Response) => {
  try {
    const glbs = fs.readdirSync(DIRS.glbs).map((f) => ({
      type: "glb",
      name: f,
      url: `/api/files/glbs/${encodeURIComponent(f)}`,
    }));
    const photos = fs.readdirSync(DIRS.photos).map((f) => ({
      type: "photo",
      name: f,
      url: `/api/files/photos/${encodeURIComponent(f)}`,
    }));
    res.json({ files: [...glbs, ...photos] });
  } catch (e) {
    res.status(500).json({ error: "Failed to list files" });
  }
});

// ---- Static file serving ----
router.get("/files/glbs/:name", (req: Request, res: Response) => {
  const name = decodeURIComponent(String(req.params.name));
  const filePath = path.join(DIRS.glbs, name);
  if (!filePath.startsWith(DIRS.glbs) || !fs.existsSync(filePath)) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.sendFile(filePath);
});

router.get("/files/photos/:name", (req: Request, res: Response) => {
  const name = decodeURIComponent(String(req.params.name));
  const filePath = path.join(DIRS.photos, name);
  if (!filePath.startsWith(DIRS.photos) || !fs.existsSync(filePath)) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.sendFile(filePath);
});

// ---- File upload ----
router.post("/upload/glb", (req: Request, res: Response) => {
  uploadGlb.single("file")(req, res, (err) => {
    if (err) {
      logger.warn({ err }, "GLB upload error");
      res.status(400).json({ error: err.message });
      return;
    }
    if (!req.file) {
      res.status(400).json({ error: "No file provided" });
      return;
    }
    const url = `/api/files/glbs/${encodeURIComponent(req.file.filename)}`;
    logger.info({ filename: req.file.filename }, "GLB uploaded");
    res.json({ url, name: req.file.filename });
  });
});

router.post("/upload/photo", (req: Request, res: Response) => {
  uploadPhoto.single("file")(req, res, (err) => {
    if (err) {
      logger.warn({ err }, "Photo upload error");
      res.status(400).json({ error: err.message });
      return;
    }
    if (!req.file) {
      res.status(400).json({ error: "No file provided" });
      return;
    }
    const url = `/api/files/photos/${encodeURIComponent(req.file.filename)}`;
    logger.info({ filename: req.file.filename }, "Photo uploaded");
    res.json({ url, name: req.file.filename });
  });
});

// ---- File deletion ----
router.delete("/files/:type/:name", (req: Request, res: Response) => {
  const type = String(req.params.type);
  const name = String(req.params.name);
  if (type !== "glbs" && type !== "photos") {
    res.status(400).json({ error: "Invalid type" });
    return;
  }
  const dir = DIRS[type as "glbs" | "photos"];
  const filePath = path.join(dir, decodeURIComponent(name));
  if (!filePath.startsWith(dir) || !fs.existsSync(filePath)) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  fs.unlinkSync(filePath);
  logger.info({ type, name }, "File deleted");
  res.json({ ok: true });
});

// ---- Config CRUD ----
router.get("/configs", (_req: Request, res: Response) => {
  try {
    const names = fs
      .readdirSync(DIRS.configs)
      .filter((f) => f.endsWith(".json"))
      .map((f) => f.replace(/\.json$/, ""));
    res.json({ configs: names });
  } catch {
    res.json({ configs: [] });
  }
});

router.get("/configs/:name", (req: Request, res: Response) => {
  const name = String(req.params.name).replace(/[^a-zA-Z0-9_-]/g, "_");
  const filePath = path.join(DIRS.configs, `${name}.json`);
  if (!fs.existsSync(filePath)) {
    res.status(404).json({ error: "Config not found" });
    return;
  }
  try {
    const data = JSON.parse(fs.readFileSync(filePath, "utf8"));
    res.json(data);
  } catch {
    res.status(500).json({ error: "Failed to read config" });
  }
});

router.post("/configs", (req: Request, res: Response) => {
  const { name, config } = req.body as { name?: string; config?: unknown };
  if (!name || !config) {
    res.status(400).json({ error: "name and config are required" });
    return;
  }
  const safeName = String(name).replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64);
  if (!safeName) {
    res.status(400).json({ error: "Invalid config name" });
    return;
  }
  const filePath = path.join(DIRS.configs, `${safeName}.json`);
  fs.writeFileSync(filePath, JSON.stringify(config, null, 2), "utf8");
  logger.info({ name: safeName }, "Config saved");
  res.json({ ok: true, name: safeName });
});

router.delete("/configs/:name", (req: Request, res: Response) => {
  const name = String(req.params.name).replace(/[^a-zA-Z0-9_-]/g, "_");
  const filePath = path.join(DIRS.configs, `${name}.json`);
  if (!fs.existsSync(filePath)) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  fs.unlinkSync(filePath);
  res.json({ ok: true });
});

export { DATA_DIR, DIRS };
export default router;
