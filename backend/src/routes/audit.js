import { Router } from "express";
import { auditController } from "../controllers/auditController.js";
import { asyncHandler } from "../middleware/errorHandler.js";

const router = Router();

router.get("/audit", asyncHandler(auditController.list));

export default router;
