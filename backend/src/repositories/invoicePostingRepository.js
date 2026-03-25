import { getClient, query } from "../db/pool.js";

const approvedReturning = `
  RETURNING
    id,
    tenant_id         AS "tenantId",
    branch_id         AS "branchId",
    business_status   AS "businessStatus",
    extraction_status AS "extractionStatus",
    corrected_json    AS "correctedJson",
    approved_by  AS "approvedByName",
    approved_at       AS "approvedAt",
    invoice_number    AS "invoiceNumber",
    party_name        AS "partyName",
    total_amount      AS "totalAmount",
    updated_at        AS "updatedAt"
`;

const postingReturning = `
  RETURNING
    id,
    tenant_id                 AS "tenantId",
    branch_id                 AS "branchId",
    business_status           AS "businessStatus",
    tally_posting_status      AS "tallyPostingStatus",
    posting_locked            AS "postingLocked",
    posting_retry_count       AS "postingRetryCount",
    posting_request_xml       AS "postingRequestXml",
    posting_request_xml_generated_at AS "postingRequestXmlGeneratedAt",
    posting_request_xml_reviewed_by  AS "postingRequestXmlReviewedBy",
    posting_request_xml_reviewed_at  AS "postingRequestXmlReviewedAt",
    posting_request_xml_review_notes AS "postingRequestXmlReviewNotes",
    posting_request_xml_source       AS "postingRequestXmlSource",
    tally_voucher_type        AS "tallyVoucherType",
    tally_voucher_number      AS "tallyVoucherNumber",
    tally_response_metadata   AS "tallyResponseMetadata",
    posting_error_message     AS "postingErrorMessage",
    last_posting_attempt_at   AS "lastPostingAttemptAt",
    original_file_path        AS "originalFilePath",
    file_name                 AS "fileName",
    invoice_number            AS "invoiceNumber",
    party_name                AS "partyName",
    total_amount              AS "totalAmount",
    updated_at                AS "updatedAt"
`;

