import type { Request, Response, NextFunction } from "express";
import { isValidToken } from "../services/auth.js";

export function requireToken(req: Request, res: Response, next: NextFunction): void {
  const token = req.headers["x-admin-token"] as string | undefined ?? req.body?.token ?? undefined;
  if (!token || !isValidToken(token)) {
    res.status(401).json({ error: "Unauthorized", message: "Invalid or expired admin token" });
    return;
  }
  next();
}
