import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { tenantService } from "../api/tenantService.js";
import PageState from "../components/PageState.jsx";

function SuperAdminTenantsListPage() {
  const navigate = useNavigate();
  const [items, setItems] = useState([]);
  const [viewState, setViewState] = useState("loading");
  const [errorMessage, setErrorMessage] = useState("");
  const [actionMessage, setActionMessage] = useState("");
  const [actionTone, setActionTone] = useState("success");
  const [deletingTenantId, setDeletingTenantId] = useState(null);

  const loadTenants = async () => {
    try {
      setViewState("loading");
      setErrorMessage("");
      const tenants = await tenantService.listOnboardedTenants();
      setItems(tenants);
      setViewState("ready");
    } catch (error) {
      setErrorMessage(error.message || "Unable to load onboarded tenants.");
      setViewState("error");
    }
  };

  useEffect(() => {
    loadTenants();
  }, []);

  const handleDelete = async (tenant) => {
    const confirmed = window.confirm(
      `Delete tenant ${tenant.tenantName}? This will remove tenant configuration, branches, and related records.`
    );

    if (!confirmed) {
      return;
    }

    try {
      setDeletingTenantId(tenant.id);
      setActionMessage("");
      setActionTone("success");
      await tenantService.deleteTenant(tenant.id);
      setItems((prev) => prev.filter((item) => item.id !== tenant.id));
      setActionMessage(`Tenant ${tenant.tenantName} deleted.`);
    } catch (error) {
      setActionTone("error");
      setActionMessage(error.message || "Unable to delete tenant.");
    } finally {
      setDeletingTenantId(null);
    }
  };

  if (viewState === "loading") {
    return (
      <section className="super-admin-page">
        <h2>Super Admin - Onboarded Tenants</h2>
        <PageState title="Loading tenants" description="Fetching onboarded tenant list." />
      </section>
    );
  }

  if (viewState === "error") {
    return (
      <section className="super-admin-page">
        <h2>Super Admin - Onboarded Tenants</h2>
        <PageState
          title="Unable to load tenants"
          description={errorMessage}
          actionLabel="Retry"
          onAction={loadTenants}
          tone="error"
        />
      </section>
    );
  }

  return (
    <section className="super-admin-page">
      <div className="card-title-row">
        <h2>Super Admin - Onboarded Tenants</h2>
        <button
          type="button"
          className="admin-btn-light"
          onClick={() => navigate("/super-admin/tenants/new")}
        >
          New Tenant
        </button>
      </div>

      {actionMessage ? (
        <div
          className={`page-inline-status ${
            actionTone === "error" ? "page-inline-status-error" : "page-inline-status-success"
          }`}
        >
          {actionMessage}
        </div>
      ) : null}

      <article className="card super-admin-section">
        {items.length === 0 ? (
          <PageState
            title="No tenants found"
            description="Onboard your first tenant to start managing configurations."
            actionLabel="Create Tenant"
            onAction={() => navigate("/super-admin/tenants/new")}
          />
        ) : (
          <div className="tenant-list-table-wrap">
            <table className="tenant-list-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Code</th>
                  <th>Contact</th>
                  <th>Status</th>
                  <th>Branches</th>
                  <th>Created</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {items.map((tenant) => (
                  <tr key={tenant.id}>
                    <td>{tenant.tenantName}</td>
                    <td>{tenant.tenantCode}</td>
                    <td>{tenant.contactEmail || tenant.contactPhone || "-"}</td>
                    <td>{tenant.isActive ? "Active" : "Inactive"}</td>
                    <td>{tenant.branchCount}</td>
                    <td>{new Date(tenant.createdAt).toLocaleDateString()}</td>
                    <td>
                      <div className="tenant-list-actions">
                        <button
                          type="button"
                          className="admin-btn-light"
                          onClick={() => navigate(`/super-admin/tenants/${tenant.id}/edit`)}
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          className="admin-btn-light"
                          onClick={() => handleDelete(tenant)}
                          disabled={deletingTenantId === tenant.id}
                        >
                          {deletingTenantId === tenant.id ? "Deleting..." : "Delete"}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </article>
    </section>
  );
}

export default SuperAdminTenantsListPage;
