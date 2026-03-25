import { createHash, randomUUID } from "node:crypto";
import { access, copyFile, mkdir, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { invoiceExtractionRepository } from "../repositories/invoiceExtractionRepository.js";
import { invoicePostingRepository } from "../repositories/invoicePostingRepository.js";
import { invoiceRuntimeRepository } from "../repositories/invoiceRuntimeRepository.js";
import { invoiceReadRepository } from "../repositories/invoiceReadRepository.js";
import { storageService } from "./storageService.js";
import { superAdminTenantRepository } from "../repositories/superAdminTenantRepository.js";

const dashboardData = {
  metrics: [
    { label: "Uploaded", value: 142, color: "var(--primary-blue)" },
    { label: "Pending Review", value: 39, color: "var(--warning-orange)" },
    { label: "Approved", value: 88, color: "var(--purple)" },
    { label: "Posted", value: 76, color: "var(--success-green)" }
  ],
  lifecycle: [
    { name: "Uploaded", count: 142, color: "var(--primary-blue)" },
    { name: "Extracting", count: 28, color: "var(--primary-blue-2)" },
    { name: "Pending Review", count: 39, color: "var(--warning-orange)" },
    { name: "Approved", count: 88, color: "var(--purple)" },
    { name: "Posting", count: 22, color: "var(--primary-blue)" },
    { name: "Posted", count: 76, color: "var(--success-green)" },
    { name: "Failed", count: 7, color: "var(--danger-red)" }
  ],
  perDay: [
    { day: "Mon", count: 28 },
    { day: "Tue", count: 34 },
    { day: "Wed", count: 26 },
    { day: "Thu", count: 43 },
    { day: "Fri", count: 38 },
    { day: "Sat", count: 21 },
    { day: "Sun", count: 17 }
  ],
  vendors: [
    { name: "Anand Traders", amount: 312500, color: "var(--primary-blue)" },
    { name: "BluePeak Supplies", amount: 228000, color: "var(--purple)" },
    { name: "Metro Industrial", amount: 194500, color: "var(--success-green)" },
    { name: "Orbit Components", amount: 143750, color: "var(--warning-orange)" }
  ]
};

const invoiceRows = [
  {
    id: "INV-001",
    status: "UPLOADED",
    invoiceType: "Purchase",
    partyName: "Anand Traders",
    gstin: "27ABCDE1234F1Z2",
    invoiceNumber: "PUR-2026-104",
    date: "2026-03-21",
    branch: "Mumbai-HQ",
    totalAmount: 128500,
    extractionStatus: "PARTIAL",
    duplicateFlag: "No"
  },
  {
    id: "INV-002",
    status: "PENDING_REVIEW",
    invoiceType: "Sales",
    partyName: "BluePeak Retail",
    gstin: "29AAACB7788N1ZP",
    invoiceNumber: "SAL-2026-237",
    date: "2026-03-20",
    branch: "Bengaluru-East",
    totalAmount: 94750,
    extractionStatus: "SUCCESS",
    duplicateFlag: "No"
  },
  {
    id: "INV-003",
    status: "EXTRACTING",
    invoiceType: "Purchase",
    partyName: "Metro Industrial",
    gstin: "27AACCM5555M1ZQ",
    invoiceNumber: "PUR-2026-103",
    date: "2026-03-19",
    branch: "Mumbai-HQ",
    totalAmount: 213900,
    extractionStatus: "RETRYABLE",
    duplicateFlag: "Yes"
  },
  {
    id: "INV-004",
    status: "APPROVED",
    invoiceType: "Sales",
    partyName: "Orbit Components",
    gstin: "07AAACO4455Q1ZD",
    invoiceNumber: "SAL-2026-231",
    date: "2026-03-18",
    branch: "Delhi-North",
    totalAmount: 154250,
    extractionStatus: "SUCCESS",
    duplicateFlag: "No"
  },
  {
    id: "INV-005",
    status: "POST_FAILED",
    invoiceType: "Purchase",
    partyName: "Shakti Packaging",
    gstin: "24AAJCS6677K1ZS",
    invoiceNumber: "PUR-2026-099",
    date: "2026-03-17",
    branch: "Ahmedabad-West",
    totalAmount: 68900,
    extractionStatus: "FAILED",
    duplicateFlag: "No"
  },
  {
    id: "INV-006",
    status: "POSTED",
    invoiceType: "Sales",
    partyName: "Northline Distributors",
    gstin: "06AAACN3344H1Z6",
    invoiceNumber: "SAL-2026-226",
    date: "2026-03-16",
    branch: "Gurugram",
    totalAmount: 117300,
    extractionStatus: "SUCCESS",
    duplicateFlag: "No"
  },
  {
    id: "INV-007",
    status: "REJECTED",
    invoiceType: "Purchase",
    partyName: "Radian Logistics",
    gstin: "19AABCR9988L1ZX",
    invoiceNumber: "PUR-2026-094",
    date: "2026-03-15",
    branch: "Kolkata",
    totalAmount: 56240,
    extractionStatus: "PARTIAL",
    duplicateFlag: "Yes"
  },
  {
    id: "INV-008",
    status: "POSTING",
    invoiceType: "Sales",
    partyName: "Pioneer Foods",
    gstin: "33AACCP4422D1ZT",
    invoiceNumber: "SAL-2026-219",
    date: "2026-03-14",
    branch: "Chennai-Central",
    totalAmount: 133880,
    extractionStatus: "SUCCESS",
    duplicateFlag: "No"
  }
];

const maxExtractionRetries = 3;
const maxBulkUploadFiles = 10;

const createError = (message, statusCode, code) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
};

const allowedUploadMimeTypes = new Set([
  "application/pdf",
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp"
]);

const sanitizeUploadFileName = (name) => {
  const raw = typeof name === "string" ? name.trim() : "";
  const fallback = raw || `invoice-${Date.now()}`;
  return fallback.replace(/[^a-zA-Z0-9._-]/g, "_");
};

const resolveSafeDirectoryPath = (rawPath, fieldName) => {
  const normalized = toLooseOptionalString(rawPath);
  if (!normalized) {
    throw createError(`${fieldName} is required`, 422, "STORAGE_CONFIG_INVALID");
  }
  if (normalized.includes("\0")) {
    throw createError(`${fieldName} is invalid`, 422, "STORAGE_CONFIG_INVALID");
  }
  return path.resolve(normalized);
};

const resolveSafeChildPath = (basePath, childName) => {
  const resolvedBase = path.resolve(basePath);
  const resolvedChild = path.resolve(resolvedBase, childName);
  const relative = path.relative(resolvedBase, resolvedChild);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw createError("Resolved file path is outside configured storage directory", 422, "STORAGE_CONFIG_INVALID");
  }
  return resolvedChild;
};

const toLooseOptionalString = (value) => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed || null;
};

const isRemoteFilePath = (value) => /^https?:\/\//i.test(String(value || ""));

const toAbsoluteLocalPath = (value) => {
  const text = toLooseOptionalString(value);
  if (!text || isRemoteFilePath(text)) return null;
  return path.isAbsolute(text) ? text : path.resolve(process.cwd(), text);
};

const pathExists = async (filePath) => {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
};

const sanitizeFileToken = (value, fallback) => {
  const raw = String(value || "")
    .trim()
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  if (!raw) return fallback;
  return raw.slice(0, 48);
};

const buildPostingArtifactStem = (invoice) => {
  const partyToken = sanitizeFileToken(invoice?.partyName, "party");
  const invoiceToken = sanitizeFileToken(invoice?.invoiceNumber || invoice?.id, "invoice");
  const shortId = sanitizeFileToken(String(invoice?.id || "").slice(0, 8), "id");
  return `${partyToken}_${invoiceToken}_${shortId}`;
};

const resolveUniquePath = async (folderPath, fileName) => {
  const parsed = path.parse(fileName);
  const safeBaseName = sanitizeUploadFileName(parsed.name || "file");
  const ext = parsed.ext || "";
  let counter = 0;

  while (counter < 200) {
    const suffix = counter === 0 ? "" : `_${counter}`;
    const candidate = path.join(folderPath, `${safeBaseName}${suffix}${ext}`);
    if (!(await pathExists(candidate))) {
      return candidate;
    }
    counter += 1;
  }

  return path.join(folderPath, `${safeBaseName}_${Date.now()}${ext}`);
};

const moveFileWithFallback = async (sourcePath, targetPath) => {
  try {
    await rename(sourcePath, targetPath);
    return;
  } catch (error) {
    if (error?.code !== "EXDEV") {
      throw error;
    }
  }

  await copyFile(sourcePath, targetPath);
  await unlink(sourcePath);
};

const persistPostingStorageArtifacts = async ({ invoice, tenantId, branchId, payload, options = {} }) => {
  const writeOutputXml = options.writeOutputXml !== false;
  const writeSuccessXml = options.writeSuccessXml !== false;
  const moveOriginalFile = options.moveOriginalFile !== false;
  const metadataKey = toLooseOptionalString(options.metadataKey) || "storageLifecycle";
  const warnings = [];
  const artifacts = {
    generatedAt: new Date().toISOString(),
    outputPostingXmlPath: null,
    successPostingXmlPath: null,
    processedOriginalFilePath: null
  };

  let storage = null;
  try {
    storage = await storageService.resolveStoragePaths({ tenantId, branchId });
  } catch (error) {
    warnings.push(`Storage resolution failed: ${error?.message || "unknown error"}`);
  }

  const storagePaths = storage?.paths && typeof storage.paths === "object" ? storage.paths : {};
  const outputFolder = toLooseOptionalString(storagePaths.output);
  const successFolder = toLooseOptionalString(storagePaths.success);
  const processedFolder = toLooseOptionalString(storagePaths.processed);
  const postingXml =
    toLooseOptionalString(invoice?.postingRequestXml) ||
    toLooseOptionalString(payload?.posting_request_xml) ||
    toLooseOptionalString(payload?.postingRequestXml) ||
    toLooseOptionalString(payload?.voucher_request_xml) ||
    toLooseOptionalString(payload?.voucherRequestXml) ||
    toLooseOptionalString(payload?.tally_xml) ||
    toLooseOptionalString(payload?.tallyXml) ||
    null;

  const artifactStem = buildPostingArtifactStem(invoice);

  if (writeOutputXml && postingXml && outputFolder) {
    try {
      await mkdir(outputFolder, { recursive: true });
      const outputPath = await resolveUniquePath(outputFolder, `${artifactStem}_posting_request.xml`);
      await writeFile(outputPath, postingXml, "utf8");
      artifacts.outputPostingXmlPath = outputPath;
    } catch (error) {
      warnings.push(`Unable to write posting XML to output folder: ${error?.message || "unknown error"}`);
    }
  }

  if (writeSuccessXml && postingXml && successFolder) {
    try {
      await mkdir(successFolder, { recursive: true });
      const successPath = await resolveUniquePath(successFolder, `${artifactStem}_posting_success.xml`);
      await writeFile(successPath, postingXml, "utf8");
      artifacts.successPostingXmlPath = successPath;
    } catch (error) {
      warnings.push(`Unable to write posting XML to success folder: ${error?.message || "unknown error"}`);
    }
  }

  const sourcePath = toAbsoluteLocalPath(invoice?.originalFilePath);
  if (moveOriginalFile && sourcePath && processedFolder) {
    try {
      const processedRoot = path.resolve(processedFolder);
      const normalizedSource = path.resolve(sourcePath);
      const alreadyProcessed =
        normalizedSource === processedRoot || normalizedSource.startsWith(`${processedRoot}${path.sep}`);

      if (!alreadyProcessed && (await pathExists(normalizedSource))) {
        await mkdir(processedRoot, { recursive: true });
        const sourceFileName = sanitizeUploadFileName(invoice?.fileName || path.basename(normalizedSource) || "invoice");
        const targetPath = await resolveUniquePath(processedRoot, sourceFileName);
        await moveFileWithFallback(normalizedSource, targetPath);
        artifacts.processedOriginalFilePath = targetPath;
      }
    } catch (error) {
      warnings.push(`Unable to move original file to processed folder: ${error?.message || "unknown error"}`);
    }
  }

  return {
    movedOriginalFilePath: artifacts.processedOriginalFilePath,
    metadataPatch: {
      [metadataKey]: {
        ...artifacts,
        warnings
      }
    }
  };
};

