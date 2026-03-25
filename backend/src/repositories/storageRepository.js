import { query } from "../db/pool.js";

export const storageRepository = {
  async findTenantStorageConfig(tenantId, client = null) {
    const executor = client || { query };
    const result = await executor.query(
      `SELECT
          storage_mode           AS "storageMode",
          incoming_folder        AS "incomingFolder",
          review_folder          AS "reviewFolder",
          processed_folder       AS "processedFolder",
          success_folder         AS "successFolder",
          exception_folder       AS "exceptionFolder",
          output_folder          AS "outputFolder",
          allow_branch_override  AS "allowBranchOverride"
        FROM tenant_storage_config
        WHERE tenant_id = $1`,
      [tenantId]
    );

    return result.rows[0] || null;
  },

  async findBranchStorageOverride(tenantId, branchId, client = null) {
    const executor = client || { query };
    const result = await executor.query(
      `SELECT
          incoming_folder   AS "incomingFolder",
          review_folder     AS "reviewFolder",
          processed_folder  AS "processedFolder",
          success_folder    AS "successFolder",
          exception_folder  AS "exceptionFolder",
          output_folder     AS "outputFolder"
        FROM branch_storage_override
        WHERE tenant_id = $1 AND branch_id = $2`,
      [tenantId, branchId]
    );

    return result.rows[0] || null;
  }
};
