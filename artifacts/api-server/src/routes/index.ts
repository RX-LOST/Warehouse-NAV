import { Router } from "express";
import healthRoutes from "./health.js";
import authRoutes from "./auth.js";
import storageRoutes from "./storage.js";
import configRoutes from "./configs.js";

const router = Router();

router.use(healthRoutes);
router.use(authRoutes);
router.use(storageRoutes);
router.use(configRoutes);

export default router;
