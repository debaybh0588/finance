import { superAdminTenantRepository } from "../repositories/superAdminTenantRepository.js";
import { tallyRuntimeRepository } from "../repositories/tallyRuntimeRepository.js";

const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_TIMEOUT_MS = 12000;
const allowedDocumentTypes = new Set(["PURCHASE_INVOICE", "SALES_INVOICE"]);

let schedulerHandle = null;

const toOptionalString = (value) => {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  return text || null;
};

const toOptionalNumber = (value) => {
  if (value === undefined || value === null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const toIsoDate = (value) => {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
};

const fetchWithTimeout = async (url, options = {}, timeoutMs = DEFAULT_TIMEOUT_MS) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal
    });
  } finally {
    clearTimeout(timer);
  }
};

const resolveTallyEndpointUrl = (baseUrl, port) => {
  const raw = toOptionalString(baseUrl);
  if (!raw) {
    const error = new Error("tallyBaseUrl is missing");
    error.code = "TALLY_BASE_URL_MISSING";
    throw error;
  }

  const normalized = /^https?:\/\//i.test(raw) ? raw : `http://${raw}`;
  const url = new URL(normalized);
  if (Number.isInteger(port) && port > 0 && !url.port) {
    url.port = String(port);
  }

  return url.toString();
};

const buildCollectionExportRequest = (collectionId) => `
<ENVELOPE>
  <HEADER>
    <VERSION>1</VERSION>
    <TALLYREQUEST>Export</TALLYREQUEST>
    <TYPE>Collection</TYPE>
    <ID>${collectionId}</ID>
  </HEADER>
  <BODY>
    <DESC>
      <STATICVARIABLES>
        <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
      </STATICVARIABLES>
    </DESC>
  </BODY>
</ENVELOPE>
`.trim();

const extractXmlNamedValues = (xmlText, tagName) => {
  const text = String(xmlText || "");
  const tagRegex = new RegExp(`<${tagName}\\s+NAME=\"([^\"]+)\"`, "gi");
  const values = [];

  for (const match of text.matchAll(tagRegex)) {
    const value = toOptionalString(match[1]);
    if (value) values.push(value);
  }

  return Array.from(new Set(values)).sort((a, b) => a.localeCompare(b));
};

const normalizeToken = (value) =>
  String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

const similarityScore = (a, b) => {
  const left = normalizeToken(a);
  const right = normalizeToken(b);
  if (!left || !right) return 0;
  if (left === right) return 1;

  if (left.includes(right) || right.includes(left)) {
    return 0.9;
  }

  const leftTokens = new Set(left.split(/\s+/).filter(Boolean));
  const rightTokens = new Set(right.split(/\s+/).filter(Boolean));
  if (!leftTokens.size || !rightTokens.size) return 0;

  let overlap = 0;
  for (const token of leftTokens) {
    if (rightTokens.has(token)) overlap += 1;
  }

  if (!overlap) return 0;

  const denominator = Math.max(leftTokens.size, rightTokens.size);
  return Number((0.25 + (0.65 * overlap) / denominator).toFixed(4));
};

const rankOptions = (extractedValue, optionValues, limit = 8) => {
  const target = toOptionalString(extractedValue);
  const options = Array.isArray(optionValues) ? optionValues : [];

  if (!target) {
    return options.slice(0, limit).map((value) => ({ value, confidence: 0.35 }));
  }

  const scored = options
    .map((value) => ({ value, confidence: similarityScore(target, value) }))
    .filter((entry) => entry.confidence > 0)
    .sort((a, b) => b.confidence - a.confidence || a.value.localeCompare(b.value));

  if (scored.length > 0) {
    return scored.slice(0, limit);
  }

  return options.slice(0, limit).map((value) => ({ value, confidence: 0.1 }));
};

const deriveDocumentTypeHint = (invoice) => {
  const raw = toOptionalString(invoice?.documentType);
  if (raw === "SALES_INVOICE") return "sales";
  if (raw === "PURCHASE_INVOICE") return "purchase";

  const extracted = invoice?.correctedJson && Object.keys(invoice.correctedJson).length > 0
    ? invoice.correctedJson
    : invoice?.extractedJson || {};

  const rawType = toOptionalString(extracted.document_type || extracted.documentType);
  if (!rawType) return "purchase";

  const normalized = rawType.toLowerCase();
  if (normalized.includes("sale")) return "sales";
  return "purchase";
};

