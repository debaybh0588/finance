import path from "node:path";
import { extractionDispatchRepository } from "../repositories/extractionDispatchRepository.js";
import { invoiceRuntimeRepository } from "../repositories/invoiceRuntimeRepository.js";
import { superAdminTenantRepository } from "../repositories/superAdminTenantRepository.js";
import { storageService } from "./storageService.js";

let schedulerHandle = null;
let initialKickHandle = null;
let cycleInFlight = false;

const DEFAULT_POLL_INTERVAL_MS = 1500;
const DEFAULT_BATCH_SIZE = 10;
const DEFAULT_CONCURRENCY = 4;
const DEFAULT_MAX_ATTEMPTS = 6;
const DEFAULT_HTTP_TIMEOUT_MS = 10000;
const DEFAULT_STALE_LOCK_MS = 10 * 60 * 1000;
const MAX_BACKOFF_MS = 5 * 60 * 1000;

const toOptionalString = (value) => {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  return text || null;
};

const toPositiveInt = (value, fallback, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) => {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
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

const fetchWithTimeout = async (url, options = {}, timeoutMs = DEFAULT_HTTP_TIMEOUT_MS) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
};

const buildRetryDelayMs = (attemptCount) => {
  const attempt = Math.max(1, Number(attemptCount) || 1);
  const exponent = Math.min(7, attempt - 1);
  return Math.min(MAX_BACKOFF_MS, 5000 * (2 ** exponent));
};

const isRetryableHttpStatus = (status) => status === 408 || status === 429 || status >= 500;

const buildExtractionPayload = ({ job, invoice, n8nConfig, storage }) => {
  const runtimePaths = storage?.paths && typeof storage.paths === "object" ? storage.paths : {};
  const backendApiBaseUrl = toOptionalString(n8nConfig?.backendApiBaseUrl);
  const originalFilePath = toOptionalString(invoice?.originalFilePath);
  const fileName = toOptionalString(invoice?.fileName) || path.basename(originalFilePath || `${invoice.id}.bin`);

  return {
    batchId: `dispatch-${job.id}`,
    invoiceId: invoice.id,
    tenantId: job.tenantId,
    branchId: job.branchId,
    documentType: invoice.documentType || "AUTO",
    fileName,
    filePath: originalFilePath,
    originalPath: originalFilePath,
    originalFilePath,
    mimeType: toOptionalString(invoice?.mimeType),
    backendApiBaseUrl: backendApiBaseUrl || null,
    n8nRootFolder: n8nConfig?.n8nRootFolder || null,
    runtimeContext: {
      invoiceId: invoice.id,
      tenantId: job.tenantId,
      branchId: job.branchId,
      requestId: null,
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
      tenantId: job.tenantId,
      branchId: job.branchId,
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
  };
};

const normalizeWorkerOptions = (overrides = {}) => {
  const envOptions = process.env || {};
  return {
    pollIntervalMs: toPositiveInt(
      overrides.pollIntervalMs ?? envOptions.EXTRACTION_DISPATCH_POLL_INTERVAL_MS,
      DEFAULT_POLL_INTERVAL_MS,
      { min: 500, max: 60_000 }
    ),
    batchSize: toPositiveInt(
      overrides.batchSize ?? envOptions.EXTRACTION_DISPATCH_BATCH_SIZE,
      DEFAULT_BATCH_SIZE,
      { min: 1, max: 200 }
    ),
    concurrency: toPositiveInt(
      overrides.concurrency ?? envOptions.EXTRACTION_DISPATCH_CONCURRENCY,
      DEFAULT_CONCURRENCY,
      { min: 1, max: 50 }
    ),
    maxAttempts: toPositiveInt(
      overrides.maxAttempts ?? envOptions.EXTRACTION_DISPATCH_MAX_ATTEMPTS,
      DEFAULT_MAX_ATTEMPTS,
      { min: 1, max: 20 }
    ),
    httpTimeoutMs: toPositiveInt(
      overrides.httpTimeoutMs ?? envOptions.EXTRACTION_DISPATCH_HTTP_TIMEOUT_MS,
      DEFAULT_HTTP_TIMEOUT_MS,
      { min: 1000, max: 120_000 }
    ),
    staleLockMs: toPositiveInt(
      overrides.staleLockMs ?? envOptions.EXTRACTION_DISPATCH_STALE_LOCK_MS,
      DEFAULT_STALE_LOCK_MS,
      { min: 60_000, max: 24 * 60 * 60 * 1000 }
    )
  };
};

const processOneJob = async (job, options) => {
  const attemptCount = Number(job?.attemptCount) || 1;
  const jobId = toOptionalString(job?.id);
  const tenantId = toOptionalString(job?.tenantId);
  const branchId = toOptionalString(job?.branchId);
  const invoiceId = toOptionalString(job?.invoiceId);

  if (!jobId || !tenantId || !branchId || !invoiceId) {
    if (jobId) {
      await extractionDispatchRepository.markJobFailed(jobId, {
        errorMessage: "Invalid queue job payload"
      });
    }
    return;
  }

  const failOrRetry = async ({ message, httpStatus = null, forceFail = false }) => {
    const shouldRetry = !forceFail && attemptCount < options.maxAttempts;
    if (shouldRetry) {
      await extractionDispatchRepository.markJobRetry(jobId, {
        delayMs: buildRetryDelayMs(attemptCount),
        errorMessage: message,
        httpStatus
      });
    } else {
      await extractionDispatchRepository.markJobFailed(jobId, {
        errorMessage: message,
        httpStatus
      });
    }
  };

  try {
    const invoice = await invoiceRuntimeRepository.findInvoiceForRuntime(invoiceId, tenantId);
    if (!invoice) {
      await extractionDispatchRepository.markJobFailed(jobId, {
        errorMessage: "Invoice not found for tenant"
      });
      return;
    }

    const [n8nConfig, storage] = await Promise.all([
      superAdminTenantRepository.findN8nConfigByTenantId(tenantId).catch(() => null),
      storageService.resolveStoragePaths({ tenantId, branchId })
    ]);

    if (!n8nConfig?.isActive) {
      await extractionDispatchRepository.markJobFailed(jobId, {
        errorMessage: "N8N_INACTIVE"
      });
      return;
    }

    const webhookUrl = resolveWebhookUrl(n8nConfig?.n8nBaseUrl, n8nConfig?.extractionWebhookPlaceholder);
    if (!webhookUrl) {
      await extractionDispatchRepository.markJobFailed(jobId, {
        errorMessage: "N8N_WEBHOOK_NOT_CONFIGURED"
      });
      return;
    }

    const workflowKey = String(n8nConfig?.workflowKeyToken || "").trim();
    if (!workflowKey) {
      await extractionDispatchRepository.markJobFailed(jobId, {
        errorMessage: "N8N_WORKFLOW_KEY_MISSING"
      });
      return;
    }

    const payload = buildExtractionPayload({ job, invoice, n8nConfig, storage });
    const response = await fetchWithTimeout(
      webhookUrl,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-workflow-key": workflowKey
        },
        body: JSON.stringify(payload)
      },
      options.httpTimeoutMs
    );

    if (response.ok) {
      await extractionDispatchRepository.markJobDispatched(jobId, {
        httpStatus: response.status
      });
      return;
    }

    const message = `Extraction webhook returned HTTP ${response.status}`;
    await failOrRetry({
      message,
      httpStatus: response.status,
      forceFail: !isRetryableHttpStatus(response.status)
    });
  } catch (error) {
    const message = error?.name === "AbortError"
      ? "Extraction webhook timeout"
      : (error?.message || "Extraction webhook request failed");
    await failOrRetry({ message });
  }
};

