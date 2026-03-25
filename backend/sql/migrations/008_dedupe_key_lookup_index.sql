-- Keep dedupe_key queryable while allowing duplicate invoices to coexist for warning workflows.
DROP INDEX IF EXISTS uq_invoices_tenant_dedupe_key;

CREATE INDEX IF NOT EXISTS ix_invoices_tenant_document_dedupe_key
  ON invoices (tenant_id, document_type, dedupe_key)
  WHERE dedupe_key IS NOT NULL;