const normalizeLineItems = (invoice) => {
  const preferred =
    invoice?.correctedJson && Object.keys(invoice.correctedJson).length > 0
      ? invoice.correctedJson
      : invoice?.extractedJson || {};

  const fromExtracted = Array.isArray(preferred.line_items)
    ? preferred.line_items
    : Array.isArray(preferred.lineItems)
      ? preferred.lineItems
      : null;

  if (Array.isArray(fromExtracted) && fromExtracted.length > 0) {
    return fromExtracted.map((item, index) => ({
      lineNo: toOptionalNumber(item.line_no ?? item.lineNo ?? index + 1) || index + 1,
      description: toOptionalString(item.description || item.item_description || item.item) || `Line ${index + 1}`,
      hsn: toOptionalString(item.hsn || item.hsn_sac || item.hsn_code),
      quantity: toOptionalNumber(item.quantity ?? item.qty),
      uom: toOptionalString(item.uom || item.unit || item.per) || "PCS",
      rate: toOptionalNumber(item.rate || item.unit_rate),
      taxableAmount: toOptionalNumber(item.taxable_amount || item.taxable || item.taxable_value),
      total: toOptionalNumber(item.total_amount || item.total || item.line_total)
    }));
  }

  const rows = Array.isArray(invoice?.lineItems) ? invoice.lineItems : [];
  return rows.map((item, index) => ({
    lineNo: toOptionalNumber(item.lineNo ?? index + 1) || index + 1,
    description: toOptionalString(item.description) || `Line ${index + 1}`,
    hsn: toOptionalString(item.hsn),
    quantity: toOptionalNumber(item.quantity),
    uom: toOptionalString(item.uom) || "PCS",
    rate: toOptionalNumber(item.rate),
    taxableAmount: toOptionalNumber(item.taxableAmount),
    total: toOptionalNumber(item.total)
  }));
};

const composeBaseFieldRows = (invoice) => {
  const preferred =
    invoice?.correctedJson && Object.keys(invoice.correctedJson).length > 0
      ? invoice.correctedJson
      : invoice?.extractedJson || {};

  const isSales = deriveDocumentTypeHint(invoice) === "sales";
  const partyName = toOptionalString(
    preferred.party_name ||
    preferred.partyName ||
    preferred.vendor_name ||
    preferred.vendorName ||
    preferred.buyer_name ||
    preferred.buyerName ||
    invoice?.partyName
  );

  const cgst = toOptionalNumber(preferred.cgst ?? invoice?.cgstAmount) || 0;
  const sgst = toOptionalNumber(preferred.sgst ?? invoice?.sgstAmount) || 0;
  const igst = toOptionalNumber(preferred.igst ?? invoice?.igstAmount) || 0;
  const roundOff = toOptionalNumber(preferred.round_off ?? preferred.roundOff ?? invoice?.roundOffAmount) || 0;
  const tds = toOptionalNumber(preferred.tds) || 0;

  const rows = [
    {
      sourceField: "document_type",
      label: "Document Type",
      extractedValue: isSales ? "sales" : "purchase",
      targetCategory: "documentTypes",
      targetOptions: ["purchase", "sales"],
      persistable: true
    },
    {
      sourceField: "posting_mode",
      label: "Posting Mode",
      extractedValue:
        toOptionalString(preferred.posting_mode || preferred.postingMode) ||
        (Array.isArray(invoice?.lineItems) && invoice.lineItems.length > 0 ? "INVENTORY_ITEMWISE" : "ACCOUNTING_INVOICE"),
      targetCategory: "postingModes",
      targetOptions: ["INVENTORY_ITEMWISE", "ACCOUNTING_INVOICE"],
      persistable: true
    },
    {
      sourceField: "voucher_type",
      label: "Voucher Type",
      extractedValue: isSales ? "Sales" : "Purchase",
      targetCategory: "voucherTypes",
      persistable: true
    },
    {
      sourceField: "party_ledger",
      label: isSales ? "Customer Ledger" : "Supplier Ledger",
      extractedValue: partyName,
      targetCategory: "ledgers",
      persistable: true
    },
    {
      sourceField: "inventory_ledger",
      label: isSales ? "Sales Ledger" : "Purchase Ledger",
      extractedValue:
        toOptionalString(preferred.sales_ledger_name || preferred.salesLedgerName || preferred.purchase_ledger_name || preferred.purchaseLedgerName) ||
        (isSales ? "Sales" : "Purchase"),
      targetCategory: "ledgers",
      persistable: true
    },
    {
      sourceField: "cgst_ledger",
      label: isSales ? "Output CGST Ledger" : "Input CGST Ledger",
      extractedValue: isSales ? "Output CGST" : "Input CGST",
      targetCategory: "ledgers",
      persistable: true,
      active: cgst > 0
    },
    {
      sourceField: "sgst_ledger",
      label: isSales ? "Output SGST Ledger" : "Input SGST Ledger",
      extractedValue: isSales ? "Output SGST" : "Input SGST",
      targetCategory: "ledgers",
      persistable: true,
      active: sgst > 0
    },
    {
      sourceField: "igst_ledger",
      label: isSales ? "Output IGST Ledger" : "Input IGST Ledger",
      extractedValue: isSales ? "Output IGST" : "Input IGST",
      targetCategory: "ledgers",
      persistable: true,
      active: igst > 0
    },
    {
      sourceField: "roundoff_ledger",
      label: "Round Off Ledger",
      extractedValue: "Round Off",
      targetCategory: "ledgers",
      persistable: true,
      active: roundOff !== 0
    },
    {
      sourceField: "tds_ledger",
      label: "TDS Ledger",
      extractedValue: "TDS Receivable",
      targetCategory: "ledgers",
      persistable: true,
      active: tds > 0
    }
  ];

  const lineItems = normalizeLineItems(invoice);
  for (const item of lineItems) {
    rows.push({
      sourceField: `line_item_${item.lineNo}`,
      label: `Line Item ${item.lineNo}`,
      extractedValue: item.description,
      targetCategory: "stockItems",
      persistable: false,
      active: true
    });
  }

  return rows;
};

