PRAGMA foreign_keys = ON;

ALTER TABLE tasks ADD COLUMN acceptance_criteria_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE tasks ADD COLUMN selected_provider_agent_id TEXT REFERENCES agents(id) ON DELETE SET NULL;
ALTER TABLE tasks ADD COLUMN selected_at TEXT;
ALTER TABLE tasks ADD COLUMN revision_count INTEGER NOT NULL DEFAULT 0 CHECK(revision_count >= 0);
ALTER TABLE tasks ADD COLUMN revision_requested_at TEXT;
ALTER TABLE tasks ADD COLUMN last_revision_note TEXT;

CREATE INDEX IF NOT EXISTS tasks_selected_provider_idx ON tasks(selected_provider_agent_id,status);

CREATE TRIGGER IF NOT EXISTS trg_task_provider_selected AFTER UPDATE OF selected_provider_agent_id ON tasks
WHEN NEW.selected_provider_agent_id IS NOT NULL AND OLD.selected_provider_agent_id IS NOT NEW.selected_provider_agent_id
BEGIN
  INSERT INTO marketplace_events(id,event_type,source,agent_id,task_id,detail_json,created_at)
    VALUES('evt_'||lower(hex(randomblob(16))),'task.provider_selected',NEW.event_source,NEW.requester_agent_id,NEW.id,json_object('providerAgentId',NEW.selected_provider_agent_id),NEW.updated_at);
  INSERT INTO marketplace_daily_counters(day,metric,source,count) VALUES(substr(NEW.updated_at,1,10),'task.provider_selected','all',1)
    ON CONFLICT(day,metric,source) DO UPDATE SET count=count+1;
  INSERT INTO marketplace_daily_counters(day,metric,source,count) VALUES(substr(NEW.updated_at,1,10),'task.provider_selected',NEW.event_source,1)
    ON CONFLICT(day,metric,source) DO UPDATE SET count=count+1;
END;

CREATE TRIGGER IF NOT EXISTS trg_task_revision_requested AFTER UPDATE OF revision_count ON tasks
WHEN NEW.revision_count > OLD.revision_count
BEGIN
  INSERT INTO marketplace_events(id,event_type,source,agent_id,task_id,detail_json,created_at)
    VALUES('evt_'||lower(hex(randomblob(16))),'task.revision_requested',NEW.event_source,NEW.requester_agent_id,NEW.id,json_object('revisionCount',NEW.revision_count),NEW.updated_at);
  INSERT INTO marketplace_daily_counters(day,metric,source,count) VALUES(substr(NEW.updated_at,1,10),'task.revision_requested','all',1)
    ON CONFLICT(day,metric,source) DO UPDATE SET count=count+1;
  INSERT INTO marketplace_daily_counters(day,metric,source,count) VALUES(substr(NEW.updated_at,1,10),'task.revision_requested',NEW.event_source,1)
    ON CONFLICT(day,metric,source) DO UPDATE SET count=count+1;
END;
