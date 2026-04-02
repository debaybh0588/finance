import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { invoiceService } from "../api/invoiceService.js";
import { useAuth } from "../auth/AuthContext.jsx";
import PageState from "../components/PageState.jsx";

const toText = (value, fallback = "") => {
  if (value === undefined || value === null) return fallback;
  const text = String(value).trim();
  return text || fallback;
};

const toNumber = (value) => {
  if (value === undefined || value === null || value === "") return null;
  const numeric = Number(String(value).replace(/,/g, "").trim());
  return Number.isFinite(numeric) ? numeric : null;
};

const escapeXml = (value) =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&apos;");

const toTallyDate = (value) => {
  if (!value) return "";
  const raw = String(value).trim();
  if (/^\d{8}$/.test(raw)) return raw;
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw.replace(/-/g, "");

  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return "";

  const year = String(date.getFullYear());
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}${month}${day}`;
};

const pickExtractionRoot = (detail) => {
  const corrected = detail?.correctedJson;
  if (corrected && typeof corrected === "object" && !Array.isArray(corrected) && Object.keys(corrected).length > 0) {
    return corrected;
  }

  const extracted = detail?.extractedJson;
  if (extracted && typeof extracted === "object" && !Array.isArray(extracted)) {
    return extracted;
  }

  return {};
};

const normalizeLineItemsForXml = (detail) => {
  const root = pickExtractionRoot(detail);
  const fromJson = Array.isArray(root.line_items)
    ? root.line_items
    : Array.isArray(root.lineItems)
      ? root.lineItems
      : null;

  if (Array.isArray(fromJson) && fromJson.length > 0) {
    return fromJson.map((row, index) => ({
      lineNo: toNumber(row.line_no ?? row.lineNo ?? index + 1) || index + 1,
      description: toText(row.description ?? row.item_description ?? row.item, `Line ${index + 1}`),
      hsn: toText(row.hsn ?? row.hsn_sac ?? row.hsn_code, ""),
      quantity: toNumber(row.quantity ?? row.qty),
      uom: toText(row.uom ?? row.unit ?? row.per, "PCS"),
      rate: toNumber(row.rate ?? row.unit_rate),
      taxableAmount: toNumber(row.taxable_amount ?? row.taxable ?? row.taxable_value),
      total: toNumber(row.total_amount ?? row.total ?? row.line_total)
    }));
  }

  const rawRows = Array.isArray(detail?.lineItems) ? detail.lineItems : [];
  return rawRows.map((row, index) => ({
    lineNo: toNumber(row.lineNo ?? index + 1) || index + 1,
    description: toText(row.description, `Line ${index + 1}`),
    hsn: toText(row.hsn, ""),
    quantity: toNumber(row.quantity),
    uom: toText(row.uom, "PCS"),
    rate: toNumber(row.rate),
    taxableAmount: toNumber(row.taxableAmount),
    total: toNumber(row.total)
  }));
};

const buildPostingXmlFromMapping = (detail, mappingRows) => {
  const root = pickExtractionRoot(detail);
  const mapping = Object.fromEntries(
    (Array.isArray(mappingRows) ? mappingRows : []).map((row) => [row.sourceField, toText(row.selectedValue)])
  );

  const lineItems = normalizeLineItemsForXml(detail);
  const documentTypeSelection = toText(mapping.document_type, "").toLowerCase();
  const fallbackDocType = toText(detail?.documentType, "PURCHASE_INVOICE") === "SALES_INVOICE" ? "sales" : "purchase";
  const docType = documentTypeSelection || fallbackDocType;
  const isSales = docType === "sales";

  const postingMode = toText(mapping.posting_mode, "INVENTORY_ITEMWISE");
  const voucherType = toText(mapping.voucher_type, isSales ? "Sales" : "Purchase");
  const partyLedger = toText(mapping.party_ledger, toText(detail?.partyName, "Unknown Party"));
  const inventoryLedger = toText(mapping.inventory_ledger, isSales ? "Sales" : "Purchase");

  const invoiceDate = toTallyDate(root.invoice_date || root.invoiceDate || detail?.invoiceDate) || toTallyDate(new Date().toISOString().slice(0, 10));
  const invoiceNumber =
    toText(root.invoice_number || root.invoiceNumber || detail?.invoiceNumber) ||
    `AUTO-${Date.now()}`;

  const lineItemsWithAmounts = lineItems.map((item) => {
    const quantity = toNumber(item.quantity) ?? 1;
    const taxableAmount = toNumber(item.taxableAmount) ?? 0;
    const rate = toNumber(item.rate) ?? (quantity ? Number((taxableAmount / quantity).toFixed(2)) : taxableAmount);

    return {
      ...item,
      quantity,
      rate,
      taxableAmount,
      stockName: toText(mapping[`line_item_${item.lineNo}`], item.description)
    };
  });

  const taxableFromLines = Number(lineItemsWithAmounts.reduce((sum, item) => sum + (item.taxableAmount || 0), 0).toFixed(2));
  const taxable = toNumber(root.taxable_amount ?? root.taxableAmount ?? root.subtotal ?? detail?.taxableAmount ?? detail?.subtotal) ?? taxableFromLines;
  const cgst = toNumber(root.cgst ?? detail?.cgstAmount) ?? 0;
  const sgst = toNumber(root.sgst ?? detail?.sgstAmount) ?? 0;
  const igst = toNumber(root.igst ?? detail?.igstAmount) ?? 0;
  const tds = toNumber(root.tds) ?? 0;
  const roundOff = toNumber(root.round_off ?? root.roundOff ?? detail?.roundOffAmount) ?? 0;

  const computedTotal = Number((taxable + cgst + sgst + igst + roundOff - tds).toFixed(2));
  const grandTotal = toNumber(root.total_amount ?? root.totalAmount ?? detail?.totalAmount) ?? computedTotal;

  const taxEntryRows = [];
  const pushTaxEntry = (ledgerName, amount) => {
    const numericAmount = Number((amount ?? 0).toFixed(2));
    if (!numericAmount) return;
    taxEntryRows.push({
      ledgerName,
      amount: numericAmount
    });
  };

  pushTaxEntry(toText(mapping.cgst_ledger, isSales ? "Output CGST" : "Input CGST"), cgst * (isSales ? -1 : 1));
  pushTaxEntry(toText(mapping.sgst_ledger, isSales ? "Output SGST" : "Input SGST"), sgst * (isSales ? -1 : 1));
  pushTaxEntry(toText(mapping.igst_ledger, isSales ? "Output IGST" : "Input IGST"), igst * (isSales ? -1 : 1));
  pushTaxEntry(toText(mapping.tds_ledger, "TDS Receivable"), -Math.abs(tds));
  pushTaxEntry(toText(mapping.roundoff_ledger, "Round Off"), roundOff);

  const narration = [
    partyLedger,
    lineItemsWithAmounts
      .slice(0, 5)
      .map((item) => {
        const hsnText = item.hsn ? ` [HSN ${item.hsn}]` : "";
        return `${item.lineNo}. ${item.description}${hsnText}`;
      })
      .join(" | "),
    lineItemsWithAmounts.length > 5 ? `+${lineItemsWithAmounts.length - 5} more items` : ""
  ]
    .filter(Boolean)
    .join(" ; ");

  const partyEntryAmount = isSales ? Math.abs(grandTotal) : -Math.abs(grandTotal);
  const partyEntryPositive = partyEntryAmount >= 0 ? "No" : "Yes";

  const ledgerEntryAmount = isSales ? -Math.abs(taxable) : Math.abs(taxable);
  const ledgerEntryPositive = ledgerEntryAmount >= 0 ? "No" : "Yes";

  const inventoryEntriesXml =
    postingMode === "INVENTORY_ITEMWISE"
      ? lineItemsWithAmounts
          .map((item) => {
            const amount = isSales ? -Math.abs(item.taxableAmount) : Math.abs(item.taxableAmount);
            const deemed = amount >= 0 ? "No" : "Yes";
            const qtyText = `${Number(item.quantity.toFixed(3))} ${item.uom}`;
            const rateText = `${Number(item.rate.toFixed(2))}/${item.uom}`;
            return [
              "            <ALLINVENTORYENTRIES.LIST>",
              `              <STOCKITEMNAME>${escapeXml(item.stockName)}</STOCKITEMNAME>`,
              `              <ISDEEMEDPOSITIVE>${deemed}</ISDEEMEDPOSITIVE>`,
              `              <RATE>${escapeXml(rateText)}</RATE>`,
              `              <AMOUNT>${Number(amount).toFixed(2)}</AMOUNT>`,
              `              <ACTUALQTY>${escapeXml(qtyText)}</ACTUALQTY>`,
              `              <BILLEDQTY>${escapeXml(qtyText)}</BILLEDQTY>`,
              "              <ACCOUNTINGALLOCATIONS.LIST>",
              `                <LEDGERNAME>${escapeXml(inventoryLedger)}</LEDGERNAME>`,
              `                <ISDEEMEDPOSITIVE>${deemed}</ISDEEMEDPOSITIVE>`,
              `                <AMOUNT>${Number(amount).toFixed(2)}</AMOUNT>`,
              "              </ACCOUNTINGALLOCATIONS.LIST>",
              "            </ALLINVENTORYENTRIES.LIST>"
            ].join("\n");
          })
          .join("\n")
      : "";

  const accountingLedgerXml =
    postingMode === "ACCOUNTING_INVOICE"
      ? [
          "            <ALLLEDGERENTRIES.LIST>",
          `              <LEDGERNAME>${escapeXml(inventoryLedger)}</LEDGERNAME>`,
          `              <ISDEEMEDPOSITIVE>${ledgerEntryPositive}</ISDEEMEDPOSITIVE>`,
          `              <AMOUNT>${Number(ledgerEntryAmount).toFixed(2)}</AMOUNT>`,
          "            </ALLLEDGERENTRIES.LIST>"
        ].join("\n")
      : "";

  const taxLedgerXml = taxEntryRows
    .map((row) => {
      const deemed = row.amount >= 0 ? "No" : "Yes";
      return [
        "            <ALLLEDGERENTRIES.LIST>",
        `              <LEDGERNAME>${escapeXml(row.ledgerName)}</LEDGERNAME>`,
        `              <ISDEEMEDPOSITIVE>${deemed}</ISDEEMEDPOSITIVE>`,
        `              <AMOUNT>${Number(row.amount).toFixed(2)}</AMOUNT>`,
        "            </ALLLEDGERENTRIES.LIST>"
      ].join("\n");
    })
    .join("\n");

  return [
    "<ENVELOPE>",
    "  <HEADER>",
    "    <TALLYREQUEST>Import Data</TALLYREQUEST>",
    "  </HEADER>",
    "  <BODY>",
    "    <IMPORTDATA>",
    "      <REQUESTDESC>",
    "        <REPORTNAME>Vouchers</REPORTNAME>",
    "        <STATICVARIABLES>",
    "          <IMPORTDUPS>@@DUPIGNORE</IMPORTDUPS>",
    "          <RETURNLINEERRORS>Yes</RETURNLINEERRORS>",
    "          <LOGIMPORTERRORS>Yes</LOGIMPORTERRORS>",
    "        </STATICVARIABLES>",
    "      </REQUESTDESC>",
    "      <REQUESTDATA>",
    "        <TALLYMESSAGE>",
    `          <VOUCHER VCHTYPE=\"${escapeXml(voucherType)}\" ACTION=\"Create\">`,
    `            <VOUCHERTYPENAME>${escapeXml(voucherType)}</VOUCHERTYPENAME>`,
    `            <DATE>${escapeXml(invoiceDate)}</DATE>`,
    `            <VOUCHERNUMBER>${escapeXml(invoiceNumber)}</VOUCHERNUMBER>`,
    `            <REFERENCE>${escapeXml(invoiceNumber)}</REFERENCE>`,
    "            <ISINVOICE>Yes</ISINVOICE>",
    "            <PERSISTEDVIEW>Invoice Voucher View</PERSISTEDVIEW>",
    "            <OBJVIEW>Invoice Voucher View</OBJVIEW>",
    `            <PARTYLEDGERNAME>${escapeXml(partyLedger)}</PARTYLEDGERNAME>`,
    `            <NARRATION>${escapeXml(narration)}</NARRATION>`,
    "            <ALLLEDGERENTRIES.LIST>",
    `              <LEDGERNAME>${escapeXml(partyLedger)}</LEDGERNAME>`,
    `              <ISDEEMEDPOSITIVE>${partyEntryPositive}</ISDEEMEDPOSITIVE>`,
    `              <AMOUNT>${Number(partyEntryAmount).toFixed(2)}</AMOUNT>`,
    "            </ALLLEDGERENTRIES.LIST>",
    accountingLedgerXml,
    taxLedgerXml,
    inventoryEntriesXml,
    "          </VOUCHER>",
    "        </TALLYMESSAGE>",
    "      </REQUESTDATA>",
    "    </IMPORTDATA>",
    "  </BODY>",
    "</ENVELOPE>"
  ]
    .filter(Boolean)
    .join("\n")
    .trim();
};

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
  const [mappingRows, setMappingRows] = useState([]);
  const [mappingLoading, setMappingLoading] = useState(false);
  const [mappingError, setMappingError] = useState("");
  const [mappingMeta, setMappingMeta] = useState(null);
  const [mappingSaveBusy, setMappingSaveBusy] = useState(false);

  const loadMapping = useCallback(
    async ({ forceRefresh = false } = {}) => {
      if (!selectedTenantId) return;
      setMappingLoading(true);
      setMappingError("");

      try {
        const response = forceRefresh
          ? await invoiceService.refreshPostingReviewMapping(invoiceId)
          : await invoiceService.getPostingReviewMapping(invoiceId);
        const mapping = response?.mapping || {};
        setMappingRows(Array.isArray(mapping.rows) ? mapping.rows : []);
        setMappingMeta({
          fetchedAt: mapping.fetchedAt || null,
          expiresAt: mapping.expiresAt || null,
          stale: Boolean(mapping.stale),
          skipped: Boolean(mapping.skipped),
          reason: mapping.reason || null,
          optionStats: mapping.optionStats || null
        });
      } catch (error) {
        setMappingRows([]);
        setMappingMeta(null);
        setMappingError(error.message || "Unable to load Tally runtime mapping.");
      } finally {
        setMappingLoading(false);
      }
    },
    [invoiceId, selectedTenantId]
  );

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
      await loadMapping({ forceRefresh: false });
    } catch (error) {
      setErrorMessage(error.message || "Unable to load posting review detail.");
      setViewState("error");
    }
  }, [invoiceId, selectedTenantId, loadMapping]);

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

  const mappingCountsText = useMemo(() => {
    if (!mappingMeta?.optionStats) return "";
    const stats = mappingMeta.optionStats;
    return `Voucher: ${stats.voucherTypes || 0}, Ledgers: ${stats.ledgers || 0}, Stock: ${stats.stockItems || 0}`;
  }, [mappingMeta]);

  const onMappingSelectChange = (sourceField, value) => {
    setMappingRows((prev) =>
      prev.map((row) => {
        if (row.sourceField !== sourceField) return row;
        const selected = Array.isArray(row.options)
          ? row.options.find((entry) => entry.value === value)
          : null;
        return {
          ...row,
          selectedValue: value,
          selectedConfidence: selected ? Number(selected.confidence || 0) : 0,
          isUserOverride: true
        };
      })
    );
  };

  const onSaveMapping = async () => {
    if (!mappingRows.length) return;

    setMappingSaveBusy(true);
    setActionError("");
    setActionMessage("");
    try {
      const payload = {
        updated_by: reviewerIdentity,
        mappings: mappingRows
          .filter((row) => row.persistable !== false)
          .map((row) => ({
            sourceField: row.sourceField,
            targetValue: toText(row.selectedValue, ""),
            confidence: Number(row.selectedConfidence || 0),
            isUserOverride: true,
            persistable: true
          }))
      };

      const response = await invoiceService.savePostingReviewMapping(invoiceId, payload);
      const mapping = response?.mapping || {};
      setMappingRows(Array.isArray(mapping.rows) ? mapping.rows : mappingRows);
      setMappingMeta((prev) => ({
        ...(prev || {}),
        fetchedAt: mapping.fetchedAt || prev?.fetchedAt || null,
        expiresAt: mapping.expiresAt || prev?.expiresAt || null,
        stale: Boolean(mapping.stale),
        skipped: Boolean(mapping.skipped),
        reason: mapping.reason || null,
        optionStats: mapping.optionStats || prev?.optionStats || null
      }));
      setActionMessage("Tally field mapping saved for this tenant/document type.");
    } catch (error) {
      setActionError(error.message || "Unable to save mapping.");
    } finally {
      setMappingSaveBusy(false);
    }
  };

  const onGenerateXmlFromMapping = () => {
    if (!detail) return;
    const generatedXml = buildPostingXmlFromMapping(detail, mappingRows);
    setEditableXml(generatedXml);
    setActionMessage("Posting XML generated from mapping selections.");
    setActionError("");
  };

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
            <div className="card-title-row">
              <h3>Tally Field Mapping</h3>
            </div>

            <div className="posting-mapping-header">
              <p>
                Left side shows extracted final values. Right side shows probable Tally options with confidence.
              </p>
              <p className="posting-mapping-meta">
                {mappingMeta?.fetchedAt ? `Catalog fetched: ${new Date(mappingMeta.fetchedAt).toLocaleString()}` : "Catalog not fetched yet"}
                {mappingCountsText ? ` | ${mappingCountsText}` : ""}
                {mappingMeta?.stale ? " | stale" : ""}
              </p>
            </div>

            <div className="posting-mapping-actions">
              <button type="button" className="btn-neutral" onClick={() => loadMapping({ forceRefresh: true })} disabled={mappingLoading || actionBusy || mappingSaveBusy}>
                {mappingLoading ? "Refreshing..." : "Refresh Tally Catalog"}
              </button>
              <button type="button" className="btn-neutral" onClick={onSaveMapping} disabled={mappingSaveBusy || actionBusy || mappingLoading || !mappingRows.length}>
                {mappingSaveBusy ? "Saving..." : "Save Mapping"}
              </button>
              <button type="button" className="btn-neutral" onClick={onGenerateXmlFromMapping} disabled={actionBusy || mappingLoading || !mappingRows.length}>
                Generate XML From Mapping
              </button>
            </div>

            {mappingError ? <p className="login-error">{mappingError}</p> : null}

            {!mappingRows.length ? (
              <p className="posting-mapping-empty">No mapping rows available.</p>
            ) : (
              <div className="posting-mapping-table-wrap">
                <table className="posting-mapping-table">
                  <thead>
                    <tr>
                      <th>Extracted Field</th>
                      <th>Extracted Value</th>
                      <th>Mapped Tally Field</th>
                      <th>Confidence</th>
                    </tr>
                  </thead>
                  <tbody>
                    {mappingRows.map((row) => {
                      const options = Array.isArray(row.options) ? row.options : [];
                      const selectedValue = toText(row.selectedValue, "");
                      return (
                        <tr key={row.sourceField}>
                          <td>{row.label || row.sourceField}</td>
                          <td>{toText(row.extractedValue, "-")}</td>
                          <td>
                            <select
                              value={selectedValue}
                              onChange={(event) => onMappingSelectChange(row.sourceField, event.target.value)}
                              disabled={actionBusy || mappingSaveBusy || mappingLoading}
                            >
                              {!selectedValue ? <option value="">Select...</option> : null}
                              {options.map((option) => (
                                <option key={`${row.sourceField}:${option.value}`} value={option.value}>
                                  {option.value}
                                </option>
                              ))}
                            </select>
                          </td>
                          <td>{`${Math.round(Number(row.selectedConfidence || 0) * 100)}%`}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </article>

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
