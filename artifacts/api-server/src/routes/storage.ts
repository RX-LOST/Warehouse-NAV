import { Router } from "express";
import fs from "node:fs";
import path from "node:path";
import { upload, saveUpload, getFilePath, listFiles } from "../services/fileStore.js";

const router = Router();

router.get("/files/glbs", (_req, res) => {
  res.json({ files: listFiles("glbs") });
});

router.get("/files/photos", (_req, res) => {
  res.json({ files: listFiles("photos") });
});

router.get("/files/glbs/:file", (req, res) => {
  const filePath = getFilePath(req.params["file"]!, "glbs");
  if (!filePath) {
    res.status(404).json({ error: "Not Found", message: "File not found" });
    return;
  }
  const ext = path.extname(filePath).toLowerCase();
  const mime = ext === ".glb" ? "model/gltf-binary" : "application/octet-stream";
  res.type(mime).sendFile(filePath);
});

router.get("/files/photos/:file", (req, res) => {
  const filePath = getFilePath(req.params["file"]!, "photos");
  if (!filePath) {
    res.status(404).json({ error: "Not Found", message: "File not found" });
    return;
  }
  const mimeMap: Record<string, string> = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".gif": "image/gif",
    ".webp": "image/webp",
  };
  const ext = path.extname(filePath).toLowerCase();
  res.type(mimeMap[ext] ?? "application/octet-stream").sendFile(filePath);
});

router.post("/files/upload-glb", upload.single("file"), (req, res) => {
  if (!req.file) {
    res.status(400).json({ error: "Bad Request", message: "No file uploaded" });
    return;
  }
  const filename = saveUpload(req.file.originalname, req.file.buffer);
  res.json({ url: `/api/files/glbs/${filename}`, filename });
});

router.post("/files/upload-photo", upload.single("file"), (req, res) => {
  if (!req.file) {
    res.status(400).json({ error: "Bad Request", message: "No file uploaded" });
    return;
  }
  const filename = saveUpload(req.file.originalname, req.file.buffer);
  res.json({ url: `/api/files/photos/${filename}`, filename });
});

export default router;
