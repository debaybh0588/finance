import { invoiceReadRepository } from "../repositories/invoiceReadRepository.js";
import { invoicePostingRepository } from "../repositories/invoicePostingRepository.js";
import { superAdminTenantRepository } from "../repositories/superAdminTenantRepository.js";
import { tallyRuntimeService } from "./tallyRuntimeService.js";

const toDate = (value) => {
  if (!value) return "-";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "-" : date.toISOString().slice(0, 10);
};

const toUiStatus = (status) => {
  if (status === "PENDING_POSTING_REVIEW") return "REVIEW_REQUIRED";
  if (status === "POSTED") return "COMPLETED";
  if (status === "POST_FAILED") return "FAILED";
  return "SUBMITTED";
};

const toUiInvoiceType = (documentType) => (documentType === "SALES_INVOICE" ? "Sales" : "Purchase");

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

const resolvePostingScope = (context, query = {}) => {
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

const createError = (message, statusCode, code) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
};

const decodeXmlEntities = (value) =>
  String(value || "")
    .replace(/&apos;/gi, "'")
    .replace(/&quot;/gi, "\"")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ")
    .trim();

const extractTallyResponseTextReason = (value) => {
  const text = String(value || "");
  if (!text) return null;

  const directResponseReason = text.match(/<RESPONSE>\s*([^<][\s\S]*?)\s*<\/RESPONSE>/i)?.[1];
  if (directResponseReason) {
    const normalized = decodeXmlEntities(directResponseReason);
    if (normalized) return normalized;
  }

  if (/Unknown Request,\s*cannot be processed/i.test(text)) {
    return "Unknown Request, cannot be processed";
  }

  return null;
};

const uniqueNonEmptyStrings = (values = []) => {
  const seen = new Set();
  const output = [];
  for (const value of values) {
    const text = decodeXmlEntities(value);
    if (!text) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(text);
  }
  return output;
};

const isGenericPostingFailureMessage = (value) => {
  const text = normalizeScopeValue(value);
  if (!text) return true;
  return /^(posting failed|tally posting failed|tally response indicates posting failure)$/i.test(text);
};

const buildSilentTallyFailureReason = (summary = {}) => {
  const created = Number(summary?.created ?? 0) || 0;
  const altered = Number(summary?.altered ?? 0) || 0;
  const errors = Number(summary?.errors ?? 0) || 0;
  const exceptions = Number(summary?.exceptions ?? 0) || 0;

  if (exceptions > 0) {
    return `Tally returned EXCEPTIONS=${exceptions} with no LINEERROR details (CREATED=${created}, ALTERED=${altered}, ERRORS=${errors}).`;
  }
  if (errors > 0) {
    return `Tally returned ERRORS=${errors} with no LINEERROR details (CREATED=${created}, ALTERED=${altered}, EXCEPTIONS=${exceptions}).`;
  }
  if (created <= 0 && altered <= 0) {
    return "Tally did not create or alter any voucher.";
  }
  return null;
};

const resolvePostingFailureReasonForUi = (row = {}) => {
  const rawMessage = normalizeScopeValue(row.lastFailureReason) || null;
  if (rawMessage && !isGenericPostingFailureMessage(rawMessage)) {
    return rawMessage;
  }

  const metadata = row.tallyResponseMetadata && typeof row.tallyResponseMetadata === "object"
    ? row.tallyResponseMetadata
    : {};
  const reasons = [];

  if (Array.isArray(metadata.reviewReasons)) {
    reasons.push(...metadata.reviewReasons);
  }
  if (metadata.payload && typeof metadata.payload === "object" && Array.isArray(metadata.payload.reviewReasons)) {
    reasons.push(...metadata.payload.reviewReasons);
  }

  const masterImportSummary =
    (metadata.masterImportSummary && typeof metadata.masterImportSummary === "object" ? metadata.masterImportSummary : null) ||
    (metadata.payload?.masterImportSummary && typeof metadata.payload.masterImportSummary === "object"
      ? metadata.payload.masterImportSummary
      : null);

  if (Array.isArray(masterImportSummary?.ignoredLineErrors)) {
    for (const warning of masterImportSummary.ignoredLineErrors) {
      reasons.push(`Master import warning: ${warning}`);
    }
  }

  reasons.push(
    extractTallyResponseTextReason(metadata.responsePreview),
    extractTallyResponseTextReason(metadata.payload?.responsePreview)
  );

  const summary =
    (metadata.summary && typeof metadata.summary === "object" ? metadata.summary : null) ||
    (metadata.payload?.summary && typeof metadata.payload.summary === "object" ? metadata.payload.summary : null);
  const silentReason = buildSilentTallyFailureReason(summary);
  if (silentReason) {
    reasons.push(silentReason);
  }

  const resolvedReasons = uniqueNonEmptyStrings(reasons);
  return resolvedReasons[0] || rawMessage || "Posting failed";
};

