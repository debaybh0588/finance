import { randomUUID } from "node:crypto";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { superAdminTenantRepository } from "../repositories/superAdminTenantRepository.js";

const allowedStorageModes = new Set(["LOCAL", "CLOUD"]);
const allowedTallyModes = new Set(["API", "ODBC", "XML_GATEWAY"]);
const allowedPostingReviewModes = new Set(["AUTO_POST", "REVIEW_BEFORE_POSTING"]);
const folderFields = [
  "incomingFolder",
  "reviewFolder",
  "processedFolder",
  "successFolder",
  "exceptionFolder",
  "outputFolder"
];

const createError = (message, statusCode, code, details) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  if (details) {
    error.details = details;
  }
  return error;
};

const requireUuid = (value, fieldName) => {
  if (typeof value !== "string" || value.trim() === "") {
    throw createError(`Missing required field: ${fieldName}`, 400, "VALIDATION_ERROR");
  }
  return value.trim();
};

const requireText = (value, fieldName) => {
  if (typeof value !== "string" || value.trim() === "") {
    throw createError(`Missing required field: ${fieldName}`, 400, "VALIDATION_ERROR");
  }
  return value.trim();
};

const optionalText = (value) => {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  if (typeof value !== "string") {
    throw createError("Invalid text field value", 400, "VALIDATION_ERROR");
  }
  return value.trim() || null;
};

const optionalBoolean = (value, defaultValue) => {
  if (value === undefined) {
    return defaultValue;
  }
  if (typeof value !== "boolean") {
    throw createError("Invalid boolean field value", 400, "VALIDATION_ERROR");
  }
  return value;
};

const optionalInteger = (value, fieldName) => {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  if (!Number.isInteger(value)) {
    throw createError(`Invalid integer field: ${fieldName}`, 400, "VALIDATION_ERROR");
  }
  return value;
};

const ensureTenant = async (tenantId, client) => {
  const tenant = await superAdminTenantRepository.findTenantById(tenantId, client);
  if (!tenant) {
    throw createError("Tenant not found", 404, "TENANT_NOT_FOUND");
  }
  return tenant;
};

const mapConstraintError = (error) => {
  if (error.code === "23505") {
    return createError("A record with the same unique value already exists", 409, "CONFLICT");
  }
  if (error.code === "23503") {
    return createError("Referenced record was not found", 400, "FOREIGN_KEY_ERROR");
  }
  if (error.code === "23514") {
    return createError("Payload violates a database constraint", 400, "CHECK_CONSTRAINT_ERROR");
  }
  return error;
};

const connectivityStatus = {
  PASS: "PASS",
  FAIL: "FAIL",
  SKIPPED: "SKIPPED"
};

const toTrimmedText = (value) => {
  if (value === undefined || value === null) return "";
  return String(value).trim();
};

const toOptionalPortNumber = (value) => {
  if (value === undefined || value === null || value === "") return null;
  const numeric = Number(value);
  if (!Number.isInteger(numeric) || numeric <= 0) {
    return null;
  }
  return numeric;
};

const describeConnectivityError = (error, fallbackCode = "CONNECTIVITY_ERROR") => {
  if (error?.name === "AbortError") {
    return {
      code: "TIMEOUT",
      message: "Request timed out while waiting for remote service response"
    };
  }

  const causeCode = error?.cause?.code || error?.code || "";
  if (causeCode === "ECONNREFUSED") {
    return {
      code: "CONNECTION_REFUSED",
      message: "Remote host refused the connection. Verify host/port and service availability."
    };
  }
  if (causeCode === "ENOTFOUND" || causeCode === "EAI_AGAIN") {
    return {
      code: "DNS_RESOLUTION_FAILED",
      message: "Hostname could not be resolved. Verify DNS/host value."
    };
  }
  if (causeCode === "ETIMEDOUT") {
    return {
      code: "TIMEOUT",
      message: "Connection timed out. Verify network route/firewall."
    };
  }
  if (causeCode === "CERT_HAS_EXPIRED" || causeCode === "SELF_SIGNED_CERT_IN_CHAIN") {
    return {
      code: "TLS_CERTIFICATE_ERROR",
      message: "TLS certificate validation failed. Verify HTTPS certificate chain."
    };
  }

  return {
    code: fallbackCode,
    message: error?.message || "Unknown connectivity error"
  };
};

const fetchWithTimeout = async (url, options = {}, timeoutMs = 7000) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
};

const ensureAbsoluteUrl = (rawUrl, port = null) => {
  const text = toTrimmedText(rawUrl);
  if (!text) return null;

  let normalized = text;
  if (!/^https?:\/\//i.test(normalized)) {
    normalized = `http://${normalized}`;
  }

  const url = new URL(normalized);
  if (port && !url.port) {
    url.port = String(port);
  }

  return url;
};

