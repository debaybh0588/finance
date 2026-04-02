CREATE TABLE IF NOT EXISTS tenant_tally_runtime_catalog (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL UNIQUE REFERENCES tenants(id) ON DELETE CASCADE,
  source_company_name TEXT,
  tally_base_url TEXT,
  catalog JSONB NOT NULL DEFAULT '{}'::jsonb,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '1 day'),
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tenant_tally_runtime_catalog_tenant_id
  ON tenant_tally_runtime_catalog (tenant_id);

CREATE TABLE IF NOT EXISTS tenant_tally_field_mapping (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  document_type document_type_enum NOT NULL,
  source_field TEXT NOT NULL,
  target_value TEXT,
  confidence NUMERIC(6,4),
  is_user_override BOOLEAN NOT NULL DEFAULT FALSE,
  updated_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, document_type, source_field)
);

CREATE INDEX IF NOT EXISTS idx_tenant_tally_field_mapping_tenant_doc
  ON tenant_tally_field_mapping (tenant_id, document_type);

DROP TRIGGER IF EXISTS trg_tenant_tally_runtime_catalog_updated_at ON tenant_tally_runtime_catalog;
CREATE TRIGGER trg_tenant_tally_runtime_catalog_updated_at
BEFORE UPDATE ON tenant_tally_runtime_catalog
FOR EACH ROW
EXECUTE PROCEDURE set_updated_at_column();

DROP TRIGGER IF EXISTS trg_tenant_tally_field_mapping_updated_at ON tenant_tally_field_mapping;
CREATE TRIGGER trg_tenant_tally_field_mapping_updated_at
BEFORE UPDATE ON tenant_tally_field_mapping
FOR EACH ROW
EXECUTE PROCEDURE set_updated_at_column();
