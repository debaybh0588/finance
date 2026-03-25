import { Link } from "react-router-dom";
import { useCallback, useEffect, useMemo, useState } from "react";
import { invoiceService } from "../api/invoiceService.js";
import { useAuth } from "../auth/AuthContext.jsx";
import PageState from "../components/PageState.jsx";
import TablePagination from "../components/TablePagination.jsx";

const statusClassMap = {
  UPLOADED: "status-uploaded",
  EXTRACTING: "status-extracting",
  PENDING_REVIEW: "status-pending",
  NEEDS_CORRECTION: "status-pending"
};

const toWarningText = (warning) => {
  if (typeof warning === "string" || typeof warning === "number") {
    return String(warning);
  }

  if (warning && typeof warning === "object") {
    const reason = warning.reason ?? warning.message ?? warning.error;
    const key = warning.key ?? warning.field ?? warning.code;

    if (key && reason) return `${key}: ${reason}`;
    if (reason) return String(reason);
    if (key) return String(key);
  }

  return "Unknown warning";
};

const toWarningKey = (warning, index) => {
  if (warning && typeof warning === "object") {
    const key = warning.key ?? warning.field ?? warning.code ?? "warning";
    const reason = warning.reason ?? warning.message ?? warning.error ?? index;
    return `${key}-${reason}-${index}`;
  }

  return `${String(warning)}-${index}`;
};

