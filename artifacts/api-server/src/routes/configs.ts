import { Router } from "express";
import fs from "node:fs";
import { CONFIG_DIR } from "../config.js";
import { listFiles, readJSONFile, getFilePath } from "../services/fileStore.js";
const router = Router();

router.get("/configs", (_req, res) => {
  const files = listFiles("configs").filter((f) => f.endsWith(".json"));
  const names = files.map((f) => f.replace(/\.json$/, ""));
  res.json({ configs: names });
});

// Specific routes must come before parameterized /configs/:name

router.get("/configs/active", (_req, res) => {
  const activePath = `${CONFIG_DIR}/_active`;
  try {
    const activeName = fs.readFileSync(activePath, "utf8").trim();
    if (!activeName) {
      res.json({ name: null, config: null });
      return;
    }
    const filename = `${activeName}.json`;
    const data = readJSONFile<Record<string, unknown>>(filename);
    if (!data) {
      res.json({ name: null, config: null });
      return;
    }
    res.json({ name: activeName, ...data });
  } catch {
    res.json({ name: null, config: null });
  }
});

router.post("/configs/activate", (req, res) => {
  const { name } = req.body ?? {};
  if (!name || typeof name !== "string") {
    res.status(400).json({ error: "Bad Request", message: "Config name is required" });
    return;
  }
  const activePath = `${CONFIG_DIR}/_active`;
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  fs.writeFileSync(activePath, name, "utf8");
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
  // Auto-activate saved config as the default
  fs.writeFileSync(`${dir}/_active`, name, "utf8");
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
