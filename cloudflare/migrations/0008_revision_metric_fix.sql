PRAGMA foreign_keys = ON;

-- The original lifecycle trigger treats every transition into `working` as
-- `task.started`. A requester revision changes delivered -> working, which
-- must not be counted as a fresh provider start. Revision events are already
-- recorded atomically by trg_task_revision_requested from migration 0007.
DROP TRIGGER IF EXISTS trg_task_status_changed;

CREATE TRIGGER trg_task_status_changed AFTER UPDATE OF status ON tasks
WHEN OLD.status <> NEW.status
BEGIN
  INSERT INTO marketplace_events(id,event_type,source,agent_id,task_id,detail_json,created_at)
    SELECT
      'evt_'||lower(hex(randomblob(16))),
      CASE NEW.status WHEN 'working' THEN 'task.started' ELSE 'task.'||NEW.status END,
      NEW.event_source,
      COALESCE(NEW.provider_agent_id,NEW.requester_agent_id),
      NEW.id,
      json_object('from',OLD.status,'to',NEW.status),
      NEW.updated_at
    WHERE NOT (OLD.status='delivered' AND NEW.status='working');

  INSERT INTO marketplace_daily_counters(day,metric,source,count)
    SELECT substr(NEW.updated_at,1,10),CASE NEW.status WHEN 'working' THEN 'task.started' ELSE 'task.'||NEW.status END,'all',1
    WHERE NOT (OLD.status='delivered' AND NEW.status='working')
    ON CONFLICT(day,metric,source) DO UPDATE SET count=count+1;

  INSERT INTO marketplace_daily_counters(day,metric,source,count)
    SELECT substr(NEW.updated_at,1,10),CASE NEW.status WHEN 'working' THEN 'task.started' ELSE 'task.'||NEW.status END,NEW.event_source,1
    WHERE NOT (OLD.status='delivered' AND NEW.status='working')
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
