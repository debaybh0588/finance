import { access } from "node:fs/promises";
import path from "node:path";
import { invoiceReadRepository } from "../repositories/invoiceReadRepository.js";

const formatDate = (value) => {
  if (!value) return "-";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "-" : date.toISOString().slice(0, 10);
};

const toUiInvoiceType = (documentType) => (documentType === "SALES_INVOICE" ? "Sales" : "Purchase");

const toOriginalFileUrl = (originalFilePath) => {
  if (typeof originalFilePath !== "string") return null;
  const trimmed = originalFilePath.trim();
  if (!trimmed) return null;
  return /^https?:\/\//i.test(trimmed) ? trimmed : null;
};

const createError = (message, statusCode, code) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
};

const toAbsolutePath = (filePath) => {
  if (typeof filePath !== "string") return null;
  const trimmed = filePath.trim();
  if (!trimmed) return null;
  return path.isAbsolute(trimmed) ? trimmed : path.resolve(process.cwd(), trimmed);
};

const normalizeDateRange = (value) => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed || null;
};

export const reviewService = {
  async queue(context, query) {
    const dateRange = normalizeDateRange(query?.dateRange);
    const rows = await invoiceReadRepository.listReviewQueue(context.tenantId, context.branchId, dateRange);
    const items = rows.map((row) => ({
      id: row.id,
      status: row.status,
      invoiceType: toUiInvoiceType(row.documentType),
      partyName: row.partyName,
      gstin: row.gstin,
      invoiceNumber: row.invoiceNumber,
      date: formatDate(row.invoiceDate),
      branch: row.branch,
      totalAmount: Number(row.totalAmount || 0),
      issuesCount: Number(row.issuesCount || 0),
      duplicateWarning: Boolean(row.isDuplicate)
    }));

    const previewSource = rows[0] || null;

    return {
      tabs: ["All", "Uploaded", "Extracting", "Pending Review", "Suspected Duplicates", "Needs Correction"],
      items,
      preview: previewSource
        ? {
            extractedData: {
              invoiceNumber: previewSource.extractedJson?.invoice_number || previewSource.invoiceNumber,
              invoiceDate: previewSource.extractedJson?.invoice_date || formatDate(previewSource.invoiceDate),
              partyName: previewSource.extractedJson?.party_name || previewSource.partyName,
              gstValues: previewSource.extractedJson?.gst_values || "-",
              totalAmount: String(previewSource.extractedJson?.total_amount || previewSource.totalAmount || "-")
            },
            warnings: Array.isArray(previewSource.warnings) ? previewSource.warnings : []
          }
        : {
            extractedData: {
              invoiceNumber: "-",
              invoiceDate: "-",
              partyName: "-",
              gstValues: "-",
              totalAmount: "-"
            },
            warnings: []
          },
      meta: {
        tenantId: context.tenantId,
        branchId: context.branchId,
        dateRange: dateRange || null,
        query
      }
    };
  },

  async getDetail(invoiceId, context) {
    const detail = await invoiceReadRepository.getInvoiceDetail(invoiceId, context.tenantId);
    if (!detail) {
      throw createError("Invoice not found for tenant", 404, "INVOICE_NOT_FOUND");
    }

    return {
      ...detail,
      originalFileUrl: toOriginalFileUrl(detail.originalFilePath)
    };
  },

  async getFile(invoiceId, context) {
    const detail = await invoiceReadRepository.getInvoiceDetail(invoiceId, context.tenantId);
    if (!detail) {
      throw createError("Invoice not found for tenant", 404, "INVOICE_NOT_FOUND");
    }

    const filePath = toAbsolutePath(detail.originalFilePath);
    if (!filePath) {
      throw createError("Original invoice file path is unavailable", 404, "FILE_NOT_FOUND");
    }

    if (/^https?:\/\//i.test(filePath)) {
      throw createError("Original invoice file is stored as remote URL", 422, "REMOTE_FILE_URL");
    }

    try {
      await access(filePath);
    } catch {
      throw createError("Original invoice file not found on server", 404, "FILE_NOT_FOUND");
    }

    return {
      path: filePath,
      mimeType: detail.mimeType || null,
      fileName: detail.fileName || path.basename(filePath)
    };
  },

  async update(invoiceId, context, payload = {}) {
    const updated = await invoiceReadRepository.updateReview(invoiceId, context.tenantId, {
      correctedJson: payload.corrected_json || {},
      notes: payload.notes || null
    }, context);

    if (!updated) {
      throw createError("Invoice not found for tenant", 404, "INVOICE_NOT_FOUND");
    }

    return updated;
  },

  async reject(invoiceId, context, payload = {}) {
    const rejected = await invoiceReadRepository.rejectInvoice(
      invoiceId,
      context.tenantId,
      context,
      payload.reason || "Rejected in review"
    );

    if (!rejected) {
      throw createError("Invoice not found for tenant", 404, "INVOICE_NOT_FOUND");
    }

    return rejected;
  }
};
