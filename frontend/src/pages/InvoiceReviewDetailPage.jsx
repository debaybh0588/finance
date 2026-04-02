import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { invoiceService } from "../api/invoiceService.js";
import { useAuth } from "../auth/AuthContext.jsx";
import PageState from "../components/PageState.jsx";

const LOW_CONFIDENCE_THRESHOLD = 0.88;
const CALC_MISMATCH_EPSILON = 1;

const FIELD_ALIASES = {
  documentType: ["document_type", "invoice_type"],
  invoiceNumber: ["invoice_number"],
  invoiceDate: ["invoice_date"],
  dueDate: ["due_date"],
  partyName: ["party_name", "vendor_name", "customer_name"],
  partyGstin: ["party_gstin", "gstin"],
  partyAddress: ["party_address", "address"],
  currency: ["currency"],
  subtotal: ["subtotal"],
  taxableAmount: ["taxable_amount", "taxable_value"],
  cgstAmount: ["cgst_amount", "cgst"],
  sgstAmount: ["sgst_amount", "sgst"],
  igstAmount: ["igst_amount", "igst"],
  cessAmount: ["cess_amount", "cess"],
  roundOffAmount: ["round_off_amount", "round_off"],
  totalAmount: ["total_amount", "grand_total", "invoice_total"]
};

