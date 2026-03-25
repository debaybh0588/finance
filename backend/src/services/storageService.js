import path from "node:path";
import { storageRepository } from "../repositories/storageRepository.js";
import { superAdminTenantRepository } from "../repositories/superAdminTenantRepository.js";

// Ordered pairs: [camelCase DB alias, output key]
const FOLDER_MAP = [
  ["incomingFolder",   "incoming"],
  ["reviewFolder",     "review"],
  ["processedFolder",  "processed"],
  ["successFolder",    "success"],
  ["exceptionFolder",  "exception"],
  ["outputFolder",     "output"]
];

/**
 * Pure helper — merges a branch override on top of tenant defaults.
 *
 * For each folder slot:
 *   - if the override value is a non-empty string, use it
 *   - otherwise fall back to the tenant default
 *
 * Both arguments use the camelCase aliases returned by storageRepository.
 * Exported so it can be unit-tested without a database.
 *
 * @param {object} tenantConfig  Row from tenant_storage_config (camelCase)
 * @param {object|null} branchOverride  Row from branch_storage_override (camelCase), or null
 * @returns {{ incoming, review, processed, success, exception, output }}
 */
export function mergeStoragePaths(tenantConfig, branchOverride) {
  const paths = {};

  for (const [dbKey, outKey] of FOLDER_MAP) {
    const overrideVal = branchOverride?.[dbKey];
    paths[outKey] =
      overrideVal !== undefined && overrideVal !== null && overrideVal !== ""
        ? overrideVal
        : tenantConfig[dbKey];
  }

  return paths;
}

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

const resolveRuntimePath = ({ rawPath, tenantToken, branchToken, n8nRootFolder, storageMode }) => {
  if (typeof rawPath !== "string") {
    return rawPath;
  }

  const resolvedPath = resolveTemplatePath(rawPath, tenantToken, branchToken);
  const trimmedRoot = typeof n8nRootFolder === "string" ? n8nRootFolder.trim() : "";

  if (storageMode === "LOCAL" && trimmedRoot && !path.isAbsolute(resolvedPath)) {
    return path.join(trimmedRoot, resolvedPath);
  }

  return resolvedPath;
};

export const storageService = {
  /**
   * Resolves the effective storage paths for a given tenant + optional branch.
   *
   * Rules:
   *  1. Fetch tenant default config (required — throws 404 if absent).
   *  2. If branchId is provided AND tenant allows branch overrides,
   *     fetch branch override row.
   *  3. Per-folder: use override value when non-empty, else use tenant default.
   *
   * @param {{ tenantId: string, branchId?: string }} param0
   * @returns {{ storageMode: string, paths: object }}
   */
  async resolveStoragePaths({ tenantId, branchId }) {
    const [tenantConfig, branchOverride, tenant, branches, n8nConfig] = await Promise.all([
      storageRepository.findTenantStorageConfig(tenantId),
      branchId
        ? storageRepository.findBranchStorageOverride(tenantId, branchId)
        : null,
      superAdminTenantRepository.findTenantById(tenantId),
      branchId ? superAdminTenantRepository.listBranchesByTenant(tenantId) : [],
      superAdminTenantRepository.findN8nConfigByTenantId(tenantId).catch(() => null)
    ]);

    if (!tenantConfig) {
      const error = new Error(`No storage config found for tenant ${tenantId}`);
      error.statusCode = 404;
      error.code = "STORAGE_CONFIG_NOT_FOUND";
      throw error;
    }

    // Honour the tenant-level switch; ignore override if disabled
    const effectiveOverride = tenantConfig.allowBranchOverride ? branchOverride : null;
    const mergedPaths = mergeStoragePaths(tenantConfig, effectiveOverride);
    const tenantToken = toPathToken(tenant?.tenantCode || tenant?.tenantName || tenant?.id || tenantId, "tenant");
    const resolvedBranch =
      Array.isArray(branches) && branchId
        ? branches.find((branch) => branch.id === branchId)
        : null;
    const branchToken = toPathToken(
      resolvedBranch?.branchCode || resolvedBranch?.branchName || branchId,
      "branch"
    );
    const n8nRootFolder = n8nConfig?.n8nRootFolder || null;
    const resolvedPaths = Object.fromEntries(
      Object.entries(mergedPaths).map(([key, value]) => [
        key,
        resolveRuntimePath({
          rawPath: value,
          tenantToken,
          branchToken,
          n8nRootFolder,
          storageMode: tenantConfig.storageMode
        })
      ])
    );

    return {
      storageMode: tenantConfig.storageMode,
      paths: resolvedPaths
    };
  }
};
