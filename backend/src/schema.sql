-- HelixConnect persistence schema.
-- Applied automatically on backend startup when DATABASE_URL is set.
-- Live session/room state is intentionally NOT persisted here — a WebSocket
-- session only means anything to the process holding the socket, so it
-- stays in-memory and is rebuilt (reconnect/disconnect) rather than restored.

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL DEFAULT '',
  display_name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'operator',
  avatar TEXT,
  email TEXT DEFAULT '',
  provider TEXT NOT NULL DEFAULT 'local',
  disabled BOOLEAN NOT NULL DEFAULT FALSE,
  favorites JSONB NOT NULL DEFAULT '[]',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS connections (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  protocol TEXT NOT NULL,
  hostname TEXT NOT NULL,
  port INTEGER NOT NULL,
  username TEXT DEFAULT '',
  password_encrypted TEXT DEFAULT '',
  tags JSONB NOT NULL DEFAULT '[]',
  "group" TEXT DEFAULT 'Unassigned',
  status TEXT DEFAULT 'online',
  latency_ms INTEGER,
  last_seen TEXT DEFAULT 'Just now',
  description TEXT DEFAULT '',
  os TEXT DEFAULT 'Unknown',
  resolution TEXT DEFAULT '1280x720',
  color_depth INTEGER DEFAULT 24,
  ignore_cert BOOLEAN NOT NULL DEFAULT FALSE,
  security TEXT,
  clipboard_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  file_transfer_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS grants (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  username TEXT NOT NULL,
  connection_id TEXT NOT NULL,
  connection_name TEXT NOT NULL,
  starts_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ NOT NULL,
  reason TEXT DEFAULT '',
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked BOOLEAN NOT NULL DEFAULT FALSE,
  recurrence JSONB
);

CREATE TABLE IF NOT EXISTS grant_requests (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  username TEXT NOT NULL,
  display_name TEXT,
  connection_id TEXT NOT NULL,
  connection_name TEXT NOT NULL,
  reason TEXT DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ,
  resolved_by TEXT
);

CREATE TABLE IF NOT EXISTS activity (
  id TEXT PRIMARY KEY,
  user_name TEXT,
  action TEXT NOT NULL,
  target TEXT,
  type TEXT NOT NULL DEFAULT 'session',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_grants_user ON grants (user_id);
CREATE INDEX IF NOT EXISTS idx_activity_created ON activity (created_at DESC);

-- Additive migrations for deployments created before a column existed.
-- CREATE TABLE IF NOT EXISTS above is a no-op against an existing table, so
-- new columns need their own idempotent ADD COLUMN here.
ALTER TABLE connections ADD COLUMN IF NOT EXISTS clipboard_enabled BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE connections ADD COLUMN IF NOT EXISTS file_transfer_enabled BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS favorites JSONB NOT NULL DEFAULT '[]';
ALTER TABLE grants ADD COLUMN IF NOT EXISTS recurrence JSONB;
