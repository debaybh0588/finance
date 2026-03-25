import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { invoiceService } from "../api/invoiceService.js";
import { useAuth } from "../auth/AuthContext.jsx";
import PageState from "../components/PageState.jsx";
import TablePagination from "../components/TablePagination.jsx";

const statusClassMap = {
  REVIEW_REQUIRED: "status-pending",
  SUBMITTED: "status-uploaded",
  COMPLETED: "status-posted",
  FAILED: "status-failed"
};

const formatActorIdentity = (user) => {
  const fullName = String(user?.fullName || "").trim();
  const email = String(user?.email || "").trim();
  if (fullName && email) return `${fullName} <${email}>`;
  return fullName || email || "Reviewer";
};

function PostingPage() {
  const { selectedTenantId, selectedBranchId, selectedDateRange, user } = useAuth();
  const navigate = useNavigate();
  const [postingData, setPostingData] = useState(null);
  const [activeTab, setActiveTab] = useState("All");
  const [viewState, setViewState] = useState("loading");
  const [errorMessage, setErrorMessage] = useState("");
  const [actionMessage, setActionMessage] = useState("");
  const [actionError, setActionError] = useState("");
  const [actionBusyInvoiceId, setActionBusyInvoiceId] = useState(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const actorIdentity = formatActorIdentity(user);

  const loadPostingOverview = useCallback(async ({ silent = false } = {}) => {
    if (!selectedTenantId) {
      setPostingData({ items: [], tabs: [], summary: {} });
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
      const data = await invoiceService.getPostingOverview(selectedTenantId, selectedBranchId, selectedDateRange);
      setPostingData(data);
      setViewState("ready");
    } catch (error) {
      setErrorMessage(error.message || "Unable to load posting data.");
      setViewState("error");
    }
  }, [selectedTenantId, selectedBranchId, selectedDateRange]);

  useEffect(() => {
    loadPostingOverview();
  }, [loadPostingOverview]);

  useEffect(() => {
    if (!selectedTenantId) return undefined;
    const timer = setInterval(() => {
      loadPostingOverview({ silent: true });
    }, 15000);
    return () => clearInterval(timer);
  }, [selectedTenantId, loadPostingOverview]);

  const postingTabs = ["All", ...(postingData?.tabs || [])];
  const postingRows = postingData?.items || [];
  useEffect(() => {
    if (!postingTabs.includes(activeTab)) {
      setActiveTab("All");
    }
  }, [postingTabs, activeTab]);

  const filteredRows = postingRows.filter((row) => {
    if (activeTab === "All") return true;
    if (activeTab === "Review Required") return row.status === "REVIEW_REQUIRED";
    if (activeTab === "Submitted") return row.status === "SUBMITTED";
    if (activeTab === "Completed") return row.status === "COMPLETED";
    if (activeTab === "Failed") return row.status === "FAILED";
    return true;
  });
  const totalPages = Math.max(1, Math.ceil(filteredRows.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const pagedRows = filteredRows.slice((safePage - 1) * pageSize, safePage * pageSize);
  const summary = postingData?.summary || {
    awaitingPosting: 0,
    awaitingPostingReview: 0,
    currentlyPosting: 0,
    postedToday: 0,
    failedToday: 0
  };

  const onView = (row) => {
    if (row.postingStatus === "PENDING_POSTING_REVIEW") {
      navigate(`/posting/review/${row.id}`);
      return;
    }
    navigate(`/review-queue/${row.id}`);
  };

  const onOpenException = (row) => {
    if (row.postingStatus === "PENDING_POSTING_REVIEW") {
      navigate(`/posting/review/${row.id}`);
      return;
    }
    navigate(`/review-queue/${row.id}`);
  };

  const onOpenAudit = () => {
    navigate("/audit-log");
  };

  const onRetryPosting = async (row) => {
    setActionMessage("");
    setActionError("");
    setActionBusyInvoiceId(row.id);
    try {
      const data = await invoiceService.retryPosting(row.id, { requested_by: actorIdentity });
      if (data?.n8n?.dispatched) {
        setActionMessage(`Retry triggered for invoice ${row.id}.`);
      } else {
        const reason = data?.n8n?.skippedReason ? ` (${data.n8n.skippedReason})` : "";
        setActionMessage(`Retry queued, but dispatch was skipped${reason}.`);
      }
      await loadPostingOverview();
    } catch (error) {
      setActionError(error.message || "Unable to retry posting.");
    } finally {
      setActionBusyInvoiceId(null);
    }
  };

  useEffect(() => {
    setPage(1);
  }, [activeTab, pageSize, selectedTenantId, selectedBranchId, selectedDateRange]);

  useEffect(() => {
    if (page > totalPages) {
      setPage(totalPages);
    }
  }, [page, totalPages]);

  return (
    <section className="posting-page">
      <h2>Posting</h2>
      {actionMessage ? <p>{actionMessage}</p> : null}
      {actionError ? <p className="login-error">{actionError}</p> : null}

      {viewState === "loading" ? (
        <PageState title="Loading posting queue" description="Fetching posting jobs and Tally posting summary." />
      ) : null}

      {viewState === "error" ? (
        <PageState
          title="Posting data unavailable"
          description={errorMessage}
          actionLabel="Retry"
          onAction={loadPostingOverview}
          tone="error"
        />
      ) : null}

      {viewState === "ready" ? (
        <>

      <div className="posting-layout">
        <div className="posting-main">
          <div className="card posting-tabs-row">
            {postingTabs.map((tab, index) => (
              <button
                key={tab}
                type="button"
                className={activeTab === tab || (index === 0 && activeTab === "All") ? "posting-tab active" : "posting-tab"}
                onClick={() => setActiveTab(tab)}
              >
                {tab}
              </button>
            ))}
          </div>

          <article className="card posting-table-card">
            <div className="posting-table-wrap">
              <table className="posting-table">
                <thead>
                  <tr>
                    <th className="posting-actions-col">Actions</th>
                    <th>Status</th>
                    <th>Invoice Type</th>
                    <th>Party Name</th>
                    <th>Branch</th>
                    <th>Date</th>
                    <th>Amount</th>
                    <th>Draft Generated</th>
                    <th>Approved By</th>
                    <th>Posted By</th>
                    <th>Tally Voucher Type</th>
                    <th>Tally Voucher Number</th>
                    <th>Tally Response Summary</th>
                  </tr>
                </thead>
                <tbody>
                  {pagedRows.map((row) => (
                    <tr key={row.id}>
                      <td className="posting-actions-col">
                        <div className="posting-actions">
                          {row.postingStatus === "PENDING_POSTING_REVIEW" ? (
                            <Link to={`/posting/review/${row.id}`} className="posting-action-btn posting-action-btn-primary" title="Open posting XML review">
                              Review XML
                            </Link>
                          ) : (
                            <button type="button" className="posting-action-btn posting-action-btn-primary" onClick={() => onView(row)} title="View invoice detail">
                              View
                            </button>
                          )}
                          <button
                            type="button"
                            className="posting-action-btn"
                            onClick={() => onRetryPosting(row)}
                            title="Trigger posting retry"
                            disabled={actionBusyInvoiceId === row.id || !(row.postingStatus === "APPROVED" || row.postingStatus === "POST_FAILED")}
                          >
                            {actionBusyInvoiceId === row.id ? "Retrying..." : "Retry"}
                          </button>
                          <button type="button" className="posting-action-btn" onClick={() => onOpenException(row)} title="Open invoice exception details">
                            Exception
                          </button>
                          <button type="button" className="posting-action-btn" onClick={onOpenAudit} title="Open audit log">
                            Audit
                          </button>
                        </div>
                      </td>
                      <td>
                        <span className={`badge ${statusClassMap[row.status]}`}>{row.status}</span>
                      </td>
                      <td>{row.invoiceType}</td>
                      <td>{row.partyName}</td>
                      <td>{row.branch}</td>
                      <td>{row.date}</td>
                      <td>{row.amount.toLocaleString("en-IN")}</td>
                      <td>{row.postingDraftGeneratedAt ? new Date(row.postingDraftGeneratedAt).toLocaleString() : "-"}</td>
                      <td>{row.approvedBy}</td>
                      <td>{row.postedBy}</td>
                      <td>{row.voucherType}</td>
                      <td>{row.voucherNumber}</td>
                      <td>{row.responseSummary}</td>
                    </tr>
                  ))}
                  {pagedRows.length === 0 ? (
                    <tr>
                      <td colSpan={13} className="table-empty-row">No posting rows match current selection.</td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
            <TablePagination
              totalItems={filteredRows.length}
              page={safePage}
              pageSize={pageSize}
              onPageChange={setPage}
              onPageSizeChange={setPageSize}
            />
          </article>
        </div>

        <aside className="card posting-summary-card">
          <div className="card-title-row">
            <h3>Posting Summary</h3>
          </div>

          <div className="posting-summary-grid">
            <div>
              <span>Pending posting XML review</span>
              <strong>{summary.awaitingPostingReview}</strong>
            </div>
            <div>
              <span>Approved awaiting posting</span>
              <strong>{summary.awaitingPosting}</strong>
            </div>
            <div>
              <span>Currently posting</span>
              <strong>{summary.currentlyPosting}</strong>
            </div>
            <div>
              <span>Posted today</span>
              <strong>{summary.postedToday}</strong>
            </div>
            <div>
              <span>Failed today</span>
              <strong>{summary.failedToday}</strong>
            </div>
          </div>
        </aside>
      </div>
        </>
      ) : null}
    </section>
  );
}

export default PostingPage;
