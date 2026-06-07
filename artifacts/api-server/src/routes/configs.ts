import { Router } from "express";
import fs from "node:fs";
import path from "node:path";
import { CONFIG_DIR } from "../config.js";
import { listFiles, readJSONFile, getFilePath } from "../services/fileStore.js";

const ACTIVE_FILE = path.join(CONFIG_DIR, ".active");
const router = Router();

router.get("/configs", (_req, res) => {
  const files = listFiles("configs").filter((f) => f.endsWith(".json"));
  const names = files.map((f) => f.replace(/\.json$/, ""));
  res.json({ configs: names });
});

router.get("/configs/active", (_req, res) => {
  try {
    if (fs.existsSync(ACTIVE_FILE)) {
      const activeName = fs.readFileSync(ACTIVE_FILE, "utf8").trim();
      if (activeName) {
        const filename = `${activeName}.json`;
        const data = readJSONFile<Record<string, unknown>>(filename);
        if (data) {
          res.json({ name: activeName, ...data });
          return;
        }
      }
    }
    res.status(404).json({ error: "No active config" });
  } catch {
    res.status(500).json({ error: "Failed to read active config" });
  }
});

router.put("/configs/active", (req, res) => {
  const { name } = req.body ?? {};
  if (!name || typeof name !== "string") {
    res.status(400).json({ error: "Bad Request", message: "Config name is required" });
    return;
  }
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  fs.writeFileSync(ACTIVE_FILE, name, "utf8");
  res.json({ success: true, name });
});

router.get("/configs/:name", (req, res) => {
  const name = req.params["name"]!;
  const filename = `${name}.json`;
  const data = readJSONFile<Record<string, unknown>>(filename);
  if (!data) {
    res.status(404).json({ error: "Not Found", message: `Config "${name}" not found` });
    return;
  }
  res.json({ name, ...data });
});

router.post("/configs", (req, res) => {
  const { name, config: bodyConfig } = req.body ?? {};
  if (!name || typeof name !== "string") {
    res.status(400).json({ error: "Bad Request", message: "Config name is required" });
    return;
  }
  const filename = name.endsWith(".json") ? name : `${name}.json`;
  const dir = CONFIG_DIR;
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(`${dir}/${filename}`, JSON.stringify(bodyConfig ?? {}, null, 2), "utf8");
  res.json({ success: true, name });
});

router.delete("/configs/:name", (req, res) => {
  const name = req.params["name"]!;
  const filename = `${name}.json`;
  const filePath = getFilePath(filename, "configs");
  if (!filePath) {
    res.status(404).json({ error: "Not Found", message: `Config "${name}" not found` });
    return;
  }
  fs.unlinkSync(filePath);
  res.json({ success: true });
});

export default router;
