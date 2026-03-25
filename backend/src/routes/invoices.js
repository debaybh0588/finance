import { Router } from "express";
import { invoicesController } from "../controllers/invoicesController.js";
import { asyncHandler } from "../middleware/errorHandler.js";
import { bulkInvoiceUpload } from "../middleware/uploadMiddleware.js";
import { createInMemoryRateLimiter } from "../middleware/rateLimit.js";

const router = Router();
const bulkUploadRateLimiter = createInMemoryRateLimiter({
  windowMs: Number(process.env.BULK_UPLOAD_RATE_WINDOW_MS || 60 * 1000),
  max: Number(process.env.BULK_UPLOAD_RATE_MAX || 10),
  keyFn: (req) => {
    const tenantId = req.context?.tenantId || req.auth?.tenantId || "tenantless";
    const userId = req.auth?.userId || req.ip || "anon";
    return `${tenantId}:${userId}`;
  }
});

router.get("/dashboard/summary", asyncHandler(invoicesController.dashboard));
router.get("/invoices", asyncHandler(invoicesController.list));
router.post("/invoices/bulk-upload", bulkUploadRateLimiter, bulkInvoiceUpload, asyncHandler(invoicesController.bulkUpload));
router.post("/invoices/register", asyncHandler(invoicesController.register));
router.get("/invoices/:id", asyncHandler(invoicesController.getById));
router.patch("/invoices/:id/review", asyncHandler(invoicesController.review));
router.get("/invoices/:id/runtime-context", asyncHandler(invoicesController.runtimeContext));

// TODO(n8n): extraction orchestration will call these canonical endpoints.
router.post("/invoices/:id/extraction-started", asyncHandler(invoicesController.extractionStarted));
router.post("/invoices/:id/extraction-result", asyncHandler(invoicesController.extractionResult));
router.post("/invoices/:id/extraction-failed", asyncHandler(invoicesController.extractionFailed));
router.post("/invoices/:id/extraction-retry", asyncHandler(invoicesController.extractionRetry));

router.post("/invoices/:id/approve", asyncHandler(invoicesController.approve));
router.post("/invoices/:id/reject", asyncHandler(invoicesController.reject));

// TODO(n8n): posting orchestration will call these canonical endpoints.
router.post("/invoices/:id/posting-started", asyncHandler(invoicesController.postingStarted));
router.post("/invoices/:id/posting-executor", asyncHandler(invoicesController.postingExecutor));
router.post("/invoices/:id/posting-draft", asyncHandler(invoicesController.postingDraft));
router.post("/invoices/:id/posting-result", asyncHandler(invoicesController.postingResult));
router.post("/invoices/:id/posting-failed", asyncHandler(invoicesController.postingFailed));
router.post("/invoices/:id/activity", asyncHandler(invoicesController.activity));

export default router;