const resolveStorageProbePaths = ({ storage, tenant, branches, n8nRootFolder }) => {
  const tenantToken = toPathToken(tenant?.code || tenant?.tenantCode || tenant?.name || tenant?.tenantName || "tenant", "tenant");
  const branchTokens = Array.isArray(branches) && branches.length > 0
    ? branches.map((branch) => toPathToken(branch?.code || branch?.branchCode || branch?.name || branch?.branchName || branch?.id, "branch"))
    : ["branch"];

  const rootPath = toTrimmedText(n8nRootFolder);
  const addRootIfNeeded = (resolvedPath) => {
    if (!rootPath || path.isAbsolute(resolvedPath)) {
      return resolvedPath;
    }
    return path.join(rootPath, resolvedPath);
  };

  const paths = new Set();
  for (const field of folderFields) {
    const template = toTrimmedText(storage?.[field]);
    if (!template) continue;

    const hasBranchPlaceholder = /\{branch\}/i.test(template);
    if (hasBranchPlaceholder) {
      for (const branchToken of branchTokens) {
        paths.add(addRootIfNeeded(resolveTemplatePath(template, tenantToken, branchToken)));
      }
      continue;
    }

    paths.add(addRootIfNeeded(resolveTemplatePath(template, tenantToken, branchTokens[0])));
  }

  return Array.from(paths);
};

const probeLocalPathWrite = async (folderPath) => {
  await mkdir(folderPath, { recursive: true });
  const probeFile = path.join(folderPath, `.connectivity_probe_${Date.now()}_${randomUUID()}.tmp`);
  const payload = `connectivity-probe:${new Date().toISOString()}`;
  await writeFile(probeFile, payload, "utf8");
  await readFile(probeFile, "utf8");
  await unlink(probeFile);
};

const validateBranchOverrides = (branchOverrides) => {
  if (branchOverrides === undefined) {
    return undefined;
  }

  if (!Array.isArray(branchOverrides)) {
    throw createError("branchOverrides must be an array", 400, "VALIDATION_ERROR");
  }

  return branchOverrides.map((item, index) => {
    if (!item || typeof item !== "object") {
      throw createError(`branchOverrides[${index}] must be an object`, 400, "VALIDATION_ERROR");
    }

    const normalized = {
      branchId: requireUuid(item.branchId, `branchOverrides[${index}].branchId`)
    };

    for (const field of folderFields) {
      normalized[field] = optionalText(item[field]);
    }

    return normalized;
  });
};

const validateTenantPayload = (payload) => ({
  tenantCode: requireText(payload.tenantCode, "tenantCode"),
  tenantName: requireText(payload.tenantName, "tenantName"),
  contactPerson: optionalText(payload.contactPerson),
  contactEmail: optionalText(payload.contactEmail),
  contactPhone: optionalText(payload.contactPhone),
  timezone: requireText(payload.timezone || "Asia/Kolkata", "timezone"),
  isActive: optionalBoolean(payload.isActive, true)
});

const validateBranchPayload = (payload) => ({
  branchCode: requireText(payload.branchCode, "branchCode"),
  branchName: requireText(payload.branchName, "branchName"),
  branchGstin: optionalText(payload.branchGstin),
  branchAddress: optionalText(payload.branchAddress),
  isDefault: optionalBoolean(payload.isDefault, false),
  isActive: optionalBoolean(payload.isActive, true)
});

const validateStoragePayload = (payload) => {
  const storageMode = requireText(payload.storageMode, "storageMode").toUpperCase();
  if (!allowedStorageModes.has(storageMode)) {
    throw createError("storageMode must be LOCAL or CLOUD", 400, "VALIDATION_ERROR");
  }

  return {
    storageMode,
    incomingFolder: requireText(payload.incomingFolder, "incomingFolder"),
    reviewFolder: requireText(payload.reviewFolder, "reviewFolder"),
    processedFolder: requireText(payload.processedFolder, "processedFolder"),
    successFolder: requireText(payload.successFolder, "successFolder"),
    exceptionFolder: requireText(payload.exceptionFolder, "exceptionFolder"),
    outputFolder: requireText(payload.outputFolder, "outputFolder"),
    allowBranchOverride: optionalBoolean(payload.allowBranchOverride, true),
    branchOverrides: validateBranchOverrides(payload.branchOverrides)
  };
};

