import { randomUUID } from "node:crypto";
import { readFile, rename, writeFile } from "node:fs/promises";

const workflowPath = new URL("../n8n/workflows/TenantWiseN8n-new.json", import.meta.url);
const workflow = JSON.parse(await readFile(workflowPath, "utf8"));

const nodes = workflow.nodes || [];
const connections = workflow.connections || (workflow.connections = {});

const getNode = (name) => nodes.find((node) => node.name === name);

const headerTemplateNode = getNode("Tally Posting endpoint1") || getNode("Tally Posting endpoint");
const headerParameters = JSON.parse(
  JSON.stringify(
    headerTemplateNode?.parameters?.headerParameters || {
      parameters: [
        {
          name: "Content-Type",
          value: "application/json"
        }
      ]
    }
  )
);

const ensureHttpNodeHeaders = (node) => {
  if (!node.parameters) node.parameters = {};
  node.parameters.sendHeaders = true;
  node.parameters.headerParameters = JSON.parse(JSON.stringify(headerParameters));
};

const postingExecutorBody =
  "={{ JSON.stringify({ voucherRequestXml: $json.voucherRequestXml || $json.tallyXml || null, taxMode: $json.tax_mode || $json.taxMode || null, postingMode: $json.posting_mode || $json.postingMode || null, approvedData: $json.approvedData || null, computedTotals: $json.computed_totals || $json.computedTotals || null }) }}";

for (const name of ["Tally Posting endpoint", "Tally Posting endpoint1"]) {
  const node = getNode(name);
  if (!node) continue;
  if (!node.parameters) node.parameters = {};

  if (typeof node.parameters.url === "string") {
    node.parameters.url = node.parameters.url
      .replaceAll("/posting-started", "/posting-executor")
      .replaceAll("posting-started call", "posting-executor call");
  }

  node.parameters.method = "POST";
  node.parameters.sendBody = true;
  node.parameters.specifyBody = "json";
  node.parameters.jsonBody = postingExecutorBody;
  node.parameters.options = node.parameters.options || {};
  node.parameters.options.response = node.parameters.options.response || { response: {} };

  ensureHttpNodeHeaders(node);
}

for (const name of ["vendor creator if not exists else continue", "vendor creator if not exists else continue1"]) {
  const node = getNode(name);
  if (!node) continue;
  if (!node.parameters) node.parameters = {};
  node.parameters.method = "POST";
  node.parameters.sendBody = true;
  node.parameters.specifyBody = "json";
  ensureHttpNodeHeaders(node);
  node.parameters.options = node.parameters.options || {};
  node.parameters.options.response = node.parameters.options.response || { response: {} };
}

const passthroughBinaryCode = `const xml = $json.tallyLogXml || $json.data || $json.response || '';

return [
  {
    json: {
      ...$json
    },
    binary: {
      data: {
        data: Buffer.from(String(xml)).toString('base64'),
        mimeType: 'application/xml',
        fileName: \`tally_response_\${Date.now()}.xml\`
      }
    }
  }
];`;

for (const name of ["Success Flow", "Exception Flow", "Success Flow1", "Exception Flow1"]) {
  const node = getNode(name);
  if (node?.parameters) {
    node.parameters.jsCode = passthroughBinaryCode;
  }
}

const backendInvoiceCallbackUrl = (endpoint) =>
  `={{ (() => {
    const pick = (...vals) => {
      for (const value of vals) {
        if (value !== undefined && value !== null && String(value).trim() !== '') return String(value).trim();
      }
      return '';
    };
    const toUuid = (value) => {
      const text = value === undefined || value === null ? '' : String(value).trim();
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
      return uuidRegex.test(text) ? text : '';
    };
    const apiBase = pick(
      $json.backendApiBaseUrl,
      $json.backend_api_base_url,
      $json.runtimeContext?.apiBaseUrl,
      $json.runtimeConfig?.apiBaseUrl,
      $json.body?.backendApiBaseUrl,
      $json.body?.runtimeContext?.apiBaseUrl,
      $json.body?.runtimeConfig?.apiBaseUrl,
      $json.n8n?.backendApiBaseUrl
    );
    const id = toUuid(pick(
      $json.invoiceId,
      $json.invoice_id,
      $json.data?.invoiceId,
      $json.data?.invoice_id,
      $json.body?.invoiceId,
      $json.body?.invoice_id,
      $json.payload?.invoiceId,
      $json.payload?.invoice_id,
      $json.runtimeContext?.invoiceId,
      $json.runtimeConfig?.invoiceId,
      $json.runtimeConfig?.invoice_id
    ));
    if (!apiBase) throw new Error('Missing backendApiBaseUrl in runtime context. Configure tenant n8n backendApiBaseUrl during onboarding.');
    if (!id) throw new Error('Missing valid invoice id for ${endpoint} callback');
    return String(apiBase).replace(/\\/+$/, '') + '/invoices/' + encodeURIComponent(String(id).trim()) + '/${endpoint}';
  })() }}`;