const requireInvoiceId = (invoiceId) => {
  if (typeof invoiceId !== "string" || invoiceId.trim() === "") {
    throw createError("Invoice id is required", 400, "VALIDATION_ERROR");
  }

  const normalized = invoiceId.trim();
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (!uuidRegex.test(normalized)) {
    throw createError("Invoice id must be a valid UUID", 400, "VALIDATION_ERROR");
  }

  return normalized;
};

const toObject = (value, fieldName) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw createError(`${fieldName} must be an object`, 400, "VALIDATION_ERROR");
  }

  return value;
};

const toArray = (value, fieldName) => {
  if (value === undefined) {
    return [];
  }

  if (!Array.isArray(value)) {
    throw createError(`${fieldName} must be an array`, 400, "VALIDATION_ERROR");
  }

  return value;
};

const toOptionalString = (value) => {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  if (typeof value !== "string") {
    throw createError("Invalid text value in extraction payload", 400, "VALIDATION_ERROR");
  }

  return value.trim() || null;
};

const toOptionalNumber = (value, fieldName) => {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  if (typeof value !== "number" || Number.isNaN(value)) {
    throw createError(`${fieldName} must be a number`, 400, "VALIDATION_ERROR");
  }

  return value;
};

const toOptionalDate = (value, fieldName) => {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") {
    throw createError(`${fieldName} must be a string date`, 400, "VALIDATION_ERROR");
  }
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    throw createError(`${fieldName} must be in YYYY-MM-DD format`, 400, "VALIDATION_ERROR");
  }
  const date = new Date(`${trimmed}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) {
    throw createError(`${fieldName} is invalid`, 400, "VALIDATION_ERROR");
  }
  return trimmed;
};

const toOptionalFlexibleDate = (value, fieldName) => {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") {
    throw createError(`${fieldName} must be a string date`, 400, "VALIDATION_ERROR");
  }

  const trimmed = value.trim();
  if (!trimmed) return null;

  const normalizeYear = (textYear) => (textYear.length === 2 ? `20${textYear}` : textYear);
  const toCanonical = (year, month, day) =>
    toOptionalDate(
      `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
      fieldName
    );

  const ymdPrefix = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})(?:\b|T|\s|$)/);
  if (ymdPrefix) {
    return toCanonical(ymdPrefix[1], ymdPrefix[2], ymdPrefix[3]);
  }

  const yyyyMmDd = trimmed.match(/^(\d{4})[./-](\d{1,2})[./-](\d{1,2})(?:\b.*)?$/);
  if (yyyyMmDd) {
    return toCanonical(yyyyMmDd[1], yyyyMmDd[2], yyyyMmDd[3]);
  }

  const ddMmYyyy = trimmed.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})(?:\b.*)?$/);
  if (ddMmYyyy) {
    const first = Number(ddMmYyyy[1]);
    const second = Number(ddMmYyyy[2]);
    const year = normalizeYear(ddMmYyyy[3]);

    // Heuristic:
    // - if one side is >12, it's definitely day
    // - otherwise default to DD/MM for India-style invoices
    const day = first > 12 && second <= 12 ? first : second > 12 && first <= 12 ? second : first;
    const month = first > 12 && second <= 12 ? second : second > 12 && first <= 12 ? first : second;

    return toCanonical(year, month, day);
  }

  const monthMap = {
    jan: 1,
    january: 1,
    feb: 2,
    february: 2,
    mar: 3,
    march: 3,
    apr: 4,
    april: 4,
    may: 5,
    jun: 6,
    june: 6,
    jul: 7,
    july: 7,
    aug: 8,
    august: 8,
    sep: 9,
    sept: 9,
    september: 9,
    oct: 10,
    october: 10,
    nov: 11,
    november: 11,
    dec: 12,
    december: 12
  };

  const dayMonthNameYear = trimmed.match(/^(\d{1,2})[\s./-]+([a-zA-Z]{3,9})[\s./-]+(\d{2,4})(?:\b.*)?$/);
  if (dayMonthNameYear) {
    const day = Number(dayMonthNameYear[1]);
    const month = monthMap[String(dayMonthNameYear[2]).toLowerCase()];
    const year = normalizeYear(dayMonthNameYear[3]);
    if (month) return toCanonical(year, month, day);
  }

  const monthNameDayYear = trimmed.match(/^([a-zA-Z]{3,9})[\s./-]+(\d{1,2}),?[\s./-]+(\d{2,4})(?:\b.*)?$/);
  if (monthNameDayYear) {
    const month = monthMap[String(monthNameDayYear[1]).toLowerCase()];
    const day = Number(monthNameDayYear[2]);
    const year = normalizeYear(monthNameDayYear[3]);
    if (month) return toCanonical(year, month, day);
  }

  const parsedTime = Date.parse(trimmed);
  if (!Number.isNaN(parsedTime)) {
    const parsedDate = new Date(parsedTime);
    const localDate = `${parsedDate.getFullYear()}-${String(parsedDate.getMonth() + 1).padStart(2, "0")}-${String(parsedDate.getDate()).padStart(2, "0")}`;
    return toOptionalDate(localDate, fieldName);
  }

  throw createError(`${fieldName} must be in YYYY-MM-DD format`, 400, "VALIDATION_ERROR");
};

const resolveDocumentType = (value) => {
  const normalized = toOptionalString(value);
  if (!normalized) {
    throw createError("document_type is required", 400, "VALIDATION_ERROR");
  }

  const upper = normalized.toUpperCase();
  if (upper === "PURCHASE_INVOICE" || upper === "PURCHASE") return "PURCHASE_INVOICE";
  if (upper === "SALES_INVOICE" || upper === "SALES") return "SALES_INVOICE";

  throw createError("document_type must be PURCHASE_INVOICE or SALES_INVOICE", 400, "VALIDATION_ERROR");
};

const resolveBulkDocumentType = (value) => {
  const normalized = toOptionalString(value);
  if (!normalized || normalized.toUpperCase() === "AUTO") {
    return null;
  }

  const upper = normalized.toUpperCase();
  if (upper === "PURCHASE_INVOICE" || upper === "PURCHASE") return "PURCHASE_INVOICE";
  if (upper === "SALES_INVOICE" || upper === "SALES") return "SALES_INVOICE";

  throw createError("documentType must be AUTO, PURCHASE_INVOICE, or SALES_INVOICE", 400, "VALIDATION_ERROR");
};

const normalizeRegisterPayload = (context, payload = {}) => {
  const branchId = toOptionalString(payload.branch_id || payload.branchId) || context.branchId;
  if (!branchId) {
    throw createError("branch_id is required", 400, "VALIDATION_ERROR");
  }

  const originalFilePath = toOptionalString(payload.original_file_path || payload.originalFilePath);
  if (!originalFilePath) {
    throw createError("original_file_path is required", 400, "VALIDATION_ERROR");
  }

  const documentType = resolveDocumentType(payload.document_type ?? payload.documentType ?? payload.invoice_type ?? payload.invoiceType);
  const sourceHash = toOptionalString(payload.source_hash ?? payload.sourceHash);
  const invoiceNumber = toOptionalString(payload.invoice_number ?? payload.invoiceNumber);
  const invoiceDate = toOptionalDate(payload.invoice_date ?? payload.invoiceDate, "invoice_date");
  const totalAmount = toOptionalNumber(payload.total_amount ?? payload.totalAmount, "total_amount");
  const partyGstin = toOptionalString(payload.party_gstin ?? payload.partyGstin);

  const dedupeKey = buildDedupeKey({
    partyGstin,
    invoiceNumber,
    invoiceDate,
    totalAmount
  });

  return {
    branchId,
    documentType,
    sourceHash,
    dedupeKey,
    originalFilePath,
    fileName: toOptionalString(payload.file_name ?? payload.fileName),
    mimeType: toOptionalString(payload.mime_type ?? payload.mimeType),
    invoiceNumber,
    invoiceDate,
    dueDate: toOptionalDate(payload.due_date ?? payload.dueDate, "due_date"),
    partyName: toOptionalString(payload.party_name ?? payload.partyName),
    partyGstin,
    partyAddress: toOptionalString(payload.party_address ?? payload.partyAddress),
    currency: toOptionalString(payload.currency) || "INR",
    subtotal: toOptionalNumber(payload.subtotal, "subtotal"),
    taxableAmount: toOptionalNumber(payload.taxable_amount ?? payload.taxableAmount, "taxable_amount"),
    cgstAmount: toOptionalNumber(payload.cgst_amount ?? payload.cgstAmount, "cgst_amount"),
    sgstAmount: toOptionalNumber(payload.sgst_amount ?? payload.sgstAmount, "sgst_amount"),
    igstAmount: toOptionalNumber(payload.igst_amount ?? payload.igstAmount, "igst_amount"),
    cessAmount: toOptionalNumber(payload.cess_amount ?? payload.cessAmount, "cess_amount"),
    roundOffAmount: toOptionalNumber(payload.round_off_amount ?? payload.roundOffAmount, "round_off_amount"),
    totalAmount,
    extractedJson: payload.extracted_json ? toObject(payload.extracted_json, "extracted_json") : null,
    createdByUserId: context.userId || null
  };
};