function ReviewQueuePage() {
  const { selectedTenantId, selectedBranchId, selectedDateRange, user } = useAuth();
  const [reviewData, setReviewData] = useState(null);
  const [selectedInvoiceId, setSelectedInvoiceId] = useState(null);
  const [viewState, setViewState] = useState("loading");
  const [errorMessage, setErrorMessage] = useState("");
  const [activeTab, setActiveTab] = useState("all");
  const [actionMessage, setActionMessage] = useState("");
  const [actionError, setActionError] = useState("");
  const [actionBusy, setActionBusy] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  const loadReviewQueue = useCallback(async ({ silent = false } = {}) => {
    if (!selectedTenantId) {
      setReviewData({ items: [] });
      setSelectedInvoiceId(null);
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
      const data = await invoiceService.getReviewQueue({
        tenantId: selectedTenantId,
        branchId: selectedBranchId,
        dateRange: selectedDateRange
      });
      setReviewData(data);
      const firstId = data?.items?.[0]?.id || null;
      setSelectedInvoiceId((prev) => (prev && data?.items?.some((item) => item.id === prev) ? prev : firstId));
      setViewState("ready");
    } catch (error) {
      setErrorMessage(error.message || "Unable to load review queue.");
      setViewState("error");
    }
  }, [selectedTenantId, selectedBranchId, selectedDateRange]);

  useEffect(() => {
    loadReviewQueue();
  }, [loadReviewQueue]);

  useEffect(() => {
    if (!selectedTenantId) return undefined;
    const timer = setInterval(() => {
      loadReviewQueue({ silent: true });
    }, 15000);
    return () => clearInterval(timer);
  }, [selectedTenantId, loadReviewQueue]);

  const queueRows = reviewData?.items || [];
  const filteredQueueRows = useMemo(() => {
    if (activeTab === "pending") {
      return queueRows.filter((row) => row.status === "PENDING_REVIEW");
    }
    if (activeTab === "needs-correction") {
      return queueRows.filter((row) => row.status === "NEEDS_CORRECTION");
    }
    return queueRows;
  }, [activeTab, queueRows]);
  const totalPages = Math.max(1, Math.ceil(filteredQueueRows.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const pagedQueueRows = filteredQueueRows.slice((safePage - 1) * pageSize, safePage * pageSize);
  const selectedRow = filteredQueueRows.find((row) => row.id === selectedInvoiceId) || filteredQueueRows[0] || null;
  const extractedJson = selectedRow?.extractedJson || {};
  const extractedData = {
    invoiceNumber: extractedJson.invoice_number || extractedJson.invoiceNumber || selectedRow?.invoiceNumber || "-",
    invoiceDate: extractedJson.invoice_date || extractedJson.invoiceDate || selectedRow?.date || "-",
    partyName: extractedJson.party_name || extractedJson.partyName || selectedRow?.partyName || "-",
    gstValues: extractedJson.gst_values || extractedJson.gstValues || selectedRow?.gstin || "-",
    totalAmount: selectedRow ? selectedRow.totalAmount.toLocaleString("en-IN") : "-"
  };
  const warnings = Array.isArray(selectedRow?.warnings)
    ? selectedRow.warnings
    : selectedRow?.warnings
      ? [selectedRow.warnings]
      : [];
  const reviewerIdentity = useMemo(() => {
    const fullName = String(user?.fullName || "").trim();
    const email = String(user?.email || "").trim();
    if (fullName && email) return `${fullName} <${email}>`;
    return fullName || email || "Reviewer";
  }, [user?.fullName, user?.email]);
  const canTakeReviewAction = Boolean(selectedRow) && ["PENDING_REVIEW", "NEEDS_CORRECTION"].includes(selectedRow.status);
  const tabItems = [
    { key: "all", label: "All", count: queueRows.length },
    { key: "pending", label: "Pending Review", count: queueRows.filter((row) => row.status === "PENDING_REVIEW").length },
    { key: "needs-correction", label: "Needs Correction", count: queueRows.filter((row) => row.status === "NEEDS_CORRECTION").length }
  ];

  const onApproveFromQueue = async () => {
    if (!selectedRow || !canTakeReviewAction) return;
    setActionBusy("approve");
    setActionMessage("");
    setActionError("");
    try {
      await invoiceService.approveInvoice(selectedRow.id, {
        approved_by: reviewerIdentity,
        corrected_json: selectedRow.extractedJson || {}
      });
      setActionMessage(`Approved invoice ${selectedRow.invoiceNumber || selectedRow.id}.`);
      await loadReviewQueue({ silent: true });
    } catch (error) {
      setActionError(error.message || "Unable to approve invoice.");
    } finally {
      setActionBusy("");
    }
  };

  const onRejectFromQueue = async () => {
    if (!selectedRow || !canTakeReviewAction) return;
    setActionBusy("reject");
    setActionMessage("");
    setActionError("");
    try {
      await invoiceService.rejectInvoice(selectedRow.id, {
        reason: "Rejected from review queue"
      });
      setActionMessage(`Rejected invoice ${selectedRow.invoiceNumber || selectedRow.id}.`);
      await loadReviewQueue({ silent: true });
    } catch (error) {
      setActionError(error.message || "Unable to reject invoice.");
    } finally {
      setActionBusy("");
    }
  };

  useEffect(() => {
    setPage(1);
  }, [selectedTenantId, selectedBranchId, selectedDateRange, pageSize, queueRows.length, activeTab]);

  useEffect(() => {
    if (page > totalPages) {
      setPage(totalPages);
    }
  }, [page, totalPages]);

  useEffect(() => {
    if (pagedQueueRows.length === 0) {
      setSelectedInvoiceId(null);
      return;
    }

    if (!pagedQueueRows.some((row) => row.id === selectedInvoiceId)) {
      setSelectedInvoiceId(pagedQueueRows[0].id);
    }
  }, [selectedInvoiceId, pagedQueueRows]);

  return (
    <section className="review-page">
      <h2>Review Queue</h2>
      {actionMessage ? <p>{actionMessage}</p> : null}
      {actionError ? <p className="login-error">{actionError}</p> : null}

      {viewState === "loading" ? (
        <PageState title="Loading review queue" description="Fetching queued invoices and extraction preview." />
      ) : null}

      {viewState === "error" ? (
        <PageState
          title="Review queue unavailable"
          description={errorMessage}
          actionLabel="Retry"
          onAction={loadReviewQueue}
          tone="error"
        />
      ) : null}

      {viewState === "ready" && queueRows.length === 0 ? (
        <PageState
          title="Review queue is empty"
          description="There are no invoices waiting for manual review right now."
          actionLabel="Refresh"
          onAction={loadReviewQueue}
        />
      ) : null}

      {viewState === "ready" && queueRows.length > 0 ? (
        <>

      <div className="card review-tabs-row">
        {tabItems.map((tab) => (
          <button
            key={tab.key}
            type="button"
            className={activeTab === tab.key ? "review-tab active" : "review-tab"}
            onClick={() => setActiveTab(tab.key)}
          >
            {`${tab.label} (${tab.count})`}
          </button>
        ))}
      </div>

      <div className="review-layout">
        <article className="card review-table-card">
          <div className="review-table-wrap">
            <table className="review-table">
              <thead>
                <tr>
                  <th className="review-actions-col">Action</th>
                  <th>Status</th>
                  <th>Invoice Type</th>
                  <th>Party Name + GSTIN</th>
                  <th>Invoice Number</th>
                  <th>Date</th>
                  <th>Branch</th>
                  <th>Total Amount</th>
                  <th>Issues Count</th>
                  <th>Duplicate Warning</th>
                </tr>
              </thead>
              <tbody>
                {pagedQueueRows.map((row) => (
                  <tr key={row.id} onClick={() => setSelectedInvoiceId(row.id)}>
                    <td className="review-actions-col">
                      <Link to={`/review-queue/${row.id}`} className="review-action-btn" title="Open invoice review">
                        Open Review
                      </Link>
                    </td>
                    <td>
                      <span className={`badge status-badge ${statusClassMap[row.status]}`}>{row.status}</span>
                    </td>
                    <td>{row.invoiceType}</td>
                    <td>
                      <div className="party-cell">
                        <strong>{row.partyName}</strong>
                        <span>{row.gstin}</span>
                      </div>
                    </td>
                    <td>{row.invoiceNumber}</td>
                    <td>{row.date}</td>
                    <td>{row.branch}</td>
                    <td>{row.totalAmount.toLocaleString("en-IN")}</td>
                    <td>
                      <span className={row.issuesCount > 3 ? "issues-high" : "issues-medium"}>{row.issuesCount}</span>
                    </td>
                    <td>
                      <span className={row.duplicateWarning ? "duplicate-yes" : "duplicate-no"}>
                        {row.duplicateWarning ? "Yes" : "No"}
                      </span>
                    </td>
                  </tr>
                ))}
                {pagedQueueRows.length === 0 ? (
                  <tr>
                    <td colSpan={10}>No invoices in this tab.</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
          <TablePagination
            totalItems={filteredQueueRows.length}
            page={safePage}
            pageSize={pageSize}
            onPageChange={setPage}
            onPageSizeChange={setPageSize}
          />
        </article>

        <aside className="card preview-card">
          <div className="card-title-row">
            <h3>Extraction Preview</h3>
          </div>

          <section className="preview-section">
            <h4>Extracted Data</h4>
            <dl className="preview-data-grid">
              <div>
                <dt>Invoice Number</dt>
                <dd>{extractedData.invoiceNumber}</dd>
              </div>
              <div>
                <dt>Invoice Date</dt>
                <dd>{extractedData.invoiceDate}</dd>
              </div>
              <div>
                <dt>Party Name</dt>
                <dd>{extractedData.partyName}</dd>
              </div>
              <div>
                <dt>GST Values</dt>
                <dd>{extractedData.gstValues}</dd>
              </div>
              <div>
                <dt>Total Amount</dt>
                <dd>{extractedData.totalAmount}</dd>
              </div>
            </dl>
          </section>

          <section className="preview-section">
            <h4>Validation Warnings</h4>
            <ul className="warning-list">
              {warnings.length === 0 ? <li>No warnings</li> : null}
              {warnings.map((warning, index) => (
                <li key={toWarningKey(warning, index)}>{toWarningText(warning)}</li>
              ))}
            </ul>
          </section>

          <section className="preview-section">
            <h4>Review Signals</h4>
            <dl className="preview-data-grid">
              <div>
                <dt>Duplicate Warning</dt>
                <dd>{selectedRow?.duplicateWarning ? "Yes" : "No"}</dd>
              </div>
              <div>
                <dt>Extraction Status</dt>
                <dd>{selectedRow?.extractionStatus || "-"}</dd>
              </div>
              <div>
                <dt>Confidence Score</dt>
                <dd>{selectedRow?.confidenceScore === null || selectedRow?.confidenceScore === undefined ? "-" : selectedRow.confidenceScore}</dd>
              </div>
            </dl>
          </section>

          <div className="preview-actions">
            <button type="button" className="btn-neutral" onClick={() => setSelectedInvoiceId(pagedQueueRows[0]?.id || null)}>
              Cancel
            </button>
            <button
              type="button"
              className="btn-approve"
              onClick={onApproveFromQueue}
              disabled={!canTakeReviewAction || actionBusy === "approve"}
            >
              {actionBusy === "approve" ? "Approving..." : "Approve"}
            </button>
            <button
              type="button"
              className="btn-reject"
              onClick={onRejectFromQueue}
              disabled={!canTakeReviewAction || actionBusy === "reject"}
            >
              {actionBusy === "reject" ? "Rejecting..." : "Reject"}
            </button>
          </div>
        </aside>
      </div>
        </>
      ) : null}
    </section>
  );
}

export default ReviewQueuePage;
