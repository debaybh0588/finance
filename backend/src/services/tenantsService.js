import { query } from "../db/pool.js";

const createError = (message, statusCode, code) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
};

export const tenantsService = {
  async list(context) {
    const tenantResult = await query(
      context.role === "SUPER_ADMIN"
        ? `SELECT id, tenant_code AS "tenantCode", tenant_name AS "tenantName", is_active AS "isActive"
           FROM tenants
           ORDER BY tenant_name`
        : `SELECT id, tenant_code AS "tenantCode", tenant_name AS "tenantName", is_active AS "isActive"
           FROM tenants
           WHERE id = $1
           ORDER BY tenant_name`,
      context.role === "SUPER_ADMIN" ? [] : [context.tenantId]
    );

    const branchResult = await query(
      context.role === "SUPER_ADMIN"
        ? `SELECT id, tenant_id AS "tenantId", branch_code AS "branchCode", branch_name AS "branchName", is_default AS "isDefault", is_active AS "isActive"
           FROM branches
           ORDER BY tenant_id, is_default DESC, branch_name`
        : `SELECT id, tenant_id AS "tenantId", branch_code AS "branchCode", branch_name AS "branchName", is_default AS "isDefault", is_active AS "isActive"
           FROM branches
           WHERE tenant_id = $1
           ORDER BY is_default DESC, branch_name`,
      context.role === "SUPER_ADMIN" ? [] : [context.tenantId]
    );

    const branchesByTenant = branchResult.rows.reduce((acc, branch) => {
      if (!acc[branch.tenantId]) acc[branch.tenantId] = [];
      acc[branch.tenantId].push(branch);
      return acc;
    }, {});

    return {
      items: tenantResult.rows.map((tenant) => ({
        ...tenant,
        branches: branchesByTenant[tenant.id] || []
      })),
      meta: {
        tenantId: context.tenantId,
        branchId: context.branchId,
        role: context.role
      }
    };
  },

  async getById(tenantId, context) {
    if (context.role !== "SUPER_ADMIN" && tenantId !== context.tenantId) {
      throw createError("Forbidden", 403, "FORBIDDEN");
    }

    const tenantResult = await query(
      `SELECT id, tenant_code AS "tenantCode", tenant_name AS "tenantName", contact_person AS "contactPerson",
              contact_email AS "contactEmail", contact_phone AS "contactPhone", is_active AS "isActive"
       FROM tenants WHERE id = $1 LIMIT 1`,
      [tenantId]
    );

    const tenant = tenantResult.rows[0] || null;
    if (!tenant) {
      throw createError("Tenant not found", 404, "TENANT_NOT_FOUND");
    }

    const branchesResult = await query(
      `SELECT id, branch_code AS "branchCode", branch_name AS "branchName", branch_gstin AS "branchGstin",
              branch_address AS "branchAddress", is_default AS "isDefault", is_active AS "isActive"
       FROM branches WHERE tenant_id = $1 ORDER BY is_default DESC, branch_name`,
      [tenantId]
    );

    return {
      ...tenant,
      branches: branchesResult.rows,
      requestedFromTenant: context.tenantId
    };
  },

  // Returns tenants accessible to the current user based on JWT claims (not x-tenant-id header).
  // This is the correct scope for populating the tenant selector.
  async listMy(auth) {
    const role = auth?.role || null;
    const tenantId = auth?.tenantId || null;

    const tenantResult = await query(
      role === "SUPER_ADMIN"
        ? `SELECT id, tenant_code AS "tenantCode", tenant_name AS "tenantName", is_active AS "isActive"
           FROM tenants
           ORDER BY tenant_name`
        : `SELECT id, tenant_code AS "tenantCode", tenant_name AS "tenantName", is_active AS "isActive"
           FROM tenants
           WHERE id = $1
           ORDER BY tenant_name`,
      role === "SUPER_ADMIN" ? [] : [tenantId]
    );

    const branchResult = await query(
      role === "SUPER_ADMIN"
        ? `SELECT id, tenant_id AS "tenantId", branch_code AS "branchCode", branch_name AS "branchName", is_default AS "isDefault", is_active AS "isActive"
           FROM branches
           ORDER BY tenant_id, is_default DESC, branch_name`
        : `SELECT id, tenant_id AS "tenantId", branch_code AS "branchCode", branch_name AS "branchName", is_default AS "isDefault", is_active AS "isActive"
           FROM branches
           WHERE tenant_id = $1
           ORDER BY is_default DESC, branch_name`,
      role === "SUPER_ADMIN" ? [] : [tenantId]
    );

    const branchesByTenant = branchResult.rows.reduce((acc, branch) => {
      if (!acc[branch.tenantId]) acc[branch.tenantId] = [];
      acc[branch.tenantId].push(branch);
      return acc;
    }, {});

    return {
      items: tenantResult.rows.map((tenant) => ({
        ...tenant,
        branches: branchesByTenant[tenant.id] || []
      }))
    };
  },

  async branchesForTenant(tenantId, context) {
    if (context.role !== "SUPER_ADMIN" && tenantId !== context.tenantId) {
      throw createError("Forbidden", 403, "FORBIDDEN");
    }

    const result = await query(
      `SELECT id, branch_code AS "branchCode", branch_name AS "branchName",
              is_default AS "isDefault", is_active AS "isActive"
       FROM branches
       WHERE tenant_id = $1 AND is_active = TRUE
       ORDER BY is_default DESC, branch_name`,
      [tenantId]
    );

    return { items: result.rows };
  }
};