const validateN8nPayload = (payload) => ({
  n8nBaseUrl: optionalText(payload.n8nBaseUrl),
  backendApiBaseUrl: optionalText(payload.backendApiBaseUrl),
  workflowKeyToken: optionalText(payload.workflowKeyToken),
  extractionWorkflowId: optionalText(payload.extractionWorkflowId),
  extractionWorkflowName: optionalText(payload.extractionWorkflowName),
  postingWorkflowId: optionalText(payload.postingWorkflowId),
  postingWorkflowName: optionalText(payload.postingWorkflowName),
  extractionWebhookPlaceholder: optionalText(payload.extractionWebhookPlaceholder),
  postingWebhookPlaceholder: optionalText(payload.postingWebhookPlaceholder),
  n8nRootFolder: optionalText(payload.n8nRootFolder),
  isActive: optionalBoolean(payload.isActive, true)
});

const validateTallyPayload = (payload) => {
  const tallyMode = requireText(payload.tallyMode, "tallyMode").toUpperCase();
  if (!allowedTallyModes.has(tallyMode)) {
    throw createError("tallyMode must be API, ODBC, or XML_GATEWAY", 400, "VALIDATION_ERROR");
  }

  const postingReviewMode = String(payload.postingReviewMode || "AUTO_POST").trim().toUpperCase();
  if (!allowedPostingReviewModes.has(postingReviewMode)) {
    throw createError("postingReviewMode must be AUTO_POST or REVIEW_BEFORE_POSTING", 400, "VALIDATION_ERROR");
  }

  return {
    tallyMode,
    tallyBaseUrl: optionalText(payload.tallyBaseUrl),
    companyName: optionalText(payload.companyName),
    tallyPort: optionalInteger(payload.tallyPort, "tallyPort"),
    useXmlPosting: optionalBoolean(payload.useXmlPosting, true),
    postingReviewMode,
    enableResponseLogging: optionalBoolean(payload.enableResponseLogging, true),
    defaultPurchaseVoucherType: optionalText(payload.defaultPurchaseVoucherType),
    defaultSalesVoucherType: optionalText(payload.defaultSalesVoucherType)
  };
};
/**
 * Create N8N root folder on filesystem if path is configured.
 * This enables N8N workflows to access invoke metadata and store results.
 * Silent failures: if folder creation fails, log but don't throw (N8N may create on demand).
 */
const createN8nRootFolderIfNeeded = async (n8nRootFolder) => {
  if (!n8nRootFolder || typeof n8nRootFolder !== "string") {
    return;  // No folder configured
  }

  try {
    await mkdir(n8nRootFolder, { recursive: true });
    console.log(`[N8N] Created root folder: ${n8nRootFolder}`);
  } catch (error) {
    if (error.code === "EEXIST") {
      // Folder already exists; this is fine
      return;
    }
    // Log but don't fail the entire request; N8N may create folder on demand
    console.error(`[N8N] Failed to create root folder ${n8nRootFolder}: ${error.message}`);
  }
};

const toPathToken = (value, fallback) => {
  if (typeof value !== "string") {
    return fallback;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return fallback;
  }
  return trimmed.replace(/[\\/]/g, "_");
};

const resolveTemplatePath = (templatePath, tenantToken, branchToken) =>
  templatePath
    .replace(/\{tenant\}/gi, tenantToken)
    .replace(/\{branch\}/gi, branchToken);

/**
 * Create all storage folders on filesystem for tenant + branches.
 * Creates incoming, review, processed, success, exception, output folders.
 * Silent failures: missing parent directories don't block onboarding.
 */
