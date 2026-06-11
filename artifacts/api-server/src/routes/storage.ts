import { Router } from "express";
import { saveToStaging, getStagingFilePath, upload } from "../services/fileStore.js";
import path from "node:path";

const router = Router();

const MIME_MAP: Record<string, string> = {
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

router.post("/upload", upload.single("file"), (req, res) => {
  if (!req.file) {
    res.status(400).json({ error: "Bad Request", message: "No file uploaded" });
    return;
  }
  const filename = saveToStaging(req.file.originalname, req.file.buffer);
  res.json({ url: `/api/staging/${filename}`, filename });
});

router.get("/staging/:file", (req, res) => {
  const filePath = getStagingFilePath(req.params["file"]!);
  if (!filePath) {
    res.status(404).json({ error: "Not Found", message: "File not found" });
    return;
  }
  const ext = path.extname(filePath).toLowerCase();
  res.type(MIME_MAP[ext] ?? "application/octet-stream").sendFile(filePath);
});

export default router;
