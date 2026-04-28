import pino from "pino";

const isProduction = process.env.NODE_ENV === "production";

export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  redact: [
    "req.headers.authorization",
    "req.headers.cookie",
    "res.headers['set-cookie']",
  ],

  // 🚨 IMPORTANT: disable transports completely on Pi
  // pino-pretty uses worker threads → causes crash
  transport: isProduction
    ? undefined
    : undefined,
});
