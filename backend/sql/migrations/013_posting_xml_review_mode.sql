-- 013: Posting XML review mode + draft XML lifecycle fields
-- ALTER TYPE ADD VALUE cannot run inside BEGIN/COMMIT on older PostgreSQL.
ALTER TYPE business_status_enum ADD VALUE IF NOT EXISTS 'PENDING_POSTING_REVIEW';

BEGIN;

ALTER TABLE tenant_tally_config
  ADD COLUMN IF NOT EXISTS posting_review_mode TEXT NOT NULL DEFAULT 'AUTO_POST';

ALTER TABLE tenant_tally_config DROP CONSTRAINT IF EXISTS chk_tenant_tally_posting_review_mode;
ALTER TABLE tenant_tally_config
  ADD CONSTRAINT chk_tenant_tally_posting_review_mode
  CHECK (posting_review_mode IN ('AUTO_POST', 'REVIEW_BEFORE_POSTING'));

ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS posting_request_xml TEXT,
  ADD COLUMN IF NOT EXISTS posting_request_xml_generated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS posting_request_xml_reviewed_by TEXT,
  ADD COLUMN IF NOT EXISTS posting_request_xml_reviewed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS posting_request_xml_review_notes TEXT,
  ADD COLUMN IF NOT EXISTS posting_request_xml_source JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS idx_invoices_posting_xml_review_queue
  ON invoices (tenant_id, branch_id, updated_at DESC)
  WHERE business_status = 'PENDING_POSTING_REVIEW';

COMMIT;
