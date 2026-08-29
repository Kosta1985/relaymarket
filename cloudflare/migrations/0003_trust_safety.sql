PRAGMA foreign_keys = ON;

ALTER TABLE agents ADD COLUMN operator_id TEXT;
ALTER TABLE agents ADD COLUMN trust_status TEXT NOT NULL DEFAULT 'unverified' CHECK(trust_status IN('unverified','basic','verified','restricted','suspended'));

CREATE TABLE IF NOT EXISTS operators(
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL DEFAULT 'business' CHECK(kind IN('individual','business')),
  country TEXT NOT NULL DEFAULT 'AU',
  legal_name TEXT,
  business_identifier_type TEXT CHECK(business_identifier_type IS NULL OR business_identifier_type IN('ABN','ACN','OTHER')),
  business_identifier_last4 TEXT,
  identity_provider TEXT,
  identity_reference_hash TEXT,
  identity_verified_at TEXT,
  business_verified_at TEXT,
  sanctions_status TEXT NOT NULL DEFAULT 'not_screened' CHECK(sanctions_status IN('not_screened','clear','review','blocked')),
  risk_level TEXT NOT NULL DEFAULT 'normal' CHECK(risk_level IN('normal','monitor','hold','review','blocked')),
  risk_score INTEGER NOT NULL DEFAULT 0 CHECK(risk_score BETWEEN 0 AND 100),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS operator_agents(
  operator_id TEXT NOT NULL REFERENCES operators(id) ON DELETE CASCADE,
  agent_id TEXT NOT NULL UNIQUE REFERENCES agents(id) ON DELETE CASCADE,
  linked_at TEXT NOT NULL,
  PRIMARY KEY(operator_id,agent_id)
);

CREATE TABLE IF NOT EXISTS verification_checks(
  id TEXT PRIMARY KEY,
  operator_id TEXT NOT NULL REFERENCES operators(id) ON DELETE CASCADE,
  check_type TEXT NOT NULL CHECK(check_type IN('identity','business','beneficial_owner','sanctions','payment_provider')),
  provider TEXT NOT NULL,
  provider_reference_hash TEXT,
  status TEXT NOT NULL CHECK(status IN('pending','verified','failed','review','expired')),
  evidence_json TEXT NOT NULL DEFAULT '{}',
  checked_at TEXT NOT NULL,
  expires_at TEXT
);

CREATE TABLE IF NOT EXISTS risk_signals(
  id TEXT PRIMARY KEY,
  operator_id TEXT REFERENCES operators(id) ON DELETE CASCADE,
  agent_id TEXT REFERENCES agents(id) ON DELETE CASCADE,
  task_id TEXT REFERENCES tasks(id) ON DELETE CASCADE,
  signal_type TEXT NOT NULL,
  severity INTEGER NOT NULL CHECK(severity BETWEEN 1 AND 100),
  status TEXT NOT NULL DEFAULT 'open' CHECK(status IN('open','cleared','confirmed')),
  evidence_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  resolved_at TEXT
);

CREATE TABLE IF NOT EXISTS trust_cases(
  id TEXT PRIMARY KEY,
  case_type TEXT NOT NULL CHECK(case_type IN('fraud','scam','review_manipulation','identity','payment','other')),
  operator_id TEXT REFERENCES operators(id) ON DELETE SET NULL,
  agent_id TEXT REFERENCES agents(id) ON DELETE SET NULL,
  task_id TEXT REFERENCES tasks(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK(status IN('open','investigating','actioned','cleared','appealed','closed')),
  reason TEXT NOT NULL,
  evidence_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS moderation_actions(
  id TEXT PRIMARY KEY,
  case_id TEXT REFERENCES trust_cases(id) ON DELETE SET NULL,
  operator_id TEXT REFERENCES operators(id) ON DELETE SET NULL,
  agent_id TEXT REFERENCES agents(id) ON DELETE SET NULL,
  action_type TEXT NOT NULL CHECK(action_type IN('warn','reputation_hold','payment_hold','restrict','suspend','restore')),
  reason TEXT NOT NULL,
  starts_at TEXT NOT NULL,
  ends_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS appeals(
  id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL REFERENCES trust_cases(id) ON DELETE CASCADE,
  appellant_operator_id TEXT REFERENCES operators(id) ON DELETE SET NULL,
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK(status IN('open','upheld','overturned','partially_upheld')),
  created_at TEXT NOT NULL,
  decided_at TEXT
);

CREATE TABLE IF NOT EXISTS security_audit_log(
  id TEXT PRIMARY KEY,
  actor_type TEXT NOT NULL CHECK(actor_type IN('agent','operator','system','admin')),
  actor_id TEXT,
  action TEXT NOT NULL,
  target_type TEXT,
  target_id TEXT,
  detail_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS agents_operator_idx ON agents(operator_id);
CREATE INDEX IF NOT EXISTS risk_signals_task_idx ON risk_signals(task_id,status,severity DESC);
CREATE INDEX IF NOT EXISTS risk_signals_operator_idx ON risk_signals(operator_id,status,severity DESC);
CREATE INDEX IF NOT EXISTS trust_cases_status_idx ON trust_cases(status,created_at DESC);
CREATE INDEX IF NOT EXISTS verification_checks_operator_idx ON verification_checks(operator_id,check_type,checked_at DESC);
CREATE INDEX IF NOT EXISTS security_audit_created_idx ON security_audit_log(created_at DESC);

-- Reviews remain tied to completed marketplace tasks. This trigger prevents a review
-- from existing unless the reviewed agent actually provided the completed task.
CREATE TRIGGER IF NOT EXISTS trg_review_verified_transaction
BEFORE INSERT ON reviews
WHEN NOT EXISTS (
  SELECT 1
  FROM tasks t
  WHERE t.id = NEW.task_id
    AND t.provider_agent_id = NEW.agent_id
    AND t.status = 'completed'
)
BEGIN
  SELECT RAISE(ABORT, 'review_requires_completed_marketplace_task');
END;
