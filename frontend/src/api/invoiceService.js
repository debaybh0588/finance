import { get, getBlob, patch, post, postMultipart } from "./client.js";

export const invoiceService = {
  getDashboard(tenantId, branchId, dateRange) {
    const params = new URLSearchParams();
    if (tenantId) params.set("tenantId", tenantId);
    if (branchId) params.set("branchId", branchId);
    if (dateRange) params.set("dateRange", dateRange);
    const query = params.toString();
    return get(`/dashboard/summary${query ? `?${query}` : ""}`);
  },

  listInvoices(params = {}) {
    const searchParams = new URLSearchParams();
    if (params.tenantId) searchParams.set("tenantId", params.tenantId);
    if (params.branchId) searchParams.set("branchId", params.branchId);
    if (params.search) searchParams.set("search", params.search);
    if (params.invoiceType) searchParams.set("invoiceType", params.invoiceType);
    if (params.status) searchParams.set("status", params.status);
    if (params.dateRange) searchParams.set("dateRange", params.dateRange);
    if (params.duplicateFlag) searchParams.set("duplicateFlag", params.duplicateFlag);
    if (params.extractionStatus) searchParams.set("extractionStatus", params.extractionStatus);
    const query = searchParams.toString();
    return get(`/invoices${query ? `?${query}` : ""}`);
  },

  getReviewQueue(params = {}) {
    return this.listInvoices({
      tenantId: params.tenantId,
      branchId: params.branchId,
      dateRange: params.dateRange,
      status: "PENDING_REVIEW"
    });
  },

  getReviewDetail(invoiceId) {
    return get(`/review/${invoiceId}`);
  },

  getReviewFileBlob(invoiceId) {
    return getBlob(`/review/${invoiceId}/file`);
  },

  updateReview(invoiceId, payload) {
    return patch(`/invoices/${invoiceId}/review`, payload);
  },

  approveInvoice(invoiceId, payload) {
    return post(`/invoices/${invoiceId}/approve`, payload);
  },

  bulkUploadInvoices(formData) {
    return postMultipart("/invoices/bulk-upload", formData);
  },

  rejectInvoice(invoiceId, payload) {
    return post(`/invoices/${invoiceId}/reject`, payload);
  },

  retryExtraction(invoiceId, payload = {}) {
    return post(`/invoices/${invoiceId}/extraction-retry`, payload);
  },

  getPostingOverview(tenantId, branchId, dateRange) {
    const params = new URLSearchParams();
    if (tenantId) params.set("tenantId", tenantId);
    if (branchId) params.set("branchId", branchId);
    if (dateRange) params.set("dateRange", dateRange);
    const query = params.toString();
    return get(`/posting/summary${query ? `?${query}` : ""}`);
  },

  getPostingReviewQueue(tenantId, branchId, dateRange) {
    const params = new URLSearchParams();
    if (tenantId) params.set("tenantId", tenantId);
    if (branchId) params.set("branchId", branchId);
    if (dateRange) params.set("dateRange", dateRange);
    const query = params.toString();
    return get(`/posting/review${query ? `?${query}` : ""}`);
  },

  getPostingReviewDetail(invoiceId) {
    return get(`/posting/review/${invoiceId}`);
  },

  approvePostingReview(invoiceId, payload) {
    return post(`/posting/review/${invoiceId}/approve`, payload);
  },

  rejectPostingReview(invoiceId, payload) {
    return post(`/posting/review/${invoiceId}/reject`, payload);
  },

  retryPosting(invoiceId, payload = {}) {
    return post(`/posting/${invoiceId}/retry`, payload);
  }
};
