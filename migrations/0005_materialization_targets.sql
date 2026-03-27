CREATE TABLE IF NOT EXISTS materialization_targets (
  target_type TEXT NOT NULL,
  target_key TEXT NOT NULL,
  desired_generation INTEGER NOT NULL DEFAULT 0,
  processed_generation INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'ready',
  first_dirty_at TEXT,
  last_dirty_at TEXT,
  last_started_at TEXT,
  last_completed_at TEXT,
  last_error TEXT,
  requested_by TEXT,
  workflow_instance_id TEXT,
  affected_category_slugs_json TEXT NOT NULL DEFAULT '[]',
  affected_country_codes_json TEXT NOT NULL DEFAULT '[]',
  PRIMARY KEY (target_type, target_key)
);

CREATE INDEX IF NOT EXISTS idx_materialization_targets_status
  ON materialization_targets (status, last_dirty_at DESC);
