import { Router } from "express";
import storage from "./storage";
import health from "./health";
import auth from "./auth";
import configs from "./configs";

const router = Router();

router.use("/", storage);
router.use("/", health);
router.use("/", configs);
router.use("/", auth);

export default router;
