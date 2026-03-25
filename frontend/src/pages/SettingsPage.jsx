import { useMemo } from "react";
import { useAuth } from "../auth/AuthContext.jsx";

function SettingsPage() {
  const { user, tenants, branches, selectedTenantId, selectedBranchId } = useAuth();

  const selectedTenant = useMemo(
    () => tenants.find((tenant) => tenant.id === selectedTenantId) || null,
    [tenants, selectedTenantId]
  );

  const selectedBranch = useMemo(
    () => branches.find((branch) => branch.id === selectedBranchId) || null,
    [branches, selectedBranchId]
  );

  return (
    <section className="settings-page">
      <h2>Settings</h2>

      <div className="card">
        <div className="card-title-row">
          <h3>Tenant Details</h3>
        </div>
        <p>Current workspace details (read-only for now).</p>
        <dl className="preview-data-grid">
          <div>
            <dt>Tenant Name</dt>
            <dd>{selectedTenant?.tenantName || "-"}</dd>
          </div>
          <div>
            <dt>Tenant Code</dt>
            <dd>{selectedTenant?.tenantCode || "-"}</dd>
          </div>
          <div>
            <dt>Tenant ID</dt>
            <dd>{selectedTenantId || "-"}</dd>
          </div>
          <div>
            <dt>Branch Name</dt>
            <dd>{selectedBranch?.branchName || "-"}</dd>
          </div>
          <div>
            <dt>Branch Code</dt>
            <dd>{selectedBranch?.branchCode || "-"}</dd>
          </div>
          <div>
            <dt>Branch ID</dt>
            <dd>{selectedBranchId || "-"}</dd>
          </div>
          <div>
            <dt>Logged In User</dt>
            <dd>{user?.fullName || "-"}</dd>
          </div>
          <div>
            <dt>User Email</dt>
            <dd>{user?.email || "-"}</dd>
          </div>
          <div>
            <dt>User Role</dt>
            <dd>{user?.role || "-"}</dd>
          </div>
        </dl>
      </div>

      <div className="card">
        <div className="card-title-row">
          <h3>More Settings (Coming Soon)</h3>
        </div>
        <p>
          This page is ready for future configuration sections like invoice rules, posting behavior,
          notification preferences, and retention policies.
        </p>
      </div>
    </section>
  );
}

export default SettingsPage;
