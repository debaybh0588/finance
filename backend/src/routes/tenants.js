import { Router } from "express";
import { tenantsController } from "../controllers/tenantsController.js";
import { asyncHandler } from "../middleware/errorHandler.js";

const router = Router();

router.get("/tenants", asyncHandler(tenantsController.list));
router.get("/tenants/my", asyncHandler(tenantsController.listMy));
router.get("/tenants/:tenantId/branches", asyncHandler(tenantsController.branchesForTenant));
router.get("/tenants/:tenantId", asyncHandler(tenantsController.getById));

export default router;