const createStorageFoldersIfNeeded = async (storageMode, tenant, branches, storageConfig, branchOverrides, n8nRootFolder) => {
  if (storageMode !== "LOCAL") {
    return;  // Cloud storage; no local folders to create
  }

  const folderPaths = new Set();
  const tenantToken = toPathToken(tenant?.tenantCode || tenant?.tenantName || tenant?.id, "tenant");
  const knownBranches = Array.isArray(branches) ? branches : [];
  const branchTokenById = new Map(
    knownBranches.map((branch) => [
      branch.id,
      toPathToken(branch.branchCode || branch.branchName || branch.id, "branch")
    ])
  );

  // Determine which paths to create based on tenant + branch config
  const addFolderPath = (folderPath, branchToken = null) => {
    if (!folderPath || typeof folderPath !== "string") {
      return;
    }

    const hasBranchPlaceholder = /\{branch\}/i.test(folderPath);
    const withBasePath = (resolvedPath) => {
      if (!n8nRootFolder || typeof n8nRootFolder !== "string") {
        return resolvedPath;
      }
      if (path.isAbsolute(resolvedPath)) {
        return resolvedPath;
      }
      return path.join(n8nRootFolder, resolvedPath);
    };

    if (!hasBranchPlaceholder) {
      folderPaths.add(withBasePath(resolveTemplatePath(folderPath, tenantToken, branchToken || "branch")));
      return;
    }

    if (branchToken) {
      folderPaths.add(withBasePath(resolveTemplatePath(folderPath, tenantToken, branchToken)));
      return;
    }

    if (knownBranches.length > 0) {
      for (const branch of knownBranches) {
        const token = toPathToken(branch.branchCode || branch.branchName || branch.id, "branch");
        folderPaths.add(withBasePath(resolveTemplatePath(folderPath, tenantToken, token)));
      }
      return;
    }

    folderPaths.add(withBasePath(resolveTemplatePath(folderPath, tenantToken, "branch")));
  };

  // Add tenant-level storage folders
  addFolderPath(storageConfig.incomingFolder);
  addFolderPath(storageConfig.reviewFolder);
  addFolderPath(storageConfig.processedFolder);
  addFolderPath(storageConfig.successFolder);
  addFolderPath(storageConfig.exceptionFolder);
  addFolderPath(storageConfig.outputFolder);

  // Add branch overrides if any
  if (branchOverrides && Array.isArray(branchOverrides)) {
    for (const override of branchOverrides) {
      const overrideBranchToken =
        branchTokenById.get(override.branchId) || toPathToken(override.branchId, "branch");

      addFolderPath(override.incomingFolder, overrideBranchToken);
      addFolderPath(override.reviewFolder, overrideBranchToken);
      addFolderPath(override.processedFolder, overrideBranchToken);
      addFolderPath(override.successFolder, overrideBranchToken);
      addFolderPath(override.exceptionFolder, overrideBranchToken);
      addFolderPath(override.outputFolder, overrideBranchToken);
    }
  }

  // Create all folders
  for (const folderPath of folderPaths) {
    try {
      await mkdir(folderPath, { recursive: true });
      console.log(`[Storage] Created folder: ${folderPath}`);
    } catch (error) {
      if (error.code === "EEXIST") {
        // Folder already exists; this is fine
        continue;
      }
      // Log but don't fail; directory may already exist or be created by other process
      console.warn(`[Storage] Failed to create folder ${folderPath}: ${error.message}`);
    }
  }
};
const validateAdminUserPayload = (payload = {}) => {
  const email = requireText(payload.email, "email").toLowerCase();
  const password = optionalText(payload.password);

  return {
    fullName: requireText(payload.fullName || "Tenant Admin", "fullName"),
    email,
    phone: optionalText(payload.phone),
    password,
    isActive: optionalBoolean(payload.isActive, true)
  };
};

