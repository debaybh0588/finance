BEGIN;

-- approved_by_name: display-name for reviewer (avoids requiring a users FK at approval time)
ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS approved_by_name TEXT,
  ADD COLUMN IF NOT EXISTS posting_locked BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS posting_error_message TEXT;

-- Relax the existing approval metadata constraint so that approved_at can be set
-- when approved_by_name is provided (without needing a users-table FK entry).
ALTER TABLE invoices DROP CONSTRAINT IF EXISTS chk_invoices_approval_metadata;

ALTER TABLE invoices
  ADD CONSTRAINT chk_invoices_approval_metadata CHECK (
    approved_at IS NULL
    OR (approved_by_user_id IS NOT NULL OR approved_by_name IS NOT NULL)
  );

COMMIT;
