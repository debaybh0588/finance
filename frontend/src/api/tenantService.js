import { del, get, post, put } from "./client.js";

const createClientBranchId = () => `branch-${Math.random().toString(36).slice(2, 9)}`;

const mapTemplate = (data) => ({
  tenant: data.tenant,
  branches: data.branches,
  storage: data.storage,
  n8n: data.n8n,
  tally: data.tally,
  adminUser: data.adminUser,
  rules: data.rules
});

const mapFullConfigToUi = (data) => ({
  tenant: {
    id: data.tenant.id,
    name: data.tenant.tenantName,
    code: data.tenant.tenantCode,
    contactPerson: data.tenant.contactPerson || "",
    email: data.tenant.contactEmail || "",
    phone: data.tenant.contactPhone || "",
    isActive: data.tenant.isActive
  },
  branches: (data.branches || []).map((branch) => ({
    id: branch.id,
    name: branch.branchName,
    code: branch.branchCode,
    gstin: branch.branchGstin || "",
    address: branch.branchAddress || "",
    isDefault: branch.isDefault
  })),
  storage: data.storageConfig
    ? {
        mode: data.storageConfig.storageMode,
        incomingFolder: data.storageConfig.incomingFolder,
        reviewFolder: data.storageConfig.reviewFolder,
        processedFolder: data.storageConfig.processedFolder,
        successFolder: data.storageConfig.successFolder,
        exceptionFolder: data.storageConfig.exceptionFolder,
        outputFolder: data.storageConfig.outputFolder,
        allowBranchOverride: Boolean(data.storageConfig.allowBranchOverride),
        branchOverrides: data.storageConfig.branchOverrides || []
      }
    : null,
  n8n: data.n8nConfig
    ? {
        baseUrl: data.n8nConfig.n8nBaseUrl || "",
        backendApiBaseUrl: data.n8nConfig.backendApiBaseUrl || "",
        workflowToken: data.n8nConfig.workflowKeyToken || "",
        extractionWorkflow: data.n8nConfig.extractionWorkflowName || data.n8nConfig.extractionWorkflowId || "",
        postingWorkflow: data.n8nConfig.postingWorkflowName || data.n8nConfig.postingWorkflowId || "",
        webhookExtraction: data.n8nConfig.extractionWebhookPlaceholder || "",
        webhookPosting: data.n8nConfig.postingWebhookPlaceholder || "",
        rootFolder: data.n8nConfig.n8nRootFolder || ""
      }
    : null,
  tally: data.tallyConfig
    ? {
        mode: data.tallyConfig.tallyMode,
        baseUrl: data.tallyConfig.tallyBaseUrl || "",
        companyName: data.tallyConfig.companyName || "",
        port: data.tallyConfig.tallyPort ? String(data.tallyConfig.tallyPort) : "",
        useXmlPosting: Boolean(data.tallyConfig.useXmlPosting),
        postingReviewMode: data.tallyConfig.postingReviewMode || "AUTO_POST",
        enableResponseLogging: Boolean(data.tallyConfig.enableResponseLogging),
        defaultPurchaseVoucherType: data.tallyConfig.defaultPurchaseVoucherType || "",
        defaultSalesVoucherType: data.tallyConfig.defaultSalesVoucherType || ""
      }
    : null,
  adminUser: data.adminUser
    ? {
        fullName: data.adminUser.fullName || "Tenant Admin",
        email: data.adminUser.email || "",
        phone: data.adminUser.phone || "",
        password: "",
        isActive: Boolean(data.adminUser.isActive)
      }
    : {
        fullName: "Tenant Admin",
        email: "",
        phone: "",
        password: "",
        isActive: true
      },
  rules: data.rules ?? {
    supportsPurchase: true,
    supportsSales: true,
    mandatoryReview: true,
    duplicateCheck: true,
    lineItemsMandatory: true
  }
});

const toConnectivityPayload = (payload) => ({
  tenant: {
    code: payload?.tenant?.code || "",
    name: payload?.tenant?.name || ""
  },
  branches: (payload?.branches || []).map((branch) => ({
    id: branch.id || null,
    code: branch.code || "",
    name: branch.name || ""
  })),
  storage: {
    storageMode: payload?.storage?.mode,
    incomingFolder: payload?.storage?.incomingFolder,
    reviewFolder: payload?.storage?.reviewFolder,
    processedFolder: payload?.storage?.processedFolder,
    successFolder: payload?.storage?.successFolder,
    exceptionFolder: payload?.storage?.exceptionFolder,
    outputFolder: payload?.storage?.outputFolder
  },
  n8n: {
    n8nBaseUrl: payload?.n8n?.baseUrl,
    backendApiBaseUrl: payload?.n8n?.backendApiBaseUrl,
    workflowKeyToken: payload?.n8n?.workflowToken,
    extractionWebhookPlaceholder: payload?.n8n?.webhookExtraction,
    postingWebhookPlaceholder: payload?.n8n?.webhookPosting,
    n8nRootFolder: payload?.n8n?.rootFolder
  },
  tally: {
    tallyMode: payload?.tally?.mode,
    tallyBaseUrl: payload?.tally?.baseUrl,
    tallyPort: payload?.tally?.port ? Number(payload.tally.port) : null,
    useXmlPosting: Boolean(payload?.tally?.useXmlPosting)
  }
});

