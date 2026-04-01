import { useEffect, useState } from "react";
import { invoiceService } from "../api/invoiceService.js";
import { useAuth } from "../auth/AuthContext.jsx";
import PageState from "../components/PageState.jsx";

function DashboardPage() {
  const { selectedTenantId, selectedBranchId, selectedDateRange, setDateRangeScope } = useAuth();
  const [dashboard, setDashboard] = useState(null);
  const [viewState, setViewState] = useState("loading");
  const [errorMessage, setErrorMessage] = useState("");

  const loadDashboard = async () => {
    try {
      setViewState("loading");
      setErrorMessage("");
      const data = await invoiceService.getDashboard(selectedTenantId, selectedBranchId, selectedDateRange);
      setDashboard(data);
      setViewState("ready");
    } catch (error) {
      setErrorMessage(error.message || "Unable to load dashboard data.");
      setViewState("error");
    }
  };

  useEffect(() => {
    loadDashboard();
  }, [selectedTenantId, selectedBranchId, selectedDateRange]);

  const metrics = dashboard?.metrics || [];
  const lifecycle = dashboard?.lifecycle || [];
  const perDay = dashboard?.perDay || [];
  const vendors = dashboard?.vendors || [];
  const hasContent = metrics.length > 0 || lifecycle.length > 0 || perDay.length > 0 || vendors.length > 0;
  const maxPerDay = perDay.length > 0 ? Math.max(...perDay.map((item) => item.count), 1) : 1;
  const totalVendorAmount = vendors.reduce((sum, vendor) => sum + vendor.amount, 0);

  const donutGradient = totalVendorAmount
    ? (() => {
        let running = 0;
        const segments = vendors.map((vendor) => {
          const start = (running / totalVendorAmount) * 360;
          running += vendor.amount;
          const end = (running / totalVendorAmount) * 360;
          return `${vendor.color} ${start}deg ${end}deg`;
        });
        return `conic-gradient(${segments.join(", ")})`;
      })()
    : "conic-gradient(var(--border-soft) 0deg 360deg)";

  if (viewState === "loading") {
    return (
      <section className="dashboard-page">
        <h2>Dashboard</h2>
        <PageState title="Loading dashboard" description="Fetching dashboard metrics and workflow summaries." />
      </section>
    );
  }

  if (viewState === "error") {
    return (
      <section className="dashboard-page">
        <h2>Dashboard</h2>
        <PageState
          title="Dashboard unavailable"
          description={errorMessage}
          actionLabel="Retry"
          onAction={loadDashboard}
          tone="error"
        />
      </section>
    );
  }

  if (!hasContent) {
    return (
      <section className="dashboard-page">
        <h2>Dashboard</h2>
        <PageState
          title="No dashboard data"
          description="There are no invoice metrics to display for the selected period yet."
          actionLabel="Refresh"
          onAction={loadDashboard}
        />
      </section>
    );
  }

  return (
    <section className="dashboard-page">
      <h2>Dashboard</h2>

      <div className="dashboard-metrics">
        {metrics.map((metric) => (
          <article className="card metric-card" key={metric.label}>
            <p>{metric.label}</p>
            <h3>{metric.value}</h3>
            <span style={{ background: metric.color }} />
          </article>
        ))}
      </div>

      <div className="dashboard-filters card">
        <select defaultValue="all" aria-label="Invoice type filter">
          <option value="all">All</option>
          <option value="purchase">Purchase</option>
          <option value="sales">Sales</option>
        </select>

        <select defaultValue="all-status" aria-label="Status filter">
          <option value="all-status">All Statuses</option>
          <option value="uploaded">Uploaded</option>
          <option value="pending-review">Pending Review</option>
          <option value="approved">Approved</option>
          <option value="posted">Posted</option>
          <option value="failed">Failed</option>
        </select>

        <select
          value={selectedDateRange}
          aria-label="Date range filter"
          onChange={(event) => setDateRangeScope(event.target.value)}
        >
          <option value="all-time">All Time</option>
          <option value="today">Today</option>
          <option value="this-week">This Week</option>
          <option value="this-month">This Month</option>
          <option value="this-quarter">This Quarter</option>
        </select>
      </div>

      <div className="dashboard-main-grid">
        <article className="card lifecycle-card">
          <div className="card-title-row">
            <h3>Invoice Lifecycle</h3>
          </div>

          <div className="lifecycle-track">
            {lifecycle.map((step, index) => (
              <div className="lifecycle-step" key={step.name}>
                <div className="lifecycle-node" style={{ background: step.color }} />
                <div className="lifecycle-text">
                  <p>{step.name}</p>
                  <strong>{step.count}</strong>
                </div>
                {index < lifecycle.length - 1 && <div className="lifecycle-line" />}
              </div>
            ))}
          </div>
        </article>

        <article className="card per-day-card">
          <div className="card-title-row">
            <h3>Invoice Processed Per Day</h3>
          </div>

          <div className="bar-chart">
            {perDay.map((item) => (
              <div className="bar-item" key={item.day}>
                <div
                  className="bar-fill"
                  style={{ height: `${Math.round((item.count / maxPerDay) * 100)}%` }}
                  title={`${item.day}: ${item.count}`}
                />
                <span>{item.day}</span>
              </div>
            ))}
          </div>
        </article>

        <article className="card vendors-card">
          <div className="card-title-row">
            <h3>Top Vendors This Month</h3>
          </div>

          <div className="vendors-layout">
            <div className="donut-wrap">
              <div className="donut-chart" style={{ background: donutGradient }} />
              <div className="donut-center">
                <strong>{totalVendorAmount.toLocaleString("en-IN")}</strong>
                <span>Total</span>
              </div>
            </div>

            <ul className="vendor-list">
              {vendors.map((vendor) => (
                <li key={vendor.name}>
                  <span className="vendor-dot" style={{ background: vendor.color }} />
                  <span className="vendor-name">{vendor.name}</span>
                  <strong className="vendor-amount">{vendor.amount.toLocaleString("en-IN")}</strong>
                </li>
              ))}
            </ul>
          </div>
        </article>
      </div>
    </section>
  );
}

export default DashboardPage;
