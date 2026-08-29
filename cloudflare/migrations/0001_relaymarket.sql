PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS agents(
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  capabilities_json TEXT NOT NULL DEFAULT '[]',
  protocols_json TEXT NOT NULL DEFAULT '[]',
  endpoints_json TEXT NOT NULL DEFAULT '[]',
  pricing_json TEXT NOT NULL DEFAULT '{"mode":"free"}',
  availability INTEGER NOT NULL DEFAULT 1 CHECK(availability IN(0,1)),
  verified INTEGER NOT NULL DEFAULT 0 CHECK(verified IN(0,1)),
  verified_at TEXT,
  event_source TEXT NOT NULL DEFAULT 'direct',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tasks(
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  requester_agent_id TEXT REFERENCES agents(id) ON DELETE SET NULL,
  provider_agent_id TEXT REFERENCES agents(id) ON DELETE SET NULL,
  required_capabilities_json TEXT NOT NULL DEFAULT '[]',
  preferred_protocols_json TEXT NOT NULL DEFAULT '[]',
  budget REAL,
  currency TEXT NOT NULL DEFAULT 'USD',
  status TEXT NOT NULL CHECK(status IN('open','accepted','working','delivered','completed','disputed','cancelled')),
  artifact_json TEXT,
  artifact_digest TEXT,
  delivery_note TEXT,
  dispute_reason TEXT,
  event_source TEXT NOT NULL DEFAULT 'direct',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  accepted_at TEXT,
  started_at TEXT,
  delivered_at TEXT,
  completed_at TEXT,
  CHECK(requester_agent_id IS NULL OR requester_agent_id <> provider_agent_id)
);

CREATE TABLE IF NOT EXISTS task_messages(
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  from_agent_id TEXT REFERENCES agents(id) ON DELETE SET NULL,
  to_agent_id TEXT REFERENCES agents(id) ON DELETE SET NULL,
  type TEXT NOT NULL CHECK(type IN('note','question','answer','system')),
  body TEXT NOT NULL,
  event_source TEXT NOT NULL DEFAULT 'direct',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS reviews(
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  task_id TEXT NOT NULL UNIQUE REFERENCES tasks(id) ON DELETE CASCADE,
  rating INTEGER NOT NULL CHECK(rating BETWEEN 1 AND 5),
  comment TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS marketplace_events(
  id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'direct',
  agent_id TEXT REFERENCES agents(id) ON DELETE SET NULL,
  task_id TEXT REFERENCES tasks(id) ON DELETE SET NULL,
  detail_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS marketplace_daily_counters(
  day TEXT NOT NULL,
  metric TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'all',
  count INTEGER NOT NULL DEFAULT 0 CHECK(count>=0),
  PRIMARY KEY(day,metric,source)
);

CREATE TABLE IF NOT EXISTS idempotency_records(
  scope TEXT NOT NULL,
  idempotency_key_hash TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'pending' CHECK(state IN('pending','complete')),
  response_status INTEGER,
  response_body_json TEXT,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  PRIMARY KEY(scope,idempotency_key_hash)
);

CREATE TABLE IF NOT EXISTS agent_credentials(
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  key_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  last_used_at TEXT,
  revoked_at TEXT,
  revocation_reason TEXT CHECK(revocation_reason IS NULL OR revocation_reason IN('rotated','revoked'))
);

CREATE TABLE IF NOT EXISTS agent_verification_challenges(
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  endpoint_url TEXT NOT NULL,
  verification_url TEXT NOT NULL,
  token_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  completed_at TEXT,
  event_source TEXT NOT NULL DEFAULT 'direct'
);

CREATE INDEX IF NOT EXISTS agents_availability_updated_idx ON agents(availability,updated_at DESC);
CREATE INDEX IF NOT EXISTS tasks_status_created_idx ON tasks(status,created_at DESC);
CREATE INDEX IF NOT EXISTS tasks_provider_idx ON tasks(provider_agent_id,status);
CREATE INDEX IF NOT EXISTS tasks_requester_idx ON tasks(requester_agent_id,status);
CREATE INDEX IF NOT EXISTS task_messages_task_created_idx ON task_messages(task_id,created_at);
CREATE INDEX IF NOT EXISTS marketplace_events_type_created_idx ON marketplace_events(event_type,created_at DESC);
CREATE INDEX IF NOT EXISTS marketplace_events_source_created_idx ON marketplace_events(source,created_at DESC);
CREATE INDEX IF NOT EXISTS marketplace_daily_counters_metric_day_idx ON marketplace_daily_counters(metric,day DESC);
CREATE INDEX IF NOT EXISTS idempotency_records_expiry_idx ON idempotency_records(expires_at);
CREATE INDEX IF NOT EXISTS agent_credentials_agent_idx ON agent_credentials(agent_id,revoked_at);
CREATE INDEX IF NOT EXISTS agent_verification_challenges_agent_idx ON agent_verification_challenges(agent_id,created_at DESC);

-- Business-event triggers make state changes and lifecycle counters atomic.
CREATE TRIGGER IF NOT EXISTS trg_agent_registered AFTER INSERT ON agents
BEGIN
  INSERT INTO marketplace_events(id,event_type,source,agent_id,detail_json,created_at)
    VALUES('evt_'||lower(hex(randomblob(16))),'agent.registered',NEW.event_source,NEW.id,'{}',NEW.created_at);
  INSERT INTO marketplace_daily_counters(day,metric,source,count) VALUES(substr(NEW.created_at,1,10),'agent.registered','all',1)
    ON CONFLICT(day,metric,source) DO UPDATE SET count=count+1;
  INSERT INTO marketplace_daily_counters(day,metric,source,count) VALUES(substr(NEW.created_at,1,10),'agent.registered',NEW.event_source,1)
    ON CONFLICT(day,metric,source) DO UPDATE SET count=count+1;
END;

CREATE TRIGGER IF NOT EXISTS trg_task_created AFTER INSERT ON tasks
BEGIN
  INSERT INTO marketplace_events(id,event_type,source,agent_id,task_id,detail_json,created_at)
    VALUES('evt_'||lower(hex(randomblob(16))),'task.created',NEW.event_source,NEW.requester_agent_id,NEW.id,'{}',NEW.created_at);
  INSERT INTO marketplace_daily_counters(day,metric,source,count) VALUES(substr(NEW.created_at,1,10),'task.created','all',1)
    ON CONFLICT(day,metric,source) DO UPDATE SET count=count+1;
  INSERT INTO marketplace_daily_counters(day,metric,source,count) VALUES(substr(NEW.created_at,1,10),'task.created',NEW.event_source,1)
    ON CONFLICT(day,metric,source) DO UPDATE SET count=count+1;
END;

CREATE TRIGGER IF NOT EXISTS trg_task_status_changed AFTER UPDATE OF status ON tasks
WHEN OLD.status <> NEW.status
BEGIN
  INSERT INTO marketplace_events(id,event_type,source,agent_id,task_id,detail_json,created_at)
    VALUES(
      'evt_'||lower(hex(randomblob(16))),
      CASE NEW.status WHEN 'working' THEN 'task.started' ELSE 'task.'||NEW.status END,
      NEW.event_source,
      COALESCE(NEW.provider_agent_id,NEW.requester_agent_id),
      NEW.id,
      json_object('from',OLD.status,'to',NEW.status),
      NEW.updated_at
    );
  INSERT INTO marketplace_daily_counters(day,metric,source,count)
    VALUES(substr(NEW.updated_at,1,10),CASE NEW.status WHEN 'working' THEN 'task.started' ELSE 'task.'||NEW.status END,'all',1)
    ON CONFLICT(day,metric,source) DO UPDATE SET count=count+1;
  INSERT INTO marketplace_daily_counters(day,metric,source,count)
    VALUES(substr(NEW.updated_at,1,10),CASE NEW.status WHEN 'working' THEN 'task.started' ELSE 'task.'||NEW.status END,NEW.event_source,1)
    ON CONFLICT(day,metric,source) DO UPDATE SET count=count+1;

  INSERT INTO marketplace_events(id,event_type,source,agent_id,task_id,detail_json,created_at)
    SELECT 'evt_'||lower(hex(randomblob(16))),'provider.repeat_completion',NEW.event_source,NEW.provider_agent_id,NEW.id,'{}',NEW.updated_at
    WHERE NEW.status='completed' AND NEW.provider_agent_id IS NOT NULL
      AND (SELECT COUNT(*) FROM tasks WHERE provider_agent_id=NEW.provider_agent_id AND status='completed') > 1;
  INSERT INTO marketplace_daily_counters(day,metric,source,count)
    SELECT substr(NEW.updated_at,1,10),'provider.repeat_completion','all',1
    WHERE NEW.status='completed' AND NEW.provider_agent_id IS NOT NULL
      AND (SELECT COUNT(*) FROM tasks WHERE provider_agent_id=NEW.provider_agent_id AND status='completed') > 1
    ON CONFLICT(day,metric,source) DO UPDATE SET count=count+1;
  INSERT INTO marketplace_daily_counters(day,metric,source,count)
    SELECT substr(NEW.updated_at,1,10),'provider.repeat_completion',NEW.event_source,1
    WHERE NEW.status='completed' AND NEW.provider_agent_id IS NOT NULL
      AND (SELECT COUNT(*) FROM tasks WHERE provider_agent_id=NEW.provider_agent_id AND status='completed') > 1
    ON CONFLICT(day,metric,source) DO UPDATE SET count=count+1;
END;

CREATE TRIGGER IF NOT EXISTS trg_task_message AFTER INSERT ON task_messages
BEGIN
  INSERT INTO marketplace_events(id,event_type,source,agent_id,task_id,detail_json,created_at)
    VALUES('evt_'||lower(hex(randomblob(16))),'task.message',NEW.event_source,NEW.from_agent_id,NEW.task_id,'{}',NEW.created_at);
  INSERT INTO marketplace_daily_counters(day,metric,source,count) VALUES(substr(NEW.created_at,1,10),'task.message','all',1)
    ON CONFLICT(day,metric,source) DO UPDATE SET count=count+1;
  INSERT INTO marketplace_daily_counters(day,metric,source,count) VALUES(substr(NEW.created_at,1,10),'task.message',NEW.event_source,1)
    ON CONFLICT(day,metric,source) DO UPDATE SET count=count+1;
END;


CREATE TRIGGER IF NOT EXISTS trg_credential_issued AFTER INSERT ON agent_credentials
BEGIN
  INSERT INTO marketplace_events(id,event_type,source,agent_id,detail_json,created_at)
    VALUES('evt_'||lower(hex(randomblob(16))),'agent.credential_issued','system',NEW.agent_id,json_object('credentialId',NEW.id),NEW.created_at);
  INSERT INTO marketplace_daily_counters(day,metric,source,count) VALUES(substr(NEW.created_at,1,10),'agent.credential_issued','all',1)
    ON CONFLICT(day,metric,source) DO UPDATE SET count=count+1;
  INSERT INTO marketplace_daily_counters(day,metric,source,count) VALUES(substr(NEW.created_at,1,10),'agent.credential_issued','system',1)
    ON CONFLICT(day,metric,source) DO UPDATE SET count=count+1;
END;

CREATE TRIGGER IF NOT EXISTS trg_credential_revoked AFTER UPDATE OF revoked_at ON agent_credentials
WHEN OLD.revoked_at IS NULL AND NEW.revoked_at IS NOT NULL
BEGIN
  INSERT INTO marketplace_events(id,event_type,source,agent_id,detail_json,created_at)
    VALUES(
      'evt_'||lower(hex(randomblob(16))),
      CASE NEW.revocation_reason WHEN 'rotated' THEN 'agent.credential_rotated' ELSE 'agent.credential_revoked' END,
      'system',NEW.agent_id,json_object('credentialId',NEW.id),NEW.revoked_at
    );
  INSERT INTO marketplace_daily_counters(day,metric,source,count)
    VALUES(substr(NEW.revoked_at,1,10),CASE NEW.revocation_reason WHEN 'rotated' THEN 'agent.credential_rotated' ELSE 'agent.credential_revoked' END,'all',1)
    ON CONFLICT(day,metric,source) DO UPDATE SET count=count+1;
  INSERT INTO marketplace_daily_counters(day,metric,source,count)
    VALUES(substr(NEW.revoked_at,1,10),CASE NEW.revocation_reason WHEN 'rotated' THEN 'agent.credential_rotated' ELSE 'agent.credential_revoked' END,'system',1)
    ON CONFLICT(day,metric,source) DO UPDATE SET count=count+1;
END;

CREATE TRIGGER IF NOT EXISTS trg_verification_challenge_created AFTER INSERT ON agent_verification_challenges
BEGIN
  INSERT INTO marketplace_events(id,event_type,source,agent_id,detail_json,created_at)
    VALUES('evt_'||lower(hex(randomblob(16))),'agent.verification_challenge_created',NEW.event_source,NEW.agent_id,json_object('challengeId',NEW.id),NEW.created_at);
  INSERT INTO marketplace_daily_counters(day,metric,source,count) VALUES(substr(NEW.created_at,1,10),'agent.verification_challenge_created','all',1)
    ON CONFLICT(day,metric,source) DO UPDATE SET count=count+1;
  INSERT INTO marketplace_daily_counters(day,metric,source,count) VALUES(substr(NEW.created_at,1,10),'agent.verification_challenge_created',NEW.event_source,1)
    ON CONFLICT(day,metric,source) DO UPDATE SET count=count+1;
END;

CREATE TRIGGER IF NOT EXISTS trg_agent_endpoint_verified AFTER UPDATE OF verified ON agents
WHEN OLD.verified=0 AND NEW.verified=1
BEGIN
  INSERT INTO marketplace_events(id,event_type,source,agent_id,detail_json,created_at)
    VALUES('evt_'||lower(hex(randomblob(16))),'agent.endpoint_verified',NEW.event_source,NEW.id,'{}',NEW.updated_at);
  INSERT INTO marketplace_daily_counters(day,metric,source,count) VALUES(substr(NEW.updated_at,1,10),'agent.endpoint_verified','all',1)
    ON CONFLICT(day,metric,source) DO UPDATE SET count=count+1;
  INSERT INTO marketplace_daily_counters(day,metric,source,count) VALUES(substr(NEW.updated_at,1,10),'agent.endpoint_verified',NEW.event_source,1)
    ON CONFLICT(day,metric,source) DO UPDATE SET count=count+1;
END;
