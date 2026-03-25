import { Router } from "express";
import { configController } from "../controllers/configController.js";
import { asyncHandler } from "../middleware/errorHandler.js";

const router = Router();

router.get("/config", asyncHandler(configController.getTenantConfig));

export default router;