const normalizeActivityPayload = (payload = {}) => {
  const actionType = toOptionalString(payload.action_type || payload.actionType);
  if (!actionType) {
    throw createError("action_type is required", 400, "VALIDATION_ERROR");
  }

  return {
    actionType,
    notes: toOptionalString(payload.notes),
    oldValue: payload.old_value ? toObject(payload.old_value, "old_value") : null,
    newValue: payload.new_value ? toObject(payload.new_value, "new_value") : null,
    metadata: payload.metadata ? toObject(payload.metadata, "metadata") : {},
    performedByUserId: null
  };
};

const toRetryCount = (value, fallback = 0) => {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }

  if (!Number.isInteger(value) || value < 0) {
    throw createError("retry_count must be a non-negative integer", 400, "VALIDATION_ERROR");
  }

  return value;
};

const normalizeDedupeToken = (value, { upper = true, alnumOnly = false } = {}) => {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  if (!text) return null;
  const compact = text.replace(/\s+/g, "");
  const cleaned = alnumOnly ? compact.replace(/[^a-zA-Z0-9]/g, "") : compact;
  if (!cleaned) return null;
  return upper ? cleaned.toUpperCase() : cleaned;
};

const normalizeInvoiceDateToken = (value) => {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
};

const normalizeRoundedAmountToken = (value) => {
  if (value === undefined || value === null || value === "") return null;
  const numeric = typeof value === "number" ? value : Number(value);
  if (Number.isNaN(numeric)) return null;
  return String(Math.round(numeric));
};

const buildDedupeKey = ({ partyGstin, invoiceNumber, invoiceDate, totalAmount }) => {
  const gstinToken = normalizeDedupeToken(partyGstin, { upper: true, alnumOnly: true });
  const invoiceNumberToken = normalizeDedupeToken(invoiceNumber, { upper: true, alnumOnly: true });
  const invoiceDateToken = normalizeInvoiceDateToken(invoiceDate);
  const roundedTotalToken = normalizeRoundedAmountToken(totalAmount);

  if (!gstinToken || !invoiceNumberToken || !invoiceDateToken || !roundedTotalToken) {
    return null;
  }

  return `${gstinToken}|${invoiceNumberToken}|${invoiceDateToken}|${roundedTotalToken}`;
};

const allowedExtractionStatuses = new Set(["SUCCESS", "PARTIAL", "RETRYABLE", "FAILED"]);

const normalizeExtractionPayload = (payload) => {
  const extractionStatus = toOptionalString(payload.extraction_status)?.toUpperCase();

  if (!allowedExtractionStatuses.has(extractionStatus)) {
    throw createError(
      "extraction_status must be SUCCESS, PARTIAL, RETRYABLE, or FAILED",
      400,
      "VALIDATION_ERROR"
    );
  }

  const normalizedFields = payload.normalized_fields === undefined ? {} : toObject(payload.normalized_fields, "normalized_fields");

  return {
    extractionStatus,
    retryCount: toRetryCount(payload.retry_count),
    rawModelOutput: toObject(payload.raw_model_output || {}, "raw_model_output"),
    extractedJson: toObject(payload.extracted_json || {}, "extracted_json"),
    normalizedFields: {
      invoice_number: toOptionalString(normalizedFields.invoice_number),
      invoice_date: toOptionalFlexibleDate(normalizedFields.invoice_date, "normalized_fields.invoice_date"),
      due_date: toOptionalFlexibleDate(normalizedFields.due_date, "normalized_fields.due_date"),
      party_name: toOptionalString(normalizedFields.party_name),
      party_gstin: toOptionalString(normalizedFields.party_gstin),
      party_address: toOptionalString(normalizedFields.party_address),
      currency: toOptionalString(normalizedFields.currency),
      subtotal: toOptionalNumber(normalizedFields.subtotal, "normalized_fields.subtotal"),
      taxable_amount: toOptionalNumber(normalizedFields.taxable_amount, "normalized_fields.taxable_amount"),
      cgst_amount: toOptionalNumber(normalizedFields.cgst_amount, "normalized_fields.cgst_amount"),
      sgst_amount: toOptionalNumber(normalizedFields.sgst_amount, "normalized_fields.sgst_amount"),
      igst_amount: toOptionalNumber(normalizedFields.igst_amount, "normalized_fields.igst_amount"),
      cess_amount: toOptionalNumber(normalizedFields.cess_amount, "normalized_fields.cess_amount"),
      round_off_amount: toOptionalNumber(normalizedFields.round_off_amount, "normalized_fields.round_off_amount"),
      total_amount: toOptionalNumber(normalizedFields.total_amount, "normalized_fields.total_amount"),
      dedupe_key: toOptionalString(normalizedFields.dedupe_key),
      source_hash: toOptionalString(normalizedFields.source_hash)
    },
    confidenceScore: toOptionalNumber(payload.confidence_score, "confidence_score"),
    lowConfidenceFields: toArray(payload.low_confidence_fields, "low_confidence_fields"),
    warnings: toArray(payload.warnings, "warnings"),
    salvaged: Boolean(payload.salvaged),
    extractionErrorMessage: toOptionalString(payload.error_message)
  };
};

const resolveBusinessStatus = (extractionStatus, retryCount) => {
  if (extractionStatus === "SUCCESS" || extractionStatus === "PARTIAL") {
    return "PENDING_REVIEW";
  }

  return retryCount < maxExtractionRetries ? "EXTRACTING" : "FAILED";
};

const resolveStoredExtractionStatus = (extractionStatus, retryCount) => {
  if (extractionStatus === "RETRYABLE" || extractionStatus === "FAILED") {
    return retryCount < maxExtractionRetries ? "RETRYABLE" : "FAILED";
  }

  return extractionStatus;
};

const ensureInvoice = async (invoiceId, tenantId, client) => {
  const invoice = await invoiceExtractionRepository.findById(invoiceId, tenantId, client);
  if (!invoice) {
    throw createError("Invoice not found for tenant", 404, "INVOICE_NOT_FOUND");
  }
  return invoice;
};

const normalizeScopeValue = (value) => {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed || null;
};

const resolveDashboardScope = (context, query = {}) => {
  const requestedTenantId = normalizeScopeValue(query.tenantId);
  const requestedBranchId = normalizeScopeValue(query.branchId);

  if (requestedTenantId && context.role !== "SUPER_ADMIN" && requestedTenantId !== context.tenantId) {
    throw createError("Forbidden", 403, "FORBIDDEN");
  }

  return {
    tenantId: requestedTenantId || context.tenantId,
    branchId: requestedBranchId !== null ? requestedBranchId : context.branchId
  };
};

const normalizeQueryText = (value) => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed || null;
};

const resolveListScope = (context, query = {}) => {
  const requestedTenantId = normalizeScopeValue(query.tenantId);
  const requestedBranchId = normalizeScopeValue(query.branchId);

  if (requestedTenantId && context.role !== "SUPER_ADMIN" && requestedTenantId !== context.tenantId) {
    throw createError("Forbidden", 403, "FORBIDDEN");
  }

  return {
    tenantId: requestedTenantId || context.tenantId,
    branchId: requestedBranchId !== null ? requestedBranchId : context.branchId
  };
};

const isAbsoluteHttpUrl = (value) => /^https?:\/\//i.test(String(value || ""));

const normalizeWebhookEndpoint = (value) => {
  const raw = toOptionalString(value);
  if (!raw) return null;
  if (isAbsoluteHttpUrl(raw)) return raw;
  return raw.startsWith("/") ? raw : `/${raw}`;
};

const resolveWebhookUrl = (baseUrl, endpoint) => {
  const normalizedEndpoint = normalizeWebhookEndpoint(endpoint);
  if (!normalizedEndpoint) return null;
  if (isAbsoluteHttpUrl(normalizedEndpoint)) return normalizedEndpoint;

  const normalizedBaseUrl = typeof baseUrl === "string" ? baseUrl.trim() : "";
  if (!normalizedBaseUrl) return null;

  return `${normalizedBaseUrl.replace(/\/+$/, "")}${normalizedEndpoint}`;
};

const normalizePostingReviewMode = (value) => {
  const mode = toOptionalString(value);
  const normalized = String(mode || "AUTO_POST").toUpperCase();
  return normalized === "REVIEW_BEFORE_POSTING" ? "REVIEW_BEFORE_POSTING" : "AUTO_POST";
};

const fetchWithTimeout = async (url, options = {}, timeoutMs = 10000) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
};

const resolveTallyEndpointUrl = (baseUrl, port) => {
  const raw = toOptionalString(baseUrl);
  if (!raw) {
    throw createError("tallyBaseUrl is missing", 422, "TALLY_CONFIG_INVALID");
  }

  const normalized = /^https?:\/\//i.test(raw) ? raw : `http://${raw}`;
  const url = new URL(normalized);
  if (Number.isInteger(port) && port > 0 && !url.port) {
    url.port = String(port);
  }
  return url.toString();
};

const parseTallyTagNumber = (xmlText, tagName) => {
  const match = String(xmlText || "").match(new RegExp(`<${tagName}>\\s*(-?\\d+)\\s*</${tagName}>`, "i"));
  if (!match) return 0;
  const numeric = Number(match[1]);
  return Number.isNaN(numeric) ? 0 : numeric;
};

const escapeXmlText = (value) =>
  String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");

const injectCurrentCompanyInImportXml = (xmlText, companyName) => {
  const sourceXml = toOptionalString(xmlText);
  const safeCompanyName = toOptionalString(companyName);
  if (!sourceXml || !safeCompanyName) return sourceXml;

  if (/<SVCURRENTCOMPANY>\s*[\s\S]*?<\/SVCURRENTCOMPANY>/i.test(sourceXml)) {
    return sourceXml;
  }

  const companyTag = `<SVCURRENTCOMPANY>${escapeXmlText(safeCompanyName)}</SVCURRENTCOMPANY>`;

  if (/<STATICVARIABLES>/i.test(sourceXml)) {
    return sourceXml.replace(/<STATICVARIABLES>/i, `<STATICVARIABLES>${companyTag}`);
  }

  if (/<REQUESTDESC>/i.test(sourceXml)) {
    return sourceXml.replace(/<\/REQUESTDESC>/i, `<STATICVARIABLES>${companyTag}</STATICVARIABLES></REQUESTDESC>`);
  }

  return sourceXml;
};