const requireInvoiceId = (invoiceId) => {
  if (typeof invoiceId !== "string" || invoiceId.trim() === "") {
    throw createError("Invoice id is required", 400, "VALIDATION_ERROR");
  }

  const normalized = invoiceId.trim();
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (!uuidRegex.test(normalized)) {
    throw createError("Invoice id must be a valid UUID", 400, "VALIDATION_ERROR");
  }

  return normalized;
};

const toOptionalString = (value) => {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") {
    throw createError("Invalid text field value", 400, "VALIDATION_ERROR");
  }
  return value.trim() || null;
};

const isAbsoluteHttpUrl = (value) => /^https?:\/\//i.test(String(value || ""));

const normalizeWebhookEndpoint = (value) => {
  const raw = toOptionalString(value);
  if (!raw) return null;
  if (isAbsoluteHttpUrl(raw)) return raw;
  return raw.startsWith("/") ? raw : `/${raw}`;
};

const resolveWebhookUrl = (baseUrl, endpoint) => {
  const normalizedEndpoint = normalizeWebhookEndpoint(endpoint);
  if (!normalizedEndpoint) return null;
  if (isAbsoluteHttpUrl(normalizedEndpoint)) return normalizedEndpoint;

  const normalizedBaseUrl = typeof baseUrl === "string" ? baseUrl.trim() : "";
  if (!normalizedBaseUrl) return null;

  return `${normalizedBaseUrl.replace(/\/+$/, "")}${normalizedEndpoint}`;
};

const fetchWithTimeout = async (url, options = {}, timeoutMs = 10000) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
};

const dispatchPostingWebhook = async ({
  tenantId,
  branchId,
  invoiceId,
  approvedBy,
  approvedData,
  voucherRequestXml,
  forceAutoPost
}) => {
  const result = {
    attempted: false,
    dispatched: false,
    skippedReason: null,
    responseStatus: null,
    error: null
  };

  const n8nConfig = await superAdminTenantRepository.findN8nConfigByTenantId(tenantId).catch(() => null);
  const webhookUrl = resolveWebhookUrl(n8nConfig?.n8nBaseUrl, n8nConfig?.postingWebhookPlaceholder);
  const workflowKey = String(n8nConfig?.workflowKeyToken || "").trim();
  const backendApiBaseUrl = toOptionalString(n8nConfig?.backendApiBaseUrl);

  if (!n8nConfig?.isActive) {
    result.skippedReason = "N8N_INACTIVE";
    return result;
  }
  if (!webhookUrl) {
    result.skippedReason = "N8N_POSTING_WEBHOOK_NOT_CONFIGURED";
    return result;
  }
  if (!workflowKey) {
    result.skippedReason = "N8N_WORKFLOW_KEY_MISSING";
    return result;
  }

  result.attempted = true;
  try {
    const response = await fetchWithTimeout(
      webhookUrl,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-workflow-key": workflowKey,
          "x-tenant-id": String(tenantId),
          ...(branchId ? { "x-branch-id": String(branchId) } : {})
        },
        body: JSON.stringify({
          invoiceId,
          tenantId,
          branchId: branchId || null,
          approvedBy: approvedBy || null,
          approvedData: approvedData || {},
          voucherRequestXml: voucherRequestXml || null,
          voucher_request_xml: voucherRequestXml || null,
          postingRequestXml: voucherRequestXml || null,
          posting_request_xml: voucherRequestXml || null,
          postingMode: "AUTO_POST",
          forceAutoPost: Boolean(forceAutoPost),
          backendApiBaseUrl: backendApiBaseUrl || null
        })
      },
      10000
    );

    result.responseStatus = response.status;
    if (response.ok) {
      result.dispatched = true;
    } else {
      result.skippedReason = `N8N_POSTING_WEBHOOK_HTTP_${response.status}`;
    }
  } catch (err) {
    result.skippedReason = err?.name === "AbortError" ? "N8N_POSTING_WEBHOOK_TIMEOUT" : "N8N_POSTING_WEBHOOK_REQUEST_FAILED";
    result.error = err?.message || "Posting webhook request failed";
  }

  return result;
};

