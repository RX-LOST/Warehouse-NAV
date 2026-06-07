import express from "express";
import cors from "cors";
import { IS_PRODUCTION } from "./config.js";
import { errorHandler } from "./middleware/error.js";
import routes from "./routes/index.js";

const app = express();

app.use(cors());
app.use(express.json({ limit: "1mb" }));

app.use("/api", routes);

if (!IS_PRODUCTION) {
  app.use((_req, res) => {
    res.status(404).json({ error: "Not Found", message: "Route not found" });
  });
}

app.use(errorHandler);

export default app;
