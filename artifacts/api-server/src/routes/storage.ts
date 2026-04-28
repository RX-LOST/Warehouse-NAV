import { Router, type Request, type Response } from "express";
import multer from "multer";
import fs from "node:fs";
import path from "node:path";
import { logger } from "../lib/logger";

const router = Router();

const DATA_DIR = path.resolve(process.cwd(), "data");
const GLB_DIR = path.join(DATA_DIR, "glbs");
const CONFIG_DIR = path.join(DATA_DIR, "configs");
const PHOTO_DIR = path.join(DATA_DIR, "photos");

[DATA_DIR, GLB_DIR, CONFIG_DIR, PHOTO_DIR].forEach((dir) => {
  fs.mkdirSync(dir, { recursive: true });
});

const storage = multer.diskStorage({
  destination: (_req, file, cb) => {
    if (file.originalname.endsWith(".glb")) {
      cb(null, GLB_DIR);
    } else if (file.originalname.endsWith(".json")) {
      cb(null, CONFIG_DIR);
    } else {
      cb(null, PHOTO_DIR);
    }
  },
  filename: (_req, file, cb) => {
    cb(null, file.originalname);
  },
});

const upload = multer({
  storage,
  limits: {
    fileSize: 512 * 1024 * 512,
  },
});

function handleUpload(req: Request, res: Response) {
  if (!req.file) {
    return res.status(400).json({ error: "No file uploaded" });
  }

  return res.json({
    success: true,
    filename: req.file.filename,
  });
}

router.post("/upload", upload.single("file"), handleUpload);
router.post("/upload/glb", upload.single("file"), handleUpload);
router.post("/upload/photo", upload.single("file"), handleUpload);

router.get("/files/glbs/:file", (req, res) => {
  const filePath = path.join(GLB_DIR, req.params.file);

  if (!fs.existsSync(filePath)) {
    return res.status(404).send("File not found");
  }

  return res.sendFile(filePath);
});

router.get("/files/glbs", (_req, res) => {
  try {
    const files = fs.readdirSync(GLB_DIR);
    return res.json(files);
  } catch (err) {
    logger.error({ err }, "Failed to read GLB directory");
    return res.status(500).json({ error: "Failed to list GLBs" });
  }
});

router.get("/configs", (_req, res) => {
  try {
    const files = fs.readdirSync(CONFIG_DIR);
    return res.json(files);
  } catch (err) {
    logger.error({ err }, "Failed to read configs");
    return res.status(500).json({ error: "Failed to read configs" });
  }
});

router.get("/configs/:file", (req, res) => {
  const filePath = path.join(CONFIG_DIR, req.params.file);

  if (!fs.existsSync(filePath)) {
    return res.status(404).send("Config not found");
  }

  return res.sendFile(filePath);
});

export default router;
