PRAGMA foreign_keys = ON;

ALTER TABLE operators ADD COLUMN business_identifier_hash TEXT;
ALTER TABLE operators ADD COLUMN identity_verification_expires_at TEXT;
ALTER TABLE operators ADD COLUMN business_verification_expires_at TEXT;
ALTER TABLE operators ADD COLUMN operator_verified_at TEXT;
ALTER TABLE operators ADD COLUMN operator_verification_expires_at TEXT;
ALTER TABLE operators ADD COLUMN verification_policy_version TEXT NOT NULL DEFAULT 'au-v1';

CREATE INDEX IF NOT EXISTS operators_verified_idx
  ON operators(operator_verified_at, operator_verification_expires_at);

CREATE INDEX IF NOT EXISTS verification_checks_expiry_idx
  ON verification_checks(operator_id, check_type, status, expires_at);
