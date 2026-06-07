import express from "express";
import cors from "cors";
import fs from "node:fs";
import path from "node:path";
import { IS_PRODUCTION, FRONTEND_DIST } from "./config.js";
import { errorHandler } from "./middleware/error.js";
import routes from "./routes/index.js";

const app = express();

app.use(cors());
app.use(express.json({ limit: "1mb" }));

app.use("/api", routes);

if (fs.existsSync(FRONTEND_DIST)) {
  app.use(express.static(FRONTEND_DIST));
  app.get("/{*path}", (_req, res) => {
    res.sendFile(path.join(FRONTEND_DIST, "index.html"));
  });
}

app.use(errorHandler);

export default app;
