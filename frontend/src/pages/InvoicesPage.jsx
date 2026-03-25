import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { invoiceService } from "../api/invoiceService.js";
import { useAuth } from "../auth/AuthContext.jsx";
import BulkInvoiceUploadModal from "../components/BulkInvoiceUploadModal.jsx";
import PageState from "../components/PageState.jsx";
import TablePagination from "../components/TablePagination.jsx";

const statusClassMap = {
  UPLOADED: "status-uploaded",
  EXTRACTING: "status-extracting",
  PENDING_REVIEW: "status-pending",
  PENDING_POSTING_REVIEW: "status-pending",
  APPROVED: "status-approved",
  POSTING: "status-posting",
  POSTED: "status-posted",
  POST_FAILED: "status-failed",
  REJECTED: "status-rejected"
};

const extractionClassMap = {
  SUCCESS: "ex-success",
  PARTIAL: "ex-partial",
  RETRYABLE: "ex-retryable",
  FAILED: "ex-failed"
};

function InvoicesPage() {
  const { selectedTenantId, selectedBranchId, selectedDateRange, setDateRangeScope, tenants } = useAuth();
  const navigate = useNavigate();
  const [invoiceData, setInvoiceData] = useState(null);
  const [viewState, setViewState] = useState("loading");
  const [errorMessage, setErrorMessage] = useState("");
  const [searchText, setSearchText] = useState("");
  const [invoiceType, setInvoiceType] = useState("all");
  const [status, setStatus] = useState("all-status");
  const [duplicateFlag] = useState("all");
  const [extractionStatus] = useState("all");
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [actionMessage, setActionMessage] = useState("");
  const [actionError, setActionError] = useState("");
  const [actionBusyInvoiceId, setActionBusyInvoiceId] = useState(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  const loadInvoices = useCallback(async ({ silent = false } = {}) => {
    if (!selectedTenantId) {
      setInvoiceData({ items: [], filters: { tenants: [], branches: [] } });
      setViewState("ready");
      setErrorMessage("");
      return;
    }

    try {
      if (!silent) {
        setViewState("loading");
      }
      setErrorMessage("");
      setActionError("");
      const data = await invoiceService.listInvoices({
        tenantId: selectedTenantId,
        branchId: selectedBranchId,
        search: searchText.trim() || undefined,
        invoiceType: invoiceType !== "all" ? invoiceType : undefined,
        status: status !== "all-status" ? status : undefined,
        dateRange: selectedDateRange,
        duplicateFlag: duplicateFlag !== "all" ? duplicateFlag : undefined,
        extractionStatus: extractionStatus !== "all" ? extractionStatus : undefined
      });
      setInvoiceData(data);
      setViewState("ready");
    } catch (error) {
      setErrorMessage(error.message || "Unable to load invoices.");
      setViewState("error");
    }
  }, [selectedTenantId, selectedBranchId, selectedDateRange, searchText, invoiceType, status, duplicateFlag, extractionStatus]);

  useEffect(() => {
    loadInvoices();
  }, [loadInvoices]);

  useEffect(() => {
    if (!selectedTenantId) return undefined;
    const timer = setInterval(() => {
      loadInvoices({ silent: true });
    }, 15000);
    return () => clearInterval(timer);
  }, [selectedTenantId, loadInvoices]);

  const invoices = invoiceData?.items || [];
  const totalPages = Math.max(1, Math.ceil(invoices.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const pagedInvoices = invoices.slice((safePage - 1) * pageSize, safePage * pageSize);

  useEffect(() => {
    setPage(1);
  }, [searchText, invoiceType, status, selectedDateRange, selectedTenantId, selectedBranchId, pageSize]);

  useEffect(() => {
    if (page > totalPages) {
      setPage(totalPages);
    }
  }, [page, totalPages]);

  const onViewInvoice = (invoiceId) => {
    navigate(`/review-queue/${invoiceId}`);
  };

  const onReviewInvoice = (invoice) => {
    if (invoice.status === "PENDING_POSTING_REVIEW") {
      navigate(`/posting/review/${invoice.id}`);
      return;
    }
    navigate(`/review-queue/${invoice.id}`);
  };

  const onOpenAudit = () => {
    navigate("/audit-log");
  };

  const onRetryExtraction = async (invoice) => {
    setActionMessage("");
    setActionError("");
    setActionBusyInvoiceId(invoice.id);
    try {
      await invoiceService.retryExtraction(invoice.id, {});
      setActionMessage(`Extraction retry triggered for invoice ${invoice.invoiceNumber || invoice.id}.`);
      await loadInvoices();
    } catch (error) {
      setActionError(error.message || "Unable to retry extraction.");
    } finally {
      setActionBusyInvoiceId(null);
    }
  };

  return (
    <section className="invoices-page">
      <div className="invoices-header-row">
        <h2>Invoices</h2>
        <button type="button" className="invoices-upload-btn" onClick={() => setShowUploadModal(true)}>
          Upload Invoices
        </button>
      </div>
      {actionMessage ? <p>{actionMessage}</p> : null}
      {actionError ? <p className="login-error">{actionError}</p> : null}

      {viewState === "loading" ? (
        <PageState title="Loading invoices" description="Fetching invoice listing and filter metadata." />
      ) : null}

      {viewState === "error" ? (
        <PageState
          title="Invoices unavailable"
          description={errorMessage}
          actionLabel="Retry"
          onAction={loadInvoices}
          tone="error"
        />
      ) : null}

      {viewState === "ready" ? (
        <>
          <div className="card invoices-filter-row">
            <input
              type="search"
              placeholder="Search by name, invoice number, GSTIN..."
              aria-label="Search invoices"
              value={searchText}
              onChange={(event) => setSearchText(event.target.value)}
            />

            <select value={invoiceType} aria-label="Invoice type filter" onChange={(event) => setInvoiceType(event.target.value)}>
              <option value="all">All</option>
              <option value="purchase">Purchase</option>
              <option value="sales">Sales</option>
            </select>

            <select value={status} aria-label="Status filter" onChange={(event) => setStatus(event.target.value)}>
              <option value="all-status">All Statuses</option>
              <option value="UPLOADED">UPLOADED</option>
              <option value="EXTRACTING">EXTRACTING</option>
              <option value="PENDING_REVIEW">PENDING_REVIEW</option>
              <option value="APPROVED">APPROVED</option>
              <option value="PENDING_POSTING_REVIEW">PENDING_POSTING_REVIEW</option>
              <option value="POSTING">POSTING</option>
              <option value="POSTED">POSTED</option>
              <option value="POST_FAILED">POST_FAILED</option>
              <option value="REJECTED">REJECTED</option>
            </select>

            <select
              value={selectedDateRange}
              aria-label="Date range filter"
              onChange={(event) => setDateRangeScope(event.target.value)}
            >
              <option value="today">Today</option>
              <option value="this-week">This Week</option>
              <option value="this-month">This Month</option>
              <option value="this-quarter">This Quarter</option>
            </select>
          </div>

          <article className="card invoices-table-card">
            <div className="invoices-table-wrap">
              <table className="invoices-table">
                <thead>
                  <tr>
                    <th className="invoices-actions-col">Actions</th>
                    <th>Status</th>
                    <th>Invoice Type</th>
                    <th>Vendor/Customer Name + GSTIN</th>
                    <th>Invoice Number</th>
                    <th>Date</th>
                    <th>Branch</th>
                    <th>Total Amount</th>
                    <th>Extraction Status</th>
                    <th>Duplicate Flag</th>
                  </tr>
                </thead>

                <tbody>
                  {pagedInvoices.map((invoice) => (
                    <tr key={invoice.id}>
                      <td className="invoices-actions-col">
                        <div className="action-group">
                          <button type="button" className="invoice-action-btn invoice-action-btn-primary" onClick={() => onViewInvoice(invoice.id)} title="View invoice detail">
                            View
                          </button>
                          <button type="button" className="invoice-action-btn invoice-action-btn-primary" onClick={() => onReviewInvoice(invoice)} title="Open review page">
                            Review
                          </button>
                          <button
                            type="button"
                            className="invoice-action-btn"
                            onClick={() => onRetryExtraction(invoice)}
                            title="Retry extraction"
                            disabled={
                              actionBusyInvoiceId === invoice.id ||
                              !["FAILED", "RETRYABLE", "PARTIAL"].includes(String(invoice.extractionStatus || "").toUpperCase())
                            }
                          >
                            {actionBusyInvoiceId === invoice.id ? "Retrying..." : "Retry"}
                          </button>
                          <button type="button" className="invoice-action-btn" onClick={onOpenAudit} title="Open audit log">
                            Audit
                          </button>
                        </div>
                      </td>
                      <td>
                        <span className={`badge status-badge ${statusClassMap[invoice.status]}`}>{invoice.status}</span>
                      </td>
                      <td>{invoice.invoiceType}</td>
                      <td>
                        <div className="party-cell">
                          <strong>{invoice.partyName}</strong>
                          <span>{invoice.gstin}</span>
                        </div>
                      </td>
                      <td>{invoice.invoiceNumber}</td>
                      <td>{invoice.date}</td>
                      <td>{invoice.branch}</td>
                      <td>{invoice.totalAmount.toLocaleString("en-IN")}</td>
                      <td>
                        <span className={`badge extraction-badge ${extractionClassMap[invoice.extractionStatus]}`}>
                          {invoice.extractionStatus}
                        </span>
                      </td>
                      <td>
                        <span className={invoice.duplicateFlag === "Yes" ? "duplicate-yes" : "duplicate-no"}>
                          {invoice.duplicateFlag}
                        </span>
                      </td>
                    </tr>
                  ))}
                  {pagedInvoices.length === 0 ? (
                    <tr>
                      <td colSpan={10} className="table-empty-row">No invoices match current filters.</td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
            <TablePagination
              totalItems={invoices.length}
              page={safePage}
              pageSize={pageSize}
              onPageChange={setPage}
              onPageSizeChange={setPageSize}
            />
          </article>
        </>
      ) : null}

      <BulkInvoiceUploadModal
        isOpen={showUploadModal}
        onClose={() => setShowUploadModal(false)}
        tenants={tenants}
        defaultTenantId={selectedTenantId}
        defaultBranchId={selectedBranchId}
        onUploadComplete={loadInvoices}
      />
    </section>
  );
}

export default InvoicesPage;