const postingResultUrl = backendInvoiceCallbackUrl("posting-result");
const postingFailedUrl = backendInvoiceCallbackUrl("posting-failed");

const postingResultBody =
  "={{ JSON.stringify({ tally_voucher_type: $json.tallyVoucherType || $json.tally_voucher_type || null, tally_voucher_number: $json.tallyVoucherNumber || $json.tally_voucher_number || null, tally_response_metadata: { workflowRunId: $execution.id, runId: $json.tallyBackendRunId || null, tallyStatus: $json.tallyStatus || null, summary: { created: $json.tallyCreated ?? null, altered: $json.tallyAltered ?? null, errors: $json.tallyErrors ?? null, exceptions: $json.tallyExceptions ?? null }, reviewReasons: $json.reviewReasons || null, responsePreview: $json.responsePreview || $json.tallyResponseRaw || null } }) }}";

const postingFailedBody =
  "={{ JSON.stringify({ error_message: $json.tallyLineError || $json.message || 'Posting failed', tally_response_metadata: { workflowRunId: $execution.id, runId: $json.tallyBackendRunId || null, tallyStatus: $json.tallyStatus || null, summary: { created: $json.tallyCreated ?? null, altered: $json.tallyAltered ?? null, errors: $json.tallyErrors ?? null, exceptions: $json.tallyExceptions ?? null }, reviewReasons: $json.reviewReasons || null, responsePreview: $json.responsePreview || $json.tallyResponseRaw || null } }) }}";

const upsertHttpNode = ({ name, id, position, url, jsonBody }) => {
  let node = getNode(name);
  if (!node) {
    node = {
      parameters: {},
      type: "n8n-nodes-base.httpRequest",
      typeVersion: 4.4,
      position,
      id,
      name,
      alwaysOutputData: false,
      continueOnFail: true
    };
    nodes.push(node);
  }

  node.type = "n8n-nodes-base.httpRequest";
  node.typeVersion = 4.4;
  node.position = position;
  node.alwaysOutputData = false;
  node.continueOnFail = true;

  node.parameters = {
    ...(node.parameters || {}),
    method: "POST",
    url,
    sendHeaders: true,
    headerParameters: JSON.parse(JSON.stringify(headerParameters)),
    sendBody: true,
    specifyBody: "json",
    jsonBody,
    options: {
      response: {
        response: {}
      }
    }
  };
};

upsertHttpNode({
  name: "Posting Result Callback",
  id: getNode("Posting Result Callback")?.id || randomUUID(),
  position: [4144, 704],
  url: postingResultUrl,
  jsonBody: postingResultBody
});

upsertHttpNode({
  name: "Posting Failed Callback",
  id: getNode("Posting Failed Callback")?.id || randomUUID(),
  position: [4144, 928],
  url: postingFailedUrl,
  jsonBody: postingFailedBody
});

const ensureConnection = (fromNode, toNode) => {
  if (!connections[fromNode]) {
    connections[fromNode] = { main: [[]] };
  }
  if (!Array.isArray(connections[fromNode].main)) {
    connections[fromNode].main = [[]];
  }
  if (!Array.isArray(connections[fromNode].main[0])) {
    connections[fromNode].main[0] = [];
  }

  const exists = connections[fromNode].main[0].some((entry) => entry?.node === toNode);
  if (!exists) {
    connections[fromNode].main[0].push({ node: toNode, type: "main", index: 0 });
  }
};

for (const successNode of ["Success Flow", "Success Flow1"]) {
  if (getNode(successNode)) ensureConnection(successNode, "Posting Result Callback");
}
for (const failureNode of ["Exception Flow", "Exception Flow1"]) {
  if (getNode(failureNode)) ensureConnection(failureNode, "Posting Failed Callback");
}

const tempPath = new URL("../n8n/workflows/TenantWiseN8n-new.json.tmp", import.meta.url);
await writeFile(tempPath, `${JSON.stringify(workflow, null, 2)}\n`, "utf8");
await rename(tempPath, workflowPath);

console.log("Updated workflow file:", workflowPath.pathname);
