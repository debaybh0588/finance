import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { tenantService } from "../api/tenantService.js";
import PageState from "../components/PageState.jsx";

const DEFAULT_UI_API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL || (import.meta.env.DEV ? "http://localhost:4000/api" : "/api");

const resolveDefaultBackendApiBaseUrl = () => {
  const normalized = String(DEFAULT_UI_API_BASE_URL || "").trim().replace(/\/+$/, "");
  if (!normalized) {
    return "";
  }

  if (/^https?:\/\//i.test(normalized)) {
    return normalized;
  }

  if (normalized.startsWith("/") && typeof window !== "undefined" && window.location?.origin) {
    return `${window.location.origin}${normalized}`.replace(/\/+$/, "");
  }

  return normalized;
};

const toTrimmedText = (value) => (typeof value === "string" ? value.trim() : "");

function SuperAdminTenantOnboardingPage() {
  const { tenantId } = useParams();
  const isEditMode = Boolean(tenantId);
  const [tenant, setTenant] = useState(null);
  const [branches, setBranches] = useState([]);
  const [storage, setStorage] = useState(null);
  const [n8n, setN8n] = useState(null);
  const [tally, setTally] = useState(null);
  const [adminUser, setAdminUser] = useState(null);
  const [rules, setRules] = useState(null);
  const [viewState, setViewState] = useState("loading");
  const [errorMessage, setErrorMessage] = useState("");
  const [saveState, setSaveState] = useState("idle");
  const [saveMessage, setSaveMessage] = useState("");
  const [connectivityState, setConnectivityState] = useState("idle");
  const [connectivityMessage, setConnectivityMessage] = useState("");
  const [connectivityResult, setConnectivityResult] = useState(null);

  const loadTemplate = async () => {
    try {
      setViewState("loading");
      setErrorMessage("");
      const data = isEditMode
        ? await tenantService.getFullConfig(tenantId)
        : await tenantService.getOnboardingTemplate();
      const defaultBackendApiBaseUrl = resolveDefaultBackendApiBaseUrl();
      const backendApiBaseUrl = toTrimmedText(data?.n8n?.backendApiBaseUrl) || defaultBackendApiBaseUrl;
      const normalizedN8n = {
        ...data.n8n,
        backendApiBaseUrl
      };
      setTenant(data.tenant);
      setBranches(data.branches);
      setStorage(data.storage);
      setN8n(normalizedN8n);
      setTally(data.tally);
      setAdminUser(data.adminUser);
      setRules(data.rules);
      setViewState("ready");
      setConnectivityState("idle");
      setConnectivityMessage("");
      setConnectivityResult(null);
    } catch (error) {
      setErrorMessage(error.message || "Unable to load tenant onboarding template.");
      setViewState("error");
    }
  };

  useEffect(() => {
    loadTemplate();
  }, [tenantId]);

  const setDefaultBranch = (id) => {
    setBranches((prev) => prev.map((branch) => ({ ...branch, isDefault: branch.id === id })));
  };

  const updateBranch = (id, key, value) => {
    setBranches((prev) => prev.map((branch) => (branch.id === id ? { ...branch, [key]: value } : branch)));
  };

  const addBranch = () => {
    setBranches((prev) => [...prev, tenantService.createBranchTemplate()]);
  };

  const removeBranch = (id) => {
    setBranches((prev) => {
      const next = prev.filter((branch) => branch.id !== id);
      if (!next.some((branch) => branch.isDefault) && next.length > 0) {
        next[0].isDefault = true;
      }
      return next;
    });
  };

  const handleSaveTenant = async () => {
    try {
      setSaveState("saving");
      setSaveMessage("");
      const connectivity = await runConnectivityTests({ quiet: true });
      if (!connectivity || connectivity.overallStatus !== "PASS") {
        setSaveState("error");
        setSaveMessage("Connectivity checks failed. Fix the reported issue(s) and retry.");
        return;
      }
      const result = await tenantService.saveTenantOnboarding({ tenant, branches, storage, n8n, tally, adminUser, rules });
      setTenant(result.tenant);
      setBranches(result.branches);
      if (result.storage) {
        setStorage(result.storage);
      }
      if (result.n8n) {
        setN8n(result.n8n);
      }
      if (result.tally) {
        setTally(result.tally);
      }
      if (result.adminUser) {
        setAdminUser(result.adminUser);
      }
      setSaveState("success");
      setSaveMessage(`Tenant ${result.tenant.name} saved successfully.`);
    } catch (error) {
      setSaveState("error");
      setSaveMessage(error.message || "Unable to save tenant onboarding payload.");
    }
  };

  const runConnectivityTests = async ({ quiet = false } = {}) => {
    try {
      setConnectivityState("testing");
      if (!quiet) {
        setConnectivityMessage("");
      }

      const result = await tenantService.testConnectivity({ tenant, branches, storage, n8n, tally });
      setConnectivityResult(result);
      setConnectivityState(result.overallStatus === "PASS" ? "success" : "error");
      setConnectivityMessage(
        result.overallStatus === "PASS"
          ? "Connectivity checks passed for storage, n8n, and Tally."
          : "Connectivity checks failed. Expand results below for exact reason(s)."
      );
      return result;
    } catch (error) {
      setConnectivityState("error");
      setConnectivityResult(null);
      setConnectivityMessage(error.message || "Connectivity check request failed.");
      return null;
    }
  };

  if (viewState === "loading") {
    return (
      <section className="super-admin-page">
        <h2>{isEditMode ? "Super Admin - Edit Tenant" : "Super Admin - Tenant Onboarding"}</h2>
        <PageState title="Loading onboarding form" description="Fetching tenant onboarding defaults and configuration template." />
      </section>
    );
  }

  if (viewState === "error") {
    return (
      <section className="super-admin-page">
        <h2>{isEditMode ? "Super Admin - Edit Tenant" : "Super Admin - Tenant Onboarding"}</h2>
        <PageState
          title="Onboarding form unavailable"
          description={errorMessage}
          actionLabel="Retry"
          onAction={loadTemplate}
          tone="error"
        />
      </section>
    );
  }

  if (!tenant || !storage || !n8n || !tally || !adminUser || !rules) {
    return (
      <section className="super-admin-page">
        <h2>{isEditMode ? "Super Admin - Edit Tenant" : "Super Admin - Tenant Onboarding"}</h2>
        <PageState
          title="No onboarding template"
          description="The onboarding template was not returned by the backend."
          actionLabel="Reload"
          onAction={loadTemplate}
        />
      </section>
    );
  }

  return (
    <section className="super-admin-page">
      <h2>{isEditMode ? "Super Admin - Edit Tenant" : "Super Admin - Tenant Onboarding"}</h2>

      {saveState !== "idle" && saveMessage ? (
        <div className={`page-inline-status ${saveState === "error" ? "page-inline-status-error" : "page-inline-status-success"}`}>
          {saveMessage}
        </div>
      ) : null}

      <article className="card super-admin-section">
        <div className="card-title-row">
          <h3>Tenant Basic Info</h3>
        </div>
        <div className="super-admin-grid three-col-admin">
          <label>
            Tenant Name
            <input value={tenant.name} onChange={(e) => setTenant({ ...tenant, name: e.target.value })} />
          </label>
          <label>
            Tenant Code
            <input value={tenant.code} onChange={(e) => setTenant({ ...tenant, code: e.target.value })} />
          </label>
          <label>
            Contact Person
            <input
              value={tenant.contactPerson}
              onChange={(e) => setTenant({ ...tenant, contactPerson: e.target.value })}
            />
          </label>
          <label>
            Email
            <input value={tenant.email} onChange={(e) => setTenant({ ...tenant, email: e.target.value })} />
          </label>
          <label>
            Phone
            <input value={tenant.phone} onChange={(e) => setTenant({ ...tenant, phone: e.target.value })} />
          </label>
          <label>
            Active/Inactive
            <select
              value={tenant.isActive ? "active" : "inactive"}
              onChange={(e) => setTenant({ ...tenant, isActive: e.target.value === "active" })}
            >
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </select>
          </label>
        </div>
      </article>

      <article className="card super-admin-section">
        <div className="card-title-row">
          <h3>Tenant Admin Login</h3>
        </div>
        <div className="super-admin-grid three-col-admin">
          <label>
            Full Name
            <input
              value={adminUser.fullName}
              onChange={(e) => setAdminUser({ ...adminUser, fullName: e.target.value })}
            />
          </label>
          <label>
            Username (Email)
            <input
              value={adminUser.email}
              onChange={(e) => setAdminUser({ ...adminUser, email: e.target.value })}
              placeholder="tenant.admin@company.com"
            />
          </label>
          <label>
            Phone
            <input
              value={adminUser.phone}
              onChange={(e) => setAdminUser({ ...adminUser, phone: e.target.value })}
            />
          </label>
          <label>
            Password
            <input
              type="password"
              value={adminUser.password}
              onChange={(e) => setAdminUser({ ...adminUser, password: e.target.value })}
              placeholder={isEditMode ? "Leave blank to keep unchanged" : "Set initial password"}
            />
          </label>
          <label>
            Admin User Active
            <select
              value={adminUser.isActive ? "active" : "inactive"}
              onChange={(e) => setAdminUser({ ...adminUser, isActive: e.target.value === "active" })}
            >
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </select>
          </label>
        </div>
      </article>

      <article className="card super-admin-section">
        <div className="card-title-row">
          <h3>Branch Setup</h3>
          <button type="button" className="admin-btn-light" onClick={addBranch}>
            Add Branch
          </button>
        </div>

        <div className="branch-list">
          {branches.map((branch) => (
            <div className="branch-item" key={branch.id}>
              <div className="super-admin-grid branch-grid">
                <label>
                  Branch Name
                  <input value={branch.name} onChange={(e) => updateBranch(branch.id, "name", e.target.value)} />
                </label>
                <label>
                  Branch Code
                  <input value={branch.code} onChange={(e) => updateBranch(branch.id, "code", e.target.value)} />
                </label>
                <label>
                  Branch GSTIN
                  <input value={branch.gstin} onChange={(e) => updateBranch(branch.id, "gstin", e.target.value)} />
                </label>
                <label className="full-span">
                  Branch Address
                  <input
                    value={branch.address}
                    onChange={(e) => updateBranch(branch.id, "address", e.target.value)}
                  />
                </label>
              </div>
              <div className="branch-actions">
                <label className="switch-row">
                  <input
                    type="radio"
                    name="defaultBranch"
                    checked={branch.isDefault}
                    onChange={() => setDefaultBranch(branch.id)}
                  />
                  Mark default branch
                </label>
                <button type="button" className="admin-btn-light" onClick={() => removeBranch(branch.id)}>
                  Remove
                </button>
              </div>
            </div>
          ))}
        </div>
      </article>

      <article className="card super-admin-section">
        <div className="card-title-row">
          <h3>Storage Configuration</h3>
        </div>
        <div className="super-admin-grid three-col-admin">
          <label>
            Storage Mode
            <select value={storage.mode} onChange={(e) => setStorage({ ...storage, mode: e.target.value })}>
              <option value="LOCAL">LOCAL</option>
              <option value="CLOUD">CLOUD</option>
            </select>
          </label>
          <label>
            Allow Branch Overrides
            <select
              value={storage.allowBranchOverride ? "yes" : "no"}
              onChange={(e) => setStorage({ ...storage, allowBranchOverride: e.target.value === "yes" })}
            >
              <option value="yes">Yes</option>
              <option value="no">No</option>
            </select>
          </label>
          <label>
            Incoming Folder
            <input
              value={storage.incomingFolder}
              onChange={(e) => setStorage({ ...storage, incomingFolder: e.target.value })}
            />
          </label>
          <label>
            Review Folder
            <input
              value={storage.reviewFolder}
              onChange={(e) => setStorage({ ...storage, reviewFolder: e.target.value })}
            />
          </label>
          <label>
            Processed Folder
            <input
              value={storage.processedFolder}
              onChange={(e) => setStorage({ ...storage, processedFolder: e.target.value })}
            />
          </label>
          <label>
            Success Folder
            <input
              value={storage.successFolder}
              onChange={(e) => setStorage({ ...storage, successFolder: e.target.value })}
            />
          </label>
          <label>
            Exception Folder
            <input
              value={storage.exceptionFolder}
              onChange={(e) => setStorage({ ...storage, exceptionFolder: e.target.value })}
            />
          </label>
          <label>
            Output Folder
            <input value={storage.outputFolder} onChange={(e) => setStorage({ ...storage, outputFolder: e.target.value })} />
          </label>
        </div>
        <p className="admin-note">Branch-level override allowed. No hardcoded paths anywhere.</p>
      </article>

      <article className="card super-admin-section">
        <div className="card-title-row">
          <h3>n8n Configuration</h3>
        </div>
        <div className="super-admin-grid three-col-admin">
          <label>
            n8n Base URL
            <input value={n8n.baseUrl} onChange={(e) => setN8n({ ...n8n, baseUrl: e.target.value })} />
          </label>
          <label>
            Backend API Base URL
            <input
              value={n8n.backendApiBaseUrl || ""}
              onChange={(e) => setN8n({ ...n8n, backendApiBaseUrl: e.target.value })}
              placeholder="e.g. http://localhost:4000/api"
            />
          </label>
          <label>
            Workflow Key/Token
            <input value={n8n.workflowToken} onChange={(e) => setN8n({ ...n8n, workflowToken: e.target.value })} />
          </label>
          <label>
            Extraction Workflow ID/Name
            <input
              value={n8n.extractionWorkflow}
              onChange={(e) => setN8n({ ...n8n, extractionWorkflow: e.target.value })}
            />
          </label>
          <label>
            Posting Workflow ID/Name
            <input value={n8n.postingWorkflow} onChange={(e) => setN8n({ ...n8n, postingWorkflow: e.target.value })} />
          </label>
          <label>
            Webhook Endpoint Placeholder (Extraction)
            <input
              value={n8n.webhookExtraction}
              onChange={(e) => setN8n({ ...n8n, webhookExtraction: e.target.value })}
            />
          </label>
          <label>
            Webhook Endpoint Placeholder (Posting)
            <input value={n8n.webhookPosting} onChange={(e) => setN8n({ ...n8n, webhookPosting: e.target.value })} />
          </label>
          <label>
            n8n Root Folder Path
            <input
              value={n8n.rootFolder}
              onChange={(e) => setN8n({ ...n8n, rootFolder: e.target.value })}
              placeholder="e.g. C:\n8n\data or /home/n8n/data"
            />
          </label>
        </div>
      </article>

      <article className="card super-admin-section">
        <div className="card-title-row">
          <h3>Tally Configuration</h3>
        </div>
        <div className="super-admin-grid three-col-admin">
          <label>
            Tally Mode
            <input value={tally.mode} onChange={(e) => setTally({ ...tally, mode: e.target.value })} />
          </label>
          <label>
            Tally Base URL
            <input value={tally.baseUrl} onChange={(e) => setTally({ ...tally, baseUrl: e.target.value })} />
          </label>
          <label>
            Company Name
            <input value={tally.companyName} onChange={(e) => setTally({ ...tally, companyName: e.target.value })} />
          </label>
          <label>
            Port
            <input value={tally.port} onChange={(e) => setTally({ ...tally, port: e.target.value })} />
          </label>
          <label>
            Use XML Posting
            <select
              value={tally.useXmlPosting ? "yes" : "no"}
              onChange={(e) => setTally({ ...tally, useXmlPosting: e.target.value === "yes" })}
            >
              <option value="yes">Yes</option>
              <option value="no">No</option>
            </select>
          </label>
          <label>
            Posting Review Mode
            <select
              value={tally.postingReviewMode || "AUTO_POST"}
              onChange={(e) => setTally({ ...tally, postingReviewMode: e.target.value })}
            >
              <option value="AUTO_POST">Auto Post</option>
              <option value="REVIEW_BEFORE_POSTING">UI Review Then Post</option>
            </select>
          </label>
          <label>
            Enable Response Logging
            <select
              value={tally.enableResponseLogging ? "yes" : "no"}
              onChange={(e) => setTally({ ...tally, enableResponseLogging: e.target.value === "yes" })}
            >
              <option value="yes">Yes</option>
              <option value="no">No</option>
            </select>
          </label>
          <label>
            Default Purchase Voucher Type
            <input
              value={tally.defaultPurchaseVoucherType}
              onChange={(e) => setTally({ ...tally, defaultPurchaseVoucherType: e.target.value })}
            />
          </label>
          <label>
            Default Sales Voucher Type
            <input
              value={tally.defaultSalesVoucherType}
              onChange={(e) => setTally({ ...tally, defaultSalesVoucherType: e.target.value })}
            />
          </label>
        </div>
      </article>

      <article className="card super-admin-section">
        <div className="card-title-row">
          <h3>Invoice Rules</h3>
        </div>
        <div className="super-admin-grid rules-grid">
          <label>
            Supports Purchase Invoices
            <select
              value={rules.supportsPurchase ? "yes" : "no"}
              onChange={(e) => setRules({ ...rules, supportsPurchase: e.target.value === "yes" })}
            >
              <option value="yes">Yes</option>
              <option value="no">No</option>
            </select>
          </label>
          <label>
            Supports Sales Invoices
            <select
              value={rules.supportsSales ? "yes" : "no"}
              onChange={(e) => setRules({ ...rules, supportsSales: e.target.value === "yes" })}
            >
              <option value="yes">Yes</option>
              <option value="no">No</option>
            </select>
          </label>
          <label>
            Mandatory Review
            <select
              value={rules.mandatoryReview ? "yes" : "no"}
              onChange={(e) => setRules({ ...rules, mandatoryReview: e.target.value === "yes" })}
            >
              <option value="yes">Yes</option>
              <option value="no">No</option>
            </select>
          </label>
          <label>
            Duplicate Check Enabled
            <select
              value={rules.duplicateCheck ? "yes" : "no"}
              onChange={(e) => setRules({ ...rules, duplicateCheck: e.target.value === "yes" })}
            >
              <option value="yes">Yes</option>
              <option value="no">No</option>
            </select>
          </label>
          <label>
            Line Items Mandatory
            <select
              value={rules.lineItemsMandatory ? "yes" : "no"}
              onChange={(e) => setRules({ ...rules, lineItemsMandatory: e.target.value === "yes" })}
            >
              <option value="yes">Yes</option>
              <option value="no">No</option>
            </select>
          </label>
        </div>
      </article>

      <article className="card super-admin-section">
        <div className="card-title-row">
          <h3>Connectivity Tests</h3>
          <button
            type="button"
            className="admin-btn-light"
            onClick={() => runConnectivityTests({ quiet: false })}
            disabled={connectivityState === "testing"}
          >
            {connectivityState === "testing" ? "Testing..." : "Run Connectivity Tests"}
          </button>
        </div>

        {connectivityMessage ? (
          <div
            className={`page-inline-status ${
              connectivityState === "error" ? "page-inline-status-error" : "page-inline-status-success"
            }`}
          >
            {connectivityMessage}
          </div>
        ) : null}

        {connectivityResult?.checks ? (
          <div className="connectivity-check-grid">
            {Object.entries(connectivityResult.checks).map(([name, check]) => (
              <div
                key={name}
                className={`connectivity-check connectivity-check-${String(check?.status || "UNKNOWN").toLowerCase()}`}
              >
                <div className="connectivity-check-title">
                  {name.toUpperCase()} - {check?.status || "UNKNOWN"}
                </div>
                <div className="connectivity-check-message">{check?.message || "No message available"}</div>
                {check?.code ? <div className="connectivity-check-code">Code: {check.code}</div> : null}
              </div>
            ))}
          </div>
        ) : (
          <p className="admin-note">
            Run connectivity tests before saving so onboarding fails fast with exact root-cause details.
          </p>
        )}
      </article>

      <footer className="super-admin-footer">
        <button type="button" className="btn-neutral">
          Save Draft
        </button>
        <button
          type="button"
          className="btn-approve"
          onClick={handleSaveTenant}
          disabled={saveState === "saving" || connectivityState === "testing"}
        >
          {saveState === "saving" ? "Saving..." : "Save Tenant"}
        </button>
        <button type="button" className="btn-reject" onClick={loadTemplate}>
          Cancel
        </button>
      </footer>
    </section>
  );
}

export default SuperAdminTenantOnboardingPage;