export const tenantService = {
  async listOnboardedTenants() {
    const data = await get("/super-admin/tenants");
    return data.items || [];
  },

  deleteTenant(tenantId) {
    return del(`/super-admin/tenants/${tenantId}`);
  },

  createBranchTemplate() {
    return {
      id: createClientBranchId(),
      name: "",
      code: "",
      gstin: "",
      address: "",
      isDefault: false
    };
  },

  async getOnboardingTemplate() {
    const data = await get("/super-admin/tenants/template");
    return mapTemplate(data);
  },

  createTenant(payload) {
    return post("/super-admin/tenants", payload);
  },

  updateTenant(tenantId, payload) {
    return put(`/super-admin/tenants/${tenantId}`, payload);
  },

  createBranch(tenantId, payload) {
    return post(`/super-admin/tenants/${tenantId}/branches`, payload);
  },

  saveStorageConfig(tenantId, payload) {
    return post(`/super-admin/tenants/${tenantId}/storage-config`, payload);
  },

  saveN8nConfig(tenantId, payload) {
    return post(`/super-admin/tenants/${tenantId}/n8n-config`, payload);
  },

  saveTallyConfig(tenantId, payload) {
    return post(`/super-admin/tenants/${tenantId}/tally-config`, payload);
  },

  saveAdminUser(tenantId, payload) {
    return post(`/super-admin/tenants/${tenantId}/admin-user`, payload);
  },

  testConnectivity(payload) {
    return post("/super-admin/tenants/connectivity-test", toConnectivityPayload(payload));
  },

  replaceBranches(tenantId, branches) {
    return put(
      `/super-admin/tenants/${tenantId}/branches`,
      branches.map((b) => ({
        id: b.id && !b.id.startsWith("branch-") ? b.id : null,
        branchCode: b.code,
        branchName: b.name,
        branchGstin: b.gstin,
        branchAddress: b.address,
        isDefault: b.isDefault,
        isActive: true
      }))
    );
  },

  async getFullConfig(tenantId) {
    const data = await get(`/super-admin/tenants/${tenantId}/full-config`);
    return mapFullConfigToUi(data);
  },

  async saveTenantOnboarding(payload) {
    let tenantId = payload.tenant.id || null;
    if (!tenantId) {
      const createdTenant = await this.createTenant({
        tenantCode: payload.tenant.code,
        tenantName: payload.tenant.name,
        contactPerson: payload.tenant.contactPerson,
        contactEmail: payload.tenant.email,
        contactPhone: payload.tenant.phone,
        timezone: "Asia/Kolkata",
        isActive: payload.tenant.isActive
      });
      tenantId = createdTenant.id;
    } else {
      await this.updateTenant(tenantId, {
        tenantCode: payload.tenant.code,
        tenantName: payload.tenant.name,
        contactPerson: payload.tenant.contactPerson,
        contactEmail: payload.tenant.email,
        contactPhone: payload.tenant.phone,
        timezone: "Asia/Kolkata",
        isActive: payload.tenant.isActive
      });
    }

    const isNewTenant = !payload.tenant.id;
    if (isNewTenant) {
      const branchesToCreate = (payload.branches || []).filter(
        (branch) => typeof branch.id !== "string" || branch.id.startsWith("branch-")
      );
      await Promise.all(
        branchesToCreate.map((branch) =>
          this.createBranch(tenantId, {
            branchCode: branch.code,
            branchName: branch.name,
            branchGstin: branch.gstin,
            branchAddress: branch.address,
            isDefault: branch.isDefault,
            isActive: true
          })
        )
      );
    } else {
      await this.replaceBranches(tenantId, payload.branches || []);
    }

    await this.saveStorageConfig(tenantId, {
      storageMode: payload.storage.mode,
      incomingFolder: payload.storage.incomingFolder,
      reviewFolder: payload.storage.reviewFolder,
      processedFolder: payload.storage.processedFolder,
      successFolder: payload.storage.successFolder,
      exceptionFolder: payload.storage.exceptionFolder,
      outputFolder: payload.storage.outputFolder,
      allowBranchOverride: payload.storage.allowBranchOverride,
      branchOverrides: payload.storage.branchOverrides || []
    });

    await this.saveN8nConfig(tenantId, {
      n8nBaseUrl: payload.n8n.baseUrl,
      backendApiBaseUrl: payload.n8n.backendApiBaseUrl,
      workflowKeyToken: payload.n8n.workflowToken,
      extractionWorkflowName: payload.n8n.extractionWorkflow,
      postingWorkflowName: payload.n8n.postingWorkflow,
      extractionWebhookPlaceholder: payload.n8n.webhookExtraction,
      postingWebhookPlaceholder: payload.n8n.webhookPosting,
      n8nRootFolder: payload.n8n.rootFolder,
      isActive: true
    });

    await this.saveTallyConfig(tenantId, {
      tallyMode: payload.tally.mode,
      tallyBaseUrl: payload.tally.baseUrl,
      companyName: payload.tally.companyName,
      tallyPort: Number(payload.tally.port),
      useXmlPosting: payload.tally.useXmlPosting,
      postingReviewMode: payload.tally.postingReviewMode || "AUTO_POST",
      enableResponseLogging: payload.tally.enableResponseLogging,
      defaultPurchaseVoucherType: payload.tally.defaultPurchaseVoucherType,
      defaultSalesVoucherType: payload.tally.defaultSalesVoucherType
    });

    await this.saveAdminUser(tenantId, {
      fullName: payload.adminUser.fullName,
      email: payload.adminUser.email,
      phone: payload.adminUser.phone,
      password: payload.adminUser.password,
      isActive: payload.adminUser.isActive
    });

    return this.getFullConfig(tenantId);
  }
};
