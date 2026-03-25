import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { invoiceService } from "../api/invoiceService.js";

const allowedMimeTypes = new Set([
  "application/pdf",
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp"
]);

const allowedExtensions = new Set(["pdf", "jpg", "jpeg", "png", "webp"]);
const maxUploadFiles = 10;

const bytesToLabel = (bytes) => {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
};

const getExtension = (fileName = "") => {
  const dot = fileName.lastIndexOf(".");
  if (dot < 0) return "";
  return fileName.slice(dot + 1).toLowerCase();
};

const toBackendFileKey = (fileName = "") => {
  const raw = typeof fileName === "string" ? fileName.trim() : "";
  const fallback = raw || "invoice";
  return fallback.replace(/[^a-zA-Z0-9._-]/g, "_").toLowerCase();
};

const toEntryArray = (value, { defaultKey } = {}) => {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== "object") return [];

  return Object.entries(value).map(([key, entry]) => {
    if (entry && typeof entry === "object" && !Array.isArray(entry)) {
      return {
        [defaultKey]: key,
        ...entry
      };
    }

    return {
      [defaultKey]: key,
      message: String(entry ?? "")
    };
  });
};

const firstNonEmptyArray = (...values) => {
  for (const value of values) {
    if (Array.isArray(value) && value.length > 0) return value;
  }
  return null;
};

const splitResultRows = (rows) => {
  if (!Array.isArray(rows) || rows.length === 0) {
    return { items: [], errors: [] };
  }

  const items = [];
  const errors = [];

  rows.forEach((entry) => {
    const status = String(entry?.status ?? entry?.result ?? "").toUpperCase();
    const hasFailureFlag =
      status.includes("FAIL") ||
      status.includes("ERROR") ||
      Boolean(entry?.error) ||
      Boolean(entry?.code && String(entry.code).toUpperCase().includes("FAIL"));

    if (hasFailureFlag) {
      errors.push(entry);
      return;
    }

    items.push(entry);
  });

  return {
    items,
    errors
  };
};

const unwrapBulkUploadResult = (result) => {
  if (!result || typeof result !== "object") {
    return { items: [], errors: [] };
  }

  let current = result;
  for (let depth = 0; depth < 4 && current && typeof current === "object"; depth += 1) {
    const itemsArray =
      firstNonEmptyArray(
        toEntryArray(current.items, { defaultKey: "fileName" }),
        toEntryArray(current.successes, { defaultKey: "fileName" }),
        toEntryArray(current.uploaded, { defaultKey: "fileName" }),
        toEntryArray(current.registered, { defaultKey: "fileName" }),
        toEntryArray(current.created, { defaultKey: "fileName" })
      ) || [];

    const errorsArray =
      firstNonEmptyArray(
        toEntryArray(current.errors, { defaultKey: "fileName" }),
        toEntryArray(current.failures, { defaultKey: "fileName" }),
        toEntryArray(current.failed, { defaultKey: "fileName" }),
        toEntryArray(current.rejected, { defaultKey: "fileName" })
      ) || [];

    if (itemsArray.length > 0 || errorsArray.length > 0) {
      return {
  items: itemsArray,
  errors: errorsArray,
  n8n: current.n8n ?? null
};
    }

    if (Array.isArray(current.results) && current.results.length > 0) {
      return {
  ...splitResultRows(toEntryArray(current.results, { defaultKey: "fileName" })),
  n8n: current.n8n ?? null
};
    }

    current = current.data && typeof current.data === "object" ? current.data : null;
  }

  return { items: [], errors: [], n8n: null };
};

const getResultFileName = (entry) =>
  String(entry?.fileName ?? entry?.file_name ?? entry?.name ?? entry?.originalname ?? entry?.originalName ?? "");

const getResultErrorMessage = (entry) =>
  entry?.message ??
  entry?.error?.message ??
  entry?.reason ??
  (typeof entry?.error === "string" ? entry.error : null) ??
  "Upload failed";

const getN8nStatusSuffix = (payload) => {
  const n8n = payload?.n8n;
  if (!n8n || typeof n8n !== "object") return "";
  if (!n8n.attempted) return "";
  if (Number(n8n.dispatched || 0) > 0) {
    return ` n8n: ${Number(n8n.dispatched)} webhook(s) dispatched.`;
  }
  if (n8n.skippedReason) {
    return ` n8n skipped: ${n8n.skippedReason}.`;
  }
  return "";
};

