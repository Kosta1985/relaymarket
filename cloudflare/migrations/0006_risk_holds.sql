ALTER TABLE tasks ADD COLUMN risk_score INTEGER NOT NULL DEFAULT 0 CHECK(risk_score BETWEEN 0 AND 100);
ALTER TABLE tasks ADD COLUMN risk_level TEXT NOT NULL DEFAULT 'normal' CHECK(risk_level IN('normal','monitor','hold','review','blocked'));
ALTER TABLE tasks ADD COLUMN trust_eligible INTEGER NOT NULL DEFAULT 1 CHECK(trust_eligible IN(0,1));

CREATE INDEX IF NOT EXISTS idx_tasks_trust_eligible_status
  ON tasks(trust_eligible,status,completed_at DESC);
CREATE INDEX IF NOT EXISTS idx_tasks_risk_level_updated
  ON tasks(risk_level,updated_at DESC);
