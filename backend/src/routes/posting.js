import { Router } from "express";
import { postingController } from "../controllers/postingController.js";
import { asyncHandler } from "../middleware/errorHandler.js";

const router = Router();

router.get("/posting", asyncHandler(postingController.list));
router.get("/posting/summary", asyncHandler(postingController.summary));
router.get("/posting/review", asyncHandler(postingController.reviewQueue));
router.get("/posting/review/:invoiceId", asyncHandler(postingController.reviewDetail));
router.post("/posting/review/:invoiceId/approve", asyncHandler(postingController.reviewApprove));
router.post("/posting/review/:invoiceId/reject", asyncHandler(postingController.reviewReject));
router.post("/posting/:invoiceId/retry", asyncHandler(postingController.retry));

export default router;
