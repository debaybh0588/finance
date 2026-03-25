import { authTokenService } from "../services/authTokenService.js";
import { superAdminTenantRepository } from "../repositories/superAdminTenantRepository.js";

const createError = (message, statusCode, code) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
};

const publicPaths = new Set(["/api/health", "/api/auth/login"]);

export const authGuard = (req, _res, next) => {
  const allowWorkflowKey = async () => {
    const workflowKeyHeader = String(req.header("x-workflow-key") || "").trim();
    if (!workflowKeyHeader) {
      return false;
    }

    const tenantId =
      req.header("x-tenant-id") ||
      req.body?.tenantId ||
      req.body?.tenant_id ||
      req.query?.tenantId ||
      req.query?.tenant_id ||
      null;

    if (!tenantId) {
      return false;
    }

    const config = await superAdminTenantRepository.findN8nConfigByTenantId(String(tenantId)).catch(() => null);
    const configuredKey = String(config?.workflowKeyToken || "").trim();
    if (!configuredKey || workflowKeyHeader !== configuredKey) {
      return false;
    }

    req.auth = {
      userId: null,
      role: "WORKFLOW",
      tenantId: String(tenantId),
      branchId:
        req.header("x-branch-id") ||
        req.body?.branchId ||
        req.body?.branch_id ||
        req.query?.branchId ||
        req.query?.branch_id ||
        null
    };

    return true;
  };

  const run = async () => {
    if (req.method === "OPTIONS") {
      req.auth = null;
      next();
      return;
    }

    if (publicPaths.has(req.path)) {
      req.auth = null;
      next();
      return;
    }

    const authHeader = req.header("authorization") || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
    const claims = authTokenService.verifyToken(token);

    if (claims) {
      req.auth = claims;
      next();
      return;
    }

    if (await allowWorkflowKey()) {
      next();
      return;
    }

    next(createError("Unauthorized", 401, "UNAUTHORIZED"));
  };

  run().catch((error) => {
    next(error);
  });
};
