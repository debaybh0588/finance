import { query } from "../db/pool.js";

export const invoiceRuntimeRepository = {
  async branchExistsForTenant(tenantId, branchId, client = null) {
    const executor = client || { query };
    const result = await executor.query(
      `SELECT 1
         FROM branches
        WHERE tenant_id = $1 AND id = $2
        LIMIT 1`,
      [tenantId, branchId]
    );

    return Boolean(result.rows[0]);
  },

  async insertUploadedInvoice(tenantId, payload, client = null) {
    const executor = client || { query };
    const result = await executor.query(
      `INSERT INTO invoices (
          tenant_id,
          branch_id,
          document_type,
          business_status,
          extraction_status,
          source_hash,
          dedupe_key,
          original_file_path,
          file_name,
          mime_type,
          created_by_user_id,
          updated_at
       )
       VALUES (
          $1, $2, $3::document_type_enum, 'UPLOADED', NULL, $4, $5, $6, $7, $8, $9, NOW()
       )
       RETURNING
         id,
         business_status AS "status",
         document_type AS "documentType",
         mime_type AS "mimeType",
         file_name AS "fileName"`,
      [
        tenantId,
        payload.branchId,
        payload.documentType,
        payload.sourceHash,
        payload.dedupeKey,
        payload.originalFilePath,
        payload.fileName,
        payload.mimeType,
        payload.createdByUserId
      ]
    );

    return result.rows[0] || null;
  },

  async registerInvoice(tenantId, payload, client = null) {
    const executor = client || { query };
    const result = await executor.query(
      `INSERT INTO invoices (
          tenant_id,
          branch_id,
          document_type,
          business_status,
          extraction_status,
          source_hash,
          dedupe_key,
          original_file_path,
          file_name,
          mime_type,
          invoice_number,
          invoice_date,
          due_date,
          party_name,
          party_gstin,
          party_address,
          currency,
          subtotal,
          taxable_amount,
          cgst_amount,
          sgst_amount,
          igst_amount,
          cess_amount,
          round_off_amount,
          total_amount,
          extracted_json,
          created_by_user_id,
          updated_at
       )
       VALUES (
          $1, $2, $3, 'UPLOADED', 'NOT_STARTED', $4, $5, $6, $7, $8,
          $9, $10, $11, $12, $13, $14, COALESCE($15, 'INR'),
          COALESCE($16, 0), COALESCE($17, 0), COALESCE($18, 0), COALESCE($19, 0),
          COALESCE($20, 0), COALESCE($21, 0), COALESCE($22, 0), COALESCE($23, 0),
          COALESCE($24::jsonb, '{}'::jsonb), $25, NOW()
       )
       RETURNING
         id,
         tenant_id AS "tenantId",
         branch_id AS "branchId",
         document_type AS "documentType",
         business_status AS "businessStatus",
         extraction_status AS "extractionStatus",
         source_hash AS "sourceHash",
         dedupe_key AS "dedupeKey",
         original_file_path AS "originalFilePath",
         file_name AS "fileName",
         mime_type AS "mimeType",
         created_at AS "createdAt",
         updated_at AS "updatedAt"`,
      [
        tenantId,
        payload.branchId,
        payload.documentType,
        payload.sourceHash,
        payload.dedupeKey,
        payload.originalFilePath,
        payload.fileName,
        payload.mimeType,
        payload.invoiceNumber,
        payload.invoiceDate,
        payload.dueDate,
        payload.partyName,
        payload.partyGstin,
        payload.partyAddress,
        payload.currency,
        payload.subtotal,
        payload.taxableAmount,
        payload.cgstAmount,
        payload.sgstAmount,
        payload.igstAmount,
        payload.cessAmount,
        payload.roundOffAmount,
        payload.totalAmount,
        payload.extractedJson,
        payload.createdByUserId
      ]
    );

    return result.rows[0] || null;
  },

  async insertInvoiceActivity(tenantId, invoiceId, payload, client = null) {
    const executor = client || { query };
    const result = await executor.query(
      `INSERT INTO audit_logs (
          tenant_id,
          branch_id,
          invoice_id,
          action_type,
          entity_type,
          entity_id,
          performed_by_user_id,
          old_value,
          new_value,
          notes,
          metadata,
          created_at
       )
       SELECT
          i.tenant_id,
          i.branch_id,
          i.id,
          $3,
          'INVOICE',
          i.id,
          $4,
          $5::jsonb,
          $6::jsonb,
          $7,
          $8::jsonb,
          NOW()
       FROM invoices i
       WHERE i.id = $1 AND i.tenant_id = $2
       RETURNING
         id,
         action_type AS "actionType",
         notes,
         metadata,
         created_at AS "createdAt"`,
      [
        invoiceId,
        tenantId,
        payload.actionType,
        payload.performedByUserId,
        payload.oldValue,
        payload.newValue,
        payload.notes,
        payload.metadata
      ]
    );

    return result.rows[0] || null;
  },

  async findInvoiceForRuntime(invoiceId, tenantId, client = null) {
    const executor = client || { query };
    const result = await executor.query(
      `SELECT
          id,
          tenant_id          AS "tenantId",
          branch_id          AS "branchId",
          document_type      AS "documentType",
          business_status    AS "businessStatus",
          extraction_status  AS "extractionStatus",
          retry_count        AS "retryCount",
          dedupe_key         AS "dedupeKey",
          source_hash        AS "sourceHash",
          invoice_number     AS "invoiceNumber",
          invoice_date       AS "invoiceDate",
          party_name         AS "partyName",
          party_gstin        AS "partyGstin",
          total_amount       AS "totalAmount",
          file_name          AS "fileName",
          mime_type          AS "mimeType",
          original_file_path AS "originalFilePath",
          created_at         AS "createdAt",
          updated_at         AS "updatedAt"
        FROM invoices
        WHERE id = $1 AND tenant_id = $2`,
      [invoiceId, tenantId]
    );

    return result.rows[0] || null;
  },

  /**
   * Returns other invoices on the same tenant that share the same
   * document_type + dedupe_key — indicating potential duplicates.
   * Returns [] when dedupeKey is null/empty (nothing to compare).
   */
  async findDuplicateCandidates(tenantId, documentType, dedupeKey, excludeId, client = null) {
    if (!dedupeKey) return [];

    const executor = client || { query };
    const result = await executor.query(
      `SELECT
          id,
          invoice_number  AS "invoiceNumber",
          invoice_date    AS "invoiceDate",
          party_name      AS "partyName",
          business_status AS "businessStatus",
          created_at      AS "createdAt"
        FROM invoices
        WHERE tenant_id     = $1
          AND document_type = $2
          AND dedupe_key    = $3
          AND id           != $4
        ORDER BY created_at DESC`,
      [tenantId, documentType, dedupeKey, excludeId]
    );

    return result.rows;
  }
};
