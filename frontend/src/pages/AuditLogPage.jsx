import { useEffect, useState } from "react";
import { auditService } from "../api/auditService.js";
import { useAuth } from "../auth/AuthContext.jsx";
import PageState from "../components/PageState.jsx";
import TablePagination from "../components/TablePagination.jsx";

const actionClassMap = {
  UPLOADED: "status-uploaded",
  EXTRACTION_COMPLETED: "status-extracting",
  EXTRACTION_RETRIED: "status-extracting",
  PARTIAL_EXTRACTION_RECORDED: "status-pending",
  REVIEW_UPDATED: "status-approved",
  APPROVED: "status-approved",
  REJECTED: "status-rejected",
  POSTING_STARTED: "status-posting",
  POSTED_TO_TALLY: "status-posted",
  POST_FAILED: "status-failed"
};

function AuditLogPage() {
  const { selectedTenantId, selectedBranchId, selectedDateRange, setDateRangeScope } = useAuth();
  const [auditData, setAuditData] = useState(null);
  const [viewState, setViewState] = useState("loading");
  const [errorMessage, setErrorMessage] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  const loadAuditLogs = async () => {
    try {
      setViewState("loading");
      setErrorMessage("");
      const data = await auditService.listAuditLogs(selectedTenantId, selectedBranchId, selectedDateRange);
      setAuditData(data);
      setViewState("ready");
    } catch (error) {
      setErrorMessage(error.message || "Unable to load audit logs.");
      setViewState("error");
    }
  };

  useEffect(() => {
    loadAuditLogs();
  }, [selectedTenantId, selectedBranchId, selectedDateRange]);

  const auditRows = auditData?.items || [];
  const filters = auditData?.filters || { tenants: [], branches: [], users: [], actions: [] };
  const totalPages = Math.max(1, Math.ceil(auditRows.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const pagedRows = auditRows.slice((safePage - 1) * pageSize, safePage * pageSize);

  useEffect(() => {
    setPage(1);
  }, [selectedTenantId, selectedBranchId, selectedDateRange, pageSize, auditRows.length]);

  useEffect(() => {
    if (page > totalPages) {
      setPage(totalPages);
    }
  }, [page, totalPages]);

  return (
    <section className="audit-page">
      <h2>Audit Log</h2>

      {viewState === "loading" ? (
        <PageState title="Loading audit log" description="Fetching audit events and filter metadata." />
      ) : null}

      {viewState === "error" ? (
        <PageState
          title="Audit log unavailable"
          description={errorMessage}
          actionLabel="Retry"
          onAction={loadAuditLogs}
          tone="error"
        />
      ) : null}

      {viewState === "ready" ? (
        <>

      <div className="card audit-filter-row">
        <select defaultValue={filters.tenants[0] || "all-tenants"} aria-label="Tenant filter">
          {filters.tenants.length === 0 ? <option value="all-tenants">All Tenants</option> : null}
          {filters.tenants.map((tenant) => (
            <option key={tenant} value={tenant}>
              {tenant}
            </option>
          ))}
        </select>

        <select defaultValue="all-branches" aria-label="Branch filter">
          <option value="all-branches">All Branches</option>
          {filters.branches.map((branch) => (
            <option key={branch} value={branch.toLowerCase()}>
              {branch}
            </option>
          ))}
        </select>

        <select defaultValue="all" aria-label="Invoice type filter">
          <option value="all">All</option>
          <option value="purchase">Purchase</option>
          <option value="sales">Sales</option>
        </select>

        <select defaultValue="all-actions" aria-label="Action type filter">
          <option value="all-actions">All Actions</option>
          {filters.actions.map((action) => (
            <option key={action} value={action}>
              {action}
            </option>
          ))}
        </select>

        <select
          value={selectedDateRange}
          aria-label="Date range filter"
          onChange={(event) => setDateRangeScope(event.target.value)}
        >
          <option value="all-time">All Time</option>
          <option value="today">Today</option>
          <option value="this-week">This Week</option>
          <option value="this-month">This Month</option>
          <option value="this-quarter">This Quarter</option>
        </select>

        <select defaultValue="all-users" aria-label="User filter">
          <option value="all-users">All Users</option>
          {filters.users.map((user) => (
            <option key={user} value={user.toLowerCase().replace(/\s+/g, "-")}>
              {user}
            </option>
          ))}
        </select>
      </div>

      <article className="card audit-table-card">
        <div className="audit-table-wrap">
          <table className="audit-table">
            <thead>
              <tr>
                <th>Timestamp</th>
                <th>Invoice Number</th>
                <th>Invoice Type</th>
                <th>Tenant</th>
                <th>Branch</th>
                <th>Action</th>
                <th>Performed By</th>
                <th>Old Value</th>
                <th>New Value</th>
                <th>Notes</th>
              </tr>
            </thead>
            <tbody>
              {pagedRows.map((row, idx) => (
                <tr key={`${row.invoiceNumber}-${idx}`}>
                  <td>{row.timestamp}</td>
                  <td>{row.invoiceNumber}</td>
                  <td>{row.invoiceType}</td>
                  <td>{row.tenant}</td>
                  <td>{row.branch}</td>
                  <td>
                    <span className={`badge ${actionClassMap[row.action]}`}>{row.action}</span>
                  </td>
                  <td>{row.performedBy}</td>
                  <td>{row.oldValue}</td>
                  <td>{row.newValue}</td>
                  <td>{row.notes}</td>
                </tr>
              ))}
              {pagedRows.length === 0 ? (
                <tr>
                  <td colSpan={10} className="table-empty-row">No audit events match current selection.</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
        <TablePagination
          totalItems={auditRows.length}
          page={safePage}
          pageSize={pageSize}
          onPageChange={setPage}
          onPageSizeChange={setPageSize}
        />
      </article>
        </>
      ) : null}
    </section>
  );
}

export default AuditLogPage;
