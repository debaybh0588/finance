import { getClient, query } from "../db/pool.js";

const runtimeCatalogSelect = `
  SELECT
    id,
    tenant_id AS "tenantId",
    source_company_name AS "sourceCompanyName",
    tally_base_url AS "tallyBaseUrl",
    catalog,
    fetched_at AS "fetchedAt",
    expires_at AS "expiresAt",
    last_error AS "lastError",
    created_at AS "createdAt",
    updated_at AS "updatedAt"
  FROM tenant_tally_runtime_catalog
`;

const fieldMappingSelect = `
  SELECT
    id,
    tenant_id AS "tenantId",
    document_type AS "documentType",
    source_field AS "sourceField",
    target_value AS "targetValue",
    confidence,
    is_user_override AS "isUserOverride",
    updated_by AS "updatedBy",
    created_at AS "createdAt",
    updated_at AS "updatedAt"
  FROM tenant_tally_field_mapping
`;

export const tallyRuntimeRepository = {
  getClient,

  async findRuntimeCatalogByTenantId(tenantId, client = null) {
    const executor = client || { query };
    const result = await executor.query(`${runtimeCatalogSelect} WHERE tenant_id = $1`, [tenantId]);
    return result.rows[0] || null;
  },

  async upsertRuntimeCatalog(client, payload) {
    const result = await client.query(
      `
        INSERT INTO tenant_tally_runtime_catalog (
          tenant_id,
          source_company_name,
          tally_base_url,
          catalog,
          fetched_at,
          expires_at,
          last_error
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        ON CONFLICT (tenant_id)
        DO UPDATE SET
          source_company_name = EXCLUDED.source_company_name,
          tally_base_url = EXCLUDED.tally_base_url,
          catalog = EXCLUDED.catalog,
          fetched_at = EXCLUDED.fetched_at,
          expires_at = EXCLUDED.expires_at,
          last_error = EXCLUDED.last_error
        RETURNING
          id,
          tenant_id AS "tenantId",
          source_company_name AS "sourceCompanyName",
          tally_base_url AS "tallyBaseUrl",
          catalog,
          fetched_at AS "fetchedAt",
          expires_at AS "expiresAt",
          last_error AS "lastError",
          created_at AS "createdAt",
          updated_at AS "updatedAt"
      `,
      [
        payload.tenantId,
        payload.sourceCompanyName || null,
        payload.tallyBaseUrl || null,
        payload.catalog || {},
        payload.fetchedAt,
        payload.expiresAt,
        payload.lastError || null
      ]
    );

    return result.rows[0] || null;
  },

  async listTenantsWithTallyConfig(client = null) {
    const executor = client || { query };
    const result = await executor.query(
      `
        SELECT
          tenant_id AS "tenantId",
          tally_base_url AS "tallyBaseUrl",
          company_name AS "companyName",
          tally_port AS "tallyPort",
          use_xml_posting AS "useXmlPosting"
        FROM tenant_tally_config
        WHERE tally_base_url IS NOT NULL
          AND btrim(tally_base_url) <> ''
          AND COALESCE(use_xml_posting, TRUE) = TRUE
      `
    );

    return result.rows;
  },

  async listFieldMappingsByTenantAndDocumentType(tenantId, documentType, client = null) {
    const executor = client || { query };
    const result = await executor.query(
      `${fieldMappingSelect} WHERE tenant_id = $1 AND document_type = $2 ORDER BY source_field`,
      [tenantId, documentType]
    );
    return result.rows;
  },

  async upsertFieldMappings(client, tenantId, documentType, mappings, updatedBy = null) {
    const rows = [];

    for (const mapping of mappings) {
      const result = await client.query(
        `
          INSERT INTO tenant_tally_field_mapping (
            tenant_id,
            document_type,
            source_field,
            target_value,
            confidence,
            is_user_override,
            updated_by
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7)
          ON CONFLICT (tenant_id, document_type, source_field)
          DO UPDATE SET
            target_value = EXCLUDED.target_value,
            confidence = EXCLUDED.confidence,
            is_user_override = EXCLUDED.is_user_override,
            updated_by = EXCLUDED.updated_by
          RETURNING
            id,
            tenant_id AS "tenantId",
            document_type AS "documentType",
            source_field AS "sourceField",
            target_value AS "targetValue",
            confidence,
            is_user_override AS "isUserOverride",
            updated_by AS "updatedBy",
            created_at AS "createdAt",
            updated_at AS "updatedAt"
        `,
        [
          tenantId,
          documentType,
          mapping.sourceField,
          mapping.targetValue || null,
          mapping.confidence === null || mapping.confidence === undefined ? null : Number(mapping.confidence),
          mapping.isUserOverride !== false,
          updatedBy || null
        ]
      );

      if (result.rows[0]) {
        rows.push(result.rows[0]);
      }
    }

    return rows;
  }
};