const toQueueItem = (file) => ({
  id: `${file.name}-${file.size}-${file.lastModified}-${Math.random().toString(36).slice(2, 8)}`,
  file,
  fileName: file.name,
  fileType: getExtension(file.name) || file.type || "unknown",
  size: file.size,
  status: "READY",
  message: "",
  invoiceId: null,
  backendStatus: null
});

function BulkInvoiceUploadModal({
  isOpen,
  onClose,
  tenants,
  defaultTenantId,
  defaultBranchId,
  onUploadComplete
}) {
  const navigate = useNavigate();
  const fileInputRef = useRef(null);
  const [selectedTenantId, setSelectedTenantId] = useState(defaultTenantId || "");
  const [selectedBranchId, setSelectedBranchId] = useState(defaultBranchId || "");
  const [documentType, setDocumentType] = useState("AUTO");
  const [queue, setQueue] = useState([]);
  const [isDragging, setIsDragging] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [banner, setBanner] = useState("");
  const bannerKind = useMemo(() => {
    const text = String(banner || "").toLowerCase();
    if (!text) return "info";
    if (
      text.includes("ignored") ||
      text.includes("unsupported") ||
      text.includes("failed") ||
      text.includes("maximum") ||
      text.includes("required") ||
      text.includes("error")
    ) {
      return "error";
    }
    return "info";
  }, [banner]);

  useEffect(() => {
    if (!isOpen) return;
    setSelectedTenantId(defaultTenantId || "");
    setSelectedBranchId(defaultBranchId || "");
    setDocumentType("AUTO");
    setQueue([]);
    setBanner("");
  }, [isOpen, defaultTenantId, defaultBranchId]);

  useEffect(() => {
    if (!isOpen) return;

    const onKeyDown = (event) => {
      if (event.key === "Escape") {
        onClose?.();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isOpen, onClose]);

  const tenantOptions = tenants || [];

  const branchOptions = useMemo(() => {
    const tenant = tenantOptions.find((item) => item.id === selectedTenantId);
    return tenant?.branches || [];
  }, [tenantOptions, selectedTenantId]);

  useEffect(() => {
    if (!selectedTenantId) return;
    if (!branchOptions.some((branch) => branch.id === selectedBranchId)) {
      setSelectedBranchId(branchOptions.find((branch) => branch.isDefault)?.id || branchOptions[0]?.id || "");
    }
  }, [branchOptions, selectedBranchId, selectedTenantId]);

  if (!isOpen) return null;

  const addFilesToQueue = (files) => {
    const fileList = Array.from(files || []);
    if (fileList.length === 0) return;

    const remainingSlots = Math.max(0, maxUploadFiles - queue.length);
    if (remainingSlots <= 0) {
      setBanner(`Maximum ${maxUploadFiles} files can be queued at once.`);
      return;
    }

    const nextItems = [];
    const rejected = [];
    const skippedForLimit = [];

    fileList.forEach((file) => {
      if (nextItems.length >= remainingSlots) {
        skippedForLimit.push(file.name);
        return;
      }

      const ext = getExtension(file.name);
      const mime = (file.type || "").toLowerCase();
      const mimeAllowed = !mime || allowedMimeTypes.has(mime);
      const extAllowed = allowedExtensions.has(ext);

      if (!mimeAllowed && !extAllowed) {
        rejected.push(file.name);
        return;
      }

      nextItems.push(toQueueItem(file));
    });

    if (nextItems.length > 0) {
      setQueue((prev) => [...prev, ...nextItems]);
    }

    const bannerParts = [];
    if (rejected.length > 0) {
      bannerParts.push(`Unsupported files ignored: ${rejected.join(", ")}`);
    }
    if (skippedForLimit.length > 0) {
      bannerParts.push(`Only first ${maxUploadFiles} files were kept. Ignored: ${skippedForLimit.join(", ")}`);
    }
    if (bannerParts.length > 0) {
      setBanner(bannerParts.join(" "));
    }
  };

  const onDrop = (event) => {
    event.preventDefault();
    event.stopPropagation();
    setIsDragging(false);
    addFilesToQueue(event.dataTransfer?.files || []);
  };

  const onDragOver = (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (!isDragging) setIsDragging(true);
  };

  const onDragLeave = (event) => {
    event.preventDefault();
    event.stopPropagation();
    setIsDragging(false);
  };

  const removeFromQueue = (id) => {
    setQueue((prev) => prev.filter((item) => item.id !== id));
  };

  const startUpload = async () => {
  const readyItems = queue.filter((item) => item.status === "READY" || item.status === "FAILED");

  if (!selectedTenantId || !selectedBranchId) {
    setBanner("Tenant and branch are required.");
    return;
  }

  if (readyItems.length === 0) {
    setBanner("Add at least one file to upload.");
    return;
  }
  if (readyItems.length > maxUploadFiles) {
    setBanner(`Maximum ${maxUploadFiles} files can be uploaded at once.`);
    return;
  }

  setIsSubmitting(true);
  setBanner("");
  setQueue((prev) =>
    prev.map((item) =>
      readyItems.some((ready) => ready.id === item.id)
        ? { ...item, status: "UPLOADING", message: "", invoiceId: null, backendStatus: null }
        : item
    )
  );

  const formData = new FormData();
  formData.append("tenantId", selectedTenantId);
  formData.append("branchId", selectedBranchId);
  formData.append("documentType", documentType);
  readyItems.forEach((item) => formData.append("files[]", item.file));

  try {
    const result = await invoiceService.bulkUploadInvoices(formData);
    const payload = unwrapBulkUploadResult(result);

    const itemBuckets = new Map();
    const errorBuckets = new Map();
    const remainingItems = [...payload.items];
    const remainingErrors = [...payload.errors];

    payload.items.forEach((entry) => {
      const key = toBackendFileKey(getResultFileName(entry));
      if (!itemBuckets.has(key)) itemBuckets.set(key, []);
      itemBuckets.get(key).push(entry);
    });

    payload.errors.forEach((entry) => {
      const key = toBackendFileKey(getResultFileName(entry));
      if (!errorBuckets.has(key)) errorBuckets.set(key, []);
      errorBuckets.get(key).push(entry);
    });

    const resolvedById = new Map();
    let registeredCount = 0;

    for (const item of readyItems) {
      const fileKey = toBackendFileKey(item.file?.name || item.fileName);
      const byNameItems = itemBuckets.get(fileKey) || [];
      const byNameErrors = errorBuckets.get(fileKey) || [];

      if (byNameItems.length > 0) {
        const matched = byNameItems.shift();
        const remainingIndex = remainingItems.indexOf(matched);
        if (remainingIndex >= 0) remainingItems.splice(remainingIndex, 1);

        registeredCount += 1;
        resolvedById.set(item.id, {
          status: "REGISTERED",
          invoiceId: matched.invoiceId ?? matched.invoice_id ?? null,
          backendStatus: matched.status || "UPLOADED",
          message: matched.status || "UPLOADED"
        });
        continue;
      }

      if (byNameErrors.length > 0) {
        const matchedError = byNameErrors.shift();
        const remainingIndex = remainingErrors.indexOf(matchedError);
        if (remainingIndex >= 0) remainingErrors.splice(remainingIndex, 1);

        resolvedById.set(item.id, {
          status: "FAILED",
          invoiceId: null,
          backendStatus: null,
          message: getResultErrorMessage(matchedError)
        });
        continue;
      }

      if (remainingItems.length > 0) {
        const matched = remainingItems.shift();

        registeredCount += 1;
        resolvedById.set(item.id, {
          status: "REGISTERED",
          invoiceId: matched.invoiceId ?? matched.invoice_id ?? null,
          backendStatus: matched.status || "UPLOADED",
          message: matched.status || "UPLOADED"
        });
        continue;
      }

      if (remainingErrors.length > 0) {
        const matchedError = remainingErrors.shift();

        resolvedById.set(item.id, {
          status: "FAILED",
          invoiceId: null,
          backendStatus: null,
          message: getResultErrorMessage(matchedError)
        });
        continue;
      }

      resolvedById.set(item.id, {
        status: "FAILED",
        invoiceId: null,
        backendStatus: null,
        message: "No response for file"
      });
    }

    setQueue((prev) =>
      prev.map((item) =>
        resolvedById.has(item.id)
          ? {
              ...item,
              ...resolvedById.get(item.id)
            }
          : item
      )
    );

    const failCount = readyItems.length - registeredCount;
    const n8nStatusSuffix = getN8nStatusSuffix(payload);
    setBanner(`Upload complete: ${registeredCount} registered, ${failCount} failed.${n8nStatusSuffix}`);
    onUploadComplete?.();
  } catch (error) {
    setQueue((prev) =>
      prev.map((item) =>
        readyItems.some((ready) => ready.id === item.id)
          ? { ...item, status: "FAILED", message: error.message || "Upload failed" }
          : item
      )
    );
    setBanner(error.message || "Bulk upload failed.");
  } finally {
    setIsSubmitting(false);
  }
};
  const hasRegistered = queue.some((item) => item.status === "REGISTERED");

  return (
    <div className="upload-modal-overlay" role="presentation" onClick={onClose}>
      <section className="upload-modal card" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
        <div className="upload-modal-header">
          <h3>Upload Invoices</h3>
          <button type="button" className="upload-modal-close" onClick={onClose}>
            Close
          </button>
        </div>

        <div className="upload-controls-grid">
          <label>
            Tenant
            <select value={selectedTenantId} onChange={(event) => setSelectedTenantId(event.target.value)} disabled={isSubmitting}>
              <option value="">Select tenant</option>
              {tenantOptions.map((tenant) => (
                <option key={tenant.id} value={tenant.id}>
                  {tenant.tenantCode || tenant.tenantName}
                </option>
              ))}
            </select>
          </label>

          <label>
            Branch
            <select value={selectedBranchId} onChange={(event) => setSelectedBranchId(event.target.value)} disabled={isSubmitting}>
              <option value="">Select branch</option>
              {branchOptions.map((branch) => (
                <option key={branch.id} value={branch.id}>
                  {branch.branchCode || branch.branchName}
                </option>
              ))}
            </select>
          </label>

          <label>
            Document Type
            <select value={documentType} onChange={(event) => setDocumentType(event.target.value)} disabled={isSubmitting}>
              <option value="AUTO">AUTO</option>
              <option value="PURCHASE_INVOICE">PURCHASE_INVOICE</option>
              <option value="SALES_INVOICE">SALES_INVOICE</option>
            </select>
          </label>
        </div>

        <div
          className={`upload-dropzone${isDragging ? " drag-active" : ""}`}
          onDrop={onDrop}
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
        >
          <p>Drag and drop invoice files here</p>
          <p className="upload-dropzone-note">Allowed: pdf, jpg, jpeg, png, webp | Max {maxUploadFiles} files</p>
          <button type="button" onClick={() => fileInputRef.current?.click()} disabled={isSubmitting}>
            Browse Files
          </button>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept=".pdf,.jpg,.jpeg,.png,.webp"
            onChange={(event) => addFilesToQueue(event.target.files || [])}
            style={{ display: "none" }}
          />
        </div>

        <div className="upload-queue-wrap">
          <table className="upload-queue-table">
            <thead>
              <tr>
                <th>File Name</th>
                <th>File Type</th>
                <th>Size</th>
                <th>Upload Status</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {queue.length === 0 ? (
                <tr>
                  <td colSpan={5} className="upload-queue-empty">No files selected</td>
                </tr>
              ) : (
                queue.map((item) => (
                  <tr key={item.id}>
                    <td>{item.fileName}</td>
                    <td>{item.fileType}</td>
                    <td>{bytesToLabel(item.size)}</td>
                    <td>
                      <span className={`badge upload-status upload-status-${item.status.toLowerCase()}`}>{item.status}</span>
                      {item.invoiceId ? <span className="upload-status-detail">ID: {item.invoiceId}</span> : null}
                      {item.backendStatus ? <span className="upload-status-detail">{item.backendStatus}</span> : null}
                      {item.message && item.status === "FAILED" ? <span className="upload-status-detail error">{item.message}</span> : null}
                    </td>
                    <td>
                      <button
                        type="button"
                        className="upload-remove-btn"
                        onClick={() => removeFromQueue(item.id)}
                        disabled={isSubmitting || item.status === "UPLOADING"}
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

        {banner ? (
          <p className={`upload-banner ${bannerKind === "error" ? "upload-banner-error" : "upload-banner-info"}`}>
            <span className="upload-banner-icon" aria-hidden="true">{bannerKind === "error" ? "⚠" : "ℹ"}</span>
            <span>{banner}</span>
          </p>
        ) : null}

        <div className="upload-modal-actions">
          <button type="button" onClick={onClose} disabled={isSubmitting}>Cancel</button>
          <button type="button" onClick={startUpload} disabled={isSubmitting || queue.length === 0}>Start Upload</button>
          <button type="button" onClick={() => navigate("/review-queue")} disabled={!hasRegistered || isSubmitting}>
            Go to Review Queue
          </button>
        </div>
      </section>
    </div>
  );
}

export default BulkInvoiceUploadModal;
