CREATE TABLE IF NOT EXISTS invoices (
  id BIGSERIAL PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  invoice_type TEXT NOT NULL CHECK (invoice_type IN ('purchase', 'sales')),
  invoice_number TEXT NOT NULL,
  invoice_date DATE NOT NULL,
  party_name TEXT NOT NULL,
  amount NUMERIC(14,2) NOT NULL,
  currency TEXT NOT NULL DEFAULT 'INR',
  status TEXT NOT NULL DEFAULT 'draft',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_invoices_tenant_branch_date
  ON invoices (tenant_id, branch_id, invoice_date DESC);
