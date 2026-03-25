import { useEffect } from "react";
import { Outlet, useLocation } from "react-router-dom";
import Sidebar from "./Sidebar.jsx";
import Topbar from "./Topbar.jsx";

function AppLayout() {
  const location = useLocation();
  const isSuperAdminScreen = location.pathname.startsWith("/super-admin/tenants");

  useEffect(() => {
    const inInvoicesScreen = location.pathname.startsWith("/invoices");
    const overlays = Array.from(document.querySelectorAll(".upload-modal-overlay"));

    overlays.forEach((overlayNode) => {
      const hasDialog = Boolean(overlayNode.querySelector(".upload-modal"));
      if (!inInvoicesScreen || !hasDialog) {
        overlayNode.remove();
      }
    });

    if (!inInvoicesScreen) {
      document.body.style.overflow = "";
      document.documentElement.style.overflow = "";
    }
  }, [location.pathname]);

  return (
    <div className="app-shell">
      <Sidebar />

      <div className="app-main">
        <Topbar />
        <main className={isSuperAdminScreen ? "content-area content-area-wide" : "content-area"}>
          <Outlet />
        </main>
      </div>
    </div>
  );
}

export default AppLayout;
