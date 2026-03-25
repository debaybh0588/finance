BEGIN;

INSERT INTO tenants (
  tenant_code,
  tenant_name,
  contact_person,
  contact_email,
  contact_phone,
  is_active,
  timezone
)
VALUES (
  'tenant_demo',
  'Tenant Demo',
  'Rohit Sharma',
  'admin@tenantdemo.local',
  '+91-9876543210',
  TRUE,
  'Asia/Kolkata'
)
ON CONFLICT (tenant_code) DO NOTHING;

WITH tenant_ref AS (
  SELECT id
  FROM tenants
  WHERE tenant_code = 'tenant_demo'
)
INSERT INTO branches (
  tenant_id,
  branch_code,
  branch_name,
  branch_gstin,
  branch_address,
  is_default,
  is_active
)
SELECT tenant_ref.id, values_data.branch_code, values_data.branch_name, values_data.branch_gstin, values_data.branch_address, values_data.is_default, TRUE
FROM tenant_ref
CROSS JOIN (
  VALUES
    ('branch_main', 'Main Branch', '27ABCDE1234F1Z2', 'Mumbai Head Office', TRUE),
    ('branch_east', 'East Branch', '19ABCDE1234F1Z9', 'Kolkata East Office', FALSE)
) AS values_data(branch_code, branch_name, branch_gstin, branch_address, is_default)
ON CONFLICT (tenant_id, branch_code) DO NOTHING;

WITH tenant_ref AS (
  SELECT id
  FROM tenants
  WHERE tenant_code = 'tenant_demo'
)
INSERT INTO tenant_storage_config (
  tenant_id,
  storage_mode,
  incoming_folder,
  review_folder,
  processed_folder,
  success_folder,
  exception_folder,
  output_folder,
  allow_branch_override
)
SELECT
  tenant_ref.id,
  'LOCAL',
  '{tenant}/{branch}/incoming',
  '{tenant}/{branch}/review',
  '{tenant}/{branch}/processed',
  '{tenant}/{branch}/success',
  '{tenant}/{branch}/exception',
  '{tenant}/{branch}/output',
  TRUE
FROM tenant_ref
ON CONFLICT (tenant_id) DO NOTHING;

WITH tenant_ref AS (
  SELECT id
  FROM tenants
  WHERE tenant_code = 'tenant_demo'
)
INSERT INTO tenant_n8n_config (
  tenant_id,
  n8n_base_url,
  workflow_key_token,
  extraction_workflow_id,
  extraction_workflow_name,
  posting_workflow_id,
  posting_workflow_name,
  extraction_webhook_placeholder,
  posting_webhook_placeholder,
  is_active
)
SELECT
  tenant_ref.id,
  'http://localhost:5678',
  'demo-workflow-token',
  'extract-invoice-demo',
  'Extract Invoice Demo',
  'post-tally-demo',
  'Post Tally Demo',
  '/webhook/extract-invoice-demo',
  '/webhook/post-tally-demo',
  TRUE
FROM tenant_ref
ON CONFLICT (tenant_id) DO NOTHING;

WITH tenant_ref AS (
  SELECT id
  FROM tenants
  WHERE tenant_code = 'tenant_demo'
)
INSERT INTO tenant_tally_config (
  tenant_id,
  tally_mode,
  tally_base_url,
  company_name,
  tally_port,
  use_xml_posting,
  enable_response_logging,
  default_purchase_voucher_type,
  default_sales_voucher_type
)
SELECT
  tenant_ref.id,
  'API',
  'http://localhost',
  'Tenant Demo Books',
  9000,
  TRUE,
  TRUE,
  'Purchase',
  'Sales'
FROM tenant_ref
ON CONFLICT (tenant_id) DO NOTHING;

WITH tenant_ref AS (
  SELECT id
  FROM tenants
  WHERE tenant_code = 'tenant_demo'
), branch_ref AS (
  SELECT b.id, b.branch_code, b.tenant_id
  FROM branches b
  JOIN tenant_ref t ON t.id = b.tenant_id
)
INSERT INTO users (
  tenant_id,
  default_branch_id,
  role,
  full_name,
  email,
  phone,
  password_hash,
  is_active
)
SELECT
  branch_ref.tenant_id,
  branch_ref.id,
  values_data.role::user_role_enum,
  values_data.full_name,
  values_data.email,
  values_data.phone,
  NULL,
  TRUE
FROM branch_ref
JOIN (
  VALUES
    ('branch_main', 'TENANT_ADMIN', 'Tenant Admin', 'tenant.admin@tenantdemo.local', '+91-9000000001'),
    ('branch_main', 'REVIEWER', 'Invoice Reviewer', 'reviewer@tenantdemo.local', '+91-9000000002'),
    ('branch_main', 'POSTING_OPERATOR', 'Posting Operator', 'posting@tenantdemo.local', '+91-9000000003'),
    ('branch_east', 'AUDITOR', 'Regional Auditor', 'auditor.east@tenantdemo.local', '+91-9000000004')
) AS values_data(branch_code, role, full_name, email, phone)
  ON values_data.branch_code = branch_ref.branch_code
ON CONFLICT ((LOWER(email))) DO NOTHING;

COMMIT;
