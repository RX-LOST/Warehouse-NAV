import { Router } from "express";
import storage from "./storage";
import auth from "./auth";

const router = Router();

router.use("/", storage);
router.use("/", auth);

export default router;
