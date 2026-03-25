BEGIN;

-- ============================================================
-- 007: Canonical invoice schema normalization
--
-- 1. Renames:
--    extraction_warnings  → warnings        (canonical field)
--    approved_by_name     → approved_by     (canonical field)
--
-- 2. Adds missing canonical columns:
--    file_name            TEXT              (original upload filename)
--    mime_type            TEXT              (detected/provided MIME type)
--    posted_at            TIMESTAMPTZ       (set when status reaches POSTED)
--    tally_response_raw   JSONB             (verbatim raw Tally API response)
--
-- Note: business_status remains as-is; it is the canonical "status" field
--       and is aliased AS "status" in all read queries.
-- Note: tally_response_metadata is preserved for structured/parsed metadata.
-- ============================================================

-- Rename extraction_warnings → warnings (idempotent)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'invoices'
      AND column_name  = 'extraction_warnings'
  ) THEN
    ALTER TABLE invoices RENAME COLUMN extraction_warnings TO warnings;
  END IF;
END $$;

-- Rename approved_by_name → approved_by (idempotent)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'invoices'
      AND column_name  = 'approved_by_name'
  ) THEN
    ALTER TABLE invoices RENAME COLUMN approved_by_name TO approved_by;
  END IF;
END $$;

-- Add missing canonical columns
ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS file_name          TEXT,
  ADD COLUMN IF NOT EXISTS mime_type          TEXT,
  ADD COLUMN IF NOT EXISTS posted_at          TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS tally_response_raw JSONB NOT NULL DEFAULT '{}'::jsonb;

COMMIT;
