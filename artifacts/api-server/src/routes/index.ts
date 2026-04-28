import { Router } from "express";
import storage from "./storage";
import auth from "./auth";
import configs from "./configs";

const router = Router();

router.use("/", storage);
router.use("/", configs);
router.use("/", auth);

export default router;
