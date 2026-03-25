import { NavLink } from "react-router-dom";
import { useAuth } from "../auth/AuthContext.jsx";

const menuItems = [
  { to: "/dashboard", label: "Dashboard", icon: DashboardIcon },
  { to: "/invoices", label: "Invoices", icon: InvoiceIcon },
  { to: "/review-queue", label: "Review Queue", icon: ReviewIcon },
  { to: "/posting", label: "Posting", icon: PostingIcon },
  { to: "/audit-log", label: "Audit Log", icon: AuditIcon },
  { to: "/settings", label: "Settings", icon: SettingsIcon }
];

const superAdminMenuItems = [
  {
    to: "/super-admin/tenants",
    label: "Onboarded Tenants",
    icon: ReviewIcon
  },
  {
    to: "/super-admin/tenants/new",
    label: "Tenant Onboarding",
    icon: SettingsIcon
  }
];

function Sidebar() {
  const { user } = useAuth();
  const visibleMenuItems = user?.role === "SUPER_ADMIN" ? superAdminMenuItems : menuItems;

  return (
    <aside className="sidebar">
      <div className="sidebar-brand">
        <h1>PostRight</h1>
        <p>Enterprise workspace</p>
      </div>

      <nav className="sidebar-nav" aria-label="Primary">
        {visibleMenuItems.map((item) => {
          const Icon = item.icon;
          return (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === "/dashboard"}
              className={({ isActive }) =>
                isActive ? "sidebar-link sidebar-link-active" : "sidebar-link"
              }
            >
              <span className="sidebar-icon" aria-hidden="true">
                <Icon />
              </span>
              <span>{item.label}</span>
            </NavLink>
          );
        })}
      </nav>

    </aside>
  );
}

function DashboardIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <rect x="3.5" y="3.5" width="7" height="7" rx="1.3" />
      <rect x="13.5" y="3.5" width="7" height="4" rx="1.3" />
      <rect x="13.5" y="10.5" width="7" height="10" rx="1.3" />
      <rect x="3.5" y="13.5" width="7" height="7" rx="1.3" />
    </svg>
  );
}

function InvoiceIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M6 3.5h9l3 3v14H6z" />
      <path d="M15 3.5v3h3" />
      <path d="M8.5 11h7" />
      <path d="M8.5 15h7" />
    </svg>
  );
}

function ReviewIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M4 5.5h16v13H4z" />
      <path d="M8.5 10.5h7" />
      <path d="M8.5 14.5h5" />
      <circle cx="6.5" cy="10.5" r="0.8" fill="currentColor" />
      <circle cx="6.5" cy="14.5" r="0.8" fill="currentColor" />
    </svg>
  );
}

function PostingIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M4 12h10" />
      <path d="M10 8l4 4-4 4" />
      <rect x="15.5" y="5.5" width="4.5" height="13" rx="1" />
    </svg>
  );
}

function AuditIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M12 4.2l7 3v4.8c0 4.6-2.8 7.3-7 8.8-4.2-1.5-7-4.2-7-8.8V7.2z" />
      <path d="M9.3 12.1l1.8 1.8 3.8-3.8" />
    </svg>
  );
}

function SettingsIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <circle cx="12" cy="12" r="2.5" />
      <path d="M19.3 13.1v-2.2l-2-.6-.6-1.5 1-1.9-1.6-1.6-1.9 1-.9-.4-.6-2.1h-2.2l-.6 2.1-.9.4-1.9-1-1.6 1.6 1 1.9-.6 1.5-2 .6v2.2l2 .6.6 1.5-1 1.9 1.6 1.6 1.9-1 .9.4.6 2.1h2.2l.6-2.1.9-.4 1.9 1 1.6-1.6-1-1.9.6-1.5z" />
    </svg>
  );
}

export default Sidebar;
