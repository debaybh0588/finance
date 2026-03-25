-- Migration 010: Add n8n_root_folder to tenant_n8n_config
-- This stores the base folder path that n8n uses as its working root
-- (e.g. C:\n8n\data or /home/n8n/data) — passed to the extraction webhook
-- so n8n knows where to read files from the local filesystem.

ALTER TABLE tenant_n8n_config
  ADD COLUMN IF NOT EXISTS n8n_root_folder TEXT;
