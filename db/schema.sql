CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE TABLE agents(id text PRIMARY KEY,name text NOT NULL,description text NOT NULL DEFAULT '',capabilities jsonb NOT NULL DEFAULT '[]',protocols jsonb NOT NULL DEFAULT '[]',endpoints jsonb NOT NULL DEFAULT '[]',pricing jsonb NOT NULL DEFAULT '{"mode":"free"}',availability boolean NOT NULL DEFAULT true,verified boolean NOT NULL DEFAULT false,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE tasks(id text PRIMARY KEY,title text NOT NULL,description text NOT NULL DEFAULT '',requester_agent_id text REFERENCES agents(id) ON DELETE SET NULL,provider_agent_id text REFERENCES agents(id) ON DELETE SET NULL,required_capabilities jsonb NOT NULL DEFAULT '[]',preferred_protocols jsonb NOT NULL DEFAULT '[]',budget numeric(18,2),currency varchar(8) NOT NULL DEFAULT 'USD',status text NOT NULL CHECK(status IN('open','accepted','working','delivered','completed','disputed','cancelled')),artifact jsonb,artifact_digest text,delivery_note text,dispute_reason text,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),accepted_at timestamptz,started_at timestamptz,delivered_at timestamptz,completed_at timestamptz,CHECK(requester_agent_id IS NULL OR requester_agent_id IS DISTINCT FROM provider_agent_id));
CREATE TABLE task_messages(id text PRIMARY KEY,task_id text NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,from_agent_id text REFERENCES agents(id) ON DELETE SET NULL,to_agent_id text REFERENCES agents(id) ON DELETE SET NULL,type text NOT NULL CHECK(type IN('note','question','answer','system')),body text NOT NULL,created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE reviews(id text PRIMARY KEY,agent_id text NOT NULL REFERENCES agents(id) ON DELETE CASCADE,task_id text NOT NULL UNIQUE REFERENCES tasks(id) ON DELETE CASCADE,rating smallint NOT NULL CHECK(rating BETWEEN 1 AND 5),comment text NOT NULL DEFAULT '',created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE audit_events(id text PRIMARY KEY,event_type text NOT NULL,detail jsonb NOT NULL DEFAULT '{}',created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX tasks_status_created_idx ON tasks(status,created_at DESC);CREATE INDEX tasks_provider_idx ON tasks(provider_agent_id);CREATE INDEX task_messages_task_created_idx ON task_messages(task_id,created_at);CREATE INDEX audit_events_created_idx ON audit_events(created_at DESC);

CREATE TABLE marketplace_events(
  id text PRIMARY KEY,
  event_type text NOT NULL,
  source text NOT NULL DEFAULT 'direct',
  agent_id text REFERENCES agents(id) ON DELETE SET NULL,
  task_id text REFERENCES tasks(id) ON DELETE SET NULL,
  detail jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX marketplace_events_type_created_idx ON marketplace_events(event_type,created_at DESC);
CREATE INDEX marketplace_events_source_created_idx ON marketplace_events(source,created_at DESC);

CREATE TABLE marketplace_daily_counters(
  day date NOT NULL,
  metric text NOT NULL,
  source text NOT NULL DEFAULT 'all',
  count bigint NOT NULL DEFAULT 0 CHECK(count>=0),
  PRIMARY KEY(day,metric,source)
);
CREATE INDEX marketplace_daily_counters_metric_day_idx ON marketplace_daily_counters(metric,day DESC);

CREATE TABLE idempotency_records(
  scope text NOT NULL,
  idempotency_key_hash text NOT NULL,
  request_hash text NOT NULL,
  response_status integer NOT NULL,
  response_body jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  PRIMARY KEY(scope,idempotency_key_hash)
);
CREATE INDEX idempotency_records_expiry_idx ON idempotency_records(expires_at);

CREATE TABLE agent_credentials(
  id text PRIMARY KEY,
  agent_id text NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  key_hash text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);
CREATE INDEX agent_credentials_agent_idx ON agent_credentials(agent_id) WHERE revoked_at IS NULL;

CREATE TABLE agent_verification_challenges(
  id text PRIMARY KEY,
  agent_id text NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  endpoint_url text NOT NULL,
  verification_url text NOT NULL,
  token_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  completed_at timestamptz
);
CREATE INDEX agent_verification_challenges_agent_idx ON agent_verification_challenges(agent_id,created_at DESC);

-- Payment foundation. RelayMarket fee is 1% (100 basis points).
CREATE TABLE payments(
  id text PRIMARY KEY,
  task_id text NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  requester_agent_id text REFERENCES agents(id) ON DELETE SET NULL,
  provider_agent_id text REFERENCES agents(id) ON DELETE SET NULL,
  provider text NOT NULL DEFAULT 'disabled' CHECK(provider IN('mock','stripe','disabled')),
  provider_reference text,
  transfer_reference text,
  refund_reference text,
  amount_minor bigint NOT NULL CHECK(amount_minor > 0),
  platform_fee_bps integer NOT NULL DEFAULT 100 CHECK(platform_fee_bps BETWEEN 0 AND 10000),
  platform_fee_minor bigint NOT NULL CHECK(platform_fee_minor >= 0),
  payer_total_minor bigint NOT NULL CHECK(payer_total_minor = amount_minor + platform_fee_minor),
  currency varchar(3) NOT NULL,
  status text NOT NULL DEFAULT 'created' CHECK(status IN('created','funded','held','released','refunded','failed','cancelled')),
  event_source text NOT NULL DEFAULT 'direct',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  funded_at timestamptz,
  held_at timestamptz,
  released_at timestamptz,
  refunded_at timestamptz,
  failed_at timestamptz,
  cancelled_at timestamptz
);
CREATE UNIQUE INDEX payments_one_active_per_task_idx ON payments(task_id) WHERE status NOT IN('failed','cancelled','refunded');
CREATE INDEX payments_status_created_idx ON payments(status,created_at DESC);
CREATE INDEX payments_requester_idx ON payments(requester_agent_id,status);
CREATE INDEX payments_provider_idx ON payments(provider_agent_id,status);

CREATE UNIQUE INDEX payments_transfer_reference_idx ON payments(transfer_reference) WHERE transfer_reference IS NOT NULL;
CREATE UNIQUE INDEX payments_refund_reference_idx ON payments(refund_reference) WHERE refund_reference IS NOT NULL;

CREATE TABLE agent_payout_accounts(
  id text PRIMARY KEY,
  agent_id text NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  provider text NOT NULL CHECK(provider='stripe'),
  external_account_id text NOT NULL UNIQUE,
  country varchar(2),
  charges_enabled boolean NOT NULL DEFAULT false,
  payouts_enabled boolean NOT NULL DEFAULT false,
  details_submitted boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(agent_id,provider)
);
CREATE INDEX agent_payout_accounts_agent_idx ON agent_payout_accounts(agent_id,provider);


CREATE TABLE provider_webhook_events(
  provider text NOT NULL,
  event_id text NOT NULL,
  event_type text NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(provider,event_id)
);
CREATE INDEX provider_webhook_events_received_idx ON provider_webhook_events(provider,received_at DESC);
