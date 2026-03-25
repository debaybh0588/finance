import { Navigate, Route, Routes } from "react-router-dom";
import AppLayout from "./components/AppLayout.jsx";
import { useAuth } from "./auth/AuthContext.jsx";
import AuditLogPage from "./pages/AuditLogPage.jsx";
import DashboardPage from "./pages/DashboardPage.jsx";
import InvoiceReviewDetailPage from "./pages/InvoiceReviewDetailPage.jsx";
import InvoicesPage from "./pages/InvoicesPage.jsx";
import LoginPage from "./pages/LoginPage.jsx";
import PostingPage from "./pages/PostingPage.jsx";
import PostingReviewDetailPage from "./pages/PostingReviewDetailPage.jsx";
import ReviewQueuePage from "./pages/ReviewQueuePage.jsx";
import SettingsPage from "./pages/SettingsPage.jsx";
import SuperAdminTenantOnboardingPage from "./pages/SuperAdminTenantOnboardingPage.jsx";
import SuperAdminTenantsListPage from "./pages/SuperAdminTenantsListPage.jsx";

function App() {
  const { loading, user } = useAuth();

  if (loading) {
    return null;
  }

  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/" element={<ProtectedRoute><AppLayout /></ProtectedRoute>}>
        <Route
          index
          element={<Navigate to={user?.role === "SUPER_ADMIN" ? "/super-admin/tenants" : "/dashboard"} replace />}
        />
        <Route path="dashboard" element={<NonSuperAdminRoute><DashboardPage /></NonSuperAdminRoute>} />
        <Route path="invoices" element={<NonSuperAdminRoute><InvoicesPage /></NonSuperAdminRoute>} />
        <Route path="review-queue" element={<NonSuperAdminRoute><ReviewQueuePage /></NonSuperAdminRoute>} />
        <Route
          path="review-queue/:reviewId"
          element={<NonSuperAdminRoute><InvoiceReviewDetailPage /></NonSuperAdminRoute>}
        />
        <Route path="posting" element={<NonSuperAdminRoute><PostingPage /></NonSuperAdminRoute>} />
        <Route path="posting/review/:invoiceId" element={<NonSuperAdminRoute><PostingReviewDetailPage /></NonSuperAdminRoute>} />
        <Route path="audit-log" element={<NonSuperAdminRoute><AuditLogPage /></NonSuperAdminRoute>} />
        <Route path="settings" element={<NonSuperAdminRoute><SettingsPage /></NonSuperAdminRoute>} />
        <Route
          path="super-admin/tenants"
          element={
            <SuperAdminRoute>
              <SuperAdminTenantsListPage />
            </SuperAdminRoute>
          }
        />
        <Route
          path="super-admin/tenants/new"
          element={
            <SuperAdminRoute>
              <SuperAdminTenantOnboardingPage />
            </SuperAdminRoute>
          }
        />
        <Route
          path="super-admin/tenants/:tenantId/edit"
          element={
            <SuperAdminRoute>
              <SuperAdminTenantOnboardingPage />
            </SuperAdminRoute>
          }
        />
      </Route>
    </Routes>
  );
}

function ProtectedRoute({ children }) {
  const { isAuthenticated } = useAuth();
  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }
  return children;
}

function SuperAdminRoute({ children }) {
  const { user } = useAuth();

  if (user?.role !== "SUPER_ADMIN") {
    return <Navigate to="/dashboard" replace />;
  }

  return children;
}

function NonSuperAdminRoute({ children }) {
  const { user } = useAuth();

  if (user?.role === "SUPER_ADMIN") {
    return <Navigate to="/super-admin/tenants" replace />;
  }

  return children;
}

export default App;
