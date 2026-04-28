import { Router } from "express";
import fs from "node:fs";
import path from "node:path";

const router = Router();

const CONFIG_DIR = path.resolve(process.cwd(), "data/configs");

if (!fs.existsSync(CONFIG_DIR)) {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
}

/**
 * Get all configs
 */
router.get("/configs", (_req, res) => {
  try {
    const files = fs.readdirSync(CONFIG_DIR);

    const configs = files.map((file) => {
      const fullPath = path.join(CONFIG_DIR, file);
      const raw = fs.readFileSync(fullPath, "utf-8");

      return JSON.parse(raw);
    });

    return res.json(configs);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Failed to load configs" });
  }
});

/**
 * Save config
 */
router.post("/configs", (req, res) => {
  try {
    const data = req.body;

    const filename = `${Date.now()}.json`;
    const filePath = path.join(CONFIG_DIR, filename);

    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));

    return res.json({ success: true, file: filename });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Failed to save config" });
  }
});

export default router;
