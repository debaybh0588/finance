BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$
BEGIN
  CREATE TYPE document_type_enum AS ENUM ('PURCHASE_INVOICE', 'SALES_INVOICE');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE business_status_enum AS ENUM (
    'UPLOADED',
    'EXTRACTING',
    'PENDING_REVIEW',
    'APPROVED',
    'REJECTED',
    'NEEDS_CORRECTION',
    'READY_FOR_POSTING',
    'POSTING',
    'POSTED',
    'POST_FAILED'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE extraction_status_enum AS ENUM (
    'NOT_STARTED',
    'IN_PROGRESS',
    'SUCCESS',
    'PARTIAL',
    'RETRYABLE',
    'FAILED'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE posting_status_enum AS ENUM ('NOT_STARTED', 'QUEUED', 'IN_PROGRESS', 'SUCCESS', 'FAILED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE storage_mode_enum AS ENUM ('LOCAL', 'CLOUD');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE review_action_type_enum AS ENUM (
    'REVIEW_UPDATED',
    'APPROVED',
    'REJECTED',
    'MARKED_NEEDS_CORRECTION',
    'EXTRACTION_RETRIED',
    'DUPLICATE_CONFIRMED',
    'DUPLICATE_DISMISSED',
    'COMMENT_ADDED'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE user_role_enum AS ENUM (
    'SUPER_ADMIN',
    'TENANT_ADMIN',
    'REVIEWER',
    'POSTING_OPERATOR',
    'AUDITOR'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS tenants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_code TEXT NOT NULL UNIQUE,
  tenant_name TEXT NOT NULL,
  contact_person TEXT,
  contact_email TEXT,
  contact_phone TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  timezone TEXT NOT NULL DEFAULT 'Asia/Kolkata',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS branches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  branch_code TEXT NOT NULL,
  branch_name TEXT NOT NULL,
  branch_gstin TEXT,
  branch_address TEXT,
  is_default BOOLEAN NOT NULL DEFAULT FALSE,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, branch_code),
  UNIQUE (id, tenant_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_branches_default_per_tenant
  ON branches (tenant_id)
  WHERE is_default = TRUE;

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES tenants(id) ON DELETE SET NULL,
  default_branch_id UUID,
  role user_role_enum NOT NULL DEFAULT 'REVIEWER',
  full_name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT,
  password_hash TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT fk_users_default_branch
    FOREIGN KEY (default_branch_id, tenant_id)
    REFERENCES branches(id, tenant_id)
    ON DELETE SET NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_users_email_lower ON users ((LOWER(email)));
CREATE INDEX IF NOT EXISTS idx_users_tenant_role ON users (tenant_id, role);

CREATE TABLE IF NOT EXISTS tenant_storage_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL UNIQUE REFERENCES tenants(id) ON DELETE CASCADE,
  storage_mode storage_mode_enum NOT NULL DEFAULT 'LOCAL',
  incoming_folder TEXT NOT NULL,
  review_folder TEXT NOT NULL,
  processed_folder TEXT NOT NULL,
  success_folder TEXT NOT NULL,
  exception_folder TEXT NOT NULL,
  output_folder TEXT NOT NULL,
  allow_branch_override BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (incoming_folder <> ''),
  CHECK (review_folder <> ''),
  CHECK (processed_folder <> ''),
  CHECK (success_folder <> ''),
  CHECK (exception_folder <> ''),
  CHECK (output_folder <> '')
);

CREATE TABLE IF NOT EXISTS branch_storage_override (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  branch_id UUID NOT NULL,
  incoming_folder TEXT,
  review_folder TEXT,
  processed_folder TEXT,
  success_folder TEXT,
  exception_folder TEXT,
  output_folder TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (branch_id),
  CONSTRAINT fk_branch_storage_override_branch
    FOREIGN KEY (branch_id, tenant_id)
    REFERENCES branches(id, tenant_id)
    ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS tenant_n8n_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL UNIQUE REFERENCES tenants(id) ON DELETE CASCADE,
  n8n_base_url TEXT,
  workflow_key_token TEXT,
  extraction_workflow_id TEXT,
  extraction_workflow_name TEXT,
  posting_workflow_id TEXT,
  posting_workflow_name TEXT,
  extraction_webhook_placeholder TEXT,
  posting_webhook_placeholder TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS tenant_tally_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL UNIQUE REFERENCES tenants(id) ON DELETE CASCADE,
  tally_mode TEXT NOT NULL DEFAULT 'API',
  tally_base_url TEXT,
  company_name TEXT,
  tally_port INTEGER,
  use_xml_posting BOOLEAN NOT NULL DEFAULT TRUE,
  enable_response_logging BOOLEAN NOT NULL DEFAULT TRUE,
  default_purchase_voucher_type TEXT,
  default_sales_voucher_type TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (tally_mode IN ('API', 'ODBC', 'XML_GATEWAY'))
);

CREATE TABLE IF NOT EXISTS invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  branch_id UUID NOT NULL,
  document_type document_type_enum NOT NULL,
  business_status business_status_enum NOT NULL DEFAULT 'UPLOADED',
  extraction_status extraction_status_enum NOT NULL DEFAULT 'NOT_STARTED',
  retry_count INTEGER NOT NULL DEFAULT 0 CHECK (retry_count >= 0),
  posting_retry_count INTEGER NOT NULL DEFAULT 0 CHECK (posting_retry_count >= 0),
  dedupe_key TEXT,
  source_hash TEXT,
  invoice_number TEXT,
  invoice_date DATE,
  due_date DATE,
  party_name TEXT,
  party_gstin TEXT,
  party_address TEXT,
  currency TEXT NOT NULL DEFAULT 'INR',
  subtotal NUMERIC(14,2) NOT NULL DEFAULT 0,
  taxable_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  cgst_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  sgst_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  igst_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  cess_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  round_off_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  total_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  original_file_path TEXT NOT NULL,
  extracted_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  corrected_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  raw_model_output JSONB NOT NULL DEFAULT '{}'::jsonb,
  approval_required BOOLEAN NOT NULL DEFAULT TRUE,
  approved_by_user_id UUID,
  approved_at TIMESTAMPTZ,
  approval_notes TEXT,
  tally_posting_status posting_status_enum NOT NULL DEFAULT 'NOT_STARTED',
  tally_voucher_type TEXT,
  tally_voucher_number TEXT,
  tally_response_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  last_extraction_at TIMESTAMPTZ,
  last_posting_attempt_at TIMESTAMPTZ,
  created_by_user_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT fk_invoices_branch
    FOREIGN KEY (branch_id, tenant_id)
    REFERENCES branches(id, tenant_id)
    ON DELETE RESTRICT,
  CONSTRAINT fk_invoices_created_by
    FOREIGN KEY (created_by_user_id)
    REFERENCES users(id)
    ON DELETE SET NULL,
  CONSTRAINT fk_invoices_approved_by
    FOREIGN KEY (approved_by_user_id)
    REFERENCES users(id)
    ON DELETE SET NULL,
  UNIQUE (id, tenant_id),
  CONSTRAINT chk_invoices_approval_metadata
    CHECK (
      (approved_by_user_id IS NULL AND approved_at IS NULL)
      OR (approved_by_user_id IS NOT NULL AND approved_at IS NOT NULL)
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_invoices_tenant_dedupe_key
  ON invoices (tenant_id, document_type, dedupe_key)
  WHERE dedupe_key IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_invoices_tenant_source_hash
  ON invoices (tenant_id, source_hash)
  WHERE source_hash IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_invoices_tenant_branch_date
  ON invoices (tenant_id, branch_id, invoice_date DESC);

CREATE INDEX IF NOT EXISTS idx_invoices_tenant_business_status
  ON invoices (tenant_id, business_status, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_invoices_tenant_extraction_status
  ON invoices (tenant_id, extraction_status, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_invoices_tenant_posting_status
  ON invoices (tenant_id, tally_posting_status, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_invoices_party_lookup
  ON invoices (tenant_id, party_name, invoice_number);

CREATE INDEX IF NOT EXISTS idx_invoices_extracted_json_gin
  ON invoices USING GIN (extracted_json);

CREATE TABLE IF NOT EXISTS invoice_line_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  invoice_id UUID NOT NULL,
  line_no INTEGER NOT NULL CHECK (line_no > 0),
  description TEXT NOT NULL,
  hsn_sac TEXT,
  quantity NUMERIC(14,3) NOT NULL DEFAULT 0,
  uom TEXT,
  rate NUMERIC(14,2) NOT NULL DEFAULT 0,
  taxable_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  tax_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  total_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  tax_breakup_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (invoice_id, line_no),
  CONSTRAINT fk_invoice_line_items_invoice
    FOREIGN KEY (invoice_id, tenant_id)
    REFERENCES invoices(id, tenant_id)
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_invoice_line_items_invoice
  ON invoice_line_items (invoice_id, line_no);

CREATE TABLE IF NOT EXISTS invoice_hsn_tax_summary (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  invoice_id UUID NOT NULL,
  hsn_sac TEXT NOT NULL,
  taxable_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  cgst_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  sgst_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  igst_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  cess_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  total_tax_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  line_total_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (invoice_id, hsn_sac),
  CONSTRAINT fk_hsn_tax_summary_invoice
    FOREIGN KEY (invoice_id, tenant_id)
    REFERENCES invoices(id, tenant_id)
    ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS invoice_review_actions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  invoice_id UUID NOT NULL,
  action_type review_action_type_enum NOT NULL,
  action_notes TEXT,
  old_value_json JSONB,
  new_value_json JSONB,
  performed_by_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  performed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT fk_invoice_review_actions_invoice
    FOREIGN KEY (invoice_id, tenant_id)
    REFERENCES invoices(id, tenant_id)
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_invoice_review_actions_invoice_time
  ON invoice_review_actions (invoice_id, performed_at DESC);

CREATE INDEX IF NOT EXISTS idx_invoice_review_actions_actor
  ON invoice_review_actions (tenant_id, performed_by_user_id, performed_at DESC);

CREATE TABLE IF NOT EXISTS invoice_posting_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  invoice_id UUID NOT NULL,
  attempt_no INTEGER NOT NULL CHECK (attempt_no >= 1),
  posting_status posting_status_enum NOT NULL DEFAULT 'QUEUED',
  requested_by_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  approval_reference_action_id UUID NOT NULL REFERENCES invoice_review_actions(id) ON DELETE RESTRICT,
  request_reason TEXT NOT NULL DEFAULT 'Approved invoice posting request',
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  tally_voucher_type TEXT,
  tally_voucher_number TEXT,
  request_payload JSONB,
  response_payload JSONB,
  response_summary TEXT,
  error_message TEXT,
  retry_of_attempt_id UUID REFERENCES invoice_posting_attempts(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (invoice_id, attempt_no),
  CONSTRAINT fk_invoice_posting_attempts_invoice
    FOREIGN KEY (invoice_id, tenant_id)
    REFERENCES invoices(id, tenant_id)
    ON DELETE CASCADE,
  CONSTRAINT chk_posting_attempt_time_order
    CHECK (completed_at IS NULL OR started_at IS NULL OR completed_at >= started_at)
);

CREATE INDEX IF NOT EXISTS idx_invoice_posting_attempts_invoice
  ON invoice_posting_attempts (invoice_id, attempt_no DESC);

CREATE INDEX IF NOT EXISTS idx_invoice_posting_attempts_status
  ON invoice_posting_attempts (tenant_id, posting_status, created_at DESC);

CREATE TABLE IF NOT EXISTS audit_logs (
  id BIGSERIAL PRIMARY KEY,
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  branch_id UUID,
  invoice_id UUID,
  action_type TEXT NOT NULL,
  entity_type TEXT NOT NULL DEFAULT 'INVOICE',
  entity_id UUID,
  performed_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  old_value JSONB,
  new_value JSONB,
  notes TEXT,
  metadata JSONB,
  ip_address INET,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT fk_audit_logs_branch
    FOREIGN KEY (branch_id, tenant_id)
    REFERENCES branches(id, tenant_id)
    ON DELETE SET NULL,
  CONSTRAINT fk_audit_logs_invoice
    FOREIGN KEY (invoice_id, tenant_id)
    REFERENCES invoices(id, tenant_id)
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_tenant_time
  ON audit_logs (tenant_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_audit_logs_invoice_time
  ON audit_logs (invoice_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_audit_logs_action
  ON audit_logs (tenant_id, action_type, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_audit_logs_actor
  ON audit_logs (tenant_id, performed_by_user_id, created_at DESC);

CREATE OR REPLACE FUNCTION set_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_tenants_updated_at ON tenants;
CREATE TRIGGER trg_tenants_updated_at
BEFORE UPDATE ON tenants
FOR EACH ROW
EXECUTE PROCEDURE set_updated_at_column();

DROP TRIGGER IF EXISTS trg_branches_updated_at ON branches;
CREATE TRIGGER trg_branches_updated_at
BEFORE UPDATE ON branches
FOR EACH ROW
EXECUTE PROCEDURE set_updated_at_column();

DROP TRIGGER IF EXISTS trg_users_updated_at ON users;
CREATE TRIGGER trg_users_updated_at
BEFORE UPDATE ON users
FOR EACH ROW
EXECUTE PROCEDURE set_updated_at_column();

DROP TRIGGER IF EXISTS trg_tenant_storage_config_updated_at ON tenant_storage_config;
CREATE TRIGGER trg_tenant_storage_config_updated_at
BEFORE UPDATE ON tenant_storage_config
FOR EACH ROW
EXECUTE PROCEDURE set_updated_at_column();

DROP TRIGGER IF EXISTS trg_branch_storage_override_updated_at ON branch_storage_override;
CREATE TRIGGER trg_branch_storage_override_updated_at
BEFORE UPDATE ON branch_storage_override
FOR EACH ROW
EXECUTE PROCEDURE set_updated_at_column();

DROP TRIGGER IF EXISTS trg_tenant_n8n_config_updated_at ON tenant_n8n_config;
CREATE TRIGGER trg_tenant_n8n_config_updated_at
BEFORE UPDATE ON tenant_n8n_config
FOR EACH ROW
EXECUTE PROCEDURE set_updated_at_column();

DROP TRIGGER IF EXISTS trg_tenant_tally_config_updated_at ON tenant_tally_config;
CREATE TRIGGER trg_tenant_tally_config_updated_at
BEFORE UPDATE ON tenant_tally_config
FOR EACH ROW
EXECUTE PROCEDURE set_updated_at_column();

DROP TRIGGER IF EXISTS trg_invoices_updated_at ON invoices;
CREATE TRIGGER trg_invoices_updated_at
BEFORE UPDATE ON invoices
FOR EACH ROW
EXECUTE PROCEDURE set_updated_at_column();

DROP TRIGGER IF EXISTS trg_invoice_line_items_updated_at ON invoice_line_items;
CREATE TRIGGER trg_invoice_line_items_updated_at
BEFORE UPDATE ON invoice_line_items
FOR EACH ROW
EXECUTE PROCEDURE set_updated_at_column();

DROP TRIGGER IF EXISTS trg_invoice_hsn_tax_summary_updated_at ON invoice_hsn_tax_summary;
CREATE TRIGGER trg_invoice_hsn_tax_summary_updated_at
BEFORE UPDATE ON invoice_hsn_tax_summary
FOR EACH ROW
EXECUTE PROCEDURE set_updated_at_column();

DROP TRIGGER IF EXISTS trg_invoice_posting_attempts_updated_at ON invoice_posting_attempts;
CREATE TRIGGER trg_invoice_posting_attempts_updated_at
BEFORE UPDATE ON invoice_posting_attempts
FOR EACH ROW
EXECUTE PROCEDURE set_updated_at_column();

COMMIT;
