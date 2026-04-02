-- DB-backed extraction dispatch queue for n8n webhook fan-out control.
CREATE TABLE IF NOT EXISTS extraction_dispatch_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  branch_id UUID NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  invoice_id UUID NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'PROCESSING', 'DISPATCHED', 'FAILED')),
  attempt_count INTEGER NOT NULL DEFAULT 0,
  available_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  locked_at TIMESTAMPTZ,
  dispatched_at TIMESTAMPTZ,
  last_http_status INTEGER,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (invoice_id)
);

CREATE INDEX IF NOT EXISTS idx_extraction_dispatch_queue_pending
  ON extraction_dispatch_queue (status, available_at, created_at);

CREATE INDEX IF NOT EXISTS idx_extraction_dispatch_queue_tenant_pending
  ON extraction_dispatch_queue (tenant_id, status, available_at);
