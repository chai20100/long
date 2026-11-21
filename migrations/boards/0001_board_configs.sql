CREATE TABLE IF NOT EXISTS board_configs (
  user_email TEXT PRIMARY KEY,
  config TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
