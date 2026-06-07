import { Router } from "express";
import fs from "node:fs";
import { GLB_DIR, PHOTO_DIR, CONFIG_DIR, STAGING_DIR } from "../config.js";

const router = Router();

router.get("/healthz", (_req, res) => {
  const glbCount = fs.existsSync(GLB_DIR) ? fs.readdirSync(GLB_DIR).length : 0;
  const photoCount = fs.existsSync(PHOTO_DIR) ? fs.readdirSync(PHOTO_DIR).length : 0;
  const configCount = fs.existsSync(CONFIG_DIR) ? fs.readdirSync(CONFIG_DIR).length : 0;
  const stagingCount = fs.existsSync(STAGING_DIR) ? fs.readdirSync(STAGING_DIR).length : 0;

  res.json({
    status: "ok",
    uptime: process.uptime(),
    storage: { glbs: glbCount, photos: photoCount, configs: configCount, staging: stagingCount },
  });
});

export default router;