const applySuggestions = ({ rows, catalog, savedMappings }) => {
  const savedByField = new Map(
    Array.isArray(savedMappings)
      ? savedMappings.map((mapping) => [mapping.sourceField, mapping])
      : []
  );

  return rows
    .filter((row) => row.active !== false)
    .map((row) => {
      const optionPool =
        Array.isArray(row.targetOptions)
          ? row.targetOptions
          : Array.isArray(catalog?.[row.targetCategory])
            ? catalog[row.targetCategory]
            : [];

      const ranked = rankOptions(row.extractedValue, optionPool, 10);
      const saved = savedByField.get(row.sourceField) || null;

      let selectedValue = toOptionalString(saved?.targetValue) || ranked[0]?.value || null;
      let selectedConfidence =
        saved?.confidence === null || saved?.confidence === undefined
          ? null
          : Number(saved.confidence);

      if (!selectedConfidence && selectedValue) {
        const bestForSelection = ranked.find((entry) => entry.value === selectedValue);
        selectedConfidence = bestForSelection ? Number(bestForSelection.confidence) : similarityScore(row.extractedValue, selectedValue);
      }

      const options = ranked.slice(0, 8);
      if (selectedValue && !options.some((entry) => entry.value === selectedValue)) {
        options.unshift({ value: selectedValue, confidence: selectedConfidence || 0.2 });
      }

      return {
        ...row,
        options,
        selectedValue,
        selectedConfidence: Number((selectedConfidence || 0).toFixed(4)),
        isUserOverride: Boolean(saved?.isUserOverride)
      };
    });
};

const normalizeDocumentType = (value) => {
  const text = toOptionalString(value);
  if (!text) return "PURCHASE_INVOICE";
  const normalized = text.toUpperCase();
  if (normalized === "SALES" || normalized === "SALES_INVOICE") return "SALES_INVOICE";
  return "PURCHASE_INVOICE";
};

