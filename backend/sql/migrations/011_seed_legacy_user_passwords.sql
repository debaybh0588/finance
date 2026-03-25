BEGIN;

-- Seed a temporary default password for legacy users that were inserted
-- before credential verification was enforced.
--
-- Default password: ChangeMe@123
-- This update is idempotent and only affects rows with NULL password_hash.
UPDATE users
SET
  password_hash = crypt('ChangeMe@123', gen_salt('bf')),
  updated_at = NOW()
WHERE password_hash IS NULL;

COMMIT;
