import { Router } from "express";
import { reviewController } from "../controllers/reviewController.js";
import { asyncHandler } from "../middleware/errorHandler.js";

const router = Router();

router.get("/review/queue", asyncHandler(reviewController.queue));
router.get("/review/:invoiceId/file", asyncHandler(reviewController.getFile));
router.get("/review/:invoiceId", asyncHandler(reviewController.getDetail));

export default router;
