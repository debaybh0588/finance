import { Router } from "express";
import { superAdminTenantController } from "../controllers/superAdminTenantController.js";
import { asyncHandler } from "../middleware/errorHandler.js";

const router = Router();

const requireSuperAdmin = (req, _res, next) => {
	if (req.auth?.role !== "SUPER_ADMIN") {
		const error = new Error("Forbidden");
		error.statusCode = 403;
		error.code = "FORBIDDEN";
		return next(error);
	}

	return next();
};

router.use(requireSuperAdmin);

router.get("/super-admin/tenants", asyncHandler(superAdminTenantController.listTenants));
router.get("/super-admin/tenants/template", asyncHandler(superAdminTenantController.getOnboardingTemplate));
router.post("/super-admin/tenants/connectivity-test", asyncHandler(superAdminTenantController.testConnectivity));
router.post("/super-admin/tenants", asyncHandler(superAdminTenantController.createTenant));
router.put("/super-admin/tenants/:tenantId", asyncHandler(superAdminTenantController.updateTenant));
router.delete("/super-admin/tenants/:tenantId", asyncHandler(superAdminTenantController.deleteTenant));
router.post("/super-admin/tenants/:tenantId/branches", asyncHandler(superAdminTenantController.createBranch));
router.put("/super-admin/tenants/:tenantId/branches", asyncHandler(superAdminTenantController.replaceBranches));
router.post("/super-admin/tenants/:tenantId/admin-user", asyncHandler(superAdminTenantController.upsertTenantAdminUser));
router.post("/super-admin/tenants/:tenantId/storage-config", asyncHandler(superAdminTenantController.upsertStorageConfig));
router.post("/super-admin/tenants/:tenantId/n8n-config", asyncHandler(superAdminTenantController.upsertN8nConfig));
router.post("/super-admin/tenants/:tenantId/tally-config", asyncHandler(superAdminTenantController.upsertTallyConfig));
router.get("/super-admin/tenants/:tenantId/full-config", asyncHandler(superAdminTenantController.getFullConfig));

export default router;
