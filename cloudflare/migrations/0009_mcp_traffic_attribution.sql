CREATE TABLE IF NOT EXISTS mcp_client_daily (
  day TEXT NOT NULL,
  client_hash TEXT NOT NULL,
  traffic_class TEXT NOT NULL CHECK (traffic_class IN ('external','internal')),
  source TEXT NOT NULL,
  user_agent_family TEXT NOT NULL DEFAULT 'unknown',
  request_count INTEGER NOT NULL DEFAULT 0,
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  PRIMARY KEY (day, client_hash, traffic_class, source)
);

CREATE INDEX IF NOT EXISTS idx_mcp_client_daily_day_class
  ON mcp_client_daily(day, traffic_class);
CREATE INDEX IF NOT EXISTS idx_mcp_client_daily_source
  ON mcp_client_daily(source, day);
