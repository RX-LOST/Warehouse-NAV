import { Router } from "express";
import multer from "multer";
import path from "node:path";
import fs from "node:fs";

const router = Router();

const DATA_DIR = path.resolve(process.cwd(), "data");

const dirs = {
  glbs: path.join(DATA_DIR, "glbs"),
  photos: path.join(DATA_DIR, "photos"),
};

Object.values(dirs).forEach((dir) => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

const storage = multer.diskStorage({
  destination: (_req, file, cb) => {
    if (file.fieldname === "glb") cb(null, dirs.glbs);
    else cb(null, dirs.photos);
  },
  filename: (_req, file, cb) => {
    const unique = `${Date.now()}-${file.originalname}`;
    cb(null, unique);
  },
});

const upload = multer({ storage });

/**
 * Upload GLB
 */
router.post("/upload/glb", upload.single("glb"), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, error: "No file uploaded" });
    }

    return res.json({
      success: true,
      file: req.file.filename,
      path: `/api/files/glbs/${req.file.filename}`,
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, error: "Upload failed" });
  }
});

/**
 * Serve files
 */
router.get("/files/glbs/:name", (req, res) => {
  const filePath = path.join(dirs.glbs, req.params.name);

  if (!fs.existsSync(filePath)) {
    return res.status(404).send("Not found");
  }

  res.sendFile(filePath);
});

export default router;
