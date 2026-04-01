import { get } from "./client.js";

export const auditService = {
  listAuditLogs(tenantId, branchId, dateRange) {
    const params = new URLSearchParams();
    if (tenantId) params.set("tenantId", tenantId);
    if (branchId) params.set("branchId", branchId);
    if (dateRange && dateRange !== "all-time") params.set("dateRange", dateRange);
    const query = params.toString();
    return get(`/audit${query ? `?${query}` : ""}`);
  }
};
