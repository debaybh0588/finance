import { query, getClient } from "../db/pool.js";

const toUiInvoiceType = (documentType) => (documentType === "SALES_INVOICE" ? "Sales" : "Purchase");

const toDate = (value) => {
  if (!value) return "-";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "-" : date.toISOString().slice(0, 10);
};

const branchFilterSql = (branchId, argPos = 2) =>
  branchId ? ` AND i.branch_id = $${argPos}` : "";

const normalizeDateRange = (value) => {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  return normalized || null;
};

const dateRangeConditionSql = (dateRange, columnExpr) => {
  const normalized = normalizeDateRange(dateRange);
  if (!normalized) return "";

  if (normalized === "today") {
    return `${columnExpr} = current_date`;
  }
  if (normalized === "this-week") {
    return `${columnExpr} >= date_trunc('week', current_date)::date`;
  }
  if (normalized === "this-month") {
    return `date_trunc('month', ${columnExpr}) = date_trunc('month', current_date)`;
  }
  if (normalized === "last-month") {
    return `date_trunc('month', ${columnExpr}) = date_trunc('month', current_date - interval '1 month')`;
  }
  if (normalized === "this-quarter") {
    return `date_trunc('quarter', ${columnExpr}) = date_trunc('quarter', current_date)`;
  }

  return "";
};

const dateRangeFilterSql = (dateRange, columnExpr) => {
  const condition = dateRangeConditionSql(dateRange, columnExpr);
  return condition ? ` AND ${condition}` : "";
};

const getDashboardSeriesWindowSql = (dateRange) => {
  const normalized = normalizeDateRange(dateRange);
  if (normalized === "today") {
    return { start: "current_date", end: "current_date" };
  }
  if (normalized === "this-week") {
    return {
      start: "date_trunc('week', current_date)::date",
      end: "(date_trunc('week', current_date)::date + interval '6 day')::date"
    };
  }
  if (normalized === "this-month") {
    return {
      start: "date_trunc('month', current_date)::date",
      end: "(date_trunc('month', current_date)::date + interval '1 month - 1 day')::date"
    };
  }
  if (normalized === "last-month") {
    return {
      start: "date_trunc('month', current_date - interval '1 month')::date",
      end: "(date_trunc('month', current_date)::date - interval '1 day')::date"
    };
  }
  if (normalized === "this-quarter") {
    return {
      start: "date_trunc('quarter', current_date)::date",
      end: "(date_trunc('quarter', current_date)::date + interval '3 month - 1 day')::date"
    };
  }
  return {
    start: "(current_date - interval '6 day')::date",
    end: "current_date"
  };
};

