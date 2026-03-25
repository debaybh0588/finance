import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { invoiceService } from "../api/invoiceService.js";
import { useAuth } from "../auth/AuthContext.jsx";
import PageState from "../components/PageState.jsx";

function PostingReviewDetailPage() {
  const { selectedTenantId, selectedBranchId, user } = useAuth();
  const { invoiceId } = useParams();
  const navigate = useNavigate();
  const [viewState, setViewState] = useState("loading");
  const [errorMessage, setErrorMessage] = useState("");
  const [actionMessage, setActionMessage] = useState("");
  const [actionError, setActionError] = useState("");
  const [actionBusy, setActionBusy] = useState(false);
  const [detail, setDetail] = useState(null);
  const [editableXml, setEditableXml] = useState("");
  const [reviewNotes, setReviewNotes] = useState("");
  const [previewBlobUrl, setPreviewBlobUrl] = useState("");
  const [previewBlobType, setPreviewBlobType] = useState("");

  const loadDetail = useCallback(async () => {
    if (!selectedTenantId) {
      setViewState("loading");
      return;
    }

    try {
      setViewState("loading");
      setErrorMessage("");
      const data = await invoiceService.getPostingReviewDetail(invoiceId);
      setDetail(data);
      setReviewNotes(data.postingRequestXmlReviewNotes || "");
      setEditableXml(data.postingRequestXml ? String(data.postingRequestXml) : "");
      setViewState("ready");
    } catch (error) {
      setErrorMessage(error.message || "Unable to load posting review detail.");
      setViewState("error");
    }
  }, [invoiceId, selectedTenantId]);

  useEffect(() => {
    loadDetail();
  }, [loadDetail]);

  useEffect(() => {
    let active = true;
    let objectUrl = "";

    const loadPreviewBlob = async () => {
      if (previewBlobUrl) {
        URL.revokeObjectURL(previewBlobUrl);
        setPreviewBlobUrl("");
      }
      setPreviewBlobType("");

      try {
        const blob = await invoiceService.getReviewFileBlob(invoiceId);
        if (!active) return;
        objectUrl = URL.createObjectURL(blob);
        setPreviewBlobUrl(objectUrl);
        setPreviewBlobType(blob.type || "");
      } catch {
        // keep preview empty when source file is not available
      }
    };

    loadPreviewBlob();

    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [invoiceId]);

  const previewUrl = detail?.originalFileUrl || previewBlobUrl || null;
  const mimeType = String(detail?.mimeType || previewBlobType || "").toLowerCase();
  const isPdf = mimeType === "application/pdf";
  const isImage = mimeType.startsWith("image/");

  const xmlText = useMemo(() => String(editableXml || ""), [editableXml]);
  const isPostingReviewActionAllowed = detail?.status === "PENDING_POSTING_REVIEW";
  const reviewerIdentity = useMemo(() => {
    const fullName = String(user?.fullName || "").trim();
    const email = String(user?.email || "").trim();
    if (fullName && email) return `${fullName} <${email}>`;
    return fullName || email || "Reviewer";
  }, [user?.fullName, user?.email]);

  const goToNextPostingReviewInvoice = async () => {
    const queue = await invoiceService.getPostingReviewQueue(selectedTenantId, selectedBranchId);
    const items = Array.isArray(queue?.items) ? queue.items : [];
    const nextInvoice = items.find((row) => row.id !== invoiceId) || null;

    if (nextInvoice?.id) {
      navigate(`/posting/review/${nextInvoice.id}`, { replace: true });
      return true;
    }

    navigate("/posting", { replace: true });
    return false;
  };

  const onApprove = async () => {
    if (!isPostingReviewActionAllowed) {
      setActionError(`Posting review is closed for status ${detail?.status || "-"}.`);
      return;
    }

    setActionBusy(true);
    setActionError("");
    setActionMessage("");
    try {
      const data = await invoiceService.approvePostingReview(invoiceId, {
        reviewed_by: reviewerIdentity,
        notes: reviewNotes,
        posting_request_xml: xmlText
      });
      if (data?.n8n?.dispatched) {
        setActionMessage("Posting XML approved and posting workflow triggered.");
      } else {
        const reason = data?.n8n?.skippedReason ? ` (${data.n8n.skippedReason})` : "";
        setActionMessage(`Posting XML approved, but workflow dispatch was skipped${reason}.`);
      }
      await goToNextPostingReviewInvoice();
    } catch (error) {
      setActionError(error.message || "Unable to approve posting XML.");
    } finally {
      setActionBusy(false);
    }
  };

  const onReject = async () => {
    if (!isPostingReviewActionAllowed) {
      setActionError(`Posting review is closed for status ${detail?.status || "-"}.`);
      return;
    }

    setActionBusy(true);
    setActionError("");
    setActionMessage("");
    try {
      await invoiceService.rejectPostingReview(invoiceId, {
        reviewed_by: reviewerIdentity,
        notes: reviewNotes || "Posting XML rejected in review"
      });
      setActionMessage("Posting XML rejected and invoice moved to NEEDS_CORRECTION.");
      await goToNextPostingReviewInvoice();
    } catch (error) {
      setActionError(error.message || "Unable to reject posting XML.");
    } finally {
      setActionBusy(false);
    }
  };

  if (viewState === "loading") {
    return (
      <section className="review-detail-page">
        <h2>Posting XML Review</h2>
        <PageState title="Loading posting review" description="Fetching posting XML and invoice context." />
      </section>
    );
  }

  if (viewState === "error") {
    return (
      <section className="review-detail-page">
        <h2>Posting XML Review</h2>
        <PageState title="Posting review unavailable" description={errorMessage} actionLabel="Retry" onAction={loadDetail} tone="error" />
      </section>
    );
  }

  return (
    <section className="review-detail-page">
      <h2>Posting XML Review</h2>
      {!isPostingReviewActionAllowed ? <p>Review actions are locked because invoice status is {detail?.status || "-"}.</p> : null}

      <div className="detail-layout">
        <article className="card document-panel">
          <div className="card-title-row">
            <h3>Original Invoice</h3>
          </div>

          <div className="document-canvas">
            {!previewUrl ? (
              <div className="document-page"><span>Preview unavailable</span></div>
            ) : isPdf ? (
              <iframe title="Invoice Preview" src={previewUrl} style={{ width: "100%", height: "100%", border: "none" }} />
            ) : isImage ? (
              <img src={previewUrl} alt="Invoice preview" style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }} />
            ) : (
              <div className="document-page"><span>Unsupported preview type</span></div>
            )}
          </div>

          <div className="document-hint">
            <p>{detail?.fileName || "-"} | {detail?.partyName || "-"} | {detail?.invoiceNumber || "-"}</p>
          </div>
        </article>

        <section className="detail-form-panel">
          <article className="card detail-section">
            <div className="card-title-row"><h3>Posting XML</h3></div>
            <textarea
              className="posting-xml-textarea"
              value={xmlText}
              onChange={(event) => setEditableXml(event.target.value)}
              rows={24}
              disabled={actionBusy || !isPostingReviewActionAllowed}
            />
          </article>

          <article className="card detail-section">
            <div className="card-title-row"><h3>Review Notes</h3></div>
            <textarea
              className="posting-xml-notes"
              value={reviewNotes}
              onChange={(event) => setReviewNotes(event.target.value)}
              placeholder="Add notes for audit trail"
              rows={4}
              disabled={actionBusy || !isPostingReviewActionAllowed}
            />
          </article>

          <footer className="detail-footer-actions">
            <button type="button" className="btn-approve" onClick={onApprove} disabled={actionBusy || !isPostingReviewActionAllowed || !xmlText.trim()}>
              Approve And Post
            </button>
            <button type="button" className="btn-reject" onClick={onReject} disabled={actionBusy || !isPostingReviewActionAllowed}>Reject</button>
          </footer>

          {actionMessage ? <p>{actionMessage}</p> : null}
          {actionError ? <p className="login-error">{actionError}</p> : null}
        </section>
      </div>
    </section>
  );
}

export default PostingReviewDetailPage;
