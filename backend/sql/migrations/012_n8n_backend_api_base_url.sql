-- Migration 012: Add backend_api_base_url to tenant_n8n_config

ALTER TABLE tenant_n8n_config
ADD COLUMN IF NOT EXISTS backend_api_base_url text;

