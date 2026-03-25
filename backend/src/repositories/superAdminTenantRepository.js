import { getClient, query } from "../db/pool.js";

const tenantSelect = `
  SELECT
    id,
    tenant_code AS "tenantCode",
    tenant_name AS "tenantName",
    contact_person AS "contactPerson",
    contact_email AS "contactEmail",
    contact_phone AS "contactPhone",
    is_active AS "isActive",
    timezone,
    created_at AS "createdAt",
    updated_at AS "updatedAt"
  FROM tenants
`;

const branchSelect = `
  SELECT
    id,
    tenant_id AS "tenantId",
    branch_code AS "branchCode",
    branch_name AS "branchName",
    branch_gstin AS "branchGstin",
    branch_address AS "branchAddress",
    is_default AS "isDefault",
    is_active AS "isActive",
    created_at AS "createdAt",
    updated_at AS "updatedAt"
  FROM branches
`;

const storageConfigSelect = `
  SELECT
    id,
    tenant_id AS "tenantId",
    storage_mode AS "storageMode",
    incoming_folder AS "incomingFolder",
    review_folder AS "reviewFolder",
    processed_folder AS "processedFolder",
    success_folder AS "successFolder",
    exception_folder AS "exceptionFolder",
    output_folder AS "outputFolder",
    allow_branch_override AS "allowBranchOverride",
    created_at AS "createdAt",
    updated_at AS "updatedAt"
  FROM tenant_storage_config
`;

const storageOverrideSelect = `
  SELECT
    o.id,
    o.tenant_id AS "tenantId",
    o.branch_id AS "branchId",
    b.branch_code AS "branchCode",
    b.branch_name AS "branchName",
    o.incoming_folder AS "incomingFolder",
    o.review_folder AS "reviewFolder",
    o.processed_folder AS "processedFolder",
    o.success_folder AS "successFolder",
    o.exception_folder AS "exceptionFolder",
    o.output_folder AS "outputFolder",
    o.created_at AS "createdAt",
    o.updated_at AS "updatedAt"
  FROM branch_storage_override o
  INNER JOIN branches b ON b.id = o.branch_id
`;

const n8nConfigSelect = `
  SELECT
    id,
    tenant_id AS "tenantId",
    n8n_base_url AS "n8nBaseUrl",
    backend_api_base_url AS "backendApiBaseUrl",
    workflow_key_token AS "workflowKeyToken",
    extraction_workflow_id AS "extractionWorkflowId",
    extraction_workflow_name AS "extractionWorkflowName",
    posting_workflow_id AS "postingWorkflowId",
    posting_workflow_name AS "postingWorkflowName",
    extraction_webhook_placeholder AS "extractionWebhookPlaceholder",
    posting_webhook_placeholder AS "postingWebhookPlaceholder",
    n8n_root_folder AS "n8nRootFolder",
    is_active AS "isActive",
    created_at AS "createdAt",
    updated_at AS "updatedAt"
  FROM tenant_n8n_config
`;

const tallyConfigSelect = `
  SELECT
    id,
    tenant_id AS "tenantId",
    tally_mode AS "tallyMode",
    tally_base_url AS "tallyBaseUrl",
    company_name AS "companyName",
    tally_port AS "tallyPort",
    use_xml_posting AS "useXmlPosting",
    posting_review_mode AS "postingReviewMode",
    enable_response_logging AS "enableResponseLogging",
    default_purchase_voucher_type AS "defaultPurchaseVoucherType",
    default_sales_voucher_type AS "defaultSalesVoucherType",
    created_at AS "createdAt",
    updated_at AS "updatedAt"
  FROM tenant_tally_config
`;

const tenantAdminUserSelect = `
  SELECT
    id,
    tenant_id AS "tenantId",
    default_branch_id AS "defaultBranchId",
    role,
    full_name AS "fullName",
    email,
    phone,
    is_active AS "isActive",
    created_at AS "createdAt",
    updated_at AS "updatedAt"
  FROM users
  WHERE tenant_id = $1 AND role = 'TENANT_ADMIN'
  ORDER BY created_at ASC
  LIMIT 1
`;

