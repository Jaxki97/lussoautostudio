-- Local-dev only: base tables that already exist in production D1 but are
-- missing from the fresh .wrangler local state. Safe to re-run.

CREATE TABLE IF NOT EXISTS bookings (
  id             TEXT PRIMARY KEY,
  date           TEXT NOT NULL,
  start_hour     INTEGER NOT NULL,
  duration_hours INTEGER NOT NULL,
  end_hour       INTEGER NOT NULL,
  service        TEXT NOT NULL,
  name           TEXT NOT NULL,
  phone          TEXT NOT NULL,
  email          TEXT,
  vehicle        TEXT,
  city           TEXT,
  notes          TEXT,
  status         TEXT NOT NULL DEFAULT 'active',
  created_at     TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS availability_settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
