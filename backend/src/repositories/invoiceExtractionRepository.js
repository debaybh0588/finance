import { getClient, query } from "../db/pool.js";

const toJsonbParam = (value, fallback) => {
  const resolved = value === undefined || value === null ? fallback : value;
  return JSON.stringify(resolved);
};

const invoiceSelect = `
  SELECT
    id,
    tenant_id AS "tenantId",
    branch_id AS "branchId",
    document_type AS "documentType",
    business_status AS "businessStatus",
    extraction_status AS "extractionStatus",
    retry_count AS "retryCount",
    invoice_number AS "invoiceNumber",
    invoice_date AS "invoiceDate",
    due_date AS "dueDate",
    party_name AS "partyName",
    party_gstin AS "partyGstin",
    party_address AS "partyAddress",
    currency,
    subtotal,
    taxable_amount AS "taxableAmount",
    cgst_amount AS "cgstAmount",
    sgst_amount AS "sgstAmount",
    igst_amount AS "igstAmount",
    cess_amount AS "cessAmount",
    round_off_amount AS "roundOffAmount",
    total_amount AS "totalAmount",
    dedupe_key AS "dedupeKey",
    source_hash AS "sourceHash",
    extracted_json AS "extractedJson",
    raw_model_output AS "rawModelOutput",
    confidence_score AS "confidenceScore",
    low_confidence_fields AS "lowConfidenceFields",
    warnings AS "warnings",
    salvaged,
    extraction_error_message AS "extractionErrorMessage",
    last_extraction_at AS "lastExtractionAt",
    updated_at AS "updatedAt"
  FROM invoices
`;

const updatedInvoiceReturning = `
  RETURNING
    id,
    tenant_id AS "tenantId",
    branch_id AS "branchId",
    business_status AS "businessStatus",
    extraction_status AS "extractionStatus",
    retry_count AS "retryCount",
    invoice_number AS "invoiceNumber",
    party_name AS "partyName",
    total_amount AS "totalAmount",
    confidence_score AS "confidenceScore",
    low_confidence_fields AS "lowConfidenceFields",
    warnings AS "warnings",
    salvaged,
    extraction_error_message AS "extractionErrorMessage",
    last_extraction_at AS "lastExtractionAt",
    updated_at AS "updatedAt"
`;

export const invoiceExtractionRepository = {
  getClient,

  async findById(invoiceId, tenantId, client = null) {
    const executor = client || { query };
    const result = await executor.query(
      `${invoiceSelect} WHERE id = $1 AND tenant_id = $2`,
      [invoiceId, tenantId]
    );

    return result.rows[0] || null;
  },

  async markExtractionStarted(client, invoiceId, tenantId, payload) {
    const result = await client.query(
      `
        UPDATE invoices
        SET
          business_status = 'EXTRACTING',
          extraction_status = 'IN_PROGRESS',
          retry_count = COALESCE($3, retry_count),
          raw_model_output = COALESCE($4::jsonb, raw_model_output),
          extraction_error_message = NULL,
          last_extraction_at = NOW(),
          updated_at = NOW()
        WHERE id = $1 AND tenant_id = $2
        ${updatedInvoiceReturning}
      `,
      [invoiceId, tenantId, payload.retryCount, payload.rawModelOutput]
    );

    return result.rows[0] || null;
  },

  async applyExtractionResult(client, invoiceId, tenantId, update) {
    const result = await client.query(
      `
        UPDATE invoices
        SET
          extraction_status = $3,
          business_status = $4,
          retry_count = $5,
          raw_model_output = $6::jsonb,
          extracted_json = $7::jsonb,
          invoice_number = COALESCE($8, invoice_number),
          invoice_date = COALESCE($9, invoice_date),
          due_date = COALESCE($10, due_date),
          party_name = COALESCE($11, party_name),
          party_gstin = COALESCE($12, party_gstin),
          party_address = COALESCE($13, party_address),
          currency = COALESCE($14, currency),
          subtotal = COALESCE($15, subtotal),
          taxable_amount = COALESCE($16, taxable_amount),
          cgst_amount = COALESCE($17, cgst_amount),
          sgst_amount = COALESCE($18, sgst_amount),
          igst_amount = COALESCE($19, igst_amount),
          cess_amount = COALESCE($20, cess_amount),
          round_off_amount = COALESCE($21, round_off_amount),
          total_amount = COALESCE($22, total_amount),
          dedupe_key = COALESCE($23, dedupe_key),
          source_hash = COALESCE($24, source_hash),
          confidence_score = $25,
          low_confidence_fields = $26::jsonb,
          warnings = $27::jsonb,
          salvaged = $28,
          extraction_error_message = $29,
          last_extraction_at = NOW(),
          updated_at = NOW()
        WHERE id = $1 AND tenant_id = $2
        ${updatedInvoiceReturning}
      `,
      [
        invoiceId,
        tenantId,
        update.extractionStatus,
        update.businessStatus,
        update.retryCount,
        toJsonbParam(update.rawModelOutput, {}),
        toJsonbParam(update.extractedJson, {}),
        update.normalizedFields.invoice_number,
        update.normalizedFields.invoice_date,
        update.normalizedFields.due_date,
        update.normalizedFields.party_name,
        update.normalizedFields.party_gstin,
        update.normalizedFields.party_address,
        update.normalizedFields.currency,
        update.normalizedFields.subtotal,
        update.normalizedFields.taxable_amount,
        update.normalizedFields.cgst_amount,
        update.normalizedFields.sgst_amount,
        update.normalizedFields.igst_amount,
        update.normalizedFields.cess_amount,
        update.normalizedFields.round_off_amount,
        update.normalizedFields.total_amount,
        update.normalizedFields.dedupe_key,
        update.normalizedFields.source_hash,
        update.confidenceScore,
        toJsonbParam(update.lowConfidenceFields, []),
        toJsonbParam(update.warnings, []),
        update.salvaged,
        update.extractionErrorMessage
      ]
    );

    return result.rows[0] || null;
  },

  async markExtractionRetry(client, invoiceId, tenantId, retryCount) {
    const result = await client.query(
      `
        UPDATE invoices
        SET
          business_status = 'EXTRACTING',
          extraction_status = 'IN_PROGRESS',
          retry_count = $3,
          extraction_error_message = NULL,
          last_extraction_at = NOW(),
          updated_at = NOW()
        WHERE id = $1 AND tenant_id = $2
        ${updatedInvoiceReturning}
      `,
      [invoiceId, tenantId, retryCount]
    );

    return result.rows[0] || null;
  }
};
