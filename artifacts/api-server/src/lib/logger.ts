import pino from "pino";
import { IS_PRODUCTION, LOG_LEVEL } from "../config.js";

export const logger = pino({
  level: LOG_LEVEL,
  ...(IS_PRODUCTION
    ? {}
    : {
        transport: {
          target: "pino-pretty",
          options: { colorize: true },
        },
      }),
  redact: ["req.headers.authorization", "req.headers.cookie", "res.headers['set-cookie']"],
});