export const invoiceReadRepository = {
  async getDashboardRows(tenantId, branchId, dateRange = null) {
    const params = branchId ? [tenantId, branchId] : [tenantId];
    const invoiceDateExpr = "COALESCE(i.invoice_date, i.created_at::date)";
    const dateFilter = dateRangeFilterSql(dateRange, invoiceDateExpr);
    const partyDateFilter =
      dateFilter || ` AND date_trunc('month', ${invoiceDateExpr}) = date_trunc('month', current_date)`;
    const seriesWindow = getDashboardSeriesWindowSql(dateRange);

    const statusRows = await query(
      `SELECT i.business_status AS "status", COUNT(*)::int AS "count"
       FROM invoices i
       WHERE i.tenant_id = $1${branchFilterSql(branchId)}${dateFilter}
       GROUP BY i.business_status`,
      params
    );

    const perDayRows = await query(
      `SELECT to_char(day_ref.day, 'Dy') AS "day", COALESCE(d.count, 0)::int AS "count"
       FROM (
         SELECT generate_series(${seriesWindow.start}, ${seriesWindow.end}, interval '1 day')::date AS day
       ) day_ref
       LEFT JOIN (
         SELECT ${invoiceDateExpr} AS created_day, COUNT(*)::int AS count
         FROM invoices i
         WHERE i.tenant_id = $1${branchFilterSql(branchId)}${dateFilter}
         GROUP BY ${invoiceDateExpr}
       ) d ON d.created_day = day_ref.day
       ORDER BY day_ref.day`,
      params
    );

    const vendorRows = await query(
      `SELECT COALESCE(NULLIF(i.party_name, ''), 'Unknown Party') AS "name",
              COALESCE(SUM(i.total_amount), 0)::numeric(14,2) AS "amount"
       FROM invoices i
       WHERE i.tenant_id = $1${branchFilterSql(branchId)}${partyDateFilter}
       GROUP BY COALESCE(NULLIF(i.party_name, ''), 'Unknown Party')
       ORDER BY COALESCE(SUM(i.total_amount), 0) DESC
       LIMIT 5`,
      params
    );

    const topPartyRows = await query(
      `SELECT
          i.document_type AS "documentType",
          COALESCE(NULLIF(i.party_name, ''), 'Unknown Party') AS "name",
          COALESCE(SUM(i.total_amount), 0)::numeric(14,2) AS "amount"
       FROM invoices i
       WHERE i.tenant_id = $1${branchFilterSql(branchId)}${partyDateFilter}
       GROUP BY i.document_type, COALESCE(NULLIF(i.party_name, ''), 'Unknown Party')
       ORDER BY i.document_type, COALESCE(SUM(i.total_amount), 0) DESC`,
      params
    );

    const typeSplitRows = await query(
      `SELECT
          i.document_type AS "documentType",
          COUNT(*)::int AS "count",
          COALESCE(SUM(i.total_amount), 0)::numeric(14,2) AS "amount"
       FROM invoices i
       WHERE i.tenant_id = $1${branchFilterSql(branchId)}${dateFilter}
       GROUP BY i.document_type`,
      params
    );

    return {
      statusRows: statusRows.rows,
      perDayRows: perDayRows.rows,
      vendorRows: vendorRows.rows,
      topPartyRows: topPartyRows.rows,
      typeSplitRows: typeSplitRows.rows
    };
  },

  async listInvoices(tenantId, branchId, filters = {}) {
    const duplicateExpr = `EXISTS (
      SELECT 1
      FROM invoices d
      WHERE d.tenant_id = i.tenant_id
        AND d.document_type = i.document_type
        AND d.dedupe_key IS NOT NULL
        AND d.dedupe_key = i.dedupe_key
        AND d.id <> i.id
    )`;

    const params = [tenantId];
    const whereParts = [`i.tenant_id = $1`];

    if (branchId) {
      params.push(branchId);
      whereParts.push(`i.branch_id = $${params.length}`);
    }

    if (filters.search) {
      params.push(`%${filters.search}%`);
      whereParts.push(`(
        i.party_name ILIKE $${params.length}
        OR i.party_gstin ILIKE $${params.length}
        OR i.invoice_number ILIKE $${params.length}
      )`);
    }

    if (filters.documentType) {
      params.push(filters.documentType);
      whereParts.push(`i.document_type = $${params.length}`);
    }

    if (filters.status) {
      if (filters.status === "PENDING_REVIEW") {
        whereParts.push(`i.business_status IN ('PENDING_REVIEW', 'NEEDS_CORRECTION')`);
      } else {
        params.push(filters.status);
        whereParts.push(`i.business_status = $${params.length}`);
      }
    }

    if (filters.extractionStatus) {
      params.push(filters.extractionStatus);
      whereParts.push(`i.extraction_status = $${params.length}`);
    }

    const invoiceDateRangeCondition = dateRangeConditionSql(filters.dateRange, "COALESCE(i.invoice_date, i.created_at::date)");
    if (invoiceDateRangeCondition) {
      whereParts.push(invoiceDateRangeCondition);
    }

    if (filters.duplicateFlag === "yes") {
      whereParts.push(duplicateExpr);
    } else if (filters.duplicateFlag === "no") {
      whereParts.push(`NOT ${duplicateExpr}`);
    }

    const result = await query(
      `SELECT
          i.id,
          i.business_status AS "status",
          i.document_type AS "documentType",
          COALESCE(i.party_name, '-') AS "partyName",
          COALESCE(i.party_gstin, '-') AS "gstin",
          COALESCE(i.invoice_number, '-') AS "invoiceNumber",
          i.invoice_date AS "invoiceDate",
          COALESCE(b.branch_name, b.branch_code, '-') AS "branchName",
          COALESCE(i.total_amount, 0)::numeric(14,2) AS "totalAmount",
          i.extraction_status AS "extractionStatus",
           i.confidence_score AS "confidenceScore",
           COALESCE(jsonb_array_length(i.low_confidence_fields), 0) + COALESCE(jsonb_array_length(i.warnings), 0) AS "issuesCount",
           i.extracted_json AS "extractedJson",
           i.warnings AS "warnings",
          ${duplicateExpr} AS "isDuplicate"
       FROM invoices i
       LEFT JOIN branches b ON b.id = i.branch_id AND b.tenant_id = i.tenant_id
       WHERE ${whereParts.join(" AND ")}
       ORDER BY i.updated_at DESC
       LIMIT 300`,
      params
    );

    return result.rows.map((row) => ({
      id: row.id,
      documentType: row.documentType,
      status: row.status,
      extractionStatus: row.extractionStatus,
      partyName: row.partyName,
      gstin: row.gstin,
      invoiceNumber: row.invoiceNumber,
      invoiceDate: row.invoiceDate,
      branchName: row.branchName,
      totalAmount: Number(row.totalAmount || 0),
      duplicateWarning: Boolean(row.isDuplicate),
      issuesCount: Number(row.issuesCount || 0),
      extractedJson: row.extractedJson || {},
      warnings: Array.isArray(row.warnings) ? row.warnings : [],
      confidenceScore: row.confidenceScore === null || row.confidenceScore === undefined
        ? null
        : Number(row.confidenceScore),
      invoiceType: toUiInvoiceType(row.documentType),
      date: toDate(row.invoiceDate),
      branch: row.branchName,
      duplicateFlag: row.isDuplicate ? "Yes" : "No"
    }));
  },

  async getInvoiceDetail(invoiceId, tenantId) {
    const headerResult = await query(
      `SELECT
          i.id,
          i.tenant_id AS "tenantId",
          i.branch_id AS "branchId",
          COALESCE(b.branch_name, b.branch_code, '-') AS "branchName",
          i.document_type AS "documentType",
          i.business_status AS "status",
          i.extraction_status AS "extractionStatus",
          i.original_file_path AS "originalFilePath",
          i.file_name AS "fileName",
          i.mime_type AS "mimeType",
          i.retry_count AS "retryCount",
          i.invoice_number AS "invoiceNumber",
          i.invoice_date AS "invoiceDate",
          i.due_date AS "dueDate",
          i.party_name AS "partyName",
          i.party_gstin AS "partyGstin",
          i.party_address AS "partyAddress",
          i.currency,
          i.subtotal,
          i.taxable_amount AS "taxableAmount",
          i.cgst_amount AS "cgstAmount",
          i.sgst_amount AS "sgstAmount",
          i.igst_amount AS "igstAmount",
          i.cess_amount AS "cessAmount",
          i.round_off_amount AS "roundOffAmount",
          i.total_amount AS "totalAmount",
          EXISTS (
            SELECT 1
            FROM invoices d
            WHERE d.tenant_id = i.tenant_id
              AND d.document_type = i.document_type
              AND d.dedupe_key IS NOT NULL
              AND d.dedupe_key = i.dedupe_key
              AND d.id <> i.id
          ) AS "isDuplicate",
          i.confidence_score AS "confidenceScore",
          i.low_confidence_fields AS "lowConfidenceFields",
          i.warnings AS "warnings",
          i.salvaged,
          i.extracted_json AS "extractedJson",
          i.corrected_json AS "correctedJson",
          i.posting_request_xml AS "postingRequestXml",
          i.posting_request_xml_generated_at AS "postingRequestXmlGeneratedAt",
          i.posting_request_xml_reviewed_by AS "postingRequestXmlReviewedBy",
          i.posting_request_xml_reviewed_at AS "postingRequestXmlReviewedAt",
          i.posting_request_xml_review_notes AS "postingRequestXmlReviewNotes",
          i.posting_request_xml_source AS "postingRequestXmlSource"
       FROM invoices i
       LEFT JOIN branches b ON b.id = i.branch_id AND b.tenant_id = i.tenant_id
       WHERE i.id = $1 AND i.tenant_id = $2
       LIMIT 1`,
      [invoiceId, tenantId]
    );

    const header = headerResult.rows[0] || null;
    if (!header) return null;

    const [lineItemsResult, hsnSummaryResult] = await Promise.all([
      query(
        `SELECT
            line_no AS "lineNo",
            description,
            hsn_sac AS "hsn",
            quantity,
            uom,
            rate,
            taxable_amount AS "taxableAmount",
            tax_amount AS "tax",
            total_amount AS "total"
         FROM invoice_line_items
         WHERE invoice_id = $1 AND tenant_id = $2
         ORDER BY line_no`,
        [invoiceId, tenantId]
      ),
      query(
        `SELECT
            hsn_sac AS "hsn",
            taxable_amount AS "taxableAmount",
            cgst_amount AS "cgstAmount",
            sgst_amount AS "sgstAmount",
            igst_amount AS "igstAmount",
            cess_amount AS "cessAmount",
            total_tax_amount AS "totalTaxAmount",
            line_total_amount AS "lineTotalAmount"
         FROM invoice_hsn_tax_summary
         WHERE invoice_id = $1 AND tenant_id = $2
         ORDER BY hsn_sac`,
        [invoiceId, tenantId]
      )
    ]);

    return {
      ...header,
      duplicateWarning: Boolean(header.isDuplicate),
      lineItems: lineItemsResult.rows,
      hsnTaxSummary: hsnSummaryResult.rows
    };
  },

  async updateReview(invoiceId, tenantId, payload, context) {
    const correctedJson = payload.correctedJson || {};
    const notes = payload.notes || null;

    const client = await getClient();
    try {
      await client.query("BEGIN");

      const previous = await client.query(
        `SELECT corrected_json AS "correctedJson", business_status AS "status"
         FROM invoices
         WHERE id = $1 AND tenant_id = $2
         FOR UPDATE`,
        [invoiceId, tenantId]
      );

      if (!previous.rows[0]) {
        await client.query("ROLLBACK");
        return null;
      }

      const updated = await client.query(
        `UPDATE invoices
           SET corrected_json = $3::jsonb,
               business_status = CASE WHEN business_status = 'UPLOADED' THEN 'PENDING_REVIEW' ELSE business_status END,
               updated_at = NOW()
         WHERE id = $1 AND tenant_id = $2
         RETURNING id, business_status AS "status", corrected_json AS "correctedJson", updated_at AS "updatedAt"`,
        [invoiceId, tenantId, correctedJson]
      );

      await client.query(
        `INSERT INTO audit_logs (
            tenant_id, branch_id, invoice_id, action_type, entity_type, entity_id,
            performed_by_user_id, old_value, new_value, notes, metadata
         )
         VALUES ($1, $2, $3, 'REVIEW_UPDATED', 'INVOICE', $3, $4, $5::jsonb, $6::jsonb, $7, $8::jsonb)`,
        [
          tenantId,
          context.branchId,
          invoiceId,
          context.userId,
          JSON.stringify({ correctedJson: previous.rows[0].correctedJson, status: previous.rows[0].status }),
          JSON.stringify({ correctedJson, status: updated.rows[0].status }),
          notes,
          JSON.stringify({ source: 'ui' })
        ]
      );

      await client.query("COMMIT");
      return updated.rows[0];
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  },

  async rejectInvoice(invoiceId, tenantId, context, reason) {
    const result = await query(
      `UPDATE invoices
          SET business_status = 'REJECTED',
              approval_notes = $3,
              updated_at = NOW()
       WHERE id = $1 AND tenant_id = $2
       RETURNING id, business_status AS "status", approval_notes AS "reason", updated_at AS "updatedAt"`,
      [invoiceId, tenantId, reason]
    );

    const updated = result.rows[0] || null;
    if (!updated) return null;

    await query(
      `INSERT INTO audit_logs (
          tenant_id, branch_id, invoice_id, action_type, entity_type, entity_id,
          performed_by_user_id, new_value, notes, metadata
       )
       VALUES ($1, $2, $3, 'REJECTED', 'INVOICE', $3, $4, $5::jsonb, $6, $7::jsonb)`,
      [
        tenantId,
        context.branchId,
        invoiceId,
        context.userId,
        JSON.stringify({ status: 'REJECTED' }),
        reason,
        JSON.stringify({ source: 'ui' })
      ]
    );

    return updated;
  },

  async listReviewQueue(tenantId, branchId, dateRange = null) {
    const params = branchId ? [tenantId, branchId] : [tenantId];
    const reviewDateFilter = dateRangeFilterSql(dateRange, "COALESCE(i.invoice_date, i.created_at::date)");
    const result = await query(
      `SELECT
          i.id,
          i.business_status AS "status",
          i.document_type AS "documentType",
          COALESCE(i.party_name, '-') AS "partyName",
          COALESCE(i.party_gstin, '-') AS "gstin",
          COALESCE(i.invoice_number, '-') AS "invoiceNumber",
          i.invoice_date AS "invoiceDate",
          COALESCE(b.branch_name, b.branch_code, '-') AS "branch",
          COALESCE(i.total_amount, 0)::numeric(14,2) AS "totalAmount",
          COALESCE(jsonb_array_length(i.low_confidence_fields), 0) + COALESCE(jsonb_array_length(i.warnings), 0) AS "issuesCount",
          EXISTS (
            SELECT 1
            FROM invoices d
            WHERE d.tenant_id = i.tenant_id
              AND d.document_type = i.document_type
              AND d.dedupe_key IS NOT NULL
              AND d.dedupe_key = i.dedupe_key
              AND d.id <> i.id
          ) AS "isDuplicate",
          i.extracted_json AS "extractedJson",
          i.warnings AS "warnings"
       FROM invoices i
       LEFT JOIN branches b ON b.id = i.branch_id AND b.tenant_id = i.tenant_id
       WHERE i.tenant_id = $1${branchFilterSql(branchId)}
         AND i.business_status IN ('UPLOADED', 'EXTRACTING', 'PENDING_REVIEW', 'NEEDS_CORRECTION')
         ${reviewDateFilter}
       ORDER BY i.updated_at DESC
       LIMIT 300`,
      params
    );

    return result.rows;
  },

  async listPostingRows(tenantId, branchId, dateRange = null) {
    const params = branchId ? [tenantId, branchId] : [tenantId];
    const postingDateFilter = dateRangeFilterSql(dateRange, "COALESCE(i.invoice_date, i.updated_at::date)");

    const result = await query(
      `SELECT
          i.id,
          i.business_status AS "status",
          i.tally_posting_status AS "tallyPostingStatus",
          i.document_type AS "documentType",
          COALESCE(i.party_name, '-') AS "partyName",
          COALESCE(b.branch_name, b.branch_code, '-') AS "branch",
          COALESCE(i.invoice_date, i.updated_at::date) AS "date",
          COALESCE(i.total_amount, 0)::numeric(14,2) AS "amount",
          COALESCE(i.approved_by, '-') AS "approvedBy",
          COALESCE(i.posting_request_xml_generated_at, i.updated_at) AS "postingDraftGeneratedAt",
          i.posting_request_xml_reviewed_at AS "postingDraftReviewedAt",
          i.posting_request_xml_reviewed_by AS "postingDraftReviewedBy",
          COALESCE(i.tally_response_metadata->>'postedBy', 'System') AS "postedBy",
          COALESCE(i.tally_voucher_type, '-') AS "voucherType",
          COALESCE(i.tally_voucher_number, '-') AS "voucherNumber",
           i.posting_error_message AS "lastFailureReason",
           COALESCE(i.posting_error_message, i.tally_response_metadata->>'summary', '-') AS "responseSummary"
       FROM invoices i
       LEFT JOIN branches b ON b.id = i.branch_id AND b.tenant_id = i.tenant_id
       WHERE i.tenant_id = $1${branchFilterSql(branchId)}
         ${postingDateFilter}
         AND i.business_status IN ('APPROVED', 'PENDING_POSTING_REVIEW', 'POSTING', 'POSTED', 'POST_FAILED')
       ORDER BY i.updated_at DESC
       LIMIT 300`,
      params
    );

    return result.rows;
  },

  async postingSummary(tenantId, branchId, dateRange = null) {
    const params = branchId ? [tenantId, branchId] : [tenantId];
    const postingSummaryDateFilter = dateRangeFilterSql(dateRange, "COALESCE(i.invoice_date, i.updated_at::date)");
    const result = await query(
      `SELECT
          COUNT(*) FILTER (WHERE i.business_status = 'APPROVED')::int AS "awaitingPosting",
          COUNT(*) FILTER (WHERE i.business_status = 'PENDING_POSTING_REVIEW')::int AS "awaitingPostingReview",
          COUNT(*) FILTER (WHERE i.business_status = 'POSTING')::int AS "currentlyPosting",
          COUNT(*) FILTER (WHERE i.business_status = 'POSTED' AND i.updated_at::date = current_date)::int AS "postedToday",
          COUNT(*) FILTER (WHERE i.business_status = 'POST_FAILED' AND i.updated_at::date = current_date)::int AS "failedToday"
       FROM invoices i
       WHERE i.tenant_id = $1${branchFilterSql(branchId)}${postingSummaryDateFilter}`,
      params
    );

    return result.rows[0] || {
      awaitingPosting: 0,
      awaitingPostingReview: 0,
      currentlyPosting: 0,
      postedToday: 0,
      failedToday: 0
    };
  },

  async listPostingReviewRows(tenantId, branchId, dateRange = null) {
    const params = branchId ? [tenantId, branchId] : [tenantId];
    const reviewDateFilter = dateRangeFilterSql(dateRange, "COALESCE(i.invoice_date, i.updated_at::date)");
    const result = await query(
      `SELECT
          i.id,
          i.business_status AS "status",
          i.document_type AS "documentType",
          COALESCE(i.party_name, '-') AS "partyName",
          COALESCE(i.invoice_number, '-') AS "invoiceNumber",
          COALESCE(b.branch_name, b.branch_code, '-') AS "branch",
          COALESCE(i.invoice_date, i.updated_at::date) AS "invoiceDate",
          COALESCE(i.total_amount, 0)::numeric(14,2) AS "totalAmount",
          i.posting_request_xml_generated_at AS "generatedAt",
          i.posting_request_xml_reviewed_at AS "reviewedAt",
          i.posting_request_xml_reviewed_by AS "reviewedBy"
       FROM invoices i
       LEFT JOIN branches b ON b.id = i.branch_id AND b.tenant_id = i.tenant_id
       WHERE i.tenant_id = $1${branchFilterSql(branchId)}
         ${reviewDateFilter}
         AND i.business_status = 'PENDING_POSTING_REVIEW'
       ORDER BY i.updated_at DESC
       LIMIT 300`,
      params
    );

    return result.rows;
  },

  async listAuditRows(tenantId, branchId, dateRange = null) {
    const params = branchId ? [tenantId, branchId] : [tenantId];
    const auditDateCondition = dateRangeConditionSql(dateRange, "a.created_at::date");

    const eventsResult = await query(
      `SELECT
          to_char(a.created_at, 'YYYY-MM-DD HH24:MI:SS') AS "timestamp",
          COALESCE(i.invoice_number, '-') AS "invoiceNumber",
          CASE WHEN i.document_type = 'SALES_INVOICE' THEN 'Sales' ELSE 'Purchase' END AS "invoiceType",
          COALESCE(t.tenant_code, '-') AS "tenant",
          COALESCE(b.branch_name, b.branch_code, '-') AS "branch",
          a.action_type AS "action",
          COALESCE(u.full_name, 'System') AS "performedBy",
          COALESCE(a.old_value::text, '-') AS "oldValue",
          COALESCE(a.new_value::text, '-') AS "newValue",
          COALESCE(a.notes, '-') AS "notes"
       FROM audit_logs a
       LEFT JOIN invoices i ON i.id = a.invoice_id
       LEFT JOIN tenants t ON t.id = a.tenant_id
       LEFT JOIN branches b ON b.id = a.branch_id AND b.tenant_id = a.tenant_id
       LEFT JOIN users u ON u.id = a.performed_by_user_id
       WHERE a.tenant_id = $1${branchId ? " AND a.branch_id = $2" : ""}${auditDateCondition ? ` AND ${auditDateCondition}` : ""}
       ORDER BY a.created_at DESC
       LIMIT 500`,
      params
    );

    const filtersResult = await query(
      `SELECT
          COALESCE(array_agg(DISTINCT t.tenant_code) FILTER (WHERE t.tenant_code IS NOT NULL), '{}') AS "tenants",
          COALESCE(array_agg(DISTINCT b.branch_name) FILTER (WHERE b.branch_name IS NOT NULL), '{}') AS "branches",
          COALESCE(array_agg(DISTINCT u.full_name) FILTER (WHERE u.full_name IS NOT NULL), '{}') AS "users",
          COALESCE(array_agg(DISTINCT a.action_type) FILTER (WHERE a.action_type IS NOT NULL), '{}') AS "actions"
       FROM audit_logs a
       LEFT JOIN tenants t ON t.id = a.tenant_id
       LEFT JOIN branches b ON b.id = a.branch_id AND b.tenant_id = a.tenant_id
       LEFT JOIN users u ON u.id = a.performed_by_user_id
       WHERE a.tenant_id = $1${branchId ? " AND a.branch_id = $2" : ""}${auditDateCondition ? ` AND ${auditDateCondition}` : ""}`,
      params
    );

    return {
      items: eventsResult.rows,
      filters: filtersResult.rows[0] || { tenants: [], branches: [], users: [], actions: [] }
    };
  }
};
