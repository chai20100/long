CREATE TABLE IF NOT EXISTS daily_strategy_scans (
  trade_date TEXT PRIMARY KEY,
  result TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_daily_strategy_scans_created
  ON daily_strategy_scans (created_at DESC);
