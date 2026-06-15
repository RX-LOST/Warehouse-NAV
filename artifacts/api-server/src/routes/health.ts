import { Router } from "express";
import fs from "node:fs";
import { CONFIG_DIR, STAGING_DIR } from "../config.js";

const router = Router();

router.get("/healthz", (_req, res) => {
  const configCount = fs.existsSync(CONFIG_DIR) ? fs.readdirSync(CONFIG_DIR).length : 0;
  const stagingCount = fs.existsSync(STAGING_DIR) ? fs.readdirSync(STAGING_DIR).length : 0;

  res.json({
    status: "ok",
    uptime: process.uptime(),
    storage: { configs: configCount, staging: stagingCount },
  });
});

export default router;
