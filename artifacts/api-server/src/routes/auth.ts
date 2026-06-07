import { Router } from "express";
import { login, changePassword, revokeToken, isValidToken } from "../services/auth.js";
import { requireToken } from "../middleware/auth.js";

const router = Router();

router.post("/auth/login", async (req, res) => {
  const { password } = req.body ?? {};
  if (!password || typeof password !== "string") {
    res.status(400).json({ error: "Bad Request", message: "Password is required" });
    return;
  }
  const token = await login(password);
  if (!token) {
    res.status(401).json({ error: "Unauthorized", message: "Invalid password" });
    return;
  }
  res.json({ token });
});

router.post("/auth/logout", (req, res) => {
  const { token } = req.body ?? {};
  if (token && typeof token === "string") {
    revokeToken(token);
  }
  res.json({ success: true });
});

router.get("/auth/check", (req, res) => {
  const token = req.headers["x-admin-token"] as string | undefined;
  res.json({ valid: !!token && isValidToken(token) });
});

router.post("/auth/change-password", requireToken, async (req, res) => {
  const { newPassword } = req.body ?? {};
  if (!newPassword || typeof newPassword !== "string" || newPassword.length < 4) {
    res.status(400).json({ error: "Bad Request", message: "New password must be at least 4 characters" });
    return;
  }
  const token = req.headers["x-admin-token"] as string;
  const ok = await changePassword(token, newPassword);
  if (!ok) {
    res.status(500).json({ error: "Internal Server Error", message: "Failed to change password" });
    return;
  }
  res.json({ success: true });
});

export default router;