export const invoicePostingRepository = {
  getClient,

  async findById(invoiceId, tenantId, client = null) {
    const executor = client || { query };
    const result = await executor.query(
      `SELECT
          id,
          tenant_id           AS "tenantId",
          branch_id           AS "branchId",
          business_status     AS "businessStatus",
          tally_posting_status AS "tallyPostingStatus",
          posting_locked      AS "postingLocked",
          posting_retry_count AS "postingRetryCount",
          posting_request_xml AS "postingRequestXml",
          posting_request_xml_generated_at AS "postingRequestXmlGeneratedAt",
          posting_request_xml_reviewed_by  AS "postingRequestXmlReviewedBy",
          posting_request_xml_reviewed_at  AS "postingRequestXmlReviewedAt",
          posting_request_xml_review_notes AS "postingRequestXmlReviewNotes",
          posting_request_xml_source       AS "postingRequestXmlSource",
          dedupe_key          AS "dedupeKey",
          original_file_path  AS "originalFilePath",
          file_name           AS "fileName",
          invoice_number      AS "invoiceNumber",
          party_name          AS "partyName",
          total_amount        AS "totalAmount",
          approved_by    AS "approvedByName",
          approved_at    AS "approvedAt"
        FROM invoices
        WHERE id = $1 AND tenant_id = $2`,
      [invoiceId, tenantId]
    );

    return result.rows[0] || null;
  },

  async markPostingDraftReady(client, invoiceId, tenantId, { postingRequestXml, sourceMetadata }) {
    const result = await client.query(
      `UPDATE invoices
          SET business_status                   = 'PENDING_POSTING_REVIEW',
              posting_request_xml               = $3,
              posting_request_xml_generated_at  = NOW(),
              posting_request_xml_reviewed_by   = NULL,
              posting_request_xml_reviewed_at   = NULL,
              posting_request_xml_review_notes  = NULL,
              posting_request_xml_source        = COALESCE($4::jsonb, '{}'::jsonb),
              posting_error_message             = NULL,
              posting_locked                    = FALSE,
              updated_at                        = NOW()
        WHERE id = $1
          AND tenant_id = $2
          AND business_status IN ('APPROVED', 'PENDING_POSTING_REVIEW')
        ${postingReturning}`,
      [invoiceId, tenantId, postingRequestXml, sourceMetadata]
    );

    return result.rows[0] || null;
  },

  async approvePostingDraft(client, invoiceId, tenantId, { reviewedBy, notes, postingRequestXml }) {
    const result = await client.query(
      `UPDATE invoices
          SET business_status                  = 'APPROVED',
              posting_request_xml_reviewed_by  = $3,
              posting_request_xml_reviewed_at  = NOW(),
              posting_request_xml_review_notes = $4,
              posting_request_xml              = COALESCE($5, posting_request_xml),
              posting_error_message            = NULL,
              updated_at                       = NOW()
        WHERE id = $1
          AND tenant_id = $2
          AND business_status = 'PENDING_POSTING_REVIEW'
        ${postingReturning}`,
      [invoiceId, tenantId, reviewedBy, notes, postingRequestXml]
    );

    return result.rows[0] || null;
  },

  async rejectPostingDraft(client, invoiceId, tenantId, { reviewedBy, notes }) {
    const result = await client.query(
      `UPDATE invoices
          SET business_status                  = 'NEEDS_CORRECTION',
              posting_request_xml_reviewed_by  = $3,
              posting_request_xml_reviewed_at  = NOW(),
              posting_request_xml_review_notes = $4,
              posting_error_message            = COALESCE($4, posting_error_message),
              updated_at                       = NOW()
        WHERE id = $1
          AND tenant_id = $2
          AND business_status = 'PENDING_POSTING_REVIEW'
        ${postingReturning}`,
      [invoiceId, tenantId, reviewedBy, notes]
    );

    return result.rows[0] || null;
  },

  async approveInvoice(client, invoiceId, tenantId, { correctedJson, approvedByName }) {
    const result = await client.query(
      `UPDATE invoices
          SET business_status  = 'APPROVED',
              corrected_json = $3::jsonb,
              approved_by    = $4,
              approved_at    = NOW(),
              updated_at       = NOW()
        WHERE id = $1 AND tenant_id = $2
        ${approvedReturning}`,
      [invoiceId, tenantId, correctedJson, approvedByName]
    );

    return result.rows[0] || null;
  },

  /**
   * Returns true if any OTHER invoice on the same tenant shares the same
   * dedupe_key and has already reached POSTED status.
   */
  async hasDuplicatePosted(client, invoiceId, tenantId, dedupeKey) {
    if (!dedupeKey) return false;

    const result = await client.query(
      `SELECT 1
         FROM invoices
        WHERE tenant_id    = $1
          AND dedupe_key   = $2
          AND business_status = 'POSTED'
          AND id          != $3
        LIMIT 1`,
      [tenantId, dedupeKey, invoiceId]
    );

    return result.rows.length > 0;
  },

  /**
   * Atomically transitions the invoice from APPROVED → POSTING and sets
   * posting_locked = TRUE.  Returns null if the row was not in the expected
   * state (already locked, wrong status, or wrong tenant) so the service can
   * surface a 409 conflict without ambiguity.
   */
  async lockForPosting(client, invoiceId, tenantId) {
    const result = await client.query(
      `UPDATE invoices
          SET business_status         = 'POSTING',
              tally_posting_status    = 'IN_PROGRESS',
              posting_locked          = TRUE,
              posting_error_message   = NULL,
              last_posting_attempt_at = NOW(),
              posting_retry_count     = posting_retry_count + 1,
              updated_at              = NOW()
        WHERE id             = $1
          AND tenant_id      = $2
          AND business_status  = 'APPROVED'
          AND posting_locked   = FALSE
        ${postingReturning}`,
      [invoiceId, tenantId]
    );

    return result.rows[0] || null;
  },

  async applyPostingResult(client, invoiceId, tenantId, { voucherType, voucherNumber, responseMetadata }) {
    const result = await client.query(
      `UPDATE invoices
          SET business_status         = 'POSTED',
              tally_posting_status    = 'SUCCESS',
              posting_locked          = FALSE,
              tally_voucher_type      = $3,
              tally_voucher_number    = $4,
              tally_response_metadata = $5::jsonb,
              posting_error_message   = NULL,
              posted_at               = NOW(),
              updated_at              = NOW()
        WHERE id = $1 AND tenant_id = $2
        ${postingReturning}`,
      [invoiceId, tenantId, voucherType, voucherNumber, responseMetadata]
    );

    return result.rows[0] || null;
  },

  async markPostingFailed(client, invoiceId, tenantId, { errorMessage, responseMetadata }) {
    const result = await client.query(
      `UPDATE invoices
          SET business_status         = 'POST_FAILED',
              tally_posting_status    = 'FAILED',
              posting_locked          = FALSE,
              posting_error_message   = $3,
              tally_response_metadata = COALESCE($4::jsonb, tally_response_metadata),
              updated_at              = NOW()
        WHERE id = $1 AND tenant_id = $2
        ${postingReturning}`,
      [invoiceId, tenantId, errorMessage, responseMetadata]
    );

    return result.rows[0] || null;
  },

  async resetPostingFailureForRetry(client, invoiceId, tenantId) {
    const result = await client.query(
      `UPDATE invoices
          SET business_status         = 'APPROVED',
              tally_posting_status    = 'NOT_STARTED',
              posting_locked          = FALSE,
              posting_error_message   = NULL,
              updated_at              = NOW()
        WHERE id = $1
          AND tenant_id = $2
          AND business_status = 'POST_FAILED'
        ${postingReturning}`,
      [invoiceId, tenantId]
    );

    return result.rows[0] || null;
  },

  async attachPostingStorageArtifacts(invoiceId, tenantId, { originalFilePath = null, storageArtifacts = {} } = {}) {
    const result = await query(
      `UPDATE invoices
          SET original_file_path      = COALESCE($3, original_file_path),
              tally_response_metadata = COALESCE(tally_response_metadata, '{}'::jsonb) || COALESCE($4::jsonb, '{}'::jsonb),
              updated_at              = NOW()
        WHERE id = $1 AND tenant_id = $2
        ${postingReturning}`,
      [invoiceId, tenantId, originalFilePath, storageArtifacts]
    );

    return result.rows[0] || null;
  }
};
