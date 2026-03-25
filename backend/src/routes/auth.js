import { Router } from "express";
import { asyncHandler } from "../middleware/errorHandler.js";
import { authController } from "../controllers/authController.js";

const router = Router();

router.post("/auth/login", asyncHandler(authController.login));
router.post("/auth/logout", asyncHandler(authController.logout));
router.get("/auth/me", asyncHandler(authController.me));

export default router;
