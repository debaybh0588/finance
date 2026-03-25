BEGIN;

ALTER TABLE invoices
  ALTER COLUMN document_type DROP NOT NULL,
  ALTER COLUMN extraction_status DROP NOT NULL;

COMMIT;