const normalizeKey = (value) => String(value ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");

const toNumber = (value) => {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const cleaned = String(value).replace(/,/g, "").replace(/[\u20B9]/g, "").trim();
  if (!cleaned) return null;
  const num = Number(cleaned);
  return Number.isNaN(num) ? null : num;
};

const normalizeConfidence = (value) => {
  const num = toNumber(value);
  if (num === null) return null;
  return num > 1 ? num / 100 : num;
};

const formatAmount = (value) => {
  const num = toNumber(value);
  if (num === null) return "-";
  return num.toLocaleString("en-IN", { maximumFractionDigits: 2 });
};

const asArray = (value) => (Array.isArray(value) ? value : value ? [value] : []);

const toWarningText = (warning) => {
  if (typeof warning === "string" || typeof warning === "number") return String(warning);
  if (warning && typeof warning === "object") {
    const key = warning.key ?? warning.field ?? warning.code;
    const reason = warning.reason ?? warning.message ?? warning.error;
    if (key && reason) return `${key}: ${reason}`;
    if (reason) return String(reason);
    if (key) return String(key);
  }
  return "Unknown warning";
};

const toWarningKey = (warning, index) => {
  if (warning && typeof warning === "object") {
    return `${warning.key ?? warning.field ?? "warning"}-${warning.reason ?? warning.message ?? index}-${index}`;
  }
  return `${String(warning)}-${index}`;
};

const toApprovalWebhookMessage = (n8n) => {
  if (!n8n || typeof n8n !== "object") return "Invoice approved.";
  if (n8n.dispatched) return "Invoice approved. Posting webhook triggered.";

  const suffixParts = [];
  if (n8n.responseStatus) suffixParts.push(`HTTP ${n8n.responseStatus}`);
  if (n8n.skippedReason) suffixParts.push(n8n.skippedReason);
  if (n8n.error) suffixParts.push(n8n.error);
  const suffix = suffixParts.length > 0 ? ` (${suffixParts.join(" | ")})` : "";

  if (n8n.attempted) {
    return `Invoice approved, but posting webhook failed${suffix}.`;
  }

  return `Invoice approved, but posting webhook was skipped${suffix}.`;
};

const pickByAliases = (source, aliases) => {
  if (!source || typeof source !== "object") return null;
  const wanted = new Set((aliases || []).map(normalizeKey));
  for (const [key, value] of Object.entries(source)) {
    if (!wanted.has(normalizeKey(key))) continue;
    if (value === null || value === undefined || value === "") continue;
    return value;
  }
  return null;
};

const normalizeLineItem = (row, index) => {
  if (!row || typeof row !== "object") return null;
  const taxableAmount = toNumber(row.taxableAmount ?? row.taxable_amount ?? row.amount ?? row.value);
  const cgst = toNumber(row.cgst ?? row.cgst_amount);
  const sgst = toNumber(row.sgst ?? row.sgst_amount);
  const igst = toNumber(row.igst ?? row.igst_amount);
  const derivedTax = [cgst, sgst, igst].reduce((sum, value) => sum + (value ?? 0), 0);
  const tax = toNumber(row.tax ?? row.tax_amount ?? row.gst) ?? derivedTax;
  const total = toNumber(row.total ?? row.total_amount ?? row.line_total) ?? (taxableAmount === null ? null : taxableAmount + tax);

  const item = {
    lineNo: Math.max(1, Math.round(toNumber(row.lineNo ?? row.line_no ?? row.sl_no ?? row.sr_no ?? index + 1) ?? index + 1)),
    description: row.description ?? row.item_description ?? row.particulars ?? row.item ?? "-",
    hsn: row.hsn ?? row.hsn_sac ?? row.hsn_code ?? "-",
    quantity: toNumber(row.quantity ?? row.qty),
    uom: row.uom ?? row.unit ?? row.uqc ?? "-",
    rate: toNumber(row.rate ?? row.unit_rate ?? row.unitPrice),
    taxableAmount,
    cgst,
    sgst,
    igst,
    tax,
    total
  };

  const hasData = item.description !== "-" || item.hsn !== "-" || item.rate !== null || item.taxableAmount !== null || item.total !== null;
  return hasData ? item : null;
};

const toRows = (value) => {
  if (Array.isArray(value)) return value.filter((item) => item && typeof item === "object");
  if (value && typeof value === "object") {
    const keys = Object.keys(value);
    const numeric = keys.length > 0 && keys.every((key) => /^\d+$/.test(key));
    if (numeric) {
      return keys.sort((a, b) => Number(a) - Number(b)).map((key) => value[key]).filter((item) => item && typeof item === "object");
    }
    return [value];
  }
  return [];
};

const extractLineItemsFallback = (extractedJson) => {
  const candidateKeys = ["line_items", "lineItems", "items", "invoice_items", "invoiceLines", "products", "rows", "details"];
  const rows = [];
  candidateKeys.forEach((key) => rows.push(...toRows(extractedJson?.[key])));

  const normalized = rows.map((row, index) => normalizeLineItem(row, index)).filter(Boolean);
  const seen = new Set();
  return normalized.filter((item) => {
    const signature = JSON.stringify([
      item.description,
      item.hsn,
      item.quantity,
      item.rate,
      item.taxableAmount,
      item.cgst,
      item.sgst,
      item.igst,
      item.tax,
      item.total
    ]);
    if (seen.has(signature)) return false;
    seen.add(signature);
    return true;
  });
};

const createLineItemId = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const toEditableLineItem = (item, index = 0) => ({
  id: createLineItemId(),
  lineNo: String(item?.lineNo ?? index + 1),
  description: item?.description && item.description !== "-" ? String(item.description) : "",
  hsn: item?.hsn && item.hsn !== "-" ? String(item.hsn) : "",
  quantity: item?.quantity === null || item?.quantity === undefined ? "" : String(item.quantity),
  uom: item?.uom && item.uom !== "-" ? String(item.uom) : "",
  rate: item?.rate === null || item?.rate === undefined ? "" : String(item.rate),
  taxableAmount: item?.taxableAmount === null || item?.taxableAmount === undefined ? "" : String(item.taxableAmount),
  cgst: item?.cgst === null || item?.cgst === undefined ? "" : String(item.cgst),
  sgst: item?.sgst === null || item?.sgst === undefined ? "" : String(item.sgst),
  igst: item?.igst === null || item?.igst === undefined ? "" : String(item.igst),
  tax: item?.tax === null || item?.tax === undefined ? "" : String(item.tax),
  total: item?.total === null || item?.total === undefined ? "" : String(item.total)
});

function InvoiceReviewDetailPage() {
  const { selectedTenantId, selectedBranchId, user } = useAuth();
  const { reviewId } = useParams();
  const navigate = useNavigate();

  const [viewState, setViewState] = useState("loading");
  const [errorMessage, setErrorMessage] = useState("");
  const [saveMessage, setSaveMessage] = useState("");
  const [actionError, setActionError] = useState("");
  const [actionInProgress, setActionInProgress] = useState(false);
  const [detail, setDetail] = useState(null);
  const [form, setForm] = useState({});
  const [previewZoom, setPreviewZoom] = useState(1);
  const [previewBlobUrl, setPreviewBlobUrl] = useState("");
  const [previewBlobType, setPreviewBlobType] = useState("");
  const [previewFetchError, setPreviewFetchError] = useState("");
  const [allowMismatchApproval, setAllowMismatchApproval] = useState(false);
  const [editableLineItems, setEditableLineItems] = useState([]);
  const reviewerIdentity = useMemo(() => {
    const fullName = String(user?.fullName || "").trim();
    const email = String(user?.email || "").trim();
    if (fullName && email) return `${fullName} <${email}>`;
    return fullName || email || "Reviewer";
  }, [user?.fullName, user?.email]);

  const loadDetail = useCallback(async () => {
    if (!selectedTenantId) {
      setViewState("loading");
      return;
    }

    try {
      setViewState("loading");
      setErrorMessage("");
      const data = await invoiceService.getReviewDetail(reviewId);
      setDetail(data);
      setPreviewZoom(1);
      setAllowMismatchApproval(false);
      setForm({
        documentType: data.documentType || "PURCHASE_INVOICE",
        invoiceNumber: data.invoiceNumber || "",
        invoiceDate: data.invoiceDate ? String(data.invoiceDate).slice(0, 10) : "",
        dueDate: data.dueDate ? String(data.dueDate).slice(0, 10) : "",
        branch: data.branchName || "",
        partyName: data.partyName || "",
        partyGstin: data.partyGstin || "",
        partyAddress: data.partyAddress || "",
        currency: data.currency || "INR",
        subtotal: String(data.subtotal ?? ""),
        taxableAmount: String(data.taxableAmount ?? ""),
        cgstAmount: String(data.cgstAmount ?? ""),
        sgstAmount: String(data.sgstAmount ?? ""),
        igstAmount: String(data.igstAmount ?? ""),
        cessAmount: String(data.cessAmount ?? ""),
        roundOffAmount: String(data.roundOffAmount ?? ""),
        totalAmount: String(data.totalAmount ?? "")
      });
      setViewState("ready");
    } catch (error) {
      setErrorMessage(error.message || "Unable to load invoice detail.");
      setViewState("error");
    }
  }, [reviewId, selectedTenantId]);

  useEffect(() => {
    loadDetail();
  }, [loadDetail, selectedBranchId]);

  useEffect(() => {
    let active = true;
    let objectUrl = "";

    const loadPreviewBlob = async () => {
      setPreviewFetchError("");
      setPreviewBlobType("");
      if (previewBlobUrl) {
        URL.revokeObjectURL(previewBlobUrl);
        setPreviewBlobUrl("");
      }

      if (!detail?.originalFilePath || detail?.originalFileUrl) return;

      try {
        const blob = await invoiceService.getReviewFileBlob(reviewId);
        if (!active) return;
        objectUrl = URL.createObjectURL(blob);
        setPreviewBlobUrl(objectUrl);
        setPreviewBlobType(blob.type || "");
      } catch (error) {
        if (!active) return;
        setPreviewFetchError(error.message || "Unable to load preview from server.");
      }
    };

    loadPreviewBlob();

    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [reviewId, detail?.originalFilePath, detail?.originalFileUrl]);

  const extractedJson = useMemo(() => (detail?.extractedJson && typeof detail.extractedJson === "object" ? detail.extractedJson : {}), [detail?.extractedJson]);

  const sourceLineItems = useMemo(() => {
    const primary = Array.isArray(detail?.lineItems) ? detail.lineItems.map((item, index) => normalizeLineItem(item, index)).filter(Boolean) : [];
    return primary.length > 0 ? primary : extractLineItemsFallback(extractedJson);
  }, [detail?.lineItems, extractedJson]);

  useEffect(() => {
    const next = sourceLineItems.map((item, index) => toEditableLineItem(item, index));
    setEditableLineItems(next.length > 0 ? next : [toEditableLineItem(null, 0)]);
  }, [detail?.id, sourceLineItems]);

  const normalizedLineItems = useMemo(
    () =>
      editableLineItems
        .map((row, index) => {
          const lineNo = Math.max(1, Math.round(toNumber(row.lineNo) ?? index + 1));
          const description = String(row.description || "").trim();
          const hsn = String(row.hsn || "").trim();
          const quantity = toNumber(row.quantity);
          const uom = String(row.uom || "").trim();
          const rate = toNumber(row.rate);
          const taxableAmount = toNumber(row.taxableAmount);
          const cgst = toNumber(row.cgst);
          const sgst = toNumber(row.sgst);
          const igst = toNumber(row.igst);
          const tax = toNumber(row.tax);
          const total = toNumber(row.total);

          const hasData =
            description !== "" ||
            hsn !== "" ||
            quantity !== null ||
            rate !== null ||
            taxableAmount !== null ||
            cgst !== null ||
            sgst !== null ||
            igst !== null ||
            tax !== null ||
            total !== null;

          if (!hasData) return null;

          return {
            line_no: lineNo,
            description: description || null,
            hsn: hsn || null,
            quantity,
            uom: uom || null,
            rate,
            taxable_amount: taxableAmount,
            cgst,
            sgst,
            igst,
            tax,
            total_amount: total
          };
        })
        .filter(Boolean),
    [editableLineItems]
  );

  const lowConfidenceSet = useMemo(() => {
    const set = new Set();
    asArray(detail?.lowConfidenceFields).forEach((entry) => {
      if (typeof entry === "string") {
        set.add(normalizeKey(entry));
      } else if (entry && typeof entry === "object") {
        const key = entry.key ?? entry.field ?? entry.name;
        if (typeof key === "string") set.add(normalizeKey(key));
      }
    });
    return set;
  }, [detail?.lowConfidenceFields]);

  const fieldConfidenceMap = useMemo(() => {
    const map = new Map();
    const source = extractedJson?.field_confidence && typeof extractedJson.field_confidence === "object"
      ? extractedJson.field_confidence
      : extractedJson?.confidence_by_field && typeof extractedJson.confidence_by_field === "object"
        ? extractedJson.confidence_by_field
        : null;

    if (source) {
      Object.entries(source).forEach(([field, value]) => {
        const confidence = normalizeConfidence(value?.confidence ?? value?.score ?? value);
        if (confidence !== null) map.set(normalizeKey(field), confidence);
      });
    }

    return map;
  }, [extractedJson]);

  const fieldMeta = (formKey) => {
    const aliases = FIELD_ALIASES[formKey] || [];
    const extractedValue = pickByAliases(extractedJson, aliases);
    let confidence = null;

    aliases.forEach((alias) => {
      const normalized = normalizeKey(alias);
      if (confidence === null && fieldConfidenceMap.has(normalized)) {
        confidence = fieldConfidenceMap.get(normalized);
      }
    });

    const isLow = aliases.some((alias) => lowConfidenceSet.has(normalizeKey(alias))) || (confidence !== null && confidence < LOW_CONFIDENCE_THRESHOLD);

    return {
      extractedText: extractedValue === null || extractedValue === undefined || extractedValue === "" ? "-" : typeof extractedValue === "object" ? JSON.stringify(extractedValue) : String(extractedValue),
      confidenceLabel: confidence === null ? (isLow ? "Low confidence" : null) : `${Math.round(confidence * 100)}% confidence`,
      isLow
    };
  };

  const lineFieldMeta = (index, fieldKey) => {
    const candidates = [
      `line_items[${index}].${fieldKey}`,
      `lineitems[${index}].${fieldKey}`,
      `line_items.${index}.${fieldKey}`,
      `lineitems.${index}.${fieldKey}`,
      `line_item_${index}_${fieldKey}`
    ];

    let confidence = null;
    for (const candidate of candidates) {
      const normalized = normalizeKey(candidate);
      if (fieldConfidenceMap.has(normalized)) {
        confidence = fieldConfidenceMap.get(normalized);
        break;
      }
    }

    if (fieldKey === "tax" && confidence === null) {
      const taxParts = ["cgst", "sgst", "igst"].map((key) => {
        const taxCandidates = [
          `line_items[${index}].${key}`,
          `lineitems[${index}].${key}`,
          `line_items.${index}.${key}`,
          `lineitems.${index}.${key}`,
          `line_item_${index}_${key}`
        ];
        for (const candidate of taxCandidates) {
          const normalized = normalizeKey(candidate);
          if (fieldConfidenceMap.has(normalized)) return fieldConfidenceMap.get(normalized);
        }
        return null;
      }).filter((value) => value !== null);

      if (taxParts.length > 0) {
        const sum = taxParts.reduce((acc, value) => acc + value, 0);
        confidence = sum / taxParts.length;
      }
    }

    const isLow =
      candidates.some((candidate) => lowConfidenceSet.has(normalizeKey(candidate))) ||
      (confidence !== null && confidence < LOW_CONFIDENCE_THRESHOLD);

    return {
      isLow,
      confidenceLabel: confidence === null ? (isLow ? "Low confidence" : null) : `${Math.round(confidence * 100)}% confidence`
    };
  };

  const correctedJson = useMemo(
    () => ({
      document_type: form.documentType,
      invoice_number: form.invoiceNumber,
      invoice_date: form.invoiceDate,
      due_date: form.dueDate,
      party_name: form.partyName,
      party_gstin: form.partyGstin,
      party_address: form.partyAddress,
      currency: form.currency,
      subtotal: form.subtotal,
      taxable_amount: form.taxableAmount,
      cgst_amount: form.cgstAmount,
      sgst_amount: form.sgstAmount,
      igst_amount: form.igstAmount,
      cess_amount: form.cessAmount,
      round_off_amount: form.roundOffAmount,
      total_amount: form.totalAmount,
      line_items: normalizedLineItems
    }),
    [form, normalizedLineItems]
  );

  const calculationSummary = useMemo(() => {
    const subtotal = toNumber(form.subtotal);
    const taxableAmount = toNumber(form.taxableAmount);
    const cgstAmount = toNumber(form.cgstAmount) ?? 0;
    const sgstAmount = toNumber(form.sgstAmount) ?? 0;
    const igstAmount = toNumber(form.igstAmount) ?? 0;
    const cessAmount = toNumber(form.cessAmount) ?? 0;
    const roundOffAmount = toNumber(form.roundOffAmount) ?? 0;
    const totalAmount = toNumber(form.totalAmount);

    const baseAmount = taxableAmount ?? subtotal;
    const expectedHeaderTotal =
      baseAmount === null ? null : Number((baseAmount + cgstAmount + sgstAmount + igstAmount + cessAmount + roundOffAmount).toFixed(2));

    const lineTaxable = normalizedLineItems.reduce((sum, item) => sum + (toNumber(item.taxable_amount) ?? 0), 0);
    const lineTotal = normalizedLineItems.reduce((sum, item) => sum + (toNumber(item.total_amount) ?? 0), 0);
    const hasLines = normalizedLineItems.length > 0;

    const messages = [];
    if (expectedHeaderTotal !== null && totalAmount !== null && Math.abs(expectedHeaderTotal - totalAmount) > CALC_MISMATCH_EPSILON) {
      messages.push(`Header total mismatch: entered ${formatAmount(totalAmount)} vs expected ${formatAmount(expectedHeaderTotal)}.`);
    }
    if (hasLines && taxableAmount !== null && Math.abs(lineTaxable - taxableAmount) > CALC_MISMATCH_EPSILON) {
      messages.push(`Taxable mismatch: line taxable sum ${formatAmount(lineTaxable)} vs header taxable ${formatAmount(taxableAmount)}.`);
    }
    if (hasLines && totalAmount !== null && Math.abs(lineTotal - totalAmount) > CALC_MISMATCH_EPSILON) {
      messages.push(`Line total mismatch: line total ${formatAmount(lineTotal)} vs header total ${formatAmount(totalAmount)}.`);
    }

    return {
      hasMismatch: messages.length > 0,
      messages,
      probableTaxable: hasLines ? lineTaxable : null,
      probableTotal: expectedHeaderTotal ?? (hasLines ? lineTotal : null)
    };
  }, [form, normalizedLineItems]);

  const warnings = asArray(detail?.warnings);
  const mimeType = (detail?.mimeType || previewBlobType || "").toLowerCase();
  const previewUrl = detail?.originalFileUrl || previewBlobUrl || null;
  const isPdf = mimeType === "application/pdf";
  const isImage = mimeType.startsWith("image/") && ["image/jpeg", "image/jpg", "image/png", "image/webp"].includes(mimeType);

  const updateField = (key) => (event) => setForm((prev) => ({ ...prev, [key]: event.target.value }));

  const updateLineItemField = (id, key) => (event) => {
    const nextValue = event.target.value;
    setEditableLineItems((prev) => prev.map((row) => (row.id === id ? { ...row, [key]: nextValue } : row)));
  };

  const addLineItem = () => {
    setEditableLineItems((prev) => [...prev, toEditableLineItem(null, prev.length)]);
  };

  const removeLineItem = (id) => {
    setEditableLineItems((prev) => {
      const next = prev.filter((row) => row.id !== id);
      return next.length > 0 ? next : [toEditableLineItem(null, 0)];
    });
  };

  const renderFieldMeta = (key) => {
    const meta = fieldMeta(key);
    return (
      <>
        <span className="field-extracted-text">Extracted: {meta.extractedText}</span>
        {meta.confidenceLabel ? <span className={`field-confidence-tag${meta.isLow ? " low" : ""}`}>{meta.confidenceLabel}</span> : null}
      </>
    );
  };

  const applyProbableFix = () => {
    setForm((prev) => ({
      ...prev,
      ...(calculationSummary.probableTaxable !== null ? { taxableAmount: String(Number(calculationSummary.probableTaxable.toFixed(2))) } : {}),
      ...(calculationSummary.probableTotal !== null ? { totalAmount: String(Number(calculationSummary.probableTotal.toFixed(2))) } : {})
    }));
  };

  const isReviewActionAllowed = detail?.status === "PENDING_REVIEW" || detail?.status === "NEEDS_CORRECTION";

  const goToNextReviewInvoice = async () => {
    const queue = await invoiceService.getReviewQueue({
      tenantId: selectedTenantId,
      branchId: selectedBranchId
    });
    const items = Array.isArray(queue?.items) ? queue.items : [];
    const nextInvoice = items.find((row) => row.id !== reviewId) || null;

    if (nextInvoice?.id) {
      navigate(`/review-queue/${nextInvoice.id}`, { replace: true });
      return true;
    }

    navigate("/review-queue", { replace: true });
    return false;
  };

  const onSaveDraft = async () => {
    if (!isReviewActionAllowed) {
      setActionError(`Invoice is in ${detail?.status || "current"} status and cannot be edited.`);
      return;
    }
    setSaveMessage("");
    setActionError("");
    setActionInProgress(true);
    try {
      await invoiceService.updateReview(reviewId, {
        corrected_json: correctedJson,
        notes: "Saved draft"
      });
      setSaveMessage("Draft saved.");
      await loadDetail();
    } catch (error) {
      setActionError(error.message || "Unable to save draft.");
    } finally {
      setActionInProgress(false);
    }
  };

  const onApprove = async () => {
    if (!isReviewActionAllowed) {
      setActionError(`Invoice is in ${detail?.status || "current"} status and cannot be approved.`);
      return;
    }

    setSaveMessage("");
    setActionError("");

    if (calculationSummary.hasMismatch && !allowMismatchApproval) {
      setActionError("Calculation mismatch found. Tick the override checkbox to approve anyway.");
      return;
    }

    setActionInProgress(true);
    try {
      const approvalResult = await invoiceService.approveInvoice(reviewId, {
        approved_by: reviewerIdentity,
        corrected_json: correctedJson,
        allow_calculation_mismatch: calculationSummary.hasMismatch && allowMismatchApproval
      });
      setSaveMessage(toApprovalWebhookMessage(approvalResult?.n8n));
      await goToNextReviewInvoice();
    } catch (error) {
      setActionError(error.message || "Unable to approve invoice.");
    } finally {
      setActionInProgress(false);
    }
  };

  const onReject = async () => {
    if (!isReviewActionAllowed) {
      setActionError(`Invoice is in ${detail?.status || "current"} status and cannot be rejected.`);
      return;
    }

    setSaveMessage("");
    setActionError("");
    setActionInProgress(true);
    try {
      await invoiceService.rejectInvoice(reviewId, {
        reason: "Rejected from review UI"
      });
      setSaveMessage("Invoice rejected.");
      await goToNextReviewInvoice();
    } catch (error) {
      setActionError(error.message || "Unable to reject invoice.");
    } finally {
      setActionInProgress(false);
    }
  };

  const onZoomIn = () => setPreviewZoom((prev) => Math.min(prev + 0.1, 3));
  const onZoomOut = () => setPreviewZoom((prev) => Math.max(prev - 0.1, 0.5));
  const onResetZoom = () => setPreviewZoom(1);
  const onOpenNewTab = () => {
    if (!previewUrl) return;
    window.open(previewUrl, "_blank", "noopener,noreferrer");
  };

  if (viewState === "loading") {
    return (
      <section className="review-detail-page">
        <h2>Invoice Review Detail</h2>
        <PageState title="Loading invoice detail" description="Fetching review payload." />
      </section>
    );
  }

  if (viewState === "error") {
    return (
      <section className="review-detail-page">
        <h2>Invoice Review Detail</h2>
        <PageState title="Invoice detail unavailable" description={errorMessage} actionLabel="Retry" onAction={loadDetail} tone="error" />
      </section>
    );
  }

  return (
    <section className="review-detail-page">
      <h2>Invoice Review Detail</h2>
      {!isReviewActionAllowed ? <p>Review actions are locked because invoice status is {detail?.status || "-"}.</p> : null}

      <div className="detail-layout">
        <article className="card document-panel">
          <div className="card-title-row">
            <h3>Document Preview</h3>
          </div>

          <div className="detail-footer-actions" style={{ marginTop: 0, marginBottom: "0.75rem" }}>
            <button type="button" className="btn-neutral" onClick={onZoomIn}>Zoom In</button>
            <button type="button" className="btn-neutral" onClick={onZoomOut}>Zoom Out</button>
            <button type="button" className="btn-neutral" onClick={onResetZoom}>Reset Zoom</button>
            <button type="button" className="btn-neutral" onClick={onOpenNewTab} disabled={!previewUrl}>Open in New Tab</button>
          </div>

          <div className="document-canvas">
            {!previewUrl ? (
              <div className="document-page">
                <span>{previewFetchError || "Preview unavailable"}</span>
              </div>
            ) : isPdf ? (
              <iframe
                title="Invoice PDF Preview"
                src={previewUrl}
                style={{
                  width: "100%",
                  height: "100%",
                  border: "none",
                  transform: `scale(${previewZoom})`,
                  transformOrigin: "center top"
                }}
              />
            ) : isImage ? (
              <img
                src={previewUrl}
                alt={detail?.fileName || "Invoice document preview"}
                style={{
                  maxWidth: "100%",
                  maxHeight: "100%",
                  transform: `scale(${previewZoom})`,
                  transformOrigin: "center top",
                  objectFit: "contain"
                }}
              />
            ) : (
              <div className="document-page">
                <span>Unsupported file type</span>
              </div>
            )}
          </div>

          <div className="document-hint">
            <p>
              {detail?.fileName || "-"} | {detail?.mimeType || previewBlobType || "unknown"} | Source: {detail?.originalFilePath || "-"}
            </p>
          </div>
        </article>

        <section className="detail-form-panel">
          <article className="card detail-section">
            <div className="card-title-row"><h3>Header Information</h3></div>
            <div className="detail-grid six-col">
              <label>
                Document Type
                <select value={form.documentType || "PURCHASE_INVOICE"} onChange={updateField("documentType")} className={fieldMeta("documentType").isLow ? "low-confidence-input" : ""}>
                  <option value="PURCHASE_INVOICE">Purchase</option>
                  <option value="SALES_INVOICE">Sales</option>
                </select>
                {renderFieldMeta("documentType")}
              </label>
              <label>
                Invoice Number
                <input value={form.invoiceNumber || ""} onChange={updateField("invoiceNumber")} className={fieldMeta("invoiceNumber").isLow ? "low-confidence-input" : ""} />
                {renderFieldMeta("invoiceNumber")}
              </label>
              <label>
                Invoice Date
                <input value={form.invoiceDate || ""} onChange={updateField("invoiceDate")} className={fieldMeta("invoiceDate").isLow ? "low-confidence-input" : ""} />
                {renderFieldMeta("invoiceDate")}
              </label>
              <label>
                Due Date
                <input value={form.dueDate || ""} onChange={updateField("dueDate")} className={fieldMeta("dueDate").isLow ? "low-confidence-input" : ""} />
                {renderFieldMeta("dueDate")}
              </label>
              <label>
                Branch
                <select value={form.branch || ""} disabled>
                  <option value={form.branch || ""}>{form.branch || "-"}</option>
                </select>
              </label>
            </div>
          </article>

          <article className="card detail-section">
            <div className="card-title-row"><h3>Party Information</h3></div>
            <div className="detail-grid three-col">
              <label>
                Vendor/Customer Name
                <input value={form.partyName || ""} onChange={updateField("partyName")} className={fieldMeta("partyName").isLow ? "low-confidence-input" : ""} />
                {renderFieldMeta("partyName")}
              </label>
              <label>
                GSTIN
                <input value={form.partyGstin || ""} onChange={updateField("partyGstin")} className={fieldMeta("partyGstin").isLow ? "low-confidence-input" : ""} />
                {renderFieldMeta("partyGstin")}
              </label>
              <label className="full-span">
                Address
                <input value={form.partyAddress || ""} onChange={updateField("partyAddress")} className={fieldMeta("partyAddress").isLow ? "low-confidence-input" : ""} />
                {renderFieldMeta("partyAddress")}
              </label>
            </div>
          </article>

          <article className="card detail-section">
            <div className="card-title-row"><h3>Amounts</h3></div>
            <div className="detail-grid seven-col">
              <label>
                Currency
                <input value={form.currency || ""} onChange={updateField("currency")} className={fieldMeta("currency").isLow ? "low-confidence-input" : ""} />
                {renderFieldMeta("currency")}
              </label>
              <label>
                Subtotal
                <input value={form.subtotal || ""} onChange={updateField("subtotal")} className={fieldMeta("subtotal").isLow ? "low-confidence-input" : ""} />
                {renderFieldMeta("subtotal")}
              </label>
              <label>
                Taxable Amount
                <input value={form.taxableAmount || ""} onChange={updateField("taxableAmount")} className={fieldMeta("taxableAmount").isLow ? "low-confidence-input" : ""} />
                {renderFieldMeta("taxableAmount")}
              </label>
              <label>
                CGST
                <input value={form.cgstAmount || ""} onChange={updateField("cgstAmount")} className={fieldMeta("cgstAmount").isLow ? "low-confidence-input" : ""} />
                {renderFieldMeta("cgstAmount")}
              </label>
              <label>
                SGST
                <input value={form.sgstAmount || ""} onChange={updateField("sgstAmount")} className={fieldMeta("sgstAmount").isLow ? "low-confidence-input" : ""} />
                {renderFieldMeta("sgstAmount")}
              </label>
              <label>
                IGST
                <input value={form.igstAmount || ""} onChange={updateField("igstAmount")} className={fieldMeta("igstAmount").isLow ? "low-confidence-input" : ""} />
                {renderFieldMeta("igstAmount")}
              </label>
              <label>
                Cess
                <input value={form.cessAmount || ""} onChange={updateField("cessAmount")} className={fieldMeta("cessAmount").isLow ? "low-confidence-input" : ""} />
                {renderFieldMeta("cessAmount")}
              </label>
              <label>
                Round Off
                <input value={form.roundOffAmount || ""} onChange={updateField("roundOffAmount")} className={fieldMeta("roundOffAmount").isLow ? "low-confidence-input" : ""} />
                {renderFieldMeta("roundOffAmount")}
              </label>
              <label>
                Total
                <input value={form.totalAmount || ""} onChange={updateField("totalAmount")} className={fieldMeta("totalAmount").isLow ? "low-confidence-input" : ""} />
                {renderFieldMeta("totalAmount")}
              </label>
            </div>
          </article>

          <article className="card detail-section">
            <div className="card-title-row">
              <h3>Line Items</h3>
              <button type="button" className="btn-neutral line-item-add-btn" onClick={addLineItem} disabled={actionInProgress || !isReviewActionAllowed}>
                Add Line Item
              </button>
            </div>
            <div className="detail-table-wrap">
              <table className="detail-table">
                <thead>
                  <tr>
                    <th>Line No</th>
                    <th>Description</th>
                    <th>HSN/SAC</th>
                    <th>Quantity</th>
                    <th>UOM</th>
                    <th>Rate</th>
                    <th>Taxable Amount</th>
                    <th>CGST</th>
                    <th>SGST</th>
                    <th>IGST</th>
                    <th>Tax</th>
                    <th>Total</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {editableLineItems.length === 0 ? (
                    <tr><td colSpan={13}>No line items available</td></tr>
                  ) : (
                    editableLineItems.map((item, index) => (
                      <tr key={item.id}>
                        <td>
                          {(() => {
                            const meta = lineFieldMeta(index, "line_no");
                            return (
                              <>
                          <input
                            type="number"
                            min="1"
                            className={`detail-line-input${meta.isLow ? " low-confidence-input" : ""}`}
                            value={item.lineNo}
                            onChange={updateLineItemField(item.id, "lineNo")}
                            disabled={actionInProgress}
                          />
                                {meta.confidenceLabel ? <span className={`field-confidence-tag${meta.isLow ? " low" : ""}`}>{meta.confidenceLabel}</span> : null}
                              </>
                            );
                          })()}
                        </td>
                        <td>
                          {(() => {
                            const meta = lineFieldMeta(index, "description");
                            return (
                              <>
                          <input
                            type="text"
                            className={`detail-line-input${meta.isLow ? " low-confidence-input" : ""}`}
                            value={item.description}
                            onChange={updateLineItemField(item.id, "description")}
                            disabled={actionInProgress}
                          />
                                {meta.confidenceLabel ? <span className={`field-confidence-tag${meta.isLow ? " low" : ""}`}>{meta.confidenceLabel}</span> : null}
                              </>
                            );
                          })()}
                        </td>
                        <td>
                          {(() => {
                            const meta = lineFieldMeta(index, "hsn");
                            return (
                              <>
                          <input
                            type="text"
                            className={`detail-line-input${meta.isLow ? " low-confidence-input" : ""}`}
                            value={item.hsn}
                            onChange={updateLineItemField(item.id, "hsn")}
                            disabled={actionInProgress}
                          />
                                {meta.confidenceLabel ? <span className={`field-confidence-tag${meta.isLow ? " low" : ""}`}>{meta.confidenceLabel}</span> : null}
                              </>
                            );
                          })()}
                        </td>
                        <td>
                          {(() => {
                            const meta = lineFieldMeta(index, "quantity");
                            return (
                              <>
                          <input
                            type="number"
                            step="any"
                            className={`detail-line-input${meta.isLow ? " low-confidence-input" : ""}`}
                            value={item.quantity}
                            onChange={updateLineItemField(item.id, "quantity")}
                            disabled={actionInProgress}
                          />
                                {meta.confidenceLabel ? <span className={`field-confidence-tag${meta.isLow ? " low" : ""}`}>{meta.confidenceLabel}</span> : null}
                              </>
                            );
                          })()}
                        </td>
                        <td>
                          {(() => {
                            const meta = lineFieldMeta(index, "uom");
                            return (
                              <>
                          <input
                            type="text"
                            className={`detail-line-input${meta.isLow ? " low-confidence-input" : ""}`}
                            value={item.uom}
                            onChange={updateLineItemField(item.id, "uom")}
                            disabled={actionInProgress}
                          />
                                {meta.confidenceLabel ? <span className={`field-confidence-tag${meta.isLow ? " low" : ""}`}>{meta.confidenceLabel}</span> : null}
                              </>
                            );
                          })()}
                        </td>
                        <td>
                          {(() => {
                            const meta = lineFieldMeta(index, "rate");
                            return (
                              <>
                          <input
                            type="number"
                            step="any"
                            className={`detail-line-input${meta.isLow ? " low-confidence-input" : ""}`}
                            value={item.rate}
                            onChange={updateLineItemField(item.id, "rate")}
                            disabled={actionInProgress}
                          />
                                {meta.confidenceLabel ? <span className={`field-confidence-tag${meta.isLow ? " low" : ""}`}>{meta.confidenceLabel}</span> : null}
                              </>
                            );
                          })()}
                        </td>
                        <td>
                          {(() => {
                            const meta = lineFieldMeta(index, "taxable_amount");
                            return (
                              <>
                          <input
                            type="number"
                            step="any"
                            className={`detail-line-input${meta.isLow ? " low-confidence-input" : ""}`}
                            value={item.taxableAmount}
                            onChange={updateLineItemField(item.id, "taxableAmount")}
                            disabled={actionInProgress}
                          />
                                {meta.confidenceLabel ? <span className={`field-confidence-tag${meta.isLow ? " low" : ""}`}>{meta.confidenceLabel}</span> : null}
                              </>
                            );
                          })()}
                        </td>
                        <td>
                          {(() => {
                            const meta = lineFieldMeta(index, "cgst");
                            return (
                              <>
                          <input
                            type="number"
                            step="any"
                            className={`detail-line-input${meta.isLow ? " low-confidence-input" : ""}`}
                            value={item.cgst}
                            onChange={updateLineItemField(item.id, "cgst")}
                            disabled={actionInProgress}
                          />
                                {meta.confidenceLabel ? <span className={`field-confidence-tag${meta.isLow ? " low" : ""}`}>{meta.confidenceLabel}</span> : null}
                              </>
                            );
                          })()}
                        </td>
                        <td>
                          {(() => {
                            const meta = lineFieldMeta(index, "sgst");
                            return (
                              <>
                          <input
                            type="number"
                            step="any"
                            className={`detail-line-input${meta.isLow ? " low-confidence-input" : ""}`}
                            value={item.sgst}
                            onChange={updateLineItemField(item.id, "sgst")}
                            disabled={actionInProgress}
                          />
                                {meta.confidenceLabel ? <span className={`field-confidence-tag${meta.isLow ? " low" : ""}`}>{meta.confidenceLabel}</span> : null}
                              </>
                            );
                          })()}
                        </td>
                        <td>
                          {(() => {
                            const meta = lineFieldMeta(index, "igst");
                            return (
                              <>
                          <input
                            type="number"
                            step="any"
                            className={`detail-line-input${meta.isLow ? " low-confidence-input" : ""}`}
                            value={item.igst}
                            onChange={updateLineItemField(item.id, "igst")}
                            disabled={actionInProgress}
                          />
                                {meta.confidenceLabel ? <span className={`field-confidence-tag${meta.isLow ? " low" : ""}`}>{meta.confidenceLabel}</span> : null}
                              </>
                            );
                          })()}
                        </td>
                        <td>
                          {(() => {
                            const meta = lineFieldMeta(index, "tax");
                            return (
                              <>
                          <input
                            type="number"
                            step="any"
                            className={`detail-line-input${meta.isLow ? " low-confidence-input" : ""}`}
                            value={item.tax}
                            onChange={updateLineItemField(item.id, "tax")}
                            disabled={actionInProgress}
                          />
                                {meta.confidenceLabel ? <span className={`field-confidence-tag${meta.isLow ? " low" : ""}`}>{meta.confidenceLabel}</span> : null}
                              </>
                            );
                          })()}
                        </td>
                        <td>
                          {(() => {
                            const meta = lineFieldMeta(index, "total_amount");
                            return (
                              <>
                          <input
                            type="number"
                            step="any"
                            className={`detail-line-input${meta.isLow ? " low-confidence-input" : ""}`}
                            value={item.total}
                            onChange={updateLineItemField(item.id, "total")}
                            disabled={actionInProgress}
                          />
                                {meta.confidenceLabel ? <span className={`field-confidence-tag${meta.isLow ? " low" : ""}`}>{meta.confidenceLabel}</span> : null}
                              </>
                            );
                          })()}
                        </td>
                        <td className="line-item-row-actions">
                          <button
                            type="button"
                            className="btn-reject"
                            onClick={() => removeLineItem(item.id)}
                            disabled={actionInProgress || editableLineItems.length <= 1}
                          >
                            Remove
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </article>

          <article className={`card detail-section${calculationSummary.hasMismatch ? " calc-mismatch-section" : ""}`}>
            <div className="card-title-row"><h3>Calculation Check</h3></div>
            {calculationSummary.hasMismatch ? (
              <>
                <ul className="detail-warning-list">
                  {calculationSummary.messages.map((message, index) => (
                    <li key={`calc-${index}`}>{message}</li>
                  ))}
                </ul>
                <p className="calc-fix-hint">
                  Probable fix:
                  {calculationSummary.probableTaxable !== null ? ` taxable ${formatAmount(calculationSummary.probableTaxable)},` : ""}
                  {calculationSummary.probableTotal !== null ? ` total ${formatAmount(calculationSummary.probableTotal)}.` : " verify tax components and total."}
                </p>
                {(calculationSummary.probableTaxable !== null || calculationSummary.probableTotal !== null) ? (
                  <button type="button" className="btn-neutral" onClick={applyProbableFix} disabled={actionInProgress || !isReviewActionAllowed}>Apply Probable Fix</button>
                ) : null}
                <label className="mismatch-override-row">
                  <input type="checkbox" checked={allowMismatchApproval} onChange={(event) => setAllowMismatchApproval(event.target.checked)} disabled={actionInProgress || !isReviewActionAllowed} />
                  <span>I reviewed this mismatch and want to approve anyway.</span>
                </label>
              </>
            ) : (
              <p className="calc-ok-text">No significant calculation mismatch detected.</p>
            )}
          </article>

          <article className="card detail-section warnings-section">
            <div className="card-title-row"><h3>Validation Warnings</h3></div>
            <ul className="detail-warning-list">
              {warnings.length === 0 ? <li>No warnings</li> : null}
              {warnings.map((warning, index) => (
                <li key={toWarningKey(warning, index)}>{toWarningText(warning)}</li>
              ))}
            </ul>
          </article>

          <article className="card detail-section meta-section">
            <div className="card-title-row"><h3>Extraction Meta</h3></div>
            <div className="meta-grid">
              <div><span>Extraction Status</span><strong className="status-pending">{detail?.extractionStatus || "-"}</strong></div>
              <div><span>Confidence Score</span><strong>{normalizeConfidence(detail?.confidenceScore) === null ? "-" : `${Math.round((normalizeConfidence(detail?.confidenceScore) || 0) * 100)}%`}</strong></div>
              <div><span>Salvaged</span><strong>{detail?.salvaged ? "Yes" : "No"}</strong></div>
              <div><span>Retry Count</span><strong>{detail?.retryCount ?? 0}</strong></div>
            </div>
          </article>

          <footer className="detail-footer-actions">
            <button type="button" className="btn-neutral" onClick={onSaveDraft} disabled={actionInProgress || !isReviewActionAllowed}>Save Draft</button>
            <button type="button" className="btn-approve" onClick={onApprove} disabled={actionInProgress || !isReviewActionAllowed || (calculationSummary.hasMismatch && !allowMismatchApproval)}>Approve</button>
            <button type="button" className="btn-reject" onClick={onReject} disabled={actionInProgress || !isReviewActionAllowed}>Reject</button>
            <button type="button" className="btn-correction" disabled>Mark Needs Correction</button>
          </footer>

          {saveMessage ? <p>{saveMessage}</p> : null}
          {actionError ? <p className="login-error">{actionError}</p> : null}
        </section>
      </div>
    </section>
  );
}

export default InvoiceReviewDetailPage;