const injectPartyBillAllocationInVoucherXml = (xmlText) => {
  const sourceXml = toOptionalString(xmlText);
  if (!sourceXml) return sourceXml;
  if (/<BILLALLOCATIONS\.LIST>/i.test(sourceXml)) return sourceXml;

  const voucherNumberMatch = sourceXml.match(/<VOUCHERNUMBER>([\s\S]*?)<\/VOUCHERNUMBER>/i);
  const referenceMatch = sourceXml.match(/<REFERENCE>([\s\S]*?)<\/REFERENCE>/i);
  const allocationName =
    toOptionalString(referenceMatch?.[1]) ||
    toOptionalString(voucherNumberMatch?.[1]) ||
    "AUTO-REF";

  let injected = false;
  const updatedXml = sourceXml.replace(/<ALLLEDGERENTRIES\.LIST>[\s\S]*?<\/ALLLEDGERENTRIES\.LIST>/gi, (block) => {
    if (injected) return block;
    if (/<BILLALLOCATIONS\.LIST>/i.test(block)) return block;

    const isDeemedPositiveYes = /<ISDEEMEDPOSITIVE>\s*Yes\s*<\/ISDEEMEDPOSITIVE>/i.test(block);
    const amountMatch = block.match(/<AMOUNT>\s*([^<]+)\s*<\/AMOUNT>/i);
    if (!isDeemedPositiveYes || !amountMatch) return block;

    const rawAmount = String(amountMatch[1] || "").trim();
    const numericAmount = Number(rawAmount.replace(/,/g, ""));
    if (!Number.isFinite(numericAmount) || numericAmount >= 0) return block;

    const billAllocXml = [
      "<BILLALLOCATIONS.LIST>",
      `  <NAME>${escapeXmlText(allocationName)}</NAME>`,
      "  <BILLTYPE>New Ref</BILLTYPE>",
      `  <AMOUNT>${rawAmount}</AMOUNT>`,
      "</BILLALLOCATIONS.LIST>"
    ].join("");

    injected = true;
    return block.replace(/<\/ALLLEDGERENTRIES\.LIST>/i, `${billAllocXml}</ALLLEDGERENTRIES.LIST>`);
  });

  return injected ? updatedXml : sourceXml;
};

const convertInventoryVoucherToAccountingVoucherXml = (xmlText) => {
  const sourceXml = toOptionalString(xmlText);
  if (!sourceXml) return sourceXml;
  if (!/<ALLINVENTORYENTRIES\.LIST>/i.test(sourceXml)) return sourceXml;

  const inventoryBlocks = Array.from(sourceXml.matchAll(/<ALLINVENTORYENTRIES\.LIST>[\s\S]*?<\/ALLINVENTORYENTRIES\.LIST>/gi))
    .map((match) => String(match[0] || ""));
  if (!inventoryBlocks.length) return sourceXml;

  let taxableAmount = 0;
  let purchaseLedgerName = null;

  for (const block of inventoryBlocks) {
    const amountMatch = block.match(/<AMOUNT>\s*([^<]+)\s*<\/AMOUNT>/i);
    if (amountMatch) {
      const n = Number(String(amountMatch[1]).replace(/,/g, "").trim());
      if (Number.isFinite(n)) taxableAmount += Math.abs(n);
    }

    if (!purchaseLedgerName) {
      const ledgerMatch = block.match(
        /<ACCOUNTINGALLOCATIONS\.LIST>[\s\S]*?<LEDGERNAME>\s*([^<]+)\s*<\/LEDGERNAME>[\s\S]*?<\/ACCOUNTINGALLOCATIONS\.LIST>/i
      );
      const ledger = toOptionalString(ledgerMatch?.[1]);
      if (ledger) purchaseLedgerName = ledger;
    }
  }

  let updatedXml = sourceXml
    .replace(/<ALLINVENTORYENTRIES\.LIST>[\s\S]*?<\/ALLINVENTORYENTRIES\.LIST>/gi, "")
    .replace(/\s*<ISINVOICE>\s*Yes\s*<\/ISINVOICE>\s*/gi, "\n")
    .replace(/\s*<PERSISTEDVIEW>\s*Invoice Voucher View\s*<\/PERSISTEDVIEW>\s*/gi, "\n");

  const hasVoucherLevelPurchaseLedger =
    Boolean(purchaseLedgerName) &&
    new RegExp(
      `<ALLLEDGERENTRIES\\.LIST>[\\s\\S]*?<LEDGERNAME>\\s*${purchaseLedgerName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*<\\/LEDGERNAME>[\\s\\S]*?<\\/ALLLEDGERENTRIES\\.LIST>`,
      "i"
    ).test(updatedXml);

  if (!hasVoucherLevelPurchaseLedger && purchaseLedgerName && taxableAmount > 0) {
    const purchaseEntryXml = [
      "<ALLLEDGERENTRIES.LIST>",
      `  <LEDGERNAME>${escapeXmlText(purchaseLedgerName)}</LEDGERNAME>`,
      "  <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>",
      `  <AMOUNT>${taxableAmount.toFixed(2)}</AMOUNT>`,
      "</ALLLEDGERENTRIES.LIST>"
    ].join("");
    updatedXml = updatedXml.replace(/<\/VOUCHER>/i, `${purchaseEntryXml}</VOUCHER>`);
  }

  return updatedXml;
};

const parseTallyPostingResponse = (xmlText, fallbackVoucherType = null, fallbackVoucherNumber = null) => {
  const created = parseTallyTagNumber(xmlText, "CREATED");
  const altered = parseTallyTagNumber(xmlText, "ALTERED");
  const errors = parseTallyTagNumber(xmlText, "ERRORS");
  const exceptions = parseTallyTagNumber(xmlText, "EXCEPTIONS");
  const lineErrors = Array.from(String(xmlText || "").matchAll(/<LINEERROR>([\s\S]*?)<\/LINEERROR>/gi))
    .map((match) => String(match[1] || "").trim())
    .filter(Boolean);
  const exceptionReasons = Array.from(String(xmlText || "").matchAll(/<EXCEPTION>([\s\S]*?)<\/EXCEPTION>/gi))
    .map((match) => String(match[1] || "").trim())
    .filter(Boolean);
  const allReasons = [...lineErrors, ...exceptionReasons].filter(Boolean);
  const voucherNumberMatch = String(xmlText || "").match(/<VOUCHERNUMBER>([^<]+)<\/VOUCHERNUMBER>/i);
  const voucherTypeMatch = String(xmlText || "").match(/<VOUCHERTYPENAME>([^<]+)<\/VOUCHERTYPENAME>/i);

  const hasHardError = errors > 0 || exceptions > 0 || allReasons.length > 0;
  const hasPositiveWrite = created > 0 || altered > 0;
  const status = !hasHardError && hasPositiveWrite ? "SUCCESS" : "FAILED";

  return {
    status,
    summary: { created, altered, errors, exceptions },
    message:
      status === "SUCCESS"
        ? "Tally posting completed successfully"
        : allReasons[0] || "Tally response indicates posting failure",
    lineErrors: allReasons,
    tallyVoucherType: toOptionalString(voucherTypeMatch?.[1]) || fallbackVoucherType,
    tallyVoucherNumber: toOptionalString(voucherNumberMatch?.[1]) || fallbackVoucherNumber,
    responsePreview: String(xmlText || "").slice(0, 2000)
  };
};

const toOptionalAnyString = (value) => {
  if (value === undefined || value === null) return null;
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed || null;
  }
  if (typeof value === "number" || typeof value === "bigint") {
    return String(value);
  }
  return null;
};

const parseVoucherHintsFromText = (value) => {
  const text = toOptionalAnyString(value);
  if (!text) return { voucherType: null, voucherNumber: null };

  const voucherTypeXml = toLooseOptionalString(text.match(/<VOUCHERTYPENAME>([\s\S]*?)<\/VOUCHERTYPENAME>/i)?.[1]);
  const voucherNumberXml = toLooseOptionalString(text.match(/<VOUCHERNUMBER>([\s\S]*?)<\/VOUCHERNUMBER>/i)?.[1]);

  const voucherTypeJson =
    toLooseOptionalString(text.match(/"(?:tallyVoucherType|tally_voucher_type|voucherType|voucher_type)"\s*:\s*"([^"]+)"/i)?.[1]) ||
    toLooseOptionalString(text.match(/(?:tallyVoucherType|tally_voucher_type|voucherType|voucher_type)\s*[:=]\s*([A-Za-z0-9 _./-]+)/i)?.[1]);

  const voucherNumberJson =
    toLooseOptionalString(text.match(/"(?:tallyVoucherNumber|tally_voucher_number|voucherNumber|voucher_number)"\s*:\s*"([^"]+)"/i)?.[1]) ||
    toLooseOptionalString(text.match(/"(?:tallyVoucherNumber|tally_voucher_number|voucherNumber|voucher_number)"\s*:\s*([0-9]+)/i)?.[1]) ||
    toLooseOptionalString(text.match(/(?:tallyVoucherNumber|tally_voucher_number|voucherNumber|voucher_number)\s*[:=]\s*([A-Za-z0-9./-]+)/i)?.[1]) ||
    toLooseOptionalString(text.match(/voucher\s*(?:no|number)\s*[:=]\s*([A-Za-z0-9./-]+)/i)?.[1]);

  return {
    voucherType: voucherTypeXml || voucherTypeJson || null,
    voucherNumber: voucherNumberXml || voucherNumberJson || null
  };
};

const toPostingResponseMetadata = (payload = {}) => {
  const raw =
    payload.tally_response_metadata ??
    payload.tallyResponseMetadata ??
    payload.response_metadata ??
    null;

  if (raw === undefined || raw === null || raw === "") return {};
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed;
      return { raw: raw.slice(0, 4000) };
    } catch {
      return { raw: raw.slice(0, 4000) };
    }
  }

  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    return raw;
  }

  throw createError("tally_response_metadata must be an object", 400, "VALIDATION_ERROR");
};

const resolvePostedVoucherDetails = ({ payload = {}, responseMetadata = {}, invoice = null } = {}) => {
  let voucherType =
    toOptionalAnyString(payload.tally_voucher_type) ||
    toOptionalAnyString(payload.tallyVoucherType) ||
    toOptionalAnyString(payload.voucher_type) ||
    toOptionalAnyString(payload.voucherType) ||
    toOptionalAnyString(responseMetadata.tally_voucher_type) ||
    toOptionalAnyString(responseMetadata.tallyVoucherType) ||
    toOptionalAnyString(responseMetadata.voucher_type) ||
    toOptionalAnyString(responseMetadata.voucherType) ||
    null;

  let voucherNumber =
    toOptionalAnyString(payload.tally_voucher_number) ||
    toOptionalAnyString(payload.tallyVoucherNumber) ||
    toOptionalAnyString(payload.voucher_number) ||
    toOptionalAnyString(payload.voucherNumber) ||
    toOptionalAnyString(responseMetadata.tally_voucher_number) ||
    toOptionalAnyString(responseMetadata.tallyVoucherNumber) ||
    toOptionalAnyString(responseMetadata.voucher_number) ||
    toOptionalAnyString(responseMetadata.voucherNumber) ||
    null;

  const textSources = [
    payload.tally_response_raw,
    payload.tallyResponseRaw,
    payload.responsePreview,
    payload.response_preview,
    payload.response,
    payload.rawResponse,
    responseMetadata.responsePreview,
    responseMetadata.response_preview,
    responseMetadata.response,
    responseMetadata.rawResponse
  ];

  if (responseMetadata.payload && typeof responseMetadata.payload === "object") {
    try {
      textSources.push(JSON.stringify(responseMetadata.payload));
    } catch {
      // ignore circular payloads
    }
  }

  if (invoice?.postingRequestXml) {
    textSources.push(invoice.postingRequestXml);
  }

  for (const source of textSources) {
    const hints = parseVoucherHintsFromText(source);
    if (!voucherType && hints.voucherType) {
      voucherType = hints.voucherType;
    }
    if (!voucherNumber && hints.voucherNumber) {
      voucherNumber = hints.voucherNumber;
    }
    if (voucherType && voucherNumber) break;
  }

  return {
    voucherType,
    voucherNumber
  };
};

