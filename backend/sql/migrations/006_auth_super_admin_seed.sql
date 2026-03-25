BEGIN;

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
VALUES (
  NULL,
  NULL,
  'SUPER_ADMIN',
  'Super Admin',
  'super.admin@accountingai.local',
  '+91-9000000099',
  NULL,
  TRUE
)
ON CONFLICT ((LOWER(email))) DO NOTHING;

COMMIT;
