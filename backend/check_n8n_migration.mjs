import pg from 'pg';
import { readFile } from 'node:fs/promises';
const { Client } = pg;
const c = new Client({ host:'localhost', port:5432, database:'accounting_ai', user:'postgres', password:'postgres', ssl:false });
await c.connect();
const r = await c.query("SELECT column_name FROM information_schema.columns WHERE table_name='tenant_n8n_config' ORDER BY ordinal_position");
console.log('COLUMNS:', r.rows.map(function(row){ return row.column_name; }).join(', '));
const sm = await c.query("SELECT filename FROM schema_migrations ORDER BY filename");
console.log('MIGRATIONS:', sm.rows.map(function(row){ return row.filename; }).join(', '));
await c.end();

const workflowPath = new URL('./n8n/workflows/TenantWiseN8n-new.json', import.meta.url);
const workflow = JSON.parse(await readFile(workflowPath, 'utf8'));

const findHttpNodes = workflow.nodes.filter((node) => node.type === 'n8n-nodes-base.httpRequest');
const legacyRegisterNodes = findHttpNodes.filter((node) =>
  String(node?.parameters?.url || '').includes('/api/invoices/register')
);
const legacyPostingStartedNodes = findHttpNodes.filter((node) =>
  String(node?.parameters?.url || '').includes('/invoices/') &&
  String(node?.parameters?.url || '').includes('/posting-started')
);
const postingExecutorNodes = findHttpNodes.filter((node) =>
  String(node?.parameters?.url || '').includes('/invoices/') &&
  String(node?.parameters?.url || '').includes('/posting-executor')
);
const postingResultNodes = findHttpNodes.filter((node) =>
  String(node?.parameters?.url || '').includes('/invoices/') &&
  String(node?.parameters?.url || '').includes('/posting-result')
);
const postingFailedNodes = findHttpNodes.filter((node) =>
  String(node?.parameters?.url || '').includes('/invoices/') &&
  String(node?.parameters?.url || '').includes('/posting-failed')
);
const activityMethodMismatches = findHttpNodes.filter((node) => {
  const url = String(node?.parameters?.url || '');
  if (!url.includes('/invoices/') || !url.includes('/activity')) return false;
  const method = String(node?.parameters?.method || 'GET').toUpperCase();
  return method !== 'POST';
});
const hardcodedBackendUrlNodes = findHttpNodes.filter((node) =>
  String(node?.parameters?.url || '').includes('http://localhost:4000/api')
);
const unexecutedApprovalFlowHeaderRefs = findHttpNodes.filter((node) => {
  const headers = node?.parameters?.headerParameters?.parameters || [];
  return headers.some((header) =>
    String(header?.name || '').toLowerCase() === 'x-workflow-key' &&
    String(header?.value || '').includes("$node['approval flow']")
  );
});
const approvalFlowRefHttpNodes = findHttpNodes.filter((node) =>
  JSON.stringify(node?.parameters || {}).includes('approval flow')
);

const hardcodedWorkflowKeyHeaders = [];
for (const node of findHttpNodes) {
  const headers = node?.parameters?.headerParameters?.parameters || [];
  for (const header of headers) {
    if (String(header?.name || '').toLowerCase() !== 'x-workflow-key') continue;
    const value = String(header?.value || '').trim();
    if (!value.startsWith('={{')) {
      hardcodedWorkflowKeyHeaders.push({ node: node.name, value });
    }
  }
}

const webhookPaths = new Set(
  workflow.nodes
    .filter((node) => node.type === 'n8n-nodes-base.webhook')
    .map((node) => node?.parameters?.path)
    .filter(Boolean)
);

const requiredWebhookPaths = ['invoice-upload', 'invoice-approved'];
const missingWebhookPaths = requiredWebhookPaths.filter((path) => !webhookPaths.has(path));

console.log('WORKFLOW CHECKS:');
console.log('- legacy register nodes:', legacyRegisterNodes.length);
console.log('- legacy posting-started call nodes:', legacyPostingStartedNodes.length);
console.log('- posting-executor call nodes:', postingExecutorNodes.length);
console.log('- posting-result callback nodes:', postingResultNodes.length);
console.log('- posting-failed callback nodes:', postingFailedNodes.length);
console.log('- /activity method mismatches:', activityMethodMismatches.length);
console.log('- hardcoded backend invoice URL nodes:', hardcodedBackendUrlNodes.length);
console.log('- unsafe approval-flow header refs:', unexecutedApprovalFlowHeaderRefs.length);
console.log('- approval-flow references in HTTP nodes:', approvalFlowRefHttpNodes.length);
console.log('- hardcoded x-workflow-key headers:', hardcodedWorkflowKeyHeaders.length);
console.log('- missing required webhook paths:', missingWebhookPaths.join(', ') || 'none');

if (legacyRegisterNodes.length > 0) {
  console.error('FAILED: Legacy /api/invoices/register node(s) still present in workflow');
  process.exitCode = 1;
}

if (legacyPostingStartedNodes.length > 0) {
  console.error('FAILED: Legacy /posting-started node(s) still present in workflow posting branch');
  process.exitCode = 1;
}

if (postingExecutorNodes.length === 0) {
  console.error('FAILED: Missing /posting-executor call node in workflow');
  process.exitCode = 1;
}

if (postingResultNodes.length === 0 || postingFailedNodes.length === 0) {
  console.error('FAILED: Missing posting result callback node(s):', {
    postingResultNodes: postingResultNodes.length,
    postingFailedNodes: postingFailedNodes.length
  });
  process.exitCode = 1;
}

if (activityMethodMismatches.length > 0) {
  console.error(
    'FAILED: Invoice activity callback node(s) must use POST method:',
    activityMethodMismatches.map((node) => node.name)
  );
  process.exitCode = 1;
}

if (hardcodedBackendUrlNodes.length > 0) {
  console.error(
    'FAILED: Hardcoded backend invoice callback URL(s) detected:',
    hardcodedBackendUrlNodes.map((node) => node.name)
  );
  process.exitCode = 1;
}

if (unexecutedApprovalFlowHeaderRefs.length > 0) {
  console.error(
    'FAILED: x-workflow-key header expression references unexecuted approval flow node:',
    unexecutedApprovalFlowHeaderRefs.map((node) => node.name)
  );
  process.exitCode = 1;
}

if (approvalFlowRefHttpNodes.length > 0) {
  console.error(
    'FAILED: HTTP node expression(s) still reference approval flow:',
    approvalFlowRefHttpNodes.map((node) => node.name)
  );
  process.exitCode = 1;
}

if (hardcodedWorkflowKeyHeaders.length > 0) {
  console.error('FAILED: Hardcoded x-workflow-key header(s) detected:', hardcodedWorkflowKeyHeaders);
  process.exitCode = 1;
}

if (missingWebhookPaths.length > 0) {
  console.error('FAILED: Missing required webhook path(s):', missingWebhookPaths);
  process.exitCode = 1;
}