const normalizeClientMappings = (mappings = []) => {
  if (!Array.isArray(mappings)) return [];

  return mappings
    .filter((entry) => entry && typeof entry === "object")
    .map((entry) => ({
      sourceField: toOptionalString(entry.sourceField),
      targetValue: toOptionalString(entry.targetValue),
      confidence: entry.confidence === null || entry.confidence === undefined ? null : Number(entry.confidence),
      isUserOverride: entry.isUserOverride !== false,
      persistable: entry.persistable !== false
    }))
    .filter((entry) => entry.sourceField)
    .filter((entry) => entry.persistable);
};

export const tallyRuntimeService = {
  async refreshTenantRuntimeCatalog(tenantId, { force = false, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
    const config = await superAdminTenantRepository.findTallyConfigByTenantId(tenantId).catch(() => null);
    if (!config || !toOptionalString(config.tallyBaseUrl)) {
      return {
        catalog: {
          voucherTypes: [],
          ledgers: [],
          stockItems: [],
          stockGroups: []
        },
        fetchedAt: null,
        expiresAt: null,
        stale: true,
        skipped: true,
        reason: "TALLY_CONFIG_MISSING"
      };
    }

    const existing = await tallyRuntimeRepository.findRuntimeCatalogByTenantId(tenantId).catch(() => null);
    const now = new Date();
    const nowMs = now.getTime();

    const existingCatalog = existing?.catalog && typeof existing.catalog === "object"
      ? existing.catalog
      : {
          voucherTypes: [],
          ledgers: [],
          stockItems: [],
          stockGroups: []
        };

    const existingHasData =
      Array.isArray(existingCatalog.voucherTypes) ||
      Array.isArray(existingCatalog.ledgers) ||
      Array.isArray(existingCatalog.stockItems) ||
      Array.isArray(existingCatalog.stockGroups);

    const expiresAtMs = existing?.expiresAt ? new Date(existing.expiresAt).getTime() : 0;

    if (!force && existing && existingHasData && Number.isFinite(expiresAtMs) && expiresAtMs > nowMs) {
      return {
        catalog: existingCatalog,
        fetchedAt: existing.fetchedAt,
        expiresAt: existing.expiresAt,
        stale: false,
        skipped: true,
        reason: "FRESH_CACHE"
      };
    }

    const endpoint = resolveTallyEndpointUrl(config.tallyBaseUrl, config.tallyPort);

    const fetchCollection = async (id, tag) => {
      const response = await fetchWithTimeout(
        endpoint,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/xml"
          },
          body: buildCollectionExportRequest(id)
        },
        timeoutMs
      );

      const responseText = await response.text().catch(() => "");
      if (!response.ok) {
        const error = new Error(`Tally collection fetch failed (${id}) with HTTP ${response.status}`);
        error.code = `TALLY_HTTP_${response.status}`;
        error.responsePreview = responseText.slice(0, 300);
        throw error;
      }

      return extractXmlNamedValues(responseText, tag);
    };

    const client = await tallyRuntimeRepository.getClient();

    try {
      await client.query("BEGIN");

      const [voucherTypes, ledgers, stockItems, stockGroups] = await Promise.all([
        fetchCollection("List of Voucher Types", "VOUCHERTYPE"),
        fetchCollection("List of Ledgers", "LEDGER"),
        fetchCollection("List of Stock Items", "STOCKITEM"),
        fetchCollection("List of Stock Groups", "STOCKGROUP")
      ]);

      const fetchedAt = new Date();
      const expiresAt = new Date(fetchedAt.getTime() + ONE_DAY_MS);
      const catalog = {
        voucherTypes,
        ledgers,
        stockItems,
        stockGroups
      };

      const saved = await tallyRuntimeRepository.upsertRuntimeCatalog(client, {
        tenantId,
        sourceCompanyName: config.companyName,
        tallyBaseUrl: config.tallyBaseUrl,
        catalog,
        fetchedAt,
        expiresAt,
        lastError: null
      });

      await client.query("COMMIT");

      return {
        catalog,
        fetchedAt: saved?.fetchedAt || fetchedAt,
        expiresAt: saved?.expiresAt || expiresAt,
        stale: false,
        skipped: false,
        reason: null
      };
    } catch (error) {
      await client.query("ROLLBACK");

      const fallbackFetchedAt = existing?.fetchedAt || null;
      const fallbackExpiresAt = existing?.expiresAt || null;

      try {
        await client.query("BEGIN");
        await tallyRuntimeRepository.upsertRuntimeCatalog(client, {
          tenantId,
          sourceCompanyName: config.companyName,
          tallyBaseUrl: config.tallyBaseUrl,
          catalog: existingCatalog,
          fetchedAt: fallbackFetchedAt || new Date(0),
          expiresAt: fallbackExpiresAt || new Date(0),
          lastError: toOptionalString(error?.message) || "TALLY_RUNTIME_SYNC_FAILED"
        });
        await client.query("COMMIT");
      } catch {
        await client.query("ROLLBACK");
      }

      return {
        catalog: existingCatalog,
        fetchedAt: fallbackFetchedAt,
        expiresAt: fallbackExpiresAt,
        stale: true,
        skipped: true,
        reason: toOptionalString(error?.message) || "TALLY_RUNTIME_SYNC_FAILED"
      };
    } finally {
      client.release();
    }
  },

  async getPostingMappingContext({ tenantId, invoice, forceRefresh = false } = {}) {
    const documentType = normalizeDocumentType(invoice?.documentType);
    const [runtime, savedMappings] = await Promise.all([
      this.refreshTenantRuntimeCatalog(tenantId, { force: forceRefresh }),
      tallyRuntimeRepository.listFieldMappingsByTenantAndDocumentType(tenantId, documentType).catch(() => [])
    ]);

    const rows = applySuggestions({
      rows: composeBaseFieldRows(invoice),
      catalog: runtime.catalog,
      savedMappings
    });

    return {
      tenantId,
      documentType,
      fetchedAt: toIsoDate(runtime.fetchedAt),
      expiresAt: toIsoDate(runtime.expiresAt),
      stale: Boolean(runtime.stale),
      skipped: Boolean(runtime.skipped),
      reason: runtime.reason || null,
      optionStats: {
        voucherTypes: Array.isArray(runtime.catalog?.voucherTypes) ? runtime.catalog.voucherTypes.length : 0,
        ledgers: Array.isArray(runtime.catalog?.ledgers) ? runtime.catalog.ledgers.length : 0,
        stockItems: Array.isArray(runtime.catalog?.stockItems) ? runtime.catalog.stockItems.length : 0,
        stockGroups: Array.isArray(runtime.catalog?.stockGroups) ? runtime.catalog.stockGroups.length : 0
      },
      rows
    };
  },

  async savePostingFieldMappings({ tenantId, documentType, mappings, updatedBy } = {}) {
    const normalizedDocumentType = normalizeDocumentType(documentType);
    if (!allowedDocumentTypes.has(normalizedDocumentType)) {
      const error = new Error("documentType must be PURCHASE_INVOICE or SALES_INVOICE");
      error.statusCode = 400;
      error.code = "VALIDATION_ERROR";
      throw error;
    }

    const normalizedMappings = normalizeClientMappings(mappings);

    const client = await tallyRuntimeRepository.getClient();
    try {
      await client.query("BEGIN");
      const saved = await tallyRuntimeRepository.upsertFieldMappings(
        client,
        tenantId,
        normalizedDocumentType,
        normalizedMappings,
        toOptionalString(updatedBy) || null
      );
      await client.query("COMMIT");
      return saved;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  },

  startScheduler({ intervalMs = 60 * 60 * 1000 } = {}) {
    if (schedulerHandle) {
      return;
    }

    if (String(process.env.TALLY_RUNTIME_SYNC_DISABLED || "").trim() === "1") {
      return;
    }

    const runCycle = async () => {
      try {
        const tenants = await tallyRuntimeRepository.listTenantsWithTallyConfig();
        for (const tenant of tenants) {
          const tenantId = toOptionalString(tenant.tenantId);
          if (!tenantId) continue;
          await this.refreshTenantRuntimeCatalog(tenantId, { force: false }).catch(() => null);
        }
      } catch {
        // scheduler should never crash the process
      }
    };

    setTimeout(() => {
      runCycle().catch(() => null);
    }, 5000);

    schedulerHandle = setInterval(() => {
      runCycle().catch(() => null);
    }, Math.max(15 * 60 * 1000, Number(intervalMs) || 60 * 60 * 1000));
  },

  stopScheduler() {
    if (schedulerHandle) {
      clearInterval(schedulerHandle);
      schedulerHandle = null;
    }
  }
};