export const postingService = {
  async list(context, query) {
    const scope = resolvePostingScope(context, query);
    const rows = await invoiceReadRepository.listPostingRows(scope.tenantId, scope.branchId, scope.dateRange);

    return {
      tabs: ["Review Required", "Submitted", "Completed", "Failed"],
      items: rows.map((row) => {
        const resolvedFailureReason = resolvePostingFailureReasonForUi(row);
        return {
          id: row.id,
          status: toUiStatus(row.status),
          postingStatus: row.status,
          tallyPostingStatus: row.tallyPostingStatus,
          invoiceType: toUiInvoiceType(row.documentType),
          documentType: row.documentType,
          partyName: row.partyName,
          branch: row.branch,
          date: toDate(row.date),
          amount: Number(row.amount || 0),
          approvedBy: row.approvedBy,
          postingDraftGeneratedAt: row.postingDraftGeneratedAt,
          postingDraftReviewedAt: row.postingDraftReviewedAt,
          postingDraftReviewedBy: row.postingDraftReviewedBy,
          postedBy: row.postedBy,
          voucherType: row.voucherType,
          voucherNumber: row.voucherNumber,
          responseSummary: resolvedFailureReason,
          lastFailureReason: resolvedFailureReason || null,
          tallyResponseMetadata: row.tallyResponseMetadata || null
        };
      }),
      summary: await invoiceReadRepository.postingSummary(scope.tenantId, scope.branchId, scope.dateRange),
      meta: {
        tenantId: scope.tenantId,
        branchId: scope.branchId,
        dateRange: scope.dateRange || null,
        query
      }
    };
  },

  async summary(context, query = {}) {
    return this.list(context, query);
  },

  async listPostingReviewQueue(context, query = {}) {
    const scope = resolvePostingScope(context, query);
    const rows = await invoiceReadRepository.listPostingReviewRows(scope.tenantId, scope.branchId, scope.dateRange);
    return {
      items: rows.map((row) => ({
        id: row.id,
        status: row.status,
        invoiceType: toUiInvoiceType(row.documentType),
        documentType: row.documentType,
        partyName: row.partyName,
        invoiceNumber: row.invoiceNumber,
        date: toDate(row.invoiceDate),
        branch: row.branch,
        totalAmount: Number(row.totalAmount || 0),
        generatedAt: row.generatedAt,
        reviewedAt: row.reviewedAt,
        reviewedBy: row.reviewedBy
      })),
      meta: {
        tenantId: scope.tenantId,
        branchId: scope.branchId,
        dateRange: scope.dateRange || null
      }
    };
  },

  async getPostingReviewDetail(invoiceId, context) {
    const normalizedId = requireInvoiceId(invoiceId);
    const invoice = await invoiceReadRepository.getInvoiceDetail(normalizedId, context.tenantId);
    if (!invoice) {
      throw createError("Invoice not found for tenant", 404, "INVOICE_NOT_FOUND");
    }

    return {
      ...invoice,
      postingReviewClosed: invoice.status !== "PENDING_POSTING_REVIEW"
    };
  },

  async getPostingReviewMapping(invoiceId, context, options = {}) {
    const normalizedId = requireInvoiceId(invoiceId);
    const invoice = await invoiceReadRepository.getInvoiceDetail(normalizedId, context.tenantId);

    if (!invoice) {
      throw createError("Invoice not found for tenant", 404, "INVOICE_NOT_FOUND");
    }

    const forceRefresh = Boolean(options.forceRefresh);

    const mapping = await tallyRuntimeService.getPostingMappingContext({
      tenantId: context.tenantId,
      invoice,
      forceRefresh
    });

    return {
      invoiceId: normalizedId,
      mapping
    };
  },

  async savePostingReviewMapping(invoiceId, context, payload = {}) {
    const normalizedId = requireInvoiceId(invoiceId);
    const invoice = await invoiceReadRepository.getInvoiceDetail(normalizedId, context.tenantId);

    if (!invoice) {
      throw createError("Invoice not found for tenant", 404, "INVOICE_NOT_FOUND");
    }

    const mappings = Array.isArray(payload.mappings) ? payload.mappings : [];
    const updatedBy =
      toOptionalString(payload.updated_by || payload.reviewed_by || payload.user_name) ||
      context.userId ||
      "Posting Reviewer";

    await tallyRuntimeService.savePostingFieldMappings({
      tenantId: context.tenantId,
      documentType: invoice.documentType,
      mappings,
      updatedBy
    });

    const mapping = await tallyRuntimeService.getPostingMappingContext({
      tenantId: context.tenantId,
      invoice,
      forceRefresh: false
    });

    return {
      invoiceId: normalizedId,
      mapping
    };
  },

  async approvePostingReview(invoiceId, context, payload = {}) {
    const normalizedId = requireInvoiceId(invoiceId);
    const reviewerName = toOptionalString(payload.reviewed_by || payload.reviewer_name || payload.approved_by) || "Posting Reviewer";
    const notes = toOptionalString(payload.notes);
    const editedPostingXml =
      toOptionalString(
        payload.posting_request_xml ||
        payload.postingRequestXml ||
        payload.voucherRequestXml ||
        payload.voucher_request_xml ||
        payload.tallyXml ||
        payload.tally_xml
      ) || null;
    const client = await invoicePostingRepository.getClient();

    try {
      await client.query("BEGIN");
      const invoice = await invoicePostingRepository.findById(normalizedId, context.tenantId, client);
      if (!invoice) {
        throw createError("Invoice not found for tenant", 404, "INVOICE_NOT_FOUND");
      }
      if (invoice.businessStatus !== "PENDING_POSTING_REVIEW") {
        throw createError(
          `Invoice is not pending posting review; current status: ${invoice.businessStatus}`,
          422,
          "INVALID_STATUS_TRANSITION"
        );
      }

      const approved = await invoicePostingRepository.approvePostingDraft(client, normalizedId, context.tenantId, {
        reviewedBy: reviewerName,
        notes,
        postingRequestXml: editedPostingXml
      });
      await client.query("COMMIT");

      const reviewDetail = await invoiceReadRepository.getInvoiceDetail(normalizedId, context.tenantId);
      const approvedData =
        (reviewDetail?.correctedJson && Object.keys(reviewDetail.correctedJson).length > 0)
          ? reviewDetail.correctedJson
          : (reviewDetail?.extractedJson || {});

      const n8n = await dispatchPostingWebhook({
        tenantId: context.tenantId,
        branchId: approved.branchId || context.branchId || null,
        invoiceId: approved.id,
        approvedBy: reviewerName,
        approvedData,
        voucherRequestXml: approved.postingRequestXml || editedPostingXml || null,
        forceAutoPost: true
      });

      return {
        ...approved,
        n8n
      };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  },

  async rejectPostingReview(invoiceId, context, payload = {}) {
    const normalizedId = requireInvoiceId(invoiceId);
    const reviewerName = toOptionalString(payload.reviewed_by || payload.reviewer_name || payload.rejected_by) || "Posting Reviewer";
    const notes = toOptionalString(payload.notes || payload.reason) || "Posting XML rejected during review";
    const client = await invoicePostingRepository.getClient();

    try {
      await client.query("BEGIN");
      const invoice = await invoicePostingRepository.findById(normalizedId, context.tenantId, client);
      if (!invoice) {
        throw createError("Invoice not found for tenant", 404, "INVOICE_NOT_FOUND");
      }
      if (invoice.businessStatus !== "PENDING_POSTING_REVIEW") {
        throw createError(
          `Invoice is not pending posting review; current status: ${invoice.businessStatus}`,
          422,
          "INVALID_STATUS_TRANSITION"
        );
      }

      const updated = await invoicePostingRepository.rejectPostingDraft(client, normalizedId, context.tenantId, {
        reviewedBy: reviewerName,
        notes
      });
      await client.query("COMMIT");
      return updated;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  },

  async retryPosting(invoiceId, context, payload = {}) {
    const normalizedId = requireInvoiceId(invoiceId);
    const requesterName =
      toOptionalString(payload.requested_by || payload.retry_by || payload.approved_by || payload.user_name) || "UI Retry";

    const client = await invoicePostingRepository.getClient();
    let invoiceForDispatch = null;

    try {
      await client.query("BEGIN");
      const invoice = await invoicePostingRepository.findById(normalizedId, context.tenantId, client);
      if (!invoice) {
        throw createError("Invoice not found for tenant", 404, "INVOICE_NOT_FOUND");
      }

      if (invoice.businessStatus === "POSTED") {
        throw createError("Posted invoice cannot be retried", 422, "INVALID_STATUS_TRANSITION");
      }
      if (invoice.businessStatus === "POSTING") {
        throw createError("Invoice is already posting", 409, "POSTING_IN_PROGRESS");
      }
      if (invoice.businessStatus === "PENDING_POSTING_REVIEW") {
        throw createError("Invoice is pending posting XML review; approve review before retry", 422, "REVIEW_REQUIRED");
      }
      if (invoice.businessStatus !== "APPROVED" && invoice.businessStatus !== "POST_FAILED") {
        throw createError(
          `Retry posting is not allowed from status ${invoice.businessStatus}`,
          422,
          "INVALID_STATUS_TRANSITION"
        );
      }

      if (invoice.businessStatus === "POST_FAILED") {
        const reset = await invoicePostingRepository.resetPostingFailureForRetry(client, normalizedId, context.tenantId);
        if (!reset) {
          throw createError("Unable to prepare invoice for retry posting", 409, "RETRY_PREPARE_FAILED");
        }
        invoiceForDispatch = reset;
      } else {
        invoiceForDispatch = invoice;
      }

      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }

    const detail = await invoiceReadRepository.getInvoiceDetail(normalizedId, context.tenantId);
    const approvedData =
      detail?.correctedJson && Object.keys(detail.correctedJson).length > 0
        ? detail.correctedJson
        : (detail?.extractedJson || {});

    const n8n = await dispatchPostingWebhook({
      tenantId: context.tenantId,
      branchId: invoiceForDispatch?.branchId || context.branchId || null,
      invoiceId: normalizedId,
      approvedBy: requesterName,
      approvedData,
      voucherRequestXml: invoiceForDispatch?.postingRequestXml || null,
      forceAutoPost: true
    });

    return {
      id: normalizedId,
      businessStatus: invoiceForDispatch?.businessStatus || "APPROVED",
      postingRequestXmlPresent: Boolean(invoiceForDispatch?.postingRequestXml),
      n8n
    };
  }
};