const isIgnorableTallyMasterLineError = (lineError) => {
  const text = String(lineError || "").trim();
  if (!text) return false;

  if (/^Cannot alter Units of\b/i.test(text)) {
    return true;
  }

  if (/Stock Group\s+(?:'|&apos;)?Primary(?:'|&apos;)?\s+does not exist!?/i.test(text)) {
    return true;
  }

  return false;
};

const resolveInvoiceListFilters = (query = {}) => {
  const documentTypeInput = normalizeQueryText(query.documentType || query.invoiceType);
  const documentType =
    documentTypeInput === "purchase" || documentTypeInput === "PURCHASE_INVOICE"
      ? "PURCHASE_INVOICE"
      : documentTypeInput === "sales" || documentTypeInput === "SALES_INVOICE"
        ? "SALES_INVOICE"
        : null;

  const status = normalizeQueryText(query.status);
  const extractionStatus = normalizeQueryText(query.extractionStatus);
  const dateRange = normalizeQueryText(query.dateRange);
  const duplicateFlag = normalizeQueryText(query.duplicateFlag)?.toLowerCase() || null;

  return {
    search: normalizeQueryText(query.search),
    documentType,
    status: status && status !== "all-status" ? status : null,
    extractionStatus: extractionStatus && extractionStatus !== "all" ? extractionStatus : null,
    dateRange: dateRange && dateRange !== "all" ? dateRange : null,
    duplicateFlag: duplicateFlag === "yes" || duplicateFlag === "no" ? duplicateFlag : null
  };
};

