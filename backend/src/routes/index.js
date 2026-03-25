import { Router } from "express";
import healthRoutes from "./healthRoutes.js";
import authRoutes from "./auth.js";
import tenantsRoutes from "./tenants.js";
import invoicesRoutes from "./invoices.js";
import reviewRoutes from "./review.js";
import postingRoutes from "./posting.js";
import auditRoutes from "./audit.js";
import configRoutes from "./config.js";
import superAdminTenantsRoutes from "./superAdminTenants.js";

const router = Router();

router.use(healthRoutes);
router.use(authRoutes);
router.use(tenantsRoutes);
router.use(invoicesRoutes);
router.use(reviewRoutes);
router.use(postingRoutes);
router.use(auditRoutes);
router.use(configRoutes);
router.use(superAdminTenantsRoutes);

export default router;
