CREATE TABLE IF NOT EXISTS stocks (
  code TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  market TEXT NOT NULL,
  board_type TEXT NOT NULL,
  industry TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS themes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS stock_theme_overrides (
  stock_code TEXT PRIMARY KEY,
  theme_id INTEGER NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (stock_code) REFERENCES stocks(code),
  FOREIGN KEY (theme_id) REFERENCES themes(id)
);

CREATE TABLE IF NOT EXISTS limit_events (
  trade_date TEXT NOT NULL,
  stock_code TEXT NOT NULL,
  theme_id INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('sealed', 'broken')),
  price REAL,
  pct_change REAL NOT NULL DEFAULT 0,
  amount REAL NOT NULL DEFAULT 0,
  turnover_rate REAL NOT NULL DEFAULT 0,
  first_limit_time TEXT,
  last_limit_time TEXT,
  open_count INTEGER NOT NULL DEFAULT 0,
  continuous_boards INTEGER NOT NULL DEFAULT 0,
  window_days INTEGER NOT NULL DEFAULT 0,
  window_boards INTEGER NOT NULL DEFAULT 0,
  source TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (trade_date, stock_code),
  FOREIGN KEY (stock_code) REFERENCES stocks(code),
  FOREIGN KEY (theme_id) REFERENCES themes(id)
);

CREATE INDEX IF NOT EXISTS idx_limit_events_date_theme
  ON limit_events (trade_date, theme_id, status);
CREATE INDEX IF NOT EXISTS idx_limit_events_stock
  ON limit_events (stock_code, trade_date);

CREATE TABLE IF NOT EXISTS market_indices (
  trade_date TEXT NOT NULL,
  secid TEXT NOT NULL,
  name TEXT NOT NULL,
  close REAL,
  pct_change REAL,
  amount REAL NOT NULL DEFAULT 0,
  PRIMARY KEY (trade_date, secid)
);

CREATE TABLE IF NOT EXISTS ingestion_runs (
  id TEXT PRIMARY KEY,
  trade_date TEXT,
  source TEXT NOT NULL,
  status TEXT NOT NULL,
  item_count INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  started_at TEXT NOT NULL,
  finished_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_ingestion_runs_started
  ON ingestion_runs (started_at DESC);