export const superAdminTenantService = {
  async listTenants() {
    const items = await superAdminTenantRepository.listTenants();
    return { items };
  },

  async getOnboardingTemplate() {
    return {
      tenant: {
        name: "",
        code: "",
        contactPerson: "",
        email: "",
        phone: "",
        isActive: true
      },
      branches: [
        {
          id: `branch-${Math.random().toString(36).slice(2, 9)}`,
          name: "Head Office",
          code: "HQ",
          gstin: "",
          address: "",
          isDefault: true
        }
      ],
      storage: {
        mode: "LOCAL",
        incomingFolder: "{tenant}/{branch}/incoming",
        reviewFolder: "{tenant}/{branch}/review",
        processedFolder: "{tenant}/{branch}/processed",
        successFolder: "{tenant}/{branch}/success",
        exceptionFolder: "{tenant}/{branch}/exception",
        outputFolder: "{tenant}/{branch}/output",
        allowBranchOverride: true,
        branchOverrides: []
      },
      n8n: {
        baseUrl: "",
        backendApiBaseUrl: "",
        workflowToken: "",
        extractionWorkflow: "",
        postingWorkflow: "",
        webhookExtraction: "",
        webhookPosting: "",
        rootFolder: ""
      },
      tally: {
        mode: "API",
        baseUrl: "",
        companyName: "",
        port: "9000",
        useXmlPosting: true,
        postingReviewMode: "AUTO_POST",
        enableResponseLogging: true,
        defaultPurchaseVoucherType: "Purchase",
        defaultSalesVoucherType: "Sales"
      },
      adminUser: {
        fullName: "Tenant Admin",
        email: "",
        phone: "",
        password: "",
        isActive: true
      },
      rules: {
        supportsPurchase: true,
        supportsSales: true,
        mandatoryReview: true,
        duplicateCheck: true,
        lineItemsMandatory: true
      }
    };
  },

  async testConnectivity(payload = {}) {
    const tenant = payload?.tenant && typeof payload.tenant === "object" ? payload.tenant : {};
    const branches = Array.isArray(payload?.branches) ? payload.branches : [];
    const storage = payload?.storage && typeof payload.storage === "object" ? payload.storage : {};
    const n8n = payload?.n8n && typeof payload.n8n === "object" ? payload.n8n : {};
    const tally = payload?.tally && typeof payload.tally === "object" ? payload.tally : {};

    const checks = {
      storage: null,
      n8n: null,
      tally: null
    };

    // Storage connectivity check
    const storageMode = toTrimmedText(storage.storageMode || storage.mode).toUpperCase();
    if (!storageMode) {
      checks.storage = {
        status: connectivityStatus.FAIL,
        code: "STORAGE_MODE_MISSING",
        message: "Storage mode is required for connectivity validation"
      };
    } else if (!allowedStorageModes.has(storageMode)) {
      checks.storage = {
        status: connectivityStatus.FAIL,
        code: "STORAGE_MODE_INVALID",
        message: `Unsupported storage mode: ${storageMode}`
      };
    } else if (storageMode === "CLOUD") {
      checks.storage = {
        status: connectivityStatus.SKIPPED,
        code: "STORAGE_CLOUD_SKIPPED",
        message: "Cloud storage probe is skipped in current backend build"
      };
    } else {
      const missingFolderFields = folderFields.filter((field) => !toTrimmedText(storage[field]));
      if (missingFolderFields.length > 0) {
        checks.storage = {
          status: connectivityStatus.FAIL,
          code: "STORAGE_PATHS_MISSING",
          message: `Missing storage folder paths: ${missingFolderFields.join(", ")}`
        };
      } else {
        const storageProbePaths = resolveStorageProbePaths({
          storage,
          tenant,
          branches,
          n8nRootFolder: n8n.rootFolder || n8n.n8nRootFolder || null
        });

        if (storageProbePaths.length === 0) {
          checks.storage = {
            status: connectivityStatus.FAIL,
            code: "STORAGE_PATHS_EMPTY",
            message: "No storage paths were resolved from the onboarding payload"
          };
        } else {
          try {
            for (const probePath of storageProbePaths) {
              await probeLocalPathWrite(probePath);
            }
            checks.storage = {
              status: connectivityStatus.PASS,
              code: "STORAGE_OK",
              message: `Validated read/write probe on ${storageProbePaths.length} storage path(s)`,
              details: {
                testedPaths: storageProbePaths
              }
            };
          } catch (error) {
            const failure = describeConnectivityError(error, "STORAGE_IO_FAILED");
            checks.storage = {
              status: connectivityStatus.FAIL,
              code: failure.code,
              message: failure.message
            };
          }
        }
      }
    }

    // n8n connectivity check
    const n8nBaseUrl = toTrimmedText(n8n.n8nBaseUrl || n8n.baseUrl);
    const backendApiBaseUrl = toTrimmedText(n8n.backendApiBaseUrl || n8n.backend_base_url);
    const n8nWorkflowToken = toTrimmedText(n8n.workflowKeyToken || n8n.workflowToken);
    const n8nExtractionWebhook = toTrimmedText(n8n.extractionWebhookPlaceholder || n8n.webhookExtraction);
    const n8nPostingWebhook = toTrimmedText(n8n.postingWebhookPlaceholder || n8n.webhookPosting);
    const missingN8nFields = [];

    if (!n8nBaseUrl) missingN8nFields.push("n8nBaseUrl");
    if (!backendApiBaseUrl) missingN8nFields.push("backendApiBaseUrl");
    if (!n8nWorkflowToken) missingN8nFields.push("workflowKeyToken");
    if (!n8nExtractionWebhook) missingN8nFields.push("extractionWebhookPlaceholder");
    if (!n8nPostingWebhook) missingN8nFields.push("postingWebhookPlaceholder");

    if (missingN8nFields.length > 0) {
      checks.n8n = {
        status: connectivityStatus.FAIL,
        code: "N8N_CONFIG_INCOMPLETE",
        message: `Missing n8n fields: ${missingN8nFields.join(", ")}`
      };
    } else {
      let parsedN8nUrl = null;
      let parsedBackendApiUrl = null;
      try {
        parsedN8nUrl = ensureAbsoluteUrl(n8nBaseUrl);
      } catch (error) {
        checks.n8n = {
          status: connectivityStatus.FAIL,
          code: "N8N_BASE_URL_INVALID",
          message: `Invalid n8n base URL: ${error.message}`
        };
      }

      if (!checks.n8n) {
        try {
          parsedBackendApiUrl = ensureAbsoluteUrl(backendApiBaseUrl);
        } catch (error) {
          checks.n8n = {
            status: connectivityStatus.FAIL,
            code: "N8N_BACKEND_API_URL_INVALID",
            message: `Invalid backend API base URL: ${error.message}`
          };
        }
      }

      if (!checks.n8n) {
        try {
          const response = await fetchWithTimeout(parsedN8nUrl.toString(), { method: "GET" }, 7000);
          if (response.status >= 500) {
            checks.n8n = {
              status: connectivityStatus.FAIL,
              code: "N8N_HTTP_5XX",
              message: `n8n is reachable but returned server error HTTP ${response.status}`
            };
          } else {
            checks.n8n = {
              status: connectivityStatus.PASS,
              code: "N8N_OK",
              message: response.ok
                ? "n8n endpoint reachable and responding"
                : `n8n endpoint reachable (HTTP ${response.status})`,
              details: {
                baseUrl: parsedN8nUrl.toString(),
                backendApiBaseUrl: parsedBackendApiUrl.toString()
              }
            };
          }
        } catch (error) {
          const failure = describeConnectivityError(error, "N8N_CONNECTIVITY_FAILED");
          checks.n8n = {
            status: connectivityStatus.FAIL,
            code: failure.code,
            message: failure.message
          };
        }
      }
    }

    // Tally connectivity check
    const tallyMode = toTrimmedText(tally.tallyMode || tally.mode).toUpperCase();
    const tallyBaseUrl = toTrimmedText(tally.tallyBaseUrl || tally.baseUrl);
    const tallyPort = toOptionalPortNumber(tally.tallyPort ?? tally.port);
    const useXmlPosting = tally.useXmlPosting !== undefined ? Boolean(tally.useXmlPosting) : true;

    if (!tallyMode || !allowedTallyModes.has(tallyMode)) {
      checks.tally = {
        status: connectivityStatus.FAIL,
        code: "TALLY_MODE_INVALID",
        message: "Tally mode must be API, ODBC, or XML_GATEWAY"
      };
    } else if (!tallyBaseUrl) {
      checks.tally = {
        status: connectivityStatus.FAIL,
        code: "TALLY_BASE_URL_MISSING",
        message: "Tally base URL is required for connectivity validation"
      };
    } else {
      let parsedTallyUrl = null;
      try {
        parsedTallyUrl = ensureAbsoluteUrl(tallyBaseUrl, tallyPort);
      } catch (error) {
        checks.tally = {
          status: connectivityStatus.FAIL,
          code: "TALLY_BASE_URL_INVALID",
          message: `Invalid Tally base URL: ${error.message}`
        };
      }

      if (!checks.tally) {
        const tallyProbeXml = `<ENVELOPE><HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER><BODY><IMPORTDATA><REQUESTDESC><REPORTNAME>Vouchers</REPORTNAME></REQUESTDESC><REQUESTDATA/></IMPORTDATA></BODY></ENVELOPE>`;
        try {
          const response = await fetchWithTimeout(
            parsedTallyUrl.toString(),
            useXmlPosting
              ? {
                  method: "POST",
                  headers: { "Content-Type": "application/xml" },
                  body: tallyProbeXml
                }
              : { method: "GET" },
            9000
          );

          const responseText = await response.text().catch(() => "");
          if (!response.ok) {
            checks.tally = {
              status: connectivityStatus.FAIL,
              code: `TALLY_HTTP_${response.status}`,
              message: `Tally endpoint responded with HTTP ${response.status}`,
              details: {
                responsePreview: responseText.slice(0, 240)
              }
            };
          } else {
            checks.tally = {
              status: connectivityStatus.PASS,
              code: "TALLY_OK",
              message: "Tally endpoint reachable and accepted probe request",
              details: {
                targetUrl: parsedTallyUrl.toString(),
                responsePreview: responseText.slice(0, 240)
              }
            };
          }
        } catch (error) {
          const failure = describeConnectivityError(error, "TALLY_CONNECTIVITY_FAILED");
          checks.tally = {
            status: connectivityStatus.FAIL,
            code: failure.code,
            message: failure.message
          };
        }
      }
    }

    const failedChecks = Object.entries(checks)
      .filter(([, value]) => value?.status === connectivityStatus.FAIL)
      .map(([name, value]) => ({ name, code: value.code, message: value.message }));

    return {
      checkedAt: new Date().toISOString(),
      overallStatus: failedChecks.length > 0 ? connectivityStatus.FAIL : connectivityStatus.PASS,
      checks,
      failedChecks
    };
  },

  async createTenant(payload) {
    const client = await superAdminTenantRepository.getClient();

    try {
      const normalizedPayload = validateTenantPayload(payload);
      await client.query("BEGIN");
      const tenant = await superAdminTenantRepository.createTenant(client, normalizedPayload);
      await client.query("COMMIT");
      return tenant;
    } catch (error) {
      await client.query("ROLLBACK");
      throw mapConstraintError(error);
    } finally {
      client.release();
    }
  },

  async updateTenant(tenantId, payload) {
    const normalizedTenantId = requireUuid(tenantId, "tenantId");
    const normalizedPayload = validateTenantPayload(payload);
    const client = await superAdminTenantRepository.getClient();

    try {
      await client.query("BEGIN");
      await ensureTenant(normalizedTenantId, client);
      const tenant = await superAdminTenantRepository.updateTenant(client, normalizedTenantId, normalizedPayload);
      await client.query("COMMIT");
      return tenant;
    } catch (error) {
      await client.query("ROLLBACK");
      throw mapConstraintError(error);
    } finally {
      client.release();
    }
  },

  async createBranch(tenantId, payload) {
    const normalizedTenantId = requireUuid(tenantId, "tenantId");
    const normalizedPayload = validateBranchPayload(payload);
    const client = await superAdminTenantRepository.getClient();

    try {
      await client.query("BEGIN");
      await ensureTenant(normalizedTenantId, client);

      if (normalizedPayload.isDefault) {
        await superAdminTenantRepository.clearDefaultBranches(client, normalizedTenantId);
      }

      const branch = await superAdminTenantRepository.createBranch(client, normalizedTenantId, normalizedPayload);
      await client.query("COMMIT");
      return branch;
    } catch (error) {
      await client.query("ROLLBACK");
      throw mapConstraintError(error);
    } finally {
      client.release();
    }
  },

  async replaceBranches(tenantId, branches) {
    const normalizedTenantId = requireUuid(tenantId, "tenantId");
    if (!Array.isArray(branches) || branches.length === 0) {
      throw createError("branches must be a non-empty array", 400, "VALIDATION_ERROR");
    }

    const normalizedBranches = branches.map((b) => ({
      id: b.id && typeof b.id === "string" ? b.id : null,
      ...validateBranchPayload(b)
    }));

    const defaultCount = normalizedBranches.filter((b) => b.isDefault).length;
    if (defaultCount !== 1) {
      throw createError("Exactly one branch must be marked as default", 400, "VALIDATION_ERROR");
    }

    const client = await superAdminTenantRepository.getClient();
    try {
      await client.query("BEGIN");
      await ensureTenant(normalizedTenantId, client);
      const updatedBranches = await superAdminTenantRepository.replaceBranches(client, normalizedTenantId, normalizedBranches);
      await client.query("COMMIT");
      return updatedBranches;
    } catch (error) {
      await client.query("ROLLBACK");
      throw mapConstraintError(error);
    } finally {
      client.release();
    }
  },

  async upsertTenantAdminUser(tenantId, payload) {
    const normalizedTenantId = requireUuid(tenantId, "tenantId");
    const normalizedPayload = validateAdminUserPayload(payload);
    const client = await superAdminTenantRepository.getClient();

    try {
      await client.query("BEGIN");
      await ensureTenant(normalizedTenantId, client);

      const [existingTenantAdmin, existingByEmail] = await Promise.all([
        superAdminTenantRepository.findTenantAdminUserByTenantId(normalizedTenantId, client),
        superAdminTenantRepository.findUserByEmail(normalizedPayload.email, client)
      ]);

      if (existingByEmail && existingByEmail.tenantId !== normalizedTenantId) {
        throw createError("Email is already used by another tenant user", 409, "CONFLICT");
      }

      let adminUser;
      if (!existingTenantAdmin) {
        if (!normalizedPayload.password) {
          throw createError("password is required for tenant admin setup", 400, "VALIDATION_ERROR");
        }

        adminUser = await superAdminTenantRepository.createTenantAdminUser(client, {
          tenantId: normalizedTenantId,
          defaultBranchId: null,
          ...normalizedPayload
        });
      } else {
        if (existingByEmail && existingByEmail.id !== existingTenantAdmin.id) {
          throw createError("Email is already used by another tenant user", 409, "CONFLICT");
        }

        adminUser = await superAdminTenantRepository.updateTenantAdminUser(client, existingTenantAdmin.id, {
          defaultBranchId: existingTenantAdmin.defaultBranchId,
          ...normalizedPayload
        });
      }

      await client.query("COMMIT");
      return adminUser;
    } catch (error) {
      await client.query("ROLLBACK");
      throw mapConstraintError(error);
    } finally {
      client.release();
    }
  },

  async upsertStorageConfig(tenantId, payload) {
    const normalizedTenantId = requireUuid(tenantId, "tenantId");
    const normalizedPayload = validateStoragePayload(payload);
    const client = await superAdminTenantRepository.getClient();

    try {
      await client.query("BEGIN");
      const tenant = await ensureTenant(normalizedTenantId, client);

      if (normalizedPayload.branchOverrides && normalizedPayload.branchOverrides.length > 0) {
        const branchIds = normalizedPayload.branchOverrides.map((item) => item.branchId);
        const branches = await superAdminTenantRepository.listBranchesByIds(client, normalizedTenantId, branchIds);

        if (branches.length !== branchIds.length) {
          throw createError("One or more branch overrides reference an unknown branch", 400, "INVALID_BRANCH_OVERRIDE");
        }
      }

      // Fetch all branches for tenant (needed for folder path resolution)
      const allBranches = await superAdminTenantRepository.listBranchesByTenant(normalizedTenantId, client);
      const n8nConfig = await superAdminTenantRepository.findN8nConfigByTenantId(normalizedTenantId, client);

      const storageConfig = await superAdminTenantRepository.upsertStorageConfig(client, normalizedTenantId, normalizedPayload);

      let branchOverrides;
      if (normalizedPayload.branchOverrides !== undefined) {
        branchOverrides = await superAdminTenantRepository.replaceBranchStorageOverrides(
          client,
          normalizedTenantId,
          normalizedPayload.branchOverrides
        );
      }

      await client.query("COMMIT");

      // Create storage folders on filesystem AFTER database commit
      // This must happen post-commit so configuration is persisted
      if (normalizedPayload.storageMode === "LOCAL") {
        await createStorageFoldersIfNeeded(
          normalizedPayload.storageMode,
          tenant,
          allBranches,
          normalizedPayload,
          branchOverrides,
          n8nConfig?.n8nRootFolder || null
        );
      }

      return {
        ...storageConfig,
        branchOverrides
      };
    } catch (error) {
      await client.query("ROLLBACK");
      throw mapConstraintError(error);
    } finally {
      client.release();
    }
  },

  async upsertN8nConfig(tenantId, payload) {
    const normalizedTenantId = requireUuid(tenantId, "tenantId");
    const normalizedPayload = validateN8nPayload(payload);
    const client = await superAdminTenantRepository.getClient();

    try {
      await client.query("BEGIN");
      await ensureTenant(normalizedTenantId, client);
      const config = await superAdminTenantRepository.upsertN8nConfig(client, normalizedTenantId, normalizedPayload);
      await client.query("COMMIT");

      // Create N8N root folder on filesystem if path is configured
      // This must happen AFTER commit so tenant is persisted
      if (normalizedPayload.n8nRootFolder) {
        await createN8nRootFolderIfNeeded(normalizedPayload.n8nRootFolder);
      }

      return config;
    } catch (error) {
      await client.query("ROLLBACK");
      throw mapConstraintError(error);
    } finally {
      client.release();
    }
  },

  async upsertTallyConfig(tenantId, payload) {
    const normalizedTenantId = requireUuid(tenantId, "tenantId");
    const normalizedPayload = validateTallyPayload(payload);
    const client = await superAdminTenantRepository.getClient();

    try {
      await client.query("BEGIN");
      await ensureTenant(normalizedTenantId, client);
      const config = await superAdminTenantRepository.upsertTallyConfig(client, normalizedTenantId, normalizedPayload);
      await client.query("COMMIT");
      return config;
    } catch (error) {
      await client.query("ROLLBACK");
      throw mapConstraintError(error);
    } finally {
      client.release();
    }
  },

  async getFullConfig(tenantId) {
    const normalizedTenantId = requireUuid(tenantId, "tenantId");
    const tenant = await superAdminTenantRepository.findTenantById(normalizedTenantId);

    if (!tenant) {
      throw createError("Tenant not found", 404, "TENANT_NOT_FOUND");
    }

    const [branches, storageConfig, branchStorageOverrides, n8nConfig, tallyConfig, adminUser] = await Promise.all([
      superAdminTenantRepository.listBranchesByTenant(normalizedTenantId),
      superAdminTenantRepository.findStorageConfigByTenantId(normalizedTenantId),
      superAdminTenantRepository.listBranchStorageOverrides(normalizedTenantId),
      superAdminTenantRepository.findN8nConfigByTenantId(normalizedTenantId),
      superAdminTenantRepository.findTallyConfigByTenantId(normalizedTenantId),
      superAdminTenantRepository.findTenantAdminUserByTenantId(normalizedTenantId)
    ]);

    return {
      tenant,
      branches,
      storageConfig: storageConfig
        ? {
            ...storageConfig,
            branchOverrides: branchStorageOverrides
          }
        : null,
      n8nConfig,
      tallyConfig,
      adminUser: adminUser
        ? {
            ...adminUser,
            password: ""
          }
        : null,
      rules: {
        supportsPurchase: true,
        supportsSales: true,
        mandatoryReview: true,
        duplicateCheck: true,
        lineItemsMandatory: true
      }
    };
  },

  async deleteTenant(tenantId) {
    const normalizedTenantId = requireUuid(tenantId, "tenantId");
    const client = await superAdminTenantRepository.getClient();

    try {
      await client.query("BEGIN");
      await ensureTenant(normalizedTenantId, client);
      const deleted = await superAdminTenantRepository.deleteTenant(client, normalizedTenantId);
      await client.query("COMMIT");
      return deleted;
    } catch (error) {
      await client.query("ROLLBACK");
      throw mapConstraintError(error);
    } finally {
      client.release();
    }
  }
};
