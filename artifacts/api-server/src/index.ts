import { PORT, HOST } from "./config.js";
import { logger } from "./lib/logger.js";
import app from "./app.js";

app.listen(PORT, HOST, () => {
  logger.info({ port: PORT, host: HOST }, "API server started");
});
