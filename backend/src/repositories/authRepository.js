import { query } from "../db/pool.js";

export const authRepository = {
  async findUserByEmailAndPassword(email, password) {
    const result = await query(
      `SELECT
          u.id,
          u.tenant_id AS "tenantId",
          u.default_branch_id AS "defaultBranchId",
          u.role,
          u.full_name AS "fullName",
          u.email,
          u.is_active AS "isActive"
       FROM users u
       WHERE lower(u.email) = lower($1)
         AND u.password_hash IS NOT NULL
         AND u.password_hash = crypt($2, u.password_hash)
       LIMIT 1`,
      [email, password]
    );

    return result.rows[0] || null;
  },

  async findUserByEmail(email) {
    const result = await query(
      `SELECT
          u.id,
          u.tenant_id AS "tenantId",
          u.default_branch_id AS "defaultBranchId",
          u.role,
          u.full_name AS "fullName",
          u.email,
          u.is_active AS "isActive"
       FROM users u
       WHERE lower(u.email) = lower($1)
       LIMIT 1`,
      [email]
    );

    return result.rows[0] || null;
  },

  async listAccessibleTenants(user) {
    if (user.role === "SUPER_ADMIN") {
      const result = await query(
        `SELECT
            t.id,
            t.tenant_code AS "tenantCode",
            t.tenant_name AS "tenantName"
         FROM tenants t
         WHERE t.is_active = TRUE
         ORDER BY t.tenant_name`
      );
      return result.rows;
    }

    if (!user.tenantId) {
      return [];
    }

    const result = await query(
      `SELECT
          t.id,
          t.tenant_code AS "tenantCode",
          t.tenant_name AS "tenantName"
       FROM tenants t
       WHERE t.id = $1 AND t.is_active = TRUE
       LIMIT 1`,
      [user.tenantId]
    );

    return result.rows;
  },

  async listAccessibleBranches(user, tenantId) {
    const result = await query(
      `SELECT
          b.id,
          b.branch_code AS "branchCode",
          b.branch_name AS "branchName",
          b.is_default AS "isDefault"
       FROM branches b
       WHERE b.tenant_id = $1
         AND b.is_active = TRUE
       ORDER BY b.is_default DESC, b.branch_name`,
      [tenantId]
    );

    return result.rows;
  }
};
