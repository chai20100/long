CREATE TABLE IF NOT EXISTS market_sync_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  range_start TEXT NOT NULL,
  range_end TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('ready', 'running', 'complete')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS market_sync_items (
  code TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  market TEXT NOT NULL,
  ipo_date TEXT,
  out_date TEXT,
  listing_status TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'running', 'complete', 'error')),
  daily_rows INTEGER NOT NULL DEFAULT 0,
  minute_rows INTEGER NOT NULL DEFAULT 0,
  daily_key TEXT,
  minute_key TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  started_at TEXT,
  finished_at TEXT,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_market_sync_items_status
  ON market_sync_items (status, code);

CREATE TABLE IF NOT EXISTS market_data_objects (
  code TEXT NOT NULL,
  frequency TEXT NOT NULL CHECK (frequency IN ('d', '5m')),
  range_start TEXT NOT NULL,
  range_end TEXT NOT NULL,
  object_key TEXT NOT NULL UNIQUE,
  row_count INTEGER NOT NULL,
  first_value TEXT,
  last_value TEXT,
  compressed_bytes INTEGER NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (code, frequency, range_start, range_end)
);

CREATE INDEX IF NOT EXISTS idx_market_data_objects_code
  ON market_data_objects (code, frequency, updated_at DESC);
