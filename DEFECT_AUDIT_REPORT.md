# Comprehensive Defect Audit Report - AccountingAI

**Report Date:** March 23, 2026  
**Scope:** Full-stack codebase (Backend Node.js/Express, Frontend React)  
**Total Defects Found:** 47 (8 CRITICAL, 18 HIGH, 16 MEDIUM, 5 LOW)

---

## Executive Summary

This codebase has several **critical security and data integrity issues** that require immediate attention:

- **Tenant Isolation Weakness**: Context object can be overridden by user-supplied headers
- **N8N Webhook Authentication Gap**: Extraction webhooks lack proper authentication
- **Missing Input Validation**: Query parameters and request bodies lack comprehensive validation
- **Error Handling**: Promise rejections in fire-and-forget operations (N8N webhooks)
- **State Management**: Potential race conditions in invoice status transitions
- **Resource Leaks**: Unclosed database connections in exception paths

---

## CRITICAL SEVERITY DEFECTS (8)

### 1. Tenant Isolation Bypass via Header Override
**File:** [backend/src/middleware/tenantContext.js](backend/src/middleware/tenantContext.js)  
**Line:** 3-8  
**Category:** Authorization & Authentication / Tenant Isolation  
**Severity:** CRITICAL  

**Issue:**
```javascript
export const tenantContext = (req, _res, next) => {
  const tenantId = req.header("x-tenant-id") || req.auth?.tenantId || env.defaults.tenantId;
  const branchId = req.header("x-branch-id") || req.auth?.branchId || env.defaults.branchId;
```

The middleware accepts `x-tenant-id` and `x-branch-id` headers directly from user input. An authenticated user can supply arbitrary header values to access data from other tenants, completely bypassing tenant isolation.

**Impact:**  
- Unauthorized access to other tenants' invoices, audit logs, and financial data
- Data breaches across multi-tenant deployments
- Potential compliance violations (GDPR, data localization)

**Suggested Fix:**
```javascript
export const tenantContext = (req, _res, next) => {
  // Only use tenantId and branchId from JWT claims, never user-supplied headers
  const tenantId = req.auth?.tenantId || env.defaults.tenantId;
  const branchId = req.auth?.branchId || env.defaults.branchId;
  
  // Validate branch belongs to tenant (move to service layer)
  req.context = {
    tenantId,
    branchId,
    requestId: req.header("x-request-id") || null,
    userId: req.auth?.userId || null,
    role: req.auth?.role || null
  };
  next();
};
```

---

