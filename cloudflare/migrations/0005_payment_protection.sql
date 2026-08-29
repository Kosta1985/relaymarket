PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS payment_protection_cases(
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL UNIQUE REFERENCES tasks(id) ON DELETE CASCADE,
  payment_id TEXT REFERENCES payments(id) ON DELETE SET NULL,
  opened_by_agent_id TEXT REFERENCES agents(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK(status IN('open','evidence','review','resolved_release','resolved_refund','closed')),
  reason TEXT NOT NULL,
  snapshot_json TEXT NOT NULL DEFAULT '{}',
  resolution_note TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  resolved_at TEXT
);

CREATE TABLE IF NOT EXISTS payment_protection_evidence(
  id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL REFERENCES payment_protection_cases(id) ON DELETE CASCADE,
  actor_agent_id TEXT REFERENCES agents(id) ON DELETE SET NULL,
  evidence_type TEXT NOT NULL CHECK(evidence_type IN('note','artifact_reference','message_reference','external_reference')),
  content_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS protection_cases_status_idx ON payment_protection_cases(status,created_at DESC);
CREATE INDEX IF NOT EXISTS protection_cases_payment_idx ON payment_protection_cases(payment_id,status);
CREATE INDEX IF NOT EXISTS protection_evidence_case_idx ON payment_protection_evidence(case_id,created_at ASC);

CREATE TRIGGER IF NOT EXISTS trg_protection_case_created AFTER INSERT ON payment_protection_cases
BEGIN
  INSERT INTO marketplace_events(id,event_type,source,agent_id,task_id,detail_json,created_at)
    VALUES('evt_'||lower(hex(randomblob(16))),'protection.case_opened','system',NEW.opened_by_agent_id,NEW.task_id,json_object('caseId',NEW.id,'paymentId',NEW.payment_id),NEW.created_at);
  INSERT INTO marketplace_daily_counters(day,metric,source,count) VALUES(substr(NEW.created_at,1,10),'protection.case_opened','all',1)
    ON CONFLICT(day,metric,source) DO UPDATE SET count=count+1;
END;

CREATE TRIGGER IF NOT EXISTS trg_protection_case_resolved AFTER UPDATE OF status ON payment_protection_cases
WHEN OLD.status <> NEW.status AND NEW.status IN('resolved_release','resolved_refund','closed')
BEGIN
  INSERT INTO marketplace_events(id,event_type,source,agent_id,task_id,detail_json,created_at)
    VALUES('evt_'||lower(hex(randomblob(16))),'protection.'||NEW.status,'system',NEW.opened_by_agent_id,NEW.task_id,json_object('caseId',NEW.id,'paymentId',NEW.payment_id),NEW.updated_at);
  INSERT INTO marketplace_daily_counters(day,metric,source,count) VALUES(substr(NEW.updated_at,1,10),'protection.'||NEW.status,'all',1)
    ON CONFLICT(day,metric,source) DO UPDATE SET count=count+1;
END;
