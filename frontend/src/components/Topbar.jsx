import { useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "../auth/AuthContext.jsx";

function Topbar() {
  const {
    user,
    tenants,
    branches,
    selectedTenantId,
    selectedBranchId,
    selectedDateRange,
    setTenantBranchScope,
    setDateRangeScope,
    logout
  } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef(null);

  const isSuperAdmin = user?.role === "SUPER_ADMIN";

  const tenantOptions = useMemo(
    () => tenants.map((tenant) => ({ value: tenant.id, label: tenant.tenantCode || tenant.tenantName })),
    [tenants]
  );

  useEffect(() => {
    const handlePointerDown = (event) => {
      if (menuRef.current && !menuRef.current.contains(event.target)) {
        setMenuOpen(false);
      }
    };

    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        setMenuOpen(false);
      }
    };

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  return (
    <header className="topbar">
      {!isSuperAdmin ? (
        <div className="topbar-group">
          <select
            value={selectedTenantId || ""}
            aria-label="Tenant"
            onChange={(event) => {
              const tenantId = event.target.value;
              const tenant = tenants.find((item) => item.id === tenantId);
              const nextBranchId = tenant?.branches?.find((branch) => branch.isDefault)?.id || tenant?.branches?.[0]?.id || "";
              setTenantBranchScope({ tenantId, branchId: nextBranchId });
            }}
          >
            {tenantOptions.map((tenant) => (
              <option key={tenant.value} value={tenant.value}>
                {tenant.label}
              </option>
            ))}
          </select>

          <select
            value={selectedBranchId || ""}
            aria-label="Branch"
            onChange={(event) => setTenantBranchScope({ tenantId: selectedTenantId, branchId: event.target.value })}
          >
            {branches.map((branch) => (
              <option key={branch.id} value={branch.id}>
                {branch.branchCode}
              </option>
            ))}
          </select>

          <select
            value={selectedDateRange || "all-time"}
            aria-label="Date range"
            onChange={(event) => setDateRangeScope(event.target.value)}
          >
            <option value="all-time">All time</option>
            <option value="today">Today</option>
            <option value="this-week">This week</option>
            <option value="this-month">This month</option>
            <option value="this-quarter">This quarter</option>
          </select>
        </div>
      ) : null}

      <div className="profile-menu-wrap" ref={menuRef}>
        <button
          type="button"
          className="profile-btn"
          aria-label="User profile menu"
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((prev) => !prev)}
        >
          <span className="profile-avatar">
            {(user?.fullName || "U")
              .split(" ")
              .map((part) => part[0])
              .join("")
              .slice(0, 2)
              .toUpperCase()}
          </span>
          <span className="profile-name">{user?.fullName || "User"}</span>
        </button>

        {menuOpen ? (
          <div className="profile-menu" role="menu" aria-label="Profile actions">
            <p className="profile-menu-meta">{user?.email || "Signed in user"}</p>
            <button
              type="button"
              className="profile-menu-item"
              role="menuitem"
              onClick={async () => {
                setMenuOpen(false);
                await logout();
              }}
            >
              Logout
            </button>
          </div>
        ) : null}
      </div>
    </header>
  );
}

export default Topbar;