export const invoicesService = {
  async bulkUploadInvoices({ context, body = {}, files = [] }) {
    const requestedTenantId = toOptionalString(body.tenantId ?? body.tenant_id);
    const requestedBranchId = toOptionalString(body.branchId ?? body.branch_id);
    const tenantId = context.role === "SUPER_ADMIN" ? requestedTenantId : (context.tenantId || requestedTenantId);
    const branchId = context.role === "SUPER_ADMIN" ? requestedBranchId : (context.branchId || requestedBranchId);
    const documentType = resolveBulkDocumentType(body.documentType ?? body.document_type);

    if (!tenantId) {
      throw createError("tenantId is required", 400, "VALIDATION_ERROR");
    }

    if (!branchId) {
      throw createError("branchId is required", 400, "VALIDATION_ERROR");
    }

    if (!Array.isArray(files) || files.length === 0) {
      throw createError("files[] is required", 400, "VALIDATION_ERROR");
    }
    if (files.length > maxBulkUploadFiles) {
      throw createError(`Maximum ${maxBulkUploadFiles} files are allowed per upload request`, 400, "FILE_LIMIT_EXCEEDED");
    }

    if (context.role !== "SUPER_ADMIN" && context.tenantId && context.tenantId !== tenantId) {
      throw createError("Forbidden", 403, "FORBIDDEN");
    }
    if (context.role !== "SUPER_ADMIN" && context.branchId && context.branchId !== branchId) {
      throw createError("Forbidden", 403, "FORBIDDEN");
    }

    const branchExists = await invoiceRuntimeRepository.branchExistsForTenant(tenantId, branchId);
    if (!branchExists) {
      throw createError("branchId is invalid for tenantId", 400, "VALIDATION_ERROR");
    }

    const storage = await storageService.resolveStoragePaths({ tenantId, branchId });
    const incomingPath = toOptionalString(storage?.paths?.incoming);
    const runtimePaths = storage?.paths && typeof storage.paths === "object" ? storage.paths : {};

    if (!incomingPath) {
      throw createError("Incoming storage path is not configured", 422, "STORAGE_CONFIG_INVALID");
    }

    const resolvedIncomingPath = resolveSafeDirectoryPath(incomingPath, "Incoming storage path");
    await mkdir(resolvedIncomingPath, { recursive: true });

    const batchId = randomUUID();
    const items = [];
    const errors = [];
    const n8nDispatch = {
      attempted: false,
      dispatched: 0,
      skippedReason: null
    };

    for (const file of files) {
      const fileName = sanitizeUploadFileName(file?.originalname);
      const mimeType = toOptionalString(file?.mimetype)?.toLowerCase() || null;
      const fileBuffer = file?.buffer;
      const fileSize = Number(file?.size || 0);

      if (!Buffer.isBuffer(fileBuffer) || fileSize <= 0) {
        errors.push({ fileName, code: "EMPTY_FILE", message: "File is empty" });
        continue;
      }

      if (!mimeType || !allowedUploadMimeTypes.has(mimeType)) {
        errors.push({ fileName, code: "UNSUPPORTED_MIME_TYPE", message: "Unsupported file type" });
        continue;
      }

      const storedName = `${Date.now()}-${randomUUID()}-${fileName}`;
      const originalFilePath = resolveSafeChildPath(resolvedIncomingPath, storedName);
      const sourceHash = createHash("sha256").update(fileBuffer).digest("hex");

      try {
        await writeFile(originalFilePath, fileBuffer);

        const created = await invoiceRuntimeRepository.insertUploadedInvoice(tenantId, {
          branchId,
          documentType,
          fileName,
          mimeType,
          originalFilePath,
          sourceHash,
          dedupeKey: null,
          createdByUserId: context.userId || null
        });

        if (!created) {
          errors.push({ fileName, code: "CREATE_FAILED", message: "Failed to create invoice record" });
          continue;
        }

        items.push({
          fileName,
          invoiceId: created.id,
          status: created.status,
          mimeType: created.mimeType,
          documentType: created.documentType || "AUTO",
          _filePath: originalFilePath
        });
      } catch (error) {
        if (error?.code === "23505" && String(error.constraint || "").includes("source_hash")) {
          errors.push({ fileName, code: "SOURCE_HASH_EXISTS", message: "Duplicate file detected by source hash" });
          continue;
        }

        errors.push({
          fileName,
          code: error?.code || "UPLOAD_FAILED",
          message: error?.message || "Failed to upload file"
        });
      }
    }

    // Fire n8n extraction webhooks (fire-and-forget) for every successfully registered invoice
    if (items.length > 0) {
      n8nDispatch.attempted = true;
      const n8nConfig = await superAdminTenantRepository
        .findN8nConfigByTenantId(tenantId)
        .catch(() => null);

      if (n8nConfig?.isActive && n8nConfig?.n8nBaseUrl && n8nConfig?.extractionWebhookPlaceholder) {
        const baseUrl = n8nConfig.n8nBaseUrl.replace(/\/+$/, "");
        const hookPath = n8nConfig.extractionWebhookPlaceholder.startsWith("/")
          ? n8nConfig.extractionWebhookPlaceholder
          : `/${n8nConfig.extractionWebhookPlaceholder}`;
        const webhookUrl = `${baseUrl}${hookPath}`;
        const workflowKey = String(n8nConfig.workflowKeyToken || "").trim();
        const backendApiBaseUrl = toOptionalString(n8nConfig.backendApiBaseUrl);
        if (!workflowKey) {
          n8nDispatch.skippedReason = "N8N_WORKFLOW_KEY_MISSING";
          console.warn(`[n8n] Skipping extraction webhook for tenant ${tenantId}: workflowKeyToken missing`);
          return {
            batchId,
            items: items.map(({ _filePath: _fp, ...rest }) => rest),
            errors,
            n8n: n8nDispatch
          };
        }

        for (const item of items) {
          const headers = { "Content-Type": "application/json" };
          headers["x-workflow-key"] = workflowKey;

          fetch(webhookUrl, {
            method: "POST",
            headers,
            body: JSON.stringify({
              batchId,
              invoiceId: item.invoiceId,
              tenantId,
              branchId,
              documentType: item.documentType,
              fileName: item.fileName,
              filePath: item._filePath,
              originalPath: item._filePath,
              originalFilePath: item._filePath,
              mimeType: item.mimeType || null,
              backendApiBaseUrl: backendApiBaseUrl || null,
              n8nRootFolder: n8nConfig.n8nRootFolder || null,
              runtimeContext: {
                invoiceId: item.invoiceId,
                tenantId,
                branchId,
                requestId: context.requestId || null,
                authToken: null,
                apiBaseUrl: backendApiBaseUrl || null,
                storageMode: storage?.storageMode || null,
                paths: {
                  incoming: runtimePaths.incoming || null,
                  review: runtimePaths.review || null,
                  processed: runtimePaths.processed || null,
                  success: runtimePaths.success || null,
                  exception: runtimePaths.exception || null,
                  output: runtimePaths.output || null
                }
              },
              runtimeConfig: {
                tenantId,
                branchId,
                apiBaseUrl: backendApiBaseUrl || null,
                paths: {
                  incoming: runtimePaths.incoming || null,
                  review: runtimePaths.review || null,
                  processed: runtimePaths.processed || null,
                  success: runtimePaths.success || null,
                  exception: runtimePaths.exception || null,
                  output: runtimePaths.output || null
                }
              },
              incomingFolder: runtimePaths.incoming || null,
              reviewFolder: runtimePaths.review || null,
              processedFolder: runtimePaths.processed || null,
              successFolder: runtimePaths.success || null,
              exceptionFolder: runtimePaths.exception || null,
              outputFolder: runtimePaths.output || null
            })
          }).catch((err) => {
            console.error(`[n8n] Extraction webhook failed for invoice ${item.invoiceId}: ${err.message}`);
          });

          n8nDispatch.dispatched += 1;
        }
      } else if (!n8nConfig?.isActive) {
        n8nDispatch.skippedReason = "N8N_INACTIVE";
        console.warn(`[n8n] Skipping extraction webhook for tenant ${tenantId}: config missing or inactive`);
      } else {
        n8nDispatch.skippedReason = "N8N_WEBHOOK_NOT_CONFIGURED";
        console.warn(
          `[n8n] Skipping extraction webhook for tenant ${tenantId}: n8nBaseUrl/extractionWebhookPlaceholder missing`
        );
      }
    }

    return {
      batchId,
      items: items.map(({ _filePath: _fp, ...rest }) => rest),
      errors,
      n8n: n8nDispatch
    };
  },

  async registerInvoice(context, payload = {}) {
    const normalized = normalizeRegisterPayload(context, payload);

    try {
      return await invoiceRuntimeRepository.registerInvoice(context.tenantId, normalized);
    } catch (error) {
      if (error?.code === "23505") {
        if (String(error.constraint || "").includes("source_hash")) {
          throw createError("Invoice already registered for this source_hash", 409, "SOURCE_HASH_EXISTS");
        }
        if (String(error.constraint || "").includes("dedupe")) {
          throw createError("Invoice dedupe_key conflict", 409, "DEDUPE_KEY_CONFLICT");
        }
      }
      throw error;
    }
  },

  async dashboard(context, query = {}) {
    const scope = resolveDashboardScope(context, query);
    const dateRange = normalizeQueryText(query.dateRange);

    const { statusRows, perDayRows, vendorRows, topPartyRows, typeSplitRows } = await invoiceReadRepository.getDashboardRows(
      scope.tenantId,
      scope.branchId,
      dateRange
    );

    const statusMap = new Map(statusRows.map((row) => [row.status, row.count]));
    const typeSplitMap = new Map(typeSplitRows.map((row) => [row.documentType, row]));
    const vendorPartyRows = topPartyRows
      .filter((row) => row.documentType === "PURCHASE_INVOICE")
      .slice(0, 5)
      .map((row) => ({ name: row.name, amount: Number(row.amount || 0) }));
    const customerPartyRows = topPartyRows
      .filter((row) => row.documentType === "SALES_INVOICE")
      .slice(0, 5)
      .map((row) => ({ name: row.name, amount: Number(row.amount || 0) }));
    const countsByStatus = Object.fromEntries(statusRows.map((row) => [row.status, row.count]));

    return {
      countsByStatus,
      lifecycleCounts: {
        uploaded: statusMap.get("UPLOADED") || 0,
        extracting: statusMap.get("EXTRACTING") || 0,
        pendingReview: statusMap.get("PENDING_REVIEW") || 0,
        approved: statusMap.get("APPROVED") || 0,
        posting: statusMap.get("POSTING") || 0,
        posted: statusMap.get("POSTED") || 0,
        failed: (statusMap.get("POST_FAILED") || 0) + (statusMap.get("FAILED") || 0)
      },
      dailyProcessedCounts: perDayRows,
      topParties: {
        vendors: vendorPartyRows,
        customers: customerPartyRows
      },
      purchaseVsSalesSplit: {
        purchase: {
          count: typeSplitMap.get("PURCHASE_INVOICE")?.count || 0,
          amount: Number(typeSplitMap.get("PURCHASE_INVOICE")?.amount || 0)
        },
        sales: {
          count: typeSplitMap.get("SALES_INVOICE")?.count || 0,
          amount: Number(typeSplitMap.get("SALES_INVOICE")?.amount || 0)
        }
      },
      metrics: [
        { label: "Uploaded", value: statusMap.get("UPLOADED") || 0, color: "var(--primary-blue)" },
        { label: "Pending Review", value: statusMap.get("PENDING_REVIEW") || 0, color: "var(--warning-orange)" },
        { label: "Approved", value: statusMap.get("APPROVED") || 0, color: "var(--purple)" },
        { label: "Posted", value: statusMap.get("POSTED") || 0, color: "var(--success-green)" }
      ],
      lifecycle: [
        { name: "Uploaded", count: statusMap.get("UPLOADED") || 0, color: "var(--primary-blue)" },
        { name: "Extracting", count: statusMap.get("EXTRACTING") || 0, color: "var(--primary-blue-2)" },
        { name: "Pending Review", count: statusMap.get("PENDING_REVIEW") || 0, color: "var(--warning-orange)" },
        { name: "Approved", count: statusMap.get("APPROVED") || 0, color: "var(--purple)" },
        { name: "Posting", count: statusMap.get("POSTING") || 0, color: "var(--primary-blue)" },
        { name: "Posted", count: statusMap.get("POSTED") || 0, color: "var(--success-green)" },
        { name: "Failed", count: (statusMap.get("POST_FAILED") || 0) + (statusMap.get("FAILED") || 0), color: "var(--danger-red)" }
      ],
      perDay: perDayRows,
      vendors: vendorRows.map((vendor, index) => ({
        name: vendor.name,
        amount: Number(vendor.amount || 0),
        color: ["var(--primary-blue)", "var(--purple)", "var(--success-green)", "var(--warning-orange)", "var(--primary-blue-2)"][index % 5]
      })),
      meta: {
        tenantId: scope.tenantId,
        branchId: scope.branchId,
        dateRange: dateRange || null
      }
    };
  },

  async list({ context, query }) {
    const scope = resolveListScope(context, query);
    const filters = resolveInvoiceListFilters(query);
    const items = await invoiceReadRepository.listInvoices(scope.tenantId, scope.branchId, filters);
    return {
      items,
      filters: {
        tenants: [scope.tenantId],
        branches: [...new Set(items.map((item) => item.branchName || item.branch))]
      },
      meta: {
        tenantId: scope.tenantId,
        branchId: scope.branchId,
        query,
        appliedFilters: filters
      }
    };
  },

  async getById(invoiceId, context) {
    const normalizedId = requireInvoiceId(invoiceId);
    const detail = await invoiceReadRepository.getInvoiceDetail(normalizedId, context.tenantId);

    if (!detail) {
      throw createError("Invoice not found for tenant", 404, "INVOICE_NOT_FOUND");
    }

    return detail;
  },

  async reviewInvoice(invoiceId, context, payload = {}) {
    const normalizedId = requireInvoiceId(invoiceId);
    const updated = await invoiceReadRepository.updateReview(
      normalizedId,
      context.tenantId,
      {
        correctedJson: payload.corrected_json || {},
        notes: payload.notes || null
      },
      context
    );

    if (!updated) {
      throw createError("Invoice not found for tenant", 404, "INVOICE_NOT_FOUND");
    }

    return updated;
  },

  async markExtractionStarted(invoiceId, context, payload = {}) {
    const normalizedInvoiceId = requireInvoiceId(invoiceId);
    const client = await invoiceExtractionRepository.getClient();

    try {
      await client.query("BEGIN");
      const invoice = await ensureInvoice(normalizedInvoiceId, context.tenantId, client);
      const updatedInvoice = await invoiceExtractionRepository.markExtractionStarted(client, normalizedInvoiceId, context.tenantId, {
        retryCount: toRetryCount(payload.retry_count, invoice.retryCount),
        rawModelOutput: payload.raw_model_output ? toObject(payload.raw_model_output, "raw_model_output") : null
      });
      await client.query("COMMIT");
      return updatedInvoice;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  },

  async applyExtractionResult(invoiceId, context, payload) {
    const normalizedInvoiceId = requireInvoiceId(invoiceId);
    const normalizedPayload = normalizeExtractionPayload(payload);
    const client = await invoiceExtractionRepository.getClient();

    try {
      await client.query("BEGIN");
      const invoice = await ensureInvoice(normalizedInvoiceId, context.tenantId, client);

      const resolvedDedupeKey = buildDedupeKey({
        partyGstin: normalizedPayload.normalizedFields.party_gstin ?? invoice.partyGstin,
        invoiceNumber: normalizedPayload.normalizedFields.invoice_number ?? invoice.invoiceNumber,
        invoiceDate: normalizedPayload.normalizedFields.invoice_date ?? invoice.invoiceDate,
        totalAmount: normalizedPayload.normalizedFields.total_amount ?? invoice.totalAmount
      });

      const updatedInvoice = await invoiceExtractionRepository.applyExtractionResult(client, normalizedInvoiceId, context.tenantId, {
        ...normalizedPayload,
        normalizedFields: {
          ...normalizedPayload.normalizedFields,
          dedupe_key: resolvedDedupeKey
        },
        extractionStatus: resolveStoredExtractionStatus(normalizedPayload.extractionStatus, normalizedPayload.retryCount),
        businessStatus: resolveBusinessStatus(normalizedPayload.extractionStatus, normalizedPayload.retryCount)
      });

      await client.query("COMMIT");
      return updatedInvoice;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  },

  async markExtractionFailed(invoiceId, context, payload = {}) {
    return this.applyExtractionResult(invoiceId, context, {
      extraction_status: payload.extraction_status || "FAILED",
      retry_count: payload.retry_count,
      raw_model_output: payload.raw_model_output || {},
      extracted_json: payload.extracted_json || {},
      normalized_fields: payload.normalized_fields || {},
      confidence_score: payload.confidence_score,
      low_confidence_fields: payload.low_confidence_fields || [],
      warnings: payload.warnings || [],
      salvaged: payload.salvaged || false,
      error_message: payload.error_message || "Extraction failed"
    });
  },

  async retryExtraction(invoiceId, context, payload = {}) {
    const normalizedInvoiceId = requireInvoiceId(invoiceId);
    const client = await invoiceExtractionRepository.getClient();

    try {
      await client.query("BEGIN");
      const invoice = await ensureInvoice(normalizedInvoiceId, context.tenantId, client);
      const retryCount = toRetryCount(payload.retry_count, invoice.retryCount + 1);
      const updatedInvoice = await invoiceExtractionRepository.markExtractionRetry(client, normalizedInvoiceId, context.tenantId, retryCount);
      await client.query("COMMIT");
      return updatedInvoice;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  },

  // ─── Approval ────────────────────────────────────────────────────────────

  async approveInvoice(invoiceId, context, payload = {}) {
    const normalizedId = requireInvoiceId(invoiceId);
    const correctedJson = toObject(payload.corrected_json || {}, "corrected_json");
    const approvedByName = toOptionalString(payload.approved_by);

    if (!approvedByName) {
      throw createError("approved_by is required", 400, "VALIDATION_ERROR");
    }

    const client = await invoicePostingRepository.getClient();

    try {
      await client.query("BEGIN");
      const invoice = await invoicePostingRepository.findById(normalizedId, context.tenantId, client);

      if (!invoice) {
        throw createError("Invoice not found for tenant", 404, "INVOICE_NOT_FOUND");
      }

      if (invoice.businessStatus === "APPROVED") {
        throw createError("Invoice is already approved", 409, "ALREADY_APPROVED");
      }

      if (invoice.businessStatus !== "PENDING_REVIEW" && invoice.businessStatus !== "NEEDS_CORRECTION") {
        throw createError(
          `Invoice cannot be approved from status ${invoice.businessStatus}`,
          422,
          "INVALID_STATUS_TRANSITION"
        );
      }

      const updated = await invoicePostingRepository.approveInvoice(client, normalizedId, context.tenantId, {
        correctedJson,
        approvedByName
      });

      await client.query("COMMIT");

      const n8nDispatch = {
        attempted: false,
        dispatched: false,
        skippedReason: null,
        responseStatus: null,
        error: null,
        postingReviewMode: "AUTO_POST"
      };

      const [n8nConfig, tallyConfig] = await Promise.all([
        superAdminTenantRepository.findN8nConfigByTenantId(context.tenantId).catch(() => null),
        superAdminTenantRepository.findTallyConfigByTenantId(context.tenantId).catch(() => null)
      ]);
      const postingReviewMode = normalizePostingReviewMode(tallyConfig?.postingReviewMode);
      n8nDispatch.postingReviewMode = postingReviewMode;

      const webhookUrl = resolveWebhookUrl(n8nConfig?.n8nBaseUrl, n8nConfig?.postingWebhookPlaceholder);
      const workflowKey = String(n8nConfig?.workflowKeyToken || "").trim();
      const backendApiBaseUrl = toOptionalString(n8nConfig?.backendApiBaseUrl);

      if (!n8nConfig?.isActive) {
        n8nDispatch.skippedReason = "N8N_INACTIVE";
      } else if (!webhookUrl) {
        n8nDispatch.skippedReason = "N8N_POSTING_WEBHOOK_NOT_CONFIGURED";
      } else if (!workflowKey) {
        n8nDispatch.skippedReason = "N8N_WORKFLOW_KEY_MISSING";
      } else {
        n8nDispatch.attempted = true;
        const branchId = updated.branchId || context.branchId || null;

        try {
          const response = await fetchWithTimeout(
            webhookUrl,
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "x-workflow-key": workflowKey,
                "x-tenant-id": String(context.tenantId),
                ...(branchId ? { "x-branch-id": String(branchId) } : {})
              },
              body: JSON.stringify({
                invoiceId: updated.id,
                tenantId: context.tenantId,
                branchId,
                approvedBy: approvedByName,
                approvedData: correctedJson,
                postingMode: postingReviewMode,
                forceAutoPost: postingReviewMode !== "REVIEW_BEFORE_POSTING",
                backendApiBaseUrl: backendApiBaseUrl || null
              })
            },
            10000
          );

          n8nDispatch.responseStatus = response.status;
          if (response.ok) {
            n8nDispatch.dispatched = true;
          } else {
            n8nDispatch.skippedReason = `N8N_POSTING_WEBHOOK_HTTP_${response.status}`;
            console.error(
              `[n8n] Posting webhook returned HTTP ${response.status} for invoice ${updated.id} (tenant ${context.tenantId})`
            );
          }
        } catch (err) {
          n8nDispatch.skippedReason = err?.name === "AbortError" ? "N8N_POSTING_WEBHOOK_TIMEOUT" : "N8N_POSTING_WEBHOOK_REQUEST_FAILED";
          n8nDispatch.error = err?.message || "Posting webhook request failed";
          console.error(`[n8n] Posting webhook failed for invoice ${updated.id}: ${n8nDispatch.error}`);
        }
      }

      return {
        ...updated,
        n8n: n8nDispatch
      };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  },

  async rejectInvoice(invoiceId, context, payload = {}) {
    const normalizedId = requireInvoiceId(invoiceId);
    const rejected = await invoiceReadRepository.rejectInvoice(
      normalizedId,
      context.tenantId,
      context,
      payload.reason || "Rejected in review"
    );

    if (!rejected) {
      throw createError("Invoice not found for tenant", 404, "INVOICE_NOT_FOUND");
    }

    return rejected;
  },

  // ─── Posting lifecycle ───────────────────────────────────────────────────

  async startPosting(invoiceId, context, payload = {}) {
    const normalizedId = requireInvoiceId(invoiceId);
    const client = await invoicePostingRepository.getClient();

    try {
      await client.query("BEGIN");
      const invoice = await invoicePostingRepository.findById(normalizedId, context.tenantId, client);

      if (!invoice) {
        throw createError("Invoice not found for tenant", 404, "INVOICE_NOT_FOUND");
      }

      if (invoice.businessStatus !== "APPROVED") {
        throw createError(
          `Invoice must be APPROVED before posting; current status: ${invoice.businessStatus}`,
          422,
          "INVALID_STATUS_TRANSITION"
        );
      }

      // Dedupe guard: reject if a different invoice with the same dedupe_key is already POSTED
      const isDuplicate = await invoicePostingRepository.hasDuplicatePosted(
        client, normalizedId, context.tenantId, invoice.dedupeKey
      );

      if (isDuplicate) {
        throw createError(
          "A duplicate invoice with the same dedupe_key has already been posted",
          409,
          "DUPLICATE_POSTING_BLOCKED"
        );
      }

      // Atomic lock: only succeeds when status is APPROVED and posting_locked is FALSE
      const updated = await invoicePostingRepository.lockForPosting(client, normalizedId, context.tenantId);

      if (!updated) {
        throw createError(
          "Invoice posting is already in progress or status has changed",
          409,
          "POSTING_LOCK_CONFLICT"
        );
      }

      await client.query("COMMIT");
      return updated;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  },

  async executePosting(invoiceId, context, payload = {}) {
    const normalizedId = requireInvoiceId(invoiceId);
    const runId = randomUUID();
    const failureResult = (code, message, details = {}) => ({
      status: "FAILED",
      runId,
      errorCode: code || "POSTING_EXECUTOR_FAILED",
      message: message || "Posting executor failed",
      summary: {
        created: 0,
        altered: 0,
        errors: 1,
        exceptions: 0
      },
      ...details
    });

    const masterRequestXml =
      toOptionalString(
        payload.masterRequestXml ||
        payload.master_request_xml ||
        payload.masterXml ||
        payload.master_xml ||
        payload.vendorLedgerXml ||
        payload.vendor_ledger_xml
      ) || null;
    const voucherRequestXml =
      toOptionalString(payload.voucherRequestXml || payload.voucher_request_xml || payload.tallyXml || payload.tally_xml) || null;
    const fallbackVoucherType = toOptionalString(payload.tally_voucher_type || payload.tallyVoucherType);
    const fallbackVoucherNumber = toOptionalString(payload.tally_voucher_number || payload.tallyVoucherNumber);
    const configuredCompanyName =
      toOptionalString(payload.tally_company_name || payload.tallyCompanyName) || null;
    const timeoutMs = Number.isInteger(payload.timeoutMs) && payload.timeoutMs > 0 ? payload.timeoutMs : 12000;
    let masterImportSummary = null;

    try {
      const existing = await invoicePostingRepository.findById(normalizedId, context.tenantId);
      if (!existing) {
        return failureResult("INVOICE_NOT_FOUND", "Invoice not found for tenant");
      }

      if (existing.businessStatus === "APPROVED") {
        const startResult = await this.startPosting(normalizedId, context, {});
        if (!startResult) {
          return failureResult("POSTING_START_FAILED", "Unable to transition invoice to POSTING");
        }
      } else if (existing.businessStatus !== "POSTING") {
        return failureResult(
          "INVALID_STATUS_TRANSITION",
          `Posting executor requires APPROVED or POSTING status; current status: ${existing.businessStatus}`
        );
      }

      if (!voucherRequestXml) {
        return failureResult("MISSING_VOUCHER_XML", "voucherRequestXml is required for posting execution");
      }

      const tallyConfig = await superAdminTenantRepository.findTallyConfigByTenantId(context.tenantId).catch(() => null);
      if (!tallyConfig) {
        return failureResult("TALLY_CONFIG_NOT_FOUND", "Tally configuration not found for tenant");
      }

      const currentCompanyName = configuredCompanyName || toOptionalString(tallyConfig.companyName);
      const preparedMasterRequestXml = injectCurrentCompanyInImportXml(masterRequestXml, currentCompanyName);
      const preparedVoucherRequestXml = injectCurrentCompanyInImportXml(voucherRequestXml, currentCompanyName);

      let tallyEndpointUrl = null;
      try {
        tallyEndpointUrl = resolveTallyEndpointUrl(tallyConfig.tallyBaseUrl, tallyConfig.tallyPort);
      } catch (error) {
        return failureResult(error.code || "TALLY_CONFIG_INVALID", error.message || "Invalid Tally endpoint configuration");
      }

      try {
        if (preparedMasterRequestXml) {
          const masterResponse = await fetchWithTimeout(
            tallyEndpointUrl,
            {
              method: "POST",
              headers: {
                "Content-Type": "application/xml"
              },
              body: preparedMasterRequestXml
            },
            timeoutMs
          );

          const masterResponseText = await masterResponse.text().catch(() => "");
          if (!masterResponse.ok) {
            return failureResult(`TALLY_MASTER_HTTP_${masterResponse.status}`, `Tally master import responded with HTTP ${masterResponse.status}`, {
              responsePreview: masterResponseText.slice(0, 2000)
            });
          }

          const masterParsed = parseTallyPostingResponse(masterResponseText);
          if (masterParsed.status !== "SUCCESS") {
            const ignorableMasterErrors =
              masterParsed.lineErrors.length > 0 &&
              masterParsed.lineErrors.every((lineError) => isIgnorableTallyMasterLineError(lineError));

            if (!ignorableMasterErrors) {
              return failureResult("TALLY_MASTER_IMPORT_FAILED", masterParsed.message, {
                summary: masterParsed.summary,
                reviewReasons: masterParsed.lineErrors,
                responsePreview: masterParsed.responsePreview
              });
            }

            masterImportSummary = {
              ...masterParsed.summary,
              ignored: true,
              ignoredLineErrors: masterParsed.lineErrors
            };
          } else {
            masterImportSummary = masterParsed.summary;
          }
        }

        const response = await fetchWithTimeout(
          tallyEndpointUrl,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/xml"
            },
            body: preparedVoucherRequestXml
          },
          timeoutMs
        );

        const responseText = await response.text().catch(() => "");
        if (!response.ok) {
          return failureResult(`TALLY_HTTP_${response.status}`, `Tally endpoint responded with HTTP ${response.status}`, {
            responsePreview: responseText.slice(0, 2000)
          });
        }

        let parsed = parseTallyPostingResponse(responseText, fallbackVoucherType, fallbackVoucherNumber);
        const looksLikeSilentVoucherException =
          parsed.status !== "SUCCESS" &&
          parsed.summary.created === 0 &&
          parsed.summary.altered === 0 &&
          parsed.summary.errors === 0 &&
          parsed.summary.exceptions > 0 &&
          parsed.lineErrors.length === 0;

        if (looksLikeSilentVoucherException) {
          const retryVoucherRequestXml = injectPartyBillAllocationInVoucherXml(preparedVoucherRequestXml);
          if (retryVoucherRequestXml && retryVoucherRequestXml !== preparedVoucherRequestXml) {
            const retryResponse = await fetchWithTimeout(
              tallyEndpointUrl,
              {
                method: "POST",
                headers: {
                  "Content-Type": "application/xml"
                },
                body: retryVoucherRequestXml
              },
              timeoutMs
            );
            const retryResponseText = await retryResponse.text().catch(() => "");
            if (retryResponse.ok) {
              parsed = parseTallyPostingResponse(retryResponseText, fallbackVoucherType, fallbackVoucherNumber);
            }
          }
        }

        const stillSilentAfterBillAllocRetry =
          parsed.status !== "SUCCESS" &&
          parsed.summary.created === 0 &&
          parsed.summary.altered === 0 &&
          parsed.summary.errors === 0 &&
          parsed.summary.exceptions > 0 &&
          parsed.lineErrors.length === 0;

        if (stillSilentAfterBillAllocRetry) {
          const accountingFallbackXml = convertInventoryVoucherToAccountingVoucherXml(
            injectPartyBillAllocationInVoucherXml(preparedVoucherRequestXml)
          );
          if (accountingFallbackXml && accountingFallbackXml !== preparedVoucherRequestXml) {
            const accountingRetryResponse = await fetchWithTimeout(
              tallyEndpointUrl,
              {
                method: "POST",
                headers: {
                  "Content-Type": "application/xml"
                },
                body: accountingFallbackXml
              },
              timeoutMs
            );
            const accountingRetryResponseText = await accountingRetryResponse.text().catch(() => "");
            if (accountingRetryResponse.ok) {
              parsed = parseTallyPostingResponse(accountingRetryResponseText, fallbackVoucherType, fallbackVoucherNumber);
            }
          }
        }

        if (parsed.status !== "SUCCESS") {
          return failureResult("TALLY_POSTING_FAILED", parsed.message, {
            summary: parsed.summary,
            masterImportSummary,
            tallyVoucherType: parsed.tallyVoucherType,
            tallyVoucherNumber: parsed.tallyVoucherNumber,
            reviewReasons: parsed.lineErrors,
            responsePreview: parsed.responsePreview
          });
        }

        return {
          status: "SUCCESS",
          runId,
          message: parsed.message,
          summary: parsed.summary,
          masterImportSummary,
          tallyVoucherType: parsed.tallyVoucherType,
          tallyVoucherNumber: parsed.tallyVoucherNumber,
          responsePreview: parsed.responsePreview
        };
      } catch (error) {
        if (error?.name === "AbortError") {
          return failureResult("TALLY_TIMEOUT", "Tally request timed out");
        }

        const code = error?.cause?.code || error?.code || "TALLY_REQUEST_FAILED";
        const message =
          code === "ECONNREFUSED"
            ? "Tally connection refused. Verify host/port and service availability."
            : code === "ENOTFOUND" || code === "EAI_AGAIN"
              ? "Tally host could not be resolved. Verify base URL/DNS."
              : error?.message || "Failed to call Tally endpoint";

        return failureResult(code, message);
      }
    } catch (error) {
      return failureResult(error.code || "POSTING_EXECUTOR_FAILED", error.message || "Posting executor failed unexpectedly");
    }
  },

  async savePostingDraft(invoiceId, context, payload = {}) {
    const normalizedId = requireInvoiceId(invoiceId);
    const postingRequestXml =
      toOptionalString(
        payload.posting_request_xml ||
        payload.voucherRequestXml ||
        payload.voucher_request_xml ||
        payload.tallyXml ||
        payload.tally_xml
      ) || null;

    if (!postingRequestXml) {
      throw createError("posting_request_xml is required", 400, "VALIDATION_ERROR");
    }

    const sourceMetadata =
      payload.posting_request_xml_source && typeof payload.posting_request_xml_source === "object"
        ? payload.posting_request_xml_source
        : {
            workflowRunId: payload.workflowRunId || payload.runId || null,
            generatedAt: new Date().toISOString(),
            source: "n8n"
          };

    const client = await invoicePostingRepository.getClient();
    let invoice = null;
    let updated = null;
    try {
      await client.query("BEGIN");
      invoice = await invoicePostingRepository.findById(normalizedId, context.tenantId, client);
      if (!invoice) {
        throw createError("Invoice not found for tenant", 404, "INVOICE_NOT_FOUND");
      }

      if (invoice.businessStatus !== "APPROVED" && invoice.businessStatus !== "PENDING_POSTING_REVIEW") {
        throw createError(
          `Posting draft can be stored only for APPROVED invoices; current status: ${invoice.businessStatus}`,
          422,
          "INVALID_STATUS_TRANSITION"
        );
      }

      updated = await invoicePostingRepository.markPostingDraftReady(client, normalizedId, context.tenantId, {
        postingRequestXml,
        sourceMetadata
      });

      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }

    try {
      const persisted = await persistPostingStorageArtifacts({
        invoice: {
          ...invoice,
          ...updated
        },
        tenantId: context.tenantId,
        branchId: updated?.branchId || invoice?.branchId || context.branchId,
        payload: {
          ...payload,
          posting_request_xml: postingRequestXml
        },
        options: {
          writeOutputXml: true,
          writeSuccessXml: false,
          moveOriginalFile: false,
          metadataKey: "postingDraftStorage"
        }
      });

      const patched = await invoicePostingRepository.attachPostingStorageArtifacts(normalizedId, context.tenantId, {
        originalFilePath: null,
        storageArtifacts: persisted.metadataPatch
      });

      if (patched) {
        return {
          ...patched,
          postingDraftStorage: persisted.metadataPatch?.postingDraftStorage || null
        };
      }
    } catch (error) {
      console.error(`[posting] Unable to persist output-folder draft XML for invoice ${normalizedId}: ${error?.message || "unknown error"}`);
    }

    return updated;
  },

  async applyPostingResult(invoiceId, context, payload = {}) {
    const normalizedId = requireInvoiceId(invoiceId);
    const responseMetadata = toPostingResponseMetadata(payload);

    const client = await invoicePostingRepository.getClient();
    let updated = null;
    let invoice = null;

    try {
      await client.query("BEGIN");
      invoice = await invoicePostingRepository.findById(normalizedId, context.tenantId, client);

      if (!invoice) {
        throw createError("Invoice not found for tenant", 404, "INVOICE_NOT_FOUND");
      }

      if (invoice.businessStatus !== "POSTING") {
        throw createError(
          `Expected status POSTING; current: ${invoice.businessStatus}`,
          422,
          "INVALID_STATUS_TRANSITION"
        );
      }

      const resolvedVoucher = resolvePostedVoucherDetails({
        payload,
        responseMetadata,
        invoice
      });

      const effectiveResponseMetadata = {
        ...responseMetadata,
        ...(resolvedVoucher.voucherType ? { voucherType: resolvedVoucher.voucherType } : {}),
        ...(resolvedVoucher.voucherNumber ? { voucherNumber: resolvedVoucher.voucherNumber } : {})
      };

      updated = await invoicePostingRepository.applyPostingResult(client, normalizedId, context.tenantId, {
        voucherType: resolvedVoucher.voucherType,
        voucherNumber: resolvedVoucher.voucherNumber,
        responseMetadata: effectiveResponseMetadata
      });

      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }

    let storageLifecycle = null;
    try {
      const persisted = await persistPostingStorageArtifacts({
        invoice: {
          ...invoice,
          ...updated
        },
        tenantId: context.tenantId,
        branchId: updated?.branchId || invoice?.branchId || context.branchId,
        payload
      });

      const patched = await invoicePostingRepository.attachPostingStorageArtifacts(normalizedId, context.tenantId, {
        originalFilePath: persisted.movedOriginalFilePath,
        storageArtifacts: persisted.metadataPatch
      });

      storageLifecycle = persisted.metadataPatch?.storageLifecycle || null;
      if (patched) {
        return {
          ...patched,
          storageLifecycle
        };
      }
    } catch (error) {
      const warningText = error?.message || "storage lifecycle persistence failed";
      console.error(`[posting] ${warningText} for invoice ${normalizedId}`);
      storageLifecycle = {
        generatedAt: new Date().toISOString(),
        outputPostingXmlPath: null,
        successPostingXmlPath: null,
        processedOriginalFilePath: null,
        warnings: [warningText]
      };
    }

    return {
      ...updated,
      storageLifecycle
    };
  },

  async getRuntimeContext(invoiceId, context) {
    const normalizedId = requireInvoiceId(invoiceId);

    const invoice = await invoiceRuntimeRepository.findInvoiceForRuntime(normalizedId, context.tenantId);

    if (!invoice) {
      throw createError("Invoice not found for tenant", 404, "INVOICE_NOT_FOUND");
    }

    const [storage, n8nConfig, tallyConfig, duplicateCandidates] = await Promise.all([
      storageService.resolveStoragePaths({ tenantId: invoice.tenantId, branchId: invoice.branchId }),
      superAdminTenantRepository.findN8nConfigByTenantId(invoice.tenantId),
      superAdminTenantRepository.findTallyConfigByTenantId(invoice.tenantId),
      invoiceRuntimeRepository.findDuplicateCandidates(
        invoice.tenantId, invoice.documentType, invoice.dedupeKey, normalizedId
      )
    ]);

    return {
      invoiceId: invoice.id,
      tenantId: invoice.tenantId,
      branchId: invoice.branchId,
      documentType: invoice.documentType,
      businessStatus: invoice.businessStatus,
      extractionStatus: invoice.extractionStatus,
      retryCount: invoice.retryCount,
      file: {
        originalFilePath: invoice.originalFilePath,
        sourceHash: invoice.sourceHash,
        dedupeKey: invoice.dedupeKey
      },
      invoiceMeta: {
        invoiceNumber: invoice.invoiceNumber,
        invoiceDate: invoice.invoiceDate,
        partyName: invoice.partyName,
        partyGstin: invoice.partyGstin,
        totalAmount: invoice.totalAmount
      },
      storage,
      n8n: n8nConfig,
      tally: tallyConfig,
      duplicates: {
        hasDuplicates: duplicateCandidates.length > 0,
        candidates: duplicateCandidates
      }
    };
  },

  async markPostingFailed(invoiceId, context, payload = {}) {
    const normalizedId = requireInvoiceId(invoiceId);
    const errorMessage = toOptionalString(payload.error_message) || "Posting failed";
    const responseMetadata = payload.tally_response_metadata
      ? toObject(payload.tally_response_metadata, "tally_response_metadata")
      : null;

    const client = await invoicePostingRepository.getClient();

    try {
      await client.query("BEGIN");
      const invoice = await invoicePostingRepository.findById(normalizedId, context.tenantId, client);

      if (!invoice) {
        throw createError("Invoice not found for tenant", 404, "INVOICE_NOT_FOUND");
      }

      if (invoice.businessStatus !== "POSTING") {
        throw createError(
          `Expected status POSTING; current: ${invoice.businessStatus}`,
          422,
          "INVALID_STATUS_TRANSITION"
        );
      }

      const updated = await invoicePostingRepository.markPostingFailed(client, normalizedId, context.tenantId, {
        errorMessage,
        responseMetadata
      });

      await client.query("COMMIT");
      return updated;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  },

  async recordActivity(invoiceId, context, payload = {}) {
    const normalizedId = requireInvoiceId(invoiceId);
    const normalizedPayload = normalizeActivityPayload(payload);
    const activity = await invoiceRuntimeRepository.insertInvoiceActivity(
      context.tenantId,
      normalizedId,
      {
        ...normalizedPayload,
        performedByUserId: context.userId
      }
    );

    if (!activity) {
      throw createError("Invoice not found for tenant", 404, "INVOICE_NOT_FOUND");
    }

    return activity;
  }
};
