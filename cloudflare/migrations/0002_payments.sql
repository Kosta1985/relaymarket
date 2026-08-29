PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS payments(
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  requester_agent_id TEXT REFERENCES agents(id) ON DELETE SET NULL,
  provider_agent_id TEXT REFERENCES agents(id) ON DELETE SET NULL,
  provider TEXT NOT NULL DEFAULT 'disabled' CHECK(provider IN('mock','stripe','disabled')),
  provider_reference TEXT,
  transfer_reference TEXT,
  refund_reference TEXT,
  amount_minor INTEGER NOT NULL CHECK(amount_minor > 0),
  platform_fee_bps INTEGER NOT NULL DEFAULT 100 CHECK(platform_fee_bps BETWEEN 0 AND 10000),
  platform_fee_minor INTEGER NOT NULL CHECK(platform_fee_minor >= 0),
  payer_total_minor INTEGER NOT NULL CHECK(payer_total_minor = amount_minor + platform_fee_minor),
  currency TEXT NOT NULL CHECK(length(currency)=3),
  status TEXT NOT NULL DEFAULT 'created' CHECK(status IN('created','funded','held','released','refunded','failed','cancelled')),
  event_source TEXT NOT NULL DEFAULT 'direct',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  funded_at TEXT,
  held_at TEXT,
  released_at TEXT,
  refunded_at TEXT,
  failed_at TEXT,
  cancelled_at TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS payments_one_active_per_task_idx
  ON payments(task_id)
  WHERE status NOT IN('failed','cancelled','refunded');
CREATE INDEX IF NOT EXISTS payments_status_created_idx ON payments(status,created_at DESC);
CREATE INDEX IF NOT EXISTS payments_requester_idx ON payments(requester_agent_id,status);
CREATE INDEX IF NOT EXISTS payments_provider_idx ON payments(provider_agent_id,status);

CREATE TRIGGER IF NOT EXISTS trg_payment_created AFTER INSERT ON payments
BEGIN
  INSERT INTO marketplace_events(id,event_type,source,agent_id,task_id,detail_json,created_at)
    VALUES('evt_'||lower(hex(randomblob(16))),'payment.created',NEW.event_source,NEW.requester_agent_id,NEW.task_id,
      json_object('paymentId',NEW.id,'amountMinor',NEW.amount_minor,'platformFeeMinor',NEW.platform_fee_minor,'currency',NEW.currency),NEW.created_at);
  INSERT INTO marketplace_daily_counters(day,metric,source,count) VALUES(substr(NEW.created_at,1,10),'payment.created','all',1)
    ON CONFLICT(day,metric,source) DO UPDATE SET count=count+1;
  INSERT INTO marketplace_daily_counters(day,metric,source,count) VALUES(substr(NEW.created_at,1,10),'payment.created',NEW.event_source,1)
    ON CONFLICT(day,metric,source) DO UPDATE SET count=count+1;
END;

CREATE TRIGGER IF NOT EXISTS trg_payment_status_changed AFTER UPDATE OF status ON payments
WHEN OLD.status <> NEW.status
BEGIN
  INSERT INTO marketplace_events(id,event_type,source,agent_id,task_id,detail_json,created_at)
    VALUES('evt_'||lower(hex(randomblob(16))),'payment.'||NEW.status,NEW.event_source,NEW.requester_agent_id,NEW.task_id,
      json_object('paymentId',NEW.id,'amountMinor',NEW.amount_minor,'platformFeeMinor',NEW.platform_fee_minor,'currency',NEW.currency),NEW.updated_at);
  INSERT INTO marketplace_daily_counters(day,metric,source,count) VALUES(substr(NEW.updated_at,1,10),'payment.'||NEW.status,'all',1)
    ON CONFLICT(day,metric,source) DO UPDATE SET count=count+1;
  INSERT INTO marketplace_daily_counters(day,metric,source,count) VALUES(substr(NEW.updated_at,1,10),'payment.'||NEW.status,NEW.event_source,1)
    ON CONFLICT(day,metric,source) DO UPDATE SET count=count+1;
END;

CREATE TABLE IF NOT EXISTS agent_payout_accounts(
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK(provider='stripe'),
  external_account_id TEXT NOT NULL UNIQUE,
  country TEXT,
  charges_enabled INTEGER NOT NULL DEFAULT 0 CHECK(charges_enabled IN(0,1)),
  payouts_enabled INTEGER NOT NULL DEFAULT 0 CHECK(payouts_enabled IN(0,1)),
  details_submitted INTEGER NOT NULL DEFAULT 0 CHECK(details_submitted IN(0,1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(agent_id,provider)
);
CREATE INDEX IF NOT EXISTS agent_payout_accounts_agent_idx ON agent_payout_accounts(agent_id,provider);


CREATE TABLE IF NOT EXISTS provider_webhook_events(
  provider TEXT NOT NULL,
  event_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  received_at TEXT NOT NULL,
  PRIMARY KEY(provider,event_id)
);
CREATE INDEX IF NOT EXISTS provider_webhook_events_received_idx ON provider_webhook_events(provider,received_at DESC);
