-- ALTER TYPE ADD VALUE cannot run inside a transaction block; must be outside BEGIN.
ALTER TYPE business_status_enum ADD VALUE IF NOT EXISTS 'FAILED';

BEGIN;

ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS confidence_score NUMERIC(5,4),
  ADD COLUMN IF NOT EXISTS low_confidence_fields JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS extraction_warnings JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS salvaged BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS extraction_error_message TEXT;

COMMIT;