export const superAdminTenantRepository = {
  getClient,

  async listTenants(client = null) {
    const executor = client || { query };
    const result = await executor.query(
      `
        SELECT
          t.id,
          t.tenant_code AS "tenantCode",
          t.tenant_name AS "tenantName",
          t.contact_person AS "contactPerson",
          t.contact_email AS "contactEmail",
          t.contact_phone AS "contactPhone",
          t.timezone,
          t.is_active AS "isActive",
          t.created_at AS "createdAt",
          t.updated_at AS "updatedAt",
          COUNT(b.id)::int AS "branchCount"
        FROM tenants t
        LEFT JOIN branches b ON b.tenant_id = t.id
        GROUP BY t.id
        ORDER BY t.created_at DESC
      `
    );
    return result.rows;
  },

  async findTenantById(tenantId, client = null) {
    const executor = client || { query };
    const result = await executor.query(
      `${tenantSelect} WHERE id = $1`,
      [tenantId]
    );
    return result.rows[0] || null;
  },

  async deleteTenant(client, tenantId) {
    const result = await client.query(
      `
        DELETE FROM tenants
        WHERE id = $1
        RETURNING
          id,
          tenant_code AS "tenantCode",
          tenant_name AS "tenantName"
      `,
      [tenantId]
    );

    return result.rows[0] || null;
  },

  async createTenant(client, payload) {
    const result = await client.query(
      `
        INSERT INTO tenants (
          tenant_code,
          tenant_name,
          contact_person,
          contact_email,
          contact_phone,
          timezone,
          is_active
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        RETURNING
          id,
          tenant_code AS "tenantCode",
          tenant_name AS "tenantName",
          contact_person AS "contactPerson",
          contact_email AS "contactEmail",
          contact_phone AS "contactPhone",
          timezone,
          is_active AS "isActive",
          created_at AS "createdAt",
          updated_at AS "updatedAt"
      `,
      [
        payload.tenantCode,
        payload.tenantName,
        payload.contactPerson,
        payload.contactEmail,
        payload.contactPhone,
        payload.timezone,
        payload.isActive
      ]
    );

    return result.rows[0];
  },

  async findTenantAdminUserByTenantId(tenantId, client = null) {
    const executor = client || { query };
    const result = await executor.query(tenantAdminUserSelect, [tenantId]);
    return result.rows[0] || null;
  },

  async findUserByEmail(email, client = null) {
    const executor = client || { query };
    const result = await executor.query(
      `
        SELECT
          id,
          tenant_id AS "tenantId",
          role,
          email
        FROM users
        WHERE lower(email) = lower($1)
        LIMIT 1
      `,
      [email]
    );

    return result.rows[0] || null;
  },

  async createTenantAdminUser(client, payload) {
    const result = await client.query(
      `
        INSERT INTO users (
          tenant_id,
          default_branch_id,
          role,
          full_name,
          email,
          phone,
          password_hash,
          is_active
        )
        VALUES ($1, $2, 'TENANT_ADMIN', $3, $4, $5, crypt($6, gen_salt('bf')), $7)
        RETURNING
          id,
          tenant_id AS "tenantId",
          default_branch_id AS "defaultBranchId",
          role,
          full_name AS "fullName",
          email,
          phone,
          is_active AS "isActive",
          created_at AS "createdAt",
          updated_at AS "updatedAt"
      `,
      [
        payload.tenantId,
        payload.defaultBranchId,
        payload.fullName,
        payload.email,
        payload.phone,
        payload.password,
        payload.isActive
      ]
    );

    return result.rows[0] || null;
  },

  async updateTenantAdminUser(client, userId, payload) {
    const baseValues = [
      userId,
      payload.defaultBranchId,
      payload.fullName,
      payload.email,
      payload.phone,
      payload.isActive
    ];

    const hasPasswordUpdate = Boolean(payload.password);
    const sql = hasPasswordUpdate
      ? `
          UPDATE users
          SET
            default_branch_id = $2,
            full_name = $3,
            email = $4,
            phone = $5,
            is_active = $6,
            password_hash = crypt($7, gen_salt('bf')),
            updated_at = NOW()
          WHERE id = $1
          RETURNING
            id,
            tenant_id AS "tenantId",
            default_branch_id AS "defaultBranchId",
            role,
            full_name AS "fullName",
            email,
            phone,
            is_active AS "isActive",
            created_at AS "createdAt",
            updated_at AS "updatedAt"
        `
      : `
          UPDATE users
          SET
            default_branch_id = $2,
            full_name = $3,
            email = $4,
            phone = $5,
            is_active = $6,
            updated_at = NOW()
          WHERE id = $1
          RETURNING
            id,
            tenant_id AS "tenantId",
            default_branch_id AS "defaultBranchId",
            role,
            full_name AS "fullName",
            email,
            phone,
            is_active AS "isActive",
            created_at AS "createdAt",
            updated_at AS "updatedAt"
        `;

    const values = hasPasswordUpdate ? [...baseValues, payload.password] : baseValues;
    const result = await client.query(sql, values);
    return result.rows[0] || null;
  },

  async updateTenant(client, tenantId, payload) {
    const result = await client.query(
      `
        UPDATE tenants
        SET
          tenant_code = $2,
          tenant_name = $3,
          contact_person = $4,
          contact_email = $5,
          contact_phone = $6,
          timezone = $7,
          is_active = $8,
          updated_at = NOW()
        WHERE id = $1
        RETURNING
          id,
          tenant_code AS "tenantCode",
          tenant_name AS "tenantName",
          contact_person AS "contactPerson",
          contact_email AS "contactEmail",
          contact_phone AS "contactPhone",
          timezone,
          is_active AS "isActive",
          created_at AS "createdAt",
          updated_at AS "updatedAt"
      `,
      [
        tenantId,
        payload.tenantCode,
        payload.tenantName,
        payload.contactPerson,
        payload.contactEmail,
        payload.contactPhone,
        payload.timezone,
        payload.isActive
      ]
    );

    return result.rows[0] || null;
  },

  async clearDefaultBranches(client, tenantId) {
    await client.query(
      `UPDATE branches SET is_default = FALSE WHERE tenant_id = $1 AND is_default = TRUE`,
      [tenantId]
    );
  },

  async createBranch(client, tenantId, payload) {
    const result = await client.query(
      `
        INSERT INTO branches (
          tenant_id,
          branch_code,
          branch_name,
          branch_gstin,
          branch_address,
          is_default,
          is_active
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        RETURNING
          id,
          tenant_id AS "tenantId",
          branch_code AS "branchCode",
          branch_name AS "branchName",
          branch_gstin AS "branchGstin",
          branch_address AS "branchAddress",
          is_default AS "isDefault",
          is_active AS "isActive",
          created_at AS "createdAt",
          updated_at AS "updatedAt"
      `,
      [
        tenantId,
        payload.branchCode,
        payload.branchName,
        payload.branchGstin,
        payload.branchAddress,
        payload.isDefault,
        payload.isActive
      ]
    );

    return result.rows[0];
  },

  async replaceBranches(client, tenantId, branches) {
    // Clear all defaults first to avoid the unique partial index constraint
    await client.query(
      `UPDATE branches SET is_default = FALSE WHERE tenant_id = $1`,
      [tenantId]
    );

    // Delete branches that are no longer in the list
    const keptIds = branches.filter((b) => b.id !== null).map((b) => b.id);
    if (keptIds.length > 0) {
      await client.query(
        `DELETE FROM branches WHERE tenant_id = $1 AND id <> ALL($2::uuid[])`,
        [tenantId, keptIds]
      );
    } else {
      await client.query(`DELETE FROM branches WHERE tenant_id = $1`, [tenantId]);
    }

    // Update existing branches (is_default stays FALSE for now)
    for (const b of branches.filter((b) => b.id !== null)) {
      await client.query(
        `UPDATE branches
         SET branch_code = $1, branch_name = $2, branch_gstin = $3, branch_address = $4,
             is_active = $5, is_default = FALSE, updated_at = NOW()
         WHERE id = $6 AND tenant_id = $7`,
        [b.branchCode, b.branchName, b.branchGstin, b.branchAddress, b.isActive, b.id, tenantId]
      );
    }

    // Insert new branches (is_default stays FALSE for now)
    for (const b of branches.filter((b) => b.id === null)) {
      await client.query(
        `INSERT INTO branches (tenant_id, branch_code, branch_name, branch_gstin, branch_address, is_default, is_active)
         VALUES ($1, $2, $3, $4, $5, FALSE, $6)`,
        [tenantId, b.branchCode, b.branchName, b.branchGstin, b.branchAddress, b.isActive]
      );
    }

    // Set exactly one default branch
    const defaultBranch = branches.find((b) => b.isDefault);
    if (defaultBranch) {
      if (defaultBranch.id) {
        await client.query(
          `UPDATE branches SET is_default = TRUE WHERE id = $1 AND tenant_id = $2`,
          [defaultBranch.id, tenantId]
        );
      } else {
        await client.query(
          `UPDATE branches SET is_default = TRUE
           WHERE tenant_id = $1 AND branch_code = $2`,
          [tenantId, defaultBranch.branchCode]
        );
      }
    }

    const result = await client.query(
      `${branchSelect} WHERE tenant_id = $1 ORDER BY is_default DESC, branch_name ASC`,
      [tenantId]
    );
    return result.rows;
  },

  async listBranchesByTenant(tenantId, client = null) {
    const executor = client || { query };
    const result = await executor.query(
      `${branchSelect} WHERE tenant_id = $1 ORDER BY is_default DESC, branch_name ASC`,
      [tenantId]
    );
    return result.rows;
  },

  async listBranchesByIds(client, tenantId, branchIds) {
    const result = await client.query(
      `${branchSelect} WHERE tenant_id = $1 AND id = ANY($2::uuid[])`,
      [tenantId, branchIds]
    );
    return result.rows;
  },

  async upsertStorageConfig(client, tenantId, payload) {
    const result = await client.query(
      `
        INSERT INTO tenant_storage_config (
          tenant_id,
          storage_mode,
          incoming_folder,
          review_folder,
          processed_folder,
          success_folder,
          exception_folder,
          output_folder,
          allow_branch_override
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        ON CONFLICT (tenant_id)
        DO UPDATE SET
          storage_mode = EXCLUDED.storage_mode,
          incoming_folder = EXCLUDED.incoming_folder,
          review_folder = EXCLUDED.review_folder,
          processed_folder = EXCLUDED.processed_folder,
          success_folder = EXCLUDED.success_folder,
          exception_folder = EXCLUDED.exception_folder,
          output_folder = EXCLUDED.output_folder,
          allow_branch_override = EXCLUDED.allow_branch_override,
          updated_at = NOW()
        RETURNING
          id,
          tenant_id AS "tenantId",
          storage_mode AS "storageMode",
          incoming_folder AS "incomingFolder",
          review_folder AS "reviewFolder",
          processed_folder AS "processedFolder",
          success_folder AS "successFolder",
          exception_folder AS "exceptionFolder",
          output_folder AS "outputFolder",
          allow_branch_override AS "allowBranchOverride",
          created_at AS "createdAt",
          updated_at AS "updatedAt"
      `,
      [
        tenantId,
        payload.storageMode,
        payload.incomingFolder,
        payload.reviewFolder,
        payload.processedFolder,
        payload.successFolder,
        payload.exceptionFolder,
        payload.outputFolder,
        payload.allowBranchOverride
      ]
    );

    return result.rows[0];
  },

  async replaceBranchStorageOverrides(client, tenantId, overrides) {
    await client.query(`DELETE FROM branch_storage_override WHERE tenant_id = $1`, [tenantId]);

    const created = [];

    for (const item of overrides) {
      const result = await client.query(
        `
          INSERT INTO branch_storage_override (
            tenant_id,
            branch_id,
            incoming_folder,
            review_folder,
            processed_folder,
            success_folder,
            exception_folder,
            output_folder
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
          RETURNING
            id,
            tenant_id AS "tenantId",
            branch_id AS "branchId",
            incoming_folder AS "incomingFolder",
            review_folder AS "reviewFolder",
            processed_folder AS "processedFolder",
            success_folder AS "successFolder",
            exception_folder AS "exceptionFolder",
            output_folder AS "outputFolder",
            created_at AS "createdAt",
            updated_at AS "updatedAt"
        `,
        [
          tenantId,
          item.branchId,
          item.incomingFolder,
          item.reviewFolder,
          item.processedFolder,
          item.successFolder,
          item.exceptionFolder,
          item.outputFolder
        ]
      );

      created.push(result.rows[0]);
    }

    return created;
  },

  async listBranchStorageOverrides(tenantId, client = null) {
    const executor = client || { query };
    const result = await executor.query(
      `${storageOverrideSelect} WHERE o.tenant_id = $1 ORDER BY b.branch_name ASC`,
      [tenantId]
    );
    return result.rows;
  },

  async upsertN8nConfig(client, tenantId, payload) {
    const result = await client.query(
      `
        INSERT INTO tenant_n8n_config (
          tenant_id,
          n8n_base_url,
          backend_api_base_url,
          workflow_key_token,
          extraction_workflow_id,
          extraction_workflow_name,
          posting_workflow_id,
          posting_workflow_name,
          extraction_webhook_placeholder,
          posting_webhook_placeholder,
          n8n_root_folder,
          is_active
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
        ON CONFLICT (tenant_id)
        DO UPDATE SET
          n8n_base_url = EXCLUDED.n8n_base_url,
          backend_api_base_url = EXCLUDED.backend_api_base_url,
          workflow_key_token = EXCLUDED.workflow_key_token,
          extraction_workflow_id = EXCLUDED.extraction_workflow_id,
          extraction_workflow_name = EXCLUDED.extraction_workflow_name,
          posting_workflow_id = EXCLUDED.posting_workflow_id,
          posting_workflow_name = EXCLUDED.posting_workflow_name,
          extraction_webhook_placeholder = EXCLUDED.extraction_webhook_placeholder,
          posting_webhook_placeholder = EXCLUDED.posting_webhook_placeholder,
          n8n_root_folder = EXCLUDED.n8n_root_folder,
          is_active = EXCLUDED.is_active,
          updated_at = NOW()
        RETURNING
          id,
          tenant_id AS "tenantId",
          n8n_base_url AS "n8nBaseUrl",
          backend_api_base_url AS "backendApiBaseUrl",
          workflow_key_token AS "workflowKeyToken",
          extraction_workflow_id AS "extractionWorkflowId",
          extraction_workflow_name AS "extractionWorkflowName",
          posting_workflow_id AS "postingWorkflowId",
          posting_workflow_name AS "postingWorkflowName",
          extraction_webhook_placeholder AS "extractionWebhookPlaceholder",
          posting_webhook_placeholder AS "postingWebhookPlaceholder",
          n8n_root_folder AS "n8nRootFolder",
          is_active AS "isActive",
          created_at AS "createdAt",
          updated_at AS "updatedAt"
      `,
      [
        tenantId,
        payload.n8nBaseUrl,
        payload.backendApiBaseUrl,
        payload.workflowKeyToken,
        payload.extractionWorkflowId,
        payload.extractionWorkflowName,
        payload.postingWorkflowId,
        payload.postingWorkflowName,
        payload.extractionWebhookPlaceholder,
        payload.postingWebhookPlaceholder,
        payload.n8nRootFolder,
        payload.isActive
      ]
    );

    return result.rows[0];
  },

  async upsertTallyConfig(client, tenantId, payload) {
    const result = await client.query(
      `
        INSERT INTO tenant_tally_config (
          tenant_id,
          tally_mode,
          tally_base_url,
          company_name,
          tally_port,
          use_xml_posting,
          posting_review_mode,
          enable_response_logging,
          default_purchase_voucher_type,
          default_sales_voucher_type
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        ON CONFLICT (tenant_id)
        DO UPDATE SET
          tally_mode = EXCLUDED.tally_mode,
          tally_base_url = EXCLUDED.tally_base_url,
          company_name = EXCLUDED.company_name,
          tally_port = EXCLUDED.tally_port,
          use_xml_posting = EXCLUDED.use_xml_posting,
          posting_review_mode = EXCLUDED.posting_review_mode,
          enable_response_logging = EXCLUDED.enable_response_logging,
          default_purchase_voucher_type = EXCLUDED.default_purchase_voucher_type,
          default_sales_voucher_type = EXCLUDED.default_sales_voucher_type,
          updated_at = NOW()
        RETURNING
          id,
          tenant_id AS "tenantId",
          tally_mode AS "tallyMode",
          tally_base_url AS "tallyBaseUrl",
          company_name AS "companyName",
          tally_port AS "tallyPort",
          use_xml_posting AS "useXmlPosting",
          posting_review_mode AS "postingReviewMode",
          enable_response_logging AS "enableResponseLogging",
          default_purchase_voucher_type AS "defaultPurchaseVoucherType",
          default_sales_voucher_type AS "defaultSalesVoucherType",
          created_at AS "createdAt",
          updated_at AS "updatedAt"
      `,
      [
        tenantId,
        payload.tallyMode,
        payload.tallyBaseUrl,
        payload.companyName,
        payload.tallyPort,
        payload.useXmlPosting,
        payload.postingReviewMode,
        payload.enableResponseLogging,
        payload.defaultPurchaseVoucherType,
        payload.defaultSalesVoucherType
      ]
    );

    return result.rows[0];
  },

  async findStorageConfigByTenantId(tenantId, client = null) {
    const executor = client || { query };
    const result = await executor.query(
      `${storageConfigSelect} WHERE tenant_id = $1`,
      [tenantId]
    );
    return result.rows[0] || null;
  },

  async findN8nConfigByTenantId(tenantId, client = null) {
    const executor = client || { query };
    const result = await executor.query(
      `${n8nConfigSelect} WHERE tenant_id = $1`,
      [tenantId]
    );
    return result.rows[0] || null;
  },

  async findTallyConfigByTenantId(tenantId, client = null) {
    const executor = client || { query };
    const result = await executor.query(
      `${tallyConfigSelect} WHERE tenant_id = $1`,
      [tenantId]
    );
    return result.rows[0] || null;
  }
};