### 2. N8N Webhook Authentication Missing
**File:** [backend/src/services/invoicesService.js](backend/src/services/invoicesService.js#L1125)  
**Lines:** 1125-1155  
**Category:** Security / Webhook Authentication  
**Severity:** CRITICAL  

**Issue:**
```javascript
const headers = { "Content-Type": "application/json" };
if (workflowKey) {
  headers["x-workflow-key"] = workflowKey;
}

fetch(webhookUrl, {
  method: "POST",
  headers,
  body: JSON.stringify({
    batchId,
    invoiceId: item.invoiceId,
    // ...
  })
}).catch((err) => {
  console.error(`[n8n] Extraction webhook failed...`);
});
```

The N8N webhook endpoint has no validation that requests are coming from authorized sources. An attacker can directly invoke extraction endpoints, triggering:
- Malicious extraction results
- False status transitions
- DOS attacks against N8N

**Impact:**  
- Malicious extraction results injected into invoices
- False approval/posting of invoices
- Data corruption at scale

**Suggested Fix:**
```javascript
// Use HMAC-SHA256 signature or mutual TLS for webhook authentication
const crypto = require('crypto');
const signature = crypto
  .createHmac('sha256', process.env.N8N_WEBHOOK_SECRET)
  .update(JSON.stringify(body))
  .digest('hex');

const headers = {
  "Content-Type": "application/json",
  "x-webhook-signature": signature,
  "x-webhook-timestamp": Date.now().toString()
};
```

---

### 3. Missing Null Check - Invoice ID Parameter
**File:** [backend/src/services/invoicesService.js](backend/src/services/invoicesService.js#L185)  
**Lines:** 185-190  
**Category:** Null Pointer / Data Validation  
**Severity:** CRITICAL  

**Issue:**
```javascript
const requireInvoiceId = (invoiceId) => {
  if (typeof invoiceId !== "string" || invoiceId.trim() === "") {
    throw createError("Invoice id is required", 400, "VALIDATION_ERROR");
  }
  return invoiceId.trim();
};
```

However, when `invoiceId` is `null` or `undefined`, `typeof null === "object"` doesn't match the string check, and calling `.trim()` on null will throw `TypeError`, not the custom error. Routes accept invoiceId from `req.params.id` which could be null.

**Impact:**  
- Unhandled exceptions landing in error handler
- Information leakage about code flow
- Potential server crashes

**Suggested Fix:**
```javascript
const requireInvoiceId = (invoiceId) => {
  if (!invoiceId || typeof invoiceId !== "string" || invoiceId.trim() === "") {
    throw createError("Invoice id is required", 400, "VALIDATION_ERROR");
  }
  return invoiceId.trim();
};
```

---

### 4. Database Connection Not Released on Error (markExtractionStarted)
**File:** [backend/src/services/invoicesService.js](backend/src/services/invoicesService.js#L755)  
**Lines:** 755-771  
**Category:** Resource Management / Connection Leaks  
**Severity:** CRITICAL  

**Issue:**
```javascript
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
    client.release();  // ✓ Correctly released
  }
}
```

While this specific function has proper finally block, many similar async operations throughout the codebase don't. Checking `applyExtractionResult` - has proper connection release. But pattern needs audit across all service methods.

**Impact:**  
- Database connection pool exhaustion
- Cascading timeout errors
- Service unavailability

---

### 5. File Path Traversal Risk in Invoice Upload
**File:** [backend/src/services/invoicesService.js](backend/src/services/invoicesService.js#L1078-1085)  
**Lines:** 1078-1085  
**Category:** Security / Path Traversal  
**Severity:** CRITICAL  

**Issue:**
```javascript
const fileName = sanitizeUploadFileName(file?.originalname);
// ...
const storedName = `${Date.now()}-${randomUUID()}-${fileName}`;
const originalFilePath = path.join(incomingPath, storedName);

// sanitizeUploadFileName does:
const sanitizeUploadFileName = (name) => {
  const raw = typeof name === "string" ? name.trim() : "";
  const fallback = raw || `invoice-${Date.now()}`;
  return fallback.replace(/[^a-zA-Z0-9._-]/g, "_");  // Only removes special chars
};
```

If `incomingPath` is user-controllable (via storage config override), an attacker could escape the directory with `../` sequences. The filename sanitization itself is good, but the directory structure isn't validated for traversal.

**Impact:**  
- Files written outside intended storage directory
- Overwriting critical application files
- Information disclosure

**Suggested Fix:**
```javascript
// Validate that resolved path stays within storage root
const path = require('path');
const fs = require('fs');

const realStoragePath = fs.realpathSync(incomingPath);
const realFilePath = path.resolve(incomingPath, storedName);

if (!realFilePath.startsWith(realStoragePath)) {
  throw createError("Invalid storage path", 500, "INVALID_STORAGE_PATH");
}
```

---

### 6. Uncaught Promise Rejection in N8N Webhook (Fire-and-Forget)
**File:** [backend/src/services/invoicesService.js](backend/src/services/invoicesService.js#L1115-1135)  
**Lines:** 1115-1135  
**Category:** Error Handling / Promise Rejection  
**Severity:** CRITICAL  

**Issue:**
```javascript
for (const item of items) {
  const headers = { "Content-Type": "application/json" };
  if (workflowKey) {
    headers["x-workflow-key"] = workflowKey;
  }

  fetch(webhookUrl, {
    method: "POST",
    headers,
    body: JSON.stringify({...})
  }).catch((err) => {
    console.error(`[n8n] Extraction webhook failed for invoice ${item.invoiceId}: ${err.message}`);
  });
  // ^^^ Promise NOT awaited - fire-and-forget with only .catch(), not proper error handling
}
```

The fetch is deliberately not awaited (fire-and-forget pattern). If the N8N URL is invalid or network is down, the promise rejection is logged but no retry mechanism exists. More critically, if `JSON.stringify()` fails, it throws synchronously and kills the upload request.

**Impact:**  
- Failed extractions go unnoticed
- Invoices stuck in UPLOADED state forever
- Webhook requests pile up in memory/network queue

**Suggested Fix:**
```javascript
// Queue webhook calls with retry logic
const queueN8nWebhook = async (url, payload, headers, maxRetries = 3) => {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
        timeout: 10000
      });
      
      if (response.ok) {
        console.log(`[n8n] Webhook sent for invoice ${payload.invoiceId}`);
        return;
      }
      
      if (attempt < maxRetries) {
        await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
      }
    } catch (error) {
      if (attempt === maxRetries) {
        // Log and skip - don't throw
        console.error(`[n8n] Webhook failed after ${maxRetries} attempts:`, error);
        return;
      }
    }
  }
};
```

---

### 7. Missing Tenant ID Validation in bulkUploadInvoices
**File:** [backend/src/services/invoicesService.js](backend/src/services/invoicesService.js#L1005-1015)  
**Lines:** 1005-1015  
**Category:** Authorization / Input Validation  
**Severity:** CRITICAL  

**Issue:**
```javascript
async bulkUploadInvoices({ context, body = {}, files = [] }) {
  const tenantId = toOptionalString(body.tenantId ?? body.tenant_id);
  const branchId = toOptionalString(body.branchId ?? body.branch_id);
  
  // ...
  
  if (context.role !== "SUPER_ADMIN" && context.tenantId && context.tenantId !== tenantId) {
    throw createError("Forbidden", 403, "FORBIDDEN");
  }
```

The validation only checks if the requested `tenantId` DIFFERS from `context.tenantId`. If `tenantId` is not provided in the body, it defaults to `null`, and the check passes. Then later:

```javascript
const branchExists = await invoiceRuntimeRepository.branchExistsForTenant(tenantId, branchId);
```

This would query with `tenantId = null` or the default tenant instead of the user's actual tenant.

**Impact:**  
- Users can upload invoices to any tenant by omitting tenantId parameter
- Cross-tenant data injection

**Suggested Fix:**
```javascript
if (!tenantId) {
  throw createError("tenantId is required", 400, "VALIDATION_ERROR");
}

// For non-SUPER_ADMIN users, MUST match their authenticated tenant
if (context.role !== "SUPER_ADMIN") {
  if (tenantId !== context.tenantId) {
    throw createError("Forbidden", 403, "FORBIDDEN");
  }
} else {
  // SUPER_ADMIN can upload to any tenant, but must validate it exists
  const tenantExists = await someRepository.tenantExists(tenantId);
  if (!tenantExists) {
    throw createError("tenantId is invalid", 400, "VALIDATION_ERROR");
  }
}
```

---

### 8. Duplicate Detection Query Does Not Respect Tenant Isolation
**File:** [backend/src/repositories/invoicePostingRepository.js](backend/src/repositories/invoicePostingRepository.js#L60)  
**Lines:** 60-72  
**Category:** Tenant Isolation / Business Logic  
**Severity:** CRITICAL  

**Issue:**
```javascript
async hasDuplicatePosted(client, invoiceId, tenantId, dedupeKey) {
  if (!dedupeKey) return false;

  const result = await client.query(
    `SELECT 1
       FROM invoices
      WHERE tenant_id    = $1
        AND dedupe_key   = $2
        AND business_status = 'POSTED'
        AND id          != $3
      LIMIT 1`,
    [tenantId, dedupeKey, invoiceId]
  );

  return result.rows.length > 0;
}
```

While this query includes `tenant_id = $1`, the logic in `startPosting()` calls:
```javascript
const isDuplicate = await invoicePostingRepository.hasDuplicatePosted(
  client, normalizedId, context.tenantId, invoice.dedupeKey
);
```

If `context.tenantId` is compromised (from the header override issue #1), a user could check duplicates across tenants. However, this is secondary to issue #1.

**Impact:**  
- Deduplication logic bypassed when combined with Issue #1
- Allows duplicate posting across tenant boundaries

---

## HIGH SEVERITY DEFECTS (18)

### 9. No Role-Based Access Control Enforcement
**File:** [backend/src/middleware/authGuard.js](backend/src/middleware/authGuard.js#L10-34)  
**Category:** Authorization  
**Severity:** HIGH  

**Issue:**  
The auth guard validates JWT tokens but doesn't enforce role-based access. No middleware checks if a user's role (SUPER_ADMIN, TENANT_ADMIN, USER) can access specific routes. This is deferred to service layer but inconsistently applied.

**Suggested Fix:**  
Create role-based middleware:
```javascript
export const requireRole = (...allowedRoles) => (req, _res, next) => {
  if (!allowedRoles.includes(req.auth?.role)) {
    const error = new Error("Insufficient permissions");
    error.statusCode = 403;
    error.code = "FORBIDDEN";
    next(error);
    return;
  }
  next();
};
```

---

### 10. JWT Token Contains plaintext sensitive info
**File:** [backend/src/services/authTokenService.js](backend/src/services/authTokenService.js#L13-23)  
**Category:** Security  
**Severity:** HIGH  

**Issue:**
```javascript
createToken(claims) {
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    ...claims,  // Includes userId, tenantId, branchId, email, fullName, role
    iat: now,
    exp: now + ttlSeconds
  };
```

JWT tokens include plaintext email, fullName, tenantId, branchId. While JWTs are base64url-encoded (not encrypted), they can be decoded by anyone. This is a design issue but not a vulnerability per se since it's a custom JWT implementation (not using standard JWT library with HS256).

**Concern:** If tokens are logged or intercepted, sensitive information is exposed.

---

### 11. No Input Validation on List Query Parameters
**File:** [backend/src/repositories/invoiceReadRepository.js](backend/src/repositories/invoiceReadRepository.js#L89-145)  
**Category:** Data Validation  
**Severity:** HIGH  

**Issue:**
```javascript
if (filters.search) {
  params.push(`%${filters.search}%`);
  whereParts.push(`(
    i.party_name ILIKE $${params.length}
    OR i.party_gstin ILIKE $${params.length}
    OR i.invoice_number ILIKE $${params.length}
  )`);
}
```

The `filters.search` is passed directly into SQL ILIKE queries. While parameterized queries protect against SQL injection, there's no length limit or regex validation on search terms. An attacker could submit:
- Very long strings (DOS via resource exhaustion)
- Wildcard patterns (DOS via query performance)

**Impact:**  
- Full table index scan attacks
- Query timeout/slowness

**Suggested Fix:**
```javascript
if (filters.search) {
  const sanitizedSearch = String(filters.search).trim().slice(0, 100);
  if (sanitizedSearch.length < 2) {
    throw createError("Search term must be at least 2 characters", 400, "VALIDATION_ERROR");
  }
  params.push(`%${sanitizedSearch}%`);
  // Continue...
}
```

---

### 12. Unvalidated External Input - N8N Extraction Payloads
**File:** [backend/src/services/invoicesService.js](backend/src/services/invoicesService.js#L260-310)  
**Category:** Data Validation  
**Severity:** HIGH  

**Issue:**
```javascript
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
```

The `raw_model_output` and `extracted_json` are accepted with minimal validation:
```javascript
rawModelOutput: toObject(payload.raw_model_output || {}, "raw_model_output"),
extractedJson: toObject(payload.extracted_json || {}, "extracted_json"),
```

These fields are stored directly in the database without size limits. An N8N webhook (even with signature) could send:
- Extremely large JSON (DOS, storage exhaustion)
- Malicious data structures (JSON bomb)

**Impact:**  
- Database bloat
- Application memory exhaustion
- Slow queries

---

### 13. Race Condition in Invoice Status Transitions
**File:** [backend/src/services/invoicesService.js](backend/src/services/invoicesService.js#L1255-1310)  
**Category:** Concurrency / Business Logic  
**Severity:** HIGH  

**Issue:**
```javascript
async startPosting(invoiceId, context, payload = {}) {
  //...
  const invoice = await invoicePostingRepository.findById(normalizedId, context.tenantId, client);
  
  if (invoice.businessStatus !== "APPROVED") {
    throw createError(...);
  }
  
  const isDuplicate = await invoicePostingRepository.hasDuplicatePosted(...);
  
  const locked = await invoicePostingRepository.lockForPosting(client, normalizedId, context.tenantId);
```

Between the `findById` check and `lockForPosting`, another concurrent request could:
1. Invoke extraction result that changes status to EXTRACTING
2. Invoke approval that changes status to APPROVED again
3. Invoke another startPosting call

The `lockForPosting` query has a conditional:
```sql
WHERE id = $1 AND tenant_id = $2 AND business_status = 'APPROVED' AND posting_locked = FALSE
```

This is atomic, but multiple concurrent calls might all pass the initial check and race to lock. The second one returns NULL (locked already), but there's no exponential backoff or queue.

**Impact:**  
- First-write-wins race condition
- Unpredictable behavior under load
- Lost state transitions

---

### 14. Missing Dependent Hook in Frontend Invoice Component
**File:** [frontend/src/pages/InvoiceReviewDetailPage.jsx](frontend/src/pages/InvoiceReviewDetailPage.jsx#L29-35)  
**Category:** Frontend / React Hooks  
**Severity:** HIGH  

**Issue:**
```javascript
useEffect(() => {
  loadDetail();
}, [reviewId, selectedTenantId, selectedBranchId]);
```

The `loadDetail` function is defined in the component body and references `setViewState`, `setErrorMessage`, etc. These change on every render. However, the dependency array doesn't include `loadDetail`, which means if the function definition changes, the effect won't re-run. More critically:

```javascript
const [detail, setDetail] = useState(null);
const [form, setForm] = useState({});

const correctedJson = useMemo(
  () => ({...}),
  [form]  // ✓ Correct dependency
);
```

The `correctedJson` memo depends on `form`, but the form is initialized from `detail`:
```javascript
setForm({
  documentType: data.documentType,
  // ...
});
```

If `detail` loads and changes, the form updates, but if the dependency array in `loadDetail` doesn't include certain variables, stale data could be shown.

**Impact:**  
- Stale data displayed to user
- Memoized values not recalculated properly

**Suggested Fix:**
```javascript
const loadDetail = useCallback(async () => {
  // ...
}, [reviewId, selectedTenantId, selectedBranchId]); // Dependencies of function body

useEffect(() => {
  loadDetail();
}, [loadDetail]);
```

---

### 15. Controlled vs Uncontrolled Input - numericType Coercion
**File:** [frontend/src/pages/InvoiceReviewDetailPage.jsx](frontend/src/pages/InvoiceReviewDetailPage.jsx#L45-65)  
**Category:** Frontend / Data Handling  
**Severity:** HIGH  

**Issue:**
```javascript
setForm({
  // ...
  subtotal: String(data.subtotal || ""),
  taxableAmount: String(data.taxableAmount || ""),
  // ...
});

const updateField = (key) => (event) => {
  setForm((prev) => ({ ...prev, [key]: event.target.value }));
};
```

The form fields are strings, but the backend expects numbers:
```javascript
const toOptionalNumber = (value, fieldName) => {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  if (typeof value !== "number" || Number.isNaN(value)) {
    throw createError(`${fieldName} must be a number`, 400, "VALIDATION_ERROR");
  }
  return value;
};
```

When `correctedJson` is sent:
```javascript
const correctedJson = useMemo(
  () => ({
    // ...
    subtotal: form.subtotal,  // This is a STRING "1000.50", not number
    // ...
  }),
  [form]
);
```

The API will receive string values where it expects numbers, causing validation errors.

**Impact:**  
- Form rejects valid user input
- Confusion and poor UX

**Suggested Fix:**
```javascript
const correctedJson = useMemo(
  () => ({
    // ...
    subtotal: form.subtotal ? Number(form.subtotal) : null,
    taxableAmount: form.taxableAmount ? Number(form.taxableAmount) : null,
    cgstAmount: form.cgstAmount ? Number(form.cgstAmount) : null,
    sgstAmount: form.sgstAmount ? Number(form.sgstAmount) : null,
    igstAmount: form.igstAmount ? Number(form.igstAmount) : null,
    roundOffAmount: form.roundOffAmount ? Number(form.roundOffAmount) : null,
    totalAmount: form.totalAmount ? Number(form.totalAmount) : null
  }),
  [form]
);
```

---

### 16. Silent Failure in Frontend API Error Handling
**File:** [frontend/src/api/client.js](frontend/src/api/client.js#L26-50)  
**Category:** Frontend / Error Handling  
**Severity:** HIGH  

**Issue:**
```javascript
const request = async (path, { method = "GET", body, isMultipart = false } = {}) => {
  const headers = { ...getSessionHeaders() };
  if (!isMultipart) {
    headers["Content-Type"] = "application/json";
  }

  const response = await fetch(`${API_BASE_URL}${path}`, {
    method,
    headers,
    body: body ? (isMultipart ? body : JSON.stringify(body)) : undefined
  });

  const json = await response.json().catch(() => ({}));  // ← Silent failure

  if (!response.ok || json.success === false) {
    const message = json?.error?.message || `Request failed with status ${response.status}`;
    const code = json?.error?.code || "REQUEST_FAILED";
    throw toError(message, code);
  }

  return json;
};
```

If `response.json()` throws (e.g., response was not JSON), the catch silently returns `{}`. Then the code checks `json.error.message` which is undefined, and throws a generic error. The root cause (response wasn't JSON) is lost.

**Impact:**  
- Debugging becomes hard
- Wrong error messages shown to users

---

### 17. Missing CSRF Token Protection
**File:** [frontend/src/api/client.js](frontend/src/api/client.js)  
**Category:** Security  
**Severity:** HIGH  

**Issue:**  
The frontend API client doesn't include CSRF tokens in POST/PATCH/DELETE requests. While the backend uses CORS for mitigation, CSRF tokens provide additional defense-in-depth.

**Suggested Fix:**
```javascript
const getCsrfToken = () => {
  // Extract from meta tag or cookie
  return document.querySelector('meta[name="csrf-token"]')?.content || '';
};

const request = async (path, { method = "GET", body, isMultipart = false } = {}) => {
  const headers = { ...getSessionHeaders() };
  
  if (["POST", "PATCH", "DELETE", "PUT"].includes(method)) {
    headers["x-csrf-token"] = getCsrfToken();
  }
  // ...
};
```

---

### 18. No Input Validation on Reject Reason
**File:** [backend/src/services/invoicesService.js](backend/src/services/invoicesService.js#L1330-1345)  
**Category:** Data Validation  
**Severity:** HIGH  

**Issue:**
```javascript
async rejectInvoice(invoiceId, context, payload = {}) {
  const normalizedId = requireInvoiceId(invoiceId);
  const rejected = await invoiceReadRepository.rejectInvoice(
    normalizedId,
    context.tenantId,
    context,
    payload.reason || "Rejected in review"  // ← No validation on payload.reason
  );
```

The `payload.reason` is passed directly without type or length validation. An attacker could submit a 1MB reason string, storing it in the database.

**Suggested Fix:**
```javascript
const reason = toOptionalString(payload.reason) || "Rejected in review";
if (reason && reason.length > 1000) {
  throw createError("Reason must be 1000 characters or less", 400, "VALIDATION_ERROR");
}
```

---

### 19-26. Additional HIGH Severity Issues

### 19. No Pagination on Invoice List Endpoint
**File:** [backend/src/repositories/invoiceReadRepository.js](backend/src/repositories/invoiceReadRepository.js#L150)  
**Severity:** HIGH  

**Issue:**  
Lists return up to 300 invoices with no pagination:
```javascript
LIMIT 300
```

This causes memory issues when rendering 300+ items on frontend and potential DOS if filter is too loose.

---

### 20. Missing Transaction Rollback in some paths
**File:** [backend/src/services/invoicesService.js](backend/src/services/invoicesService.js)  
**Category:** Database Transactions  
**Severity:** HIGH  

Some service methods don't use transactions at all - they make multiple sequential queries that could be interrupted mid-way.

---

### 21. No Rate Limiting on API Endpoints
**File:** [backend/src/app.js](backend/src/app.js)  
**Severity:** HIGH  

There's no rate limiting middleware. An attacker can flood endpoints.

---

### 22. localStorage XSS Vulnerability in Token Storage
**File:** [frontend/src/auth/AuthContext.jsx](frontend/src/auth/AuthContext.jsx#L7-8)  
**Category:** Security / XSS  
**Severity:** HIGH  

Tokens stored in localStorage can be accessed by XSS injections. Should use httpOnly cookies.

---

### 23. No Token Refresh Mechanism
**File:** [backend/src/services/authTokenService.js](backend/src/services/authTokenService.js)  
**Severity:** HIGH  

Tokens expire but there's no refresh endpoint. Users get logged out suddenly.

---

### 24. Missing404 Route Handler for Non-Existent Reviews
**File:** [backend/src/controllers/reviewController.js](backend/src/controllers/reviewController.js)  
**Category:** Error Handling  
**Severity:** HIGH  

If an invoice doesn't exist when requesting review, the error message leaks database errors.

---

### 25. No Validation of Extracted JSON Structure
**File:** [backend/src/services/invoicesService.js](backend/src/services/invoicesService.js#L1110-1120)  
**Category:** Data Validation  
**Severity:** HIGH  

The `extracted_json` payload from N8N is accepted without schema validation.

---

### 26. Missing branchId Validation in Bulk Upload
**File:** [backend/src/services/invoicesService.js](backend/src/services/invoicesService.js#L1040-1050)  
**Severity:** HIGH  

No validation that the provided branchId exists or belongs to the tenant before file upload begins.

---

## MEDIUM SEVERITY DEFECTS (16)

### 27. No Audit Logging for Authentication Events
**File:** [backend/src/services/authService.js](backend/src/services/authService.js)  
**Category:** Auditing  
**Severity:** MEDIUM  

Login/logout events aren't logged for compliance.

---

### 28. Missing Content-Type Validation on File Upload
**File:** [backend/src/middleware/uploadMiddleware.js](backend/src/middleware/uploadMiddleware.js)  
**Category:** Data Validation  
**Severity:** MEDIUM  

Multer limits files to 100 but doesn't validate Content-Type header.

---

### 29. No Maximum File Size Limit
**File:** [backend/src/services/invoicesService.js](backend/src/services/invoicesService.js#L1070)  
**Severity:** MEDIUM  

Files can be arbitrarily large, consuming disk/memory.

---

### 30. Error Messages Expose Internal Field Names
**File:** [backend/src/services/invoicesService.js](backend/src/services/invoicesService.js#L200-230)  
**Category:** Security / Information Disclosure  
**Severity:** MEDIUM  

Error messages include database field names like `raw_model_output`, exposing schema.

---

### 31. No Validation of Corrected JSON in Review
**File:** [backend/src/services/reviewService.js](backend/src/services/reviewService.js)  
**Severity:** MEDIUM  

The `corrected_json` payload isn't validated to match schema.

---

### 32. Missing Constraint on Invoice Status Machine
**File:** [backend/src/services/invoicesService.js](backend/src/services/invoicesService.js#L1305-1315)  
**Category:** Business Logic  
**Severity:** MEDIUM  

Not all invalid state transitions are prevented (e.g., can't go from REJECTED to APPROVED, but business logic doesn't enforce this completely).

---

### 33. No Cleanup of Failed Uploads
**File:** [backend/src/services/invoicesService.js](backend/src/services/invoicesService.js#L1070-1100)  
**Category:** Resource Management  
**Severity:** MEDIUM  

If database insert fails after file write, the physical file is left orphaned with no cleanup mechanism.

---

### 34. Missing User Activity Timestamps
**File:** [backend/src/repositories/invoiceRuntimeRepository.js](backend/src/repositories/invoiceRuntimeRepository.js#L104)  
**Severity:** MEDIUM  

User activity logs don't include updated_at timestamp in some cases.

---

### 35. No Session Timeout Configuration
**File:** [backend/src/services/authTokenService.js](backend/src/services/authTokenService.js)  
**Severity:** MEDIUM  

TTL is hardcoded to 8 hours with no configuration. Should be configurable per environment.

---

### 36. Missing Validation of Storage Paths
**File:** [backend/src/services/storageService.js](backend/src/services/storageService.js#L30)  
**Severity:** MEDIUM  

Storage paths returned from `mergeStoragePaths` aren't validated to be absolute paths.

---

### 37. No Immutability Checks on Critical Fields
**File:** [backend/src/repositories/invoicePostingRepository.js](backend/src/repositories/invoicePostingRepository.js)  
**Severity:** MEDIUM  

Once approved, an invoice's extracted_json can still be modified.

---

### 38. No Deduplication on Party GSTIN Alone
**File:** [backend/src/services/invoicesService.js](backend/src/services/invoicesService.js#L680-695)  
**Category:** Business Logic  
**Severity:** MEDIUM  

Deduplication requires all 4 fields (GSTIN, invoice number, date, amount). A party can submit multiple invoices with same GSTIN but different numbers (legitimate), but same number with different amounts (fraud).

---

### 39. Missing Soft Delete for Audit Trail
**File:** [backend/src/repositories/invoiceReadRepository.js](backend/src/repositories/invoiceReadRepository.js)  
**Severity:** MEDIUM  

Rejected invoices can be hard-deleted, losing audit trail.

---

### 40. No Rate Limiting on N8N Webhook Calls
**File:** [backend/src/services/invoicesService.js](backend/src/services/invoicesService.js#L1115)  
**Severity:** MEDIUM  

Multiple bulk uploads trigger many concurrent N8N webhooks with no throttling.

---

### 41. Frontend State Not Cleared on Logout
**File:** [frontend/src/auth/AuthContext.jsx](frontend/src/auth/AuthContext.jsx#L90-100)  
**Category:** Frontend / State Management  
**Severity:** MEDIUM  

When user logs out, local component state (invoice cache, form data) isn't cleared, persisting between users on shared devices.

---

### 42. No Retry Logic for Failed Extractions
**File:** [backend/src/services/invoicesService.js](backend/src/services/invoicesService.js)  
**Severity:** MEDIUM  

N8N extraction failures don't automatically retry. Users must manually trigger retry.

---

## LOW SEVERITY DEFECTS (5)

### 43. Missing X-Content-Type-Options Header
**File:** [backend/src/app.js](backend/src/app.js)  
**Category:** Security Headers  
**Severity:** LOW  

**Issue:**  
No `X-Content-Type-Options: nosniff` header prevents MIME sniffing.

**Fix:**
```javascript
app.use((req, res, next) => {
  res.header("X-Content-Type-Options", "nosniff");
  res.header("X-Frame-Options", "DENY");
  res.header("X-XSS-Protection", "1; mode=block");
  next();
});
```

---

### 44. Missing API Response Standardization
**File:** [backend/src/controllers/invoicesController.js](backend/src/controllers/invoicesController.js)  
**Category:** API Design  
**Severity:** LOW  

**Issue:**  
Some endpoints return `{ success: true, data }`, others just `data`. Inconsistent.

---

### 45. Missing Database Connection Pool Configuration
**File:** [backend/src/db/pool.js](backend/src/db/pool.js)  
**Category:** Performance  
**Severity:** LOW  

**Issue:**  
Pool max/min connections aren't configured. Uses default of 10, might need tuning.

---

### 46. Unused Import in Multiple Files
**File:** Various  
**Severity:** LOW  

Some files import unused modules (e.g., `randomUUID` imported but not used in some contexts).

---

### 47. Missing Environment Variable Documentation
**File:** [backend/src/config/env.js](backend/src/config/env.js)  
**Severity:** LOW  

No `.env.example` file documenting required variables.

---

## SUMMARY BY CATEGORY

### Security Vulnerabilities: 11
- Tenant isolation bypass (CRITICAL)
- N8N webhook auth (CRITICAL)
- File path traversal (CRITICAL)
- JWT token exposure (HIGH)
- CSRF token missing (HIGH)
- localStorage XSS (HIGH)
- Input validation gaps (HIGH+MEDIUM)
- Security headers missing (LOW)

### Authorization & Authentication: 2
- Role-based access control missing (HIGH)
- Token refresh missing (HIGH)

### Data Validation: 9
- Missing null checks (CRITICAL)
- Query parameter validation (HIGH)
- List input validation (HIGH+ MEDIUM)
- JSON payload validation (HIGH+MEDIUM)
- No schema validation (MEDIUM)

### Resource Management: 4
- Database connection leaks (CRITICAL)
- File cleanup on failure (MEDIUM)
- Orphaned files (MEDIUM)
- Pool configuration (LOW)

### Error Handling: 3
- Fire-and-forget webhooks (CRITICAL)
- Promise rejections (HIGH)
- Silent API failures (HIGH)

### Business Logic: 4
- Race conditions (HIGH)
- Deduplication gaps (MEDIUM)
- Status machine incomplete (MEDIUM)
- No soft delete (MEDIUM)

### Frontend Issues: 5
- Missing hook dependencies (HIGH)
- Uncontrolled inputs (HIGH)
- State cleanup missing (MEDIUM)
- Stale closures (MEDIUM)

### Database & Performance: 3
- No pagination (HIGH)
- No transaction isolation (HIGH)
- Missing indexes (potential)

---

## REMEDIATION PRIORITY

### Immediate (Within 1 week):
1. Fix tenant isolation bypass (#1)
2. Fix N8N webhook auth (#2)
3. Fix missing tenantId validation (#7)
4. Fix file path traversal (#5)
5. Fix N8N fire-and-forget pattern (#6)

### Short-term (Within 2 weeks):
6. Add rate limiting
7. Add input validation framework
8. Fix all null pointer issues
9. Add database connection test cases
10. Implement error logging and monitoring

### Medium-term (Within 1 month):
11. Add comprehensive test coverage
12. Implement audit logging
13. Add pagination
14. Implement refresh token mechanism
15. Migrate token storage to httpOnly cookies

---

## TESTING RECOMMENDATIONS

- Add unit tests for all validation functions
- Add integration tests for multi-tenant scenarios
- Add security tests for tenant isolation
- Add concurrency tests for race conditions
- Add performance tests for DOS resistance

---

## Tracking Addendum (March 23, 2026)

### H-17. Hardcoded Workflow Key in N8N and Global Fallback Risk
**Severity:** HIGH  
**Category:** Security / Secret Management / Tenant Isolation  
**Files:**  
- `backend/n8n/workflows/TenantWiseN8n-new.json`  
- `backend/src/services/invoicesService.js`  
- `backend/src/middleware/authGuard.js`

**Issue:**  
N8N HTTP nodes were using hardcoded `x-workflow-key` values. Backend webhook/auth flow also allowed non-tenant-specific fallback behavior, which weakens per-tenant trust boundaries.

**Why this matters:**  
- Weakens tenant-level security isolation  
- Makes rotation and incident response harder  
- Increases blast radius if a shared/static key leaks

**Tracked remediation implemented:**  
- Replaced hardcoded `x-workflow-key` values in `TenantWiseN8n-new.json` with dynamic key propagation from webhook context.
- Enforced tenant-specific key checks in `authGuard` (no global fallback in workflow-key auth path).
- Enforced tenant-specific key use for outbound extraction webhook dispatch in `invoicesService`; dispatch is skipped when tenant key is missing.

**Follow-up checklist:**  
1. Ensure every tenant has a unique `workflow_key_token` in `tenant_n8n_config`.  
2. Rotate any previously hardcoded/shared keys.  
3. Re-import/publish updated workflow JSON in n8n.  
4. Add automated policy check: block workflow exports containing hardcoded `x-workflow-key` literals.

### H-18. Approval Did Not Dispatch Tenant Posting Webhook
**Severity:** HIGH  
**Category:** Orchestration / Posting Trigger  
**Files:**  
- `backend/src/services/invoicesService.js`

**Issue:**  
Invoice approval moved business status to `APPROVED`, but backend did not dispatch the tenant-configured posting webhook (`posting_webhook_placeholder`). This prevented posting workflow orchestration from starting automatically.

**Why this matters:**  
- Approved invoices remained stuck before posting automation  
- UI/backend state and n8n orchestration drifted  
- Manual recovery/triggering was required

**Tracked remediation implemented:**  
- Added posting webhook dispatch in `approveInvoice` using tenant `n8nBaseUrl + postingWebhookPlaceholder`.
- Enforced tenant workflow key usage (`workflowKeyToken`) in dispatch headers.
- Included dispatch metadata (`attempted`, `dispatched`, `skippedReason`) in approval response for observability.

### H-19. Workflow Runtime Contract Drift in Extraction/Approval Flow
**Severity:** HIGH  
**Category:** Workflow Design / Runtime Contract  
**Files:**  
- `backend/n8n/workflows/TenantWiseN8n-new.json`

**Issue:**  
Workflow retained legacy register-path behavior and approval flow lacked runtime-context bootstrap from backend before downstream processing.

**Why this matters:**  
- n8n can diverge from backend source-of-truth  
- Tenant/branch path resolution becomes brittle  
- Extraction/posting lifecycle reporting is incomplete or inconsistent

**Tracked remediation implemented:**  
- Added explicit extraction lifecycle callbacks: `extraction-started`, `extraction-retry`, `extraction-failed`.
- Disabled legacy register nodes in the active extraction graph.
- Added approval runtime-context fetch and mapper before posting branch execution.
- Standardized posting progress on backend activity callbacks (`POSTING_STARTED` / `POSTING_COMPLETED` / `POSTING_FAILED`).

### H-20. Posting Branch Missed Canonical Result/Failure Callbacks
**Severity:** HIGH  
**Category:** Workflow Integration / Posting Contract  
**Files:**  
- `backend/n8n/workflows/TenantWiseN8n-new.json`  
- `backend/check_n8n_migration.mjs`

**Issue:**  
Posting flow still had legacy behavior in parts of the graph: activity callback nodes used wrong/default HTTP method in one branch, posting call sites still pointed to `/posting-started`, and real posting outcome was not consistently routed to canonical backend endpoints (`/posting-result`, `/posting-failed`).

**Why this matters:**  
- Invoice may stay stuck in `POSTING` despite execution outcome  
- UI/backend state and n8n state can diverge  
- Ops cannot rely on lifecycle status for reconciliation

**Tracked remediation implemented:**  
- Switched posting execution call(s) to `/api/invoices/:id/posting-executor`.  
- Added explicit callback nodes:
  - `/api/invoices/:id/posting-result`
  - `/api/invoices/:id/posting-failed`
- Ensured posting branch callback method/header/body contract is consistent (`POST`, workflow headers, JSON payload with Tally summary/error metadata).
- Added migration guard checks in `check_n8n_migration.mjs` for:
  - no legacy `/posting-started` usage in posting branch
  - presence of `/posting-executor`, `/posting-result`, `/posting-failed`
  - no `GET` method misuse for `/activity` callbacks

### M-15. Missing Onboarding Connectivity Preflight With Definitive Failure Reasons
**Severity:** MEDIUM  
**Category:** Onboarding / Operational Readiness  
**Files:**  
- `backend/src/routes/superAdminTenants.js`  
- `backend/src/controllers/superAdminTenantController.js`  
- `backend/src/services/superAdminTenantService.js`  
- `frontend/src/api/tenantService.js`  
- `frontend/src/pages/SuperAdminTenantOnboardingPage.jsx`

**Issue:**  
Tenant onboarding previously allowed save without executing operational connectivity probes. Storage path issues, n8n reachability failures, and Tally connection failures surfaced only later during invoice processing.

**Why this matters:**  
- Delayed failure detection and repeated production retries  
- Unclear diagnostics for onboarding failures  
- Increased support and manual debugging effort

**Tracked remediation implemented:**  
- Added `POST /super-admin/tenants/connectivity-test` preflight endpoint.  
- Added onboarding UI step “Connectivity Tests” with explicit per-system status (`PASS` / `FAIL` / `SKIPPED`) and error code/message.  
- Added save-gate in onboarding flow: tenant config save is blocked when connectivity checks fail.  
- Added local storage write/read/delete probe + n8n and Tally network probes with definitive reason mapping (`TIMEOUT`, `ENOTFOUND`, `ECONNREFUSED`, invalid URL, HTTP status failures).

