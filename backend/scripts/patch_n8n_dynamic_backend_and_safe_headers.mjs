import { readFile, rename, writeFile } from "node:fs/promises";

const workflowPath = new URL("../n8n/workflows/TenantWiseN8n-new.json", import.meta.url);
const workflow = JSON.parse(await readFile(workflowPath, "utf8"));
const nodes = workflow.nodes || [];

const endpoints = [
  "activity",
  "runtime-context",
  "extraction-result",
  "extraction-started",
  "extraction-retry",
  "extraction-failed",
  "posting-executor",
  "posting-result",
  "posting-failed"
];

const baseResolver = `const pick = (...vals) => {
    for (const value of vals) {
      if (value !== undefined && value !== null && String(value).trim() !== '') return String(value).trim();
    }
    return '';
  };
  const fromBaseObj = (obj) => pick(
    obj?.backendApiBaseUrl,
    obj?.backend_api_base_url,
    obj?.runtimeContext?.apiBaseUrl,
    obj?.runtimeConfig?.apiBaseUrl,
    obj?.body?.backendApiBaseUrl,
    obj?.body?.runtimeContext?.apiBaseUrl,
    obj?.body?.runtimeConfig?.apiBaseUrl,
    obj?.n8n?.backendApiBaseUrl
  );
  const toUuid = (value) => {
    const text = value === undefined || value === null ? '' : String(value).trim();
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    return uuidRegex.test(text) ? text : '';
  };
  const fromInvoiceObj = (obj) => toUuid(pick(
    obj?.invoiceId,
    obj?.invoice_id,
    obj?.data?.invoiceId,
    obj?.data?.invoice_id,
    obj?.body?.invoiceId,
    obj?.body?.invoice_id,
    obj?.payload?.invoiceId,
    obj?.payload?.invoice_id,
    obj?.runtimeContext?.invoiceId,
    obj?.runtimeConfig?.invoiceId,
    obj?.runtimeConfig?.invoice_id
  ));
  const names = [
    'Tenant Context Guard',
    'tenant specific file path extractor',
    'Code in JavaScript5',
    'Code in JavaScript6',
    'Select rows from a table',
    'Select rows from a table1',
    'HTTP Request',
    'HTTP Request Auto Register',
    'Webhook'
  ];
  let apiBase = fromBaseObj($json);
  let invoiceId = fromInvoiceObj($json);
  for (const name of names) {
    if (apiBase && invoiceId) break;
    try {
      const rows = $items(name, 0, typeof $runIndex === 'number' ? $runIndex : 0);
      if (!Array.isArray(rows) || rows.length === 0) continue;
      for (const row of rows) {
        const json = row?.json || {};
        if (!apiBase) apiBase = fromBaseObj(json);
        if (!invoiceId) invoiceId = fromInvoiceObj(json);
        if (apiBase && invoiceId) break;
      }
    } catch (_e) {}
  }
  if (!apiBase) {
    throw new Error('Missing backendApiBaseUrl in runtime context. Configure tenant n8n backendApiBaseUrl during onboarding.');
  }
  const resolvedBase = String(apiBase).replace(/\\/+$/, '');`;

const buildUrlExpression = (endpoint) => `={{ (() => {
  ${baseResolver}
  if (!invoiceId) {
    throw new Error('Missing valid invoice id for ${endpoint} callback');
  }
  return resolvedBase + '/invoices/' + encodeURIComponent(String(invoiceId).trim()) + '/${endpoint}';
})() }}`;

const safeWorkflowKeyExpression = `={{ (() => {
  const pick = (...vals) => {
    for (const value of vals) {
      if (value !== undefined && value !== null && String(value).trim() !== '') return String(value).trim();
    }
    return '';
  };
  const fromObj = (obj) => pick(
    obj?.workflowKey,
    obj?.workflow_key,
    obj?.headers?.['x-workflow-key'],
    obj?.headers?.['X-Workflow-Key'],
    obj?.body?.workflowKey,
    obj?.body?.workflow_key,
    obj?.runtimeContext?.workflowKey,
    obj?.runtimeConfig?.workflowKey,
    obj?.n8n?.workflowKeyToken,
    obj?.n8n?.workflowKey
  );
  const direct = fromObj($json);
  if (direct) return direct;
  const names = [
    'Tenant Context Guard',
    'tenant specific file path extractor',
    'Code in JavaScript5',
    'Code in JavaScript6',
    'Select rows from a table',
    'Select rows from a table1',
    'HTTP Request',
    'HTTP Request Auto Register',
    'Webhook'
  ];
  for (const name of names) {
    try {
      const rows = $items(name, 0, typeof $runIndex === 'number' ? $runIndex : 0);
      if (!Array.isArray(rows) || rows.length === 0) continue;
      for (const row of rows) {
        const key = fromObj(row?.json || {});
        if (key) return key;
      }
    } catch (_e) {}
  }
  return '';
})() }}`;

for (const node of nodes) {
  if (node.type !== "n8n-nodes-base.httpRequest") continue;
  const params = node.parameters || {};
  const url = typeof params.url === "string" ? params.url : "";

  if (url.includes("/invoices/")) {
    const endpoint = endpoints.find((name) => url.includes(`/${name}`));
    if (endpoint) {
      params.url = buildUrlExpression(endpoint);
    }
  }

  const headers = params.headerParameters?.parameters;
  if (Array.isArray(headers)) {
    for (const header of headers) {
      if (String(header?.name || "").toLowerCase() === "x-workflow-key") {
        header.value = safeWorkflowKeyExpression;
      }
    }
  }

  node.parameters = params;
}

const tempPath = new URL("../n8n/workflows/TenantWiseN8n-new.json.tmp", import.meta.url);
await writeFile(tempPath, `${JSON.stringify(workflow, null, 2)}\n`, "utf8");
await rename(tempPath, workflowPath);

console.log("Patched workflow: dynamic backend base URL + safe workflow-key header expression.");
