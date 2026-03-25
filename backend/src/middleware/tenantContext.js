import { env } from "../config/env.js";
import { invoiceRuntimeRepository } from "../repositories/invoiceRuntimeRepository.js";

const toScopeValue = (value) => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed || null;
};

export const tenantContext = (req, _res, next) => {
  const run = async () => {
    const role = req.auth?.role || null;
    const claimTenantId = toScopeValue(req.auth?.tenantId || null);
    const claimBranchId = toScopeValue(req.auth?.branchId || null);
    const headerTenantId = toScopeValue(req.header("x-tenant-id"));
    const headerBranchId = toScopeValue(req.header("x-branch-id"));

    // Tenant isolation:
    // - SUPER_ADMIN can switch tenant via header scope.
    // - All other authenticated users are pinned to token tenant.
    // - If unauthenticated/public, keep safe defaults for non-scoped endpoints.
    const tenantId =
      role === "SUPER_ADMIN"
        ? (headerTenantId || claimTenantId || env.defaults.tenantId || null)
        : (claimTenantId || env.defaults.tenantId || null);

    // Branch selection:
    // - SUPER_ADMIN can scope by header branch.
    // - Other authenticated users can switch branch within same tenant.
    let branchId =
      role === "SUPER_ADMIN"
        ? (headerBranchId || claimBranchId || env.defaults.branchId || null)
        : (headerBranchId || claimBranchId || env.defaults.branchId || null);

    if (req.auth && tenantId && branchId) {
      const isBranchInTenant = await invoiceRuntimeRepository
        .branchExistsForTenant(tenantId, branchId)
        .catch(() => false);
      if (!isBranchInTenant) {
        branchId = req.auth?.userId ? (claimBranchId || null) : null;
      }
    }

    req.context = {
      tenantId,
      branchId,
      requestId: req.header("x-request-id") || null,
      userId: req.auth?.userId || null,
      role
    };

    next();
  };

  run().catch((error) => next(error));
};
