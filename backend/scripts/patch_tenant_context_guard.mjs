import { readFile, rename, writeFile } from "node:fs/promises";

const workflowPath = new URL("../n8n/workflows/TenantWiseN8n-new.json", import.meta.url);
const workflow = JSON.parse(await readFile(workflowPath, "utf8"));

const node = (workflow.nodes || []).find((entry) => entry.name === "Tenant Context Guard");
if (!node) {
  throw new Error("Tenant Context Guard node not found");
}

node.parameters = node.parameters || {};
node.parameters.jsCode = `const item = $input.first();
const source = item?.json ?? {};
const runtimeContext = source.runtimeContext && typeof source.runtimeContext === 'object' ? source.runtimeContext : {};

const candidates = [
  runtimeContext.tenantId,
  source.tenantId,
  source.tenant_id,
  source.body?.tenantId,
  source.body?.tenant_id,
  source.runtimeConfig?.tenantId,
  source.runtimeConfig?.tenant_id,
];

const tenantId = candidates
  .map((value) => (typeof value === 'string' ? value.trim() : ''))
  .find((value) => value.length > 0) ?? '';

const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
if (!uuidRegex.test(tenantId)) {
  throw new Error('Tenant Context Guard: missing or invalid tenantId for workflow run');
}

const runtimePaths = runtimeContext.paths && typeof runtimeContext.paths === 'object'
  ? runtimeContext.paths
  : (source.runtimeConfig?.paths && typeof source.runtimeConfig.paths === 'object' ? source.runtimeConfig.paths : {});

const pickPath = (...vals) => vals.find((v) => typeof v === 'string' && v.trim().length > 0)?.trim() ?? '';
const toPosix = (value) => String(value ?? '').trim().replace(/\\\\/g, '/').replace(/\\/+/g, '/');
const dirnamePosix = (value) => {
  const normalized = toPosix(value).replace(/\\/+$/, '');
  if (!normalized) return '';
  const idx = normalized.lastIndexOf('/');
  if (idx <= 0) return '';
  return normalized.slice(0, idx);
};
const joinPosix = (...parts) =>
  parts
    .map((part) => toPosix(part).replace(/^\\/+|\\/+$/g, ''))
    .filter((part) => part.length > 0)
    .join('/');

const findIncomingDirFromPath = (filePath) => {
  const pathText = toPosix(filePath);
  if (!pathText) return '';

  const dir = dirnamePosix(pathText);
  if (/\\/incoming$/i.test(dir)) {
    return dir;
  }

  const marker = '/incoming/';
  const lower = pathText.toLowerCase();
  const idx = lower.lastIndexOf(marker);
  if (idx >= 0) {
    return pathText.slice(0, idx + marker.length - 1);
  }

  return '';
};

const originalPath = pickPath(
  source.originalPath,
  source.originalFilePath,
  source.filePath,
  source.path,
  source.body?.originalPath,
  source.body?.originalFilePath,
  source.body?.filePath,
  source.body?.path
);

const incomingFromPayload = pickPath(
  runtimePaths.incoming,
  source.incomingFolder,
  source.incoming_folder,
  source.body?.incomingFolder,
  source.body?.incoming_folder
);
const incomingFromOriginal = findIncomingDirFromPath(originalPath);
const incomingFolder = pickPath(incomingFromPayload, incomingFromOriginal);

const branchBaseFolder = dirnamePosix(incomingFolder);
const deriveFromBranchBase = (leaf) => {
  if (!branchBaseFolder) return '';
  return joinPosix(branchBaseFolder, leaf);
};

const outputFolder = pickPath(
  runtimePaths.output,
  source.outputFolder,
  source.output_folder,
  source.body?.outputFolder,
  source.body?.output_folder,
  deriveFromBranchBase('output')
);
const processedFolder = pickPath(
  runtimePaths.processed,
  source.processedFolder,
  source.processed_folder,
  source.body?.processedFolder,
  source.body?.processed_folder,
  deriveFromBranchBase('processed')
);
const successFolder = pickPath(
  runtimePaths.success,
  source.successFolder,
  source.success_folder,
  source.body?.successFolder,
  source.body?.success_folder,
  deriveFromBranchBase('success')
);
const exceptionFolder = pickPath(
  runtimePaths.exception,
  runtimePaths.exceptions,
  source.exceptionFolder,
  source.exception_folder,
  source.body?.exceptionFolder,
  source.body?.exception_folder,
  deriveFromBranchBase('exception')
);
const reviewFolder =
  pickPath(
    runtimePaths.review,
    source.reviewFolder,
    source.review_folder,
    source.body?.reviewFolder,
    source.body?.review_folder,
    deriveFromBranchBase('review')
  ) || exceptionFolder;

const missing = [];
if (!outputFolder) missing.push('outputFolder');
if (!processedFolder) missing.push('processedFolder');
if (!successFolder) missing.push('successFolder');
if (!exceptionFolder) missing.push('exceptionFolder');

if (missing.length > 0) {
  const diagnostic = {
    originalPath,
    incomingFolder,
    branchBaseFolder
  };
  throw new Error('Tenant Path Guard: missing required tenant path config: ' + missing.join(', ') + ' | ' + JSON.stringify(diagnostic));
}

return [{
  json: {
    ...source,
    tenantId,
    incomingFolder,
    outputFolder,
    processedFolder,
    successFolder,
    exceptionFolder,
    reviewFolder,
    runtimeContext: {
      ...runtimeContext,
      tenantId,
      paths: {
        incoming: incomingFolder,
        review: reviewFolder,
        processed: processedFolder,
        success: successFolder,
        exception: exceptionFolder,
        output: outputFolder
      }
    }
  },
  binary: item?.binary,
}];`;

const tempPath = new URL("../n8n/workflows/TenantWiseN8n-new.json.tmp", import.meta.url);
await writeFile(tempPath, `${JSON.stringify(workflow, null, 2)}\n`, "utf8");
await rename(tempPath, workflowPath);

console.log("Patched Tenant Context Guard in workflow.");