const runWorkerCycle = async (options) => {
  if (cycleInFlight) return;
  cycleInFlight = true;

  try {
    await extractionDispatchRepository.recoverStaleProcessingJobs(options.staleLockMs);
    const jobs = await extractionDispatchRepository.claimPendingJobs(options.batchSize);
    if (!Array.isArray(jobs) || jobs.length === 0) return;

    const queue = [...jobs];
    const workerCount = Math.min(options.concurrency, queue.length);
    const workers = [];

    for (let index = 0; index < workerCount; index += 1) {
      workers.push(
        (async () => {
          while (queue.length > 0) {
            const job = queue.shift();
            if (!job) break;
            await processOneJob(job, options);
          }
        })()
      );
    }

    await Promise.all(workers);
  } catch (error) {
    console.error(`[extraction-dispatch] Worker cycle failed: ${error?.message || "unknown error"}`);
  } finally {
    cycleInFlight = false;
  }
};

export const extractionDispatchService = {
  async runOnce(overrides = {}) {
    const options = normalizeWorkerOptions(overrides);
    await runWorkerCycle(options);
  },

  startScheduler(overrides = {}) {
    if (schedulerHandle) return;
    if (String(process.env.EXTRACTION_DISPATCH_DISABLED || "").trim() === "1") return;

    const options = normalizeWorkerOptions(overrides);
    const run = () => runWorkerCycle(options).catch(() => null);

    initialKickHandle = setTimeout(() => {
      run();
    }, 1000);

    schedulerHandle = setInterval(run, options.pollIntervalMs);
  },

  stopScheduler() {
    if (initialKickHandle) {
      clearTimeout(initialKickHandle);
      initialKickHandle = null;
    }
    if (schedulerHandle) {
      clearInterval(schedulerHandle);
      schedulerHandle = null;
    }
  }
};
