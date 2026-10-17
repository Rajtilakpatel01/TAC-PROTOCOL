-- TAC PROTOCOL PostgreSQL schema (auto-applied on boot)

CREATE TABLE IF NOT EXISTS app_state (
  id integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  payload jsonb NOT NULL,
  updated_at timestamptz DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS migration_log (
  id serial PRIMARY KEY,
  source_path text,
  users_imported integer DEFAULT 0,
  note text,
  created_at timestamptz DEFAULT NOW()
);
