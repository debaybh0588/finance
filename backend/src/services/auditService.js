import { invoiceReadRepository } from "../repositories/invoiceReadRepository.js";

const normalizeScopeValue = (value) => {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed || null;
};

const normalizeDateRange = (value) => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed || null;
};

const resolveAuditScope = (context, query = {}) => {
  const requestedTenantId = normalizeScopeValue(query.tenantId);
  const requestedBranchId = normalizeScopeValue(query.branchId);

  if (requestedTenantId && context.role !== "SUPER_ADMIN" && requestedTenantId !== context.tenantId) {
    const error = new Error("Forbidden");
    error.statusCode = 403;
    error.code = "FORBIDDEN";
    throw error;
  }

  return {
    tenantId: requestedTenantId || context.tenantId,
    branchId: requestedBranchId !== null ? requestedBranchId : context.branchId,
    dateRange: normalizeDateRange(query.dateRange)
  };
};

export const auditService = {
  async list(context, query) {
    const scope = resolveAuditScope(context, query);
    const audit = await invoiceReadRepository.listAuditRows(scope.tenantId, scope.branchId, scope.dateRange);

    return {
      ...audit,
      meta: {
        tenantId: scope.tenantId,
        branchId: scope.branchId,
        dateRange: scope.dateRange || null,
        query
      }
    };
  }
};
