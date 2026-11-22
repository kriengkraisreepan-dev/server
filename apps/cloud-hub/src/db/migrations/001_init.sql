-- Task A2 initial schema (docs/ai-assistant/PHASE_A_TASKS.md A2).
-- Append-only: never edit a migration that has run; add a new file instead (Gate G7 for destructive ones).

CREATE TABLE devices (
  device_id              TEXT PRIMARY KEY,
  device_name            TEXT NOT NULL,
  app_version            TEXT NOT NULL,
  -- S-5.2: sha256 of the device token only. The plaintext token is never stored.
  token_hash             TEXT UNIQUE,
  -- Previous token stays valid for 5 minutes after token.rotate (BRIDGE_PROTOCOL §5).
  prev_token_hash        TEXT UNIQUE,
  prev_token_expires_at  TIMESTAMPTZ,
  paired_at              TIMESTAMPTZ NOT NULL,
  last_seen_at           TIMESTAMPTZ,
  revoked_at             TIMESTAMPTZ
);

CREATE TABLE pairing_codes (
  code            TEXT PRIMARY KEY,
  created_at      TIMESTAMPTZ NOT NULL,
  expires_at      TIMESTAMPTZ NOT NULL,
  used_at         TIMESTAMPTZ,
  used_by_device  TEXT REFERENCES devices(device_id),
  cancelled_at    TIMESTAMPTZ
);

-- Latest snapshot per device only (snapshot cache). The JSON was validated by
-- bridge-protocol's strict Snapshot schema before it got here (S-2.1).
CREATE TABLE snapshots_latest (
  device_id     TEXT PRIMARY KEY REFERENCES devices(device_id) ON DELETE CASCADE,
  seq           BIGINT NOT NULL,
  generated_at  TIMESTAMPTZ NOT NULL,
  received_at   TIMESTAMPTZ NOT NULL,
  snapshot      JSONB NOT NULL
);

CREATE TABLE audit_log (
  id          BIGSERIAL PRIMARY KEY,
  at          TIMESTAMPTZ NOT NULL,
  actor       TEXT NOT NULL,          -- 'owner', 'device:<id>', 'system'
  action      TEXT NOT NULL,          -- e.g. 'device.paired', 'kill_switch.set'
  target      TEXT,
  detail      JSONB NOT NULL DEFAULT '{}'::jsonb   -- never tokens or phone numbers (S-5.3, S-5.4)
);
CREATE INDEX audit_log_at_idx ON audit_log (at DESC);

-- S-1.5 kill switches. enabled = true means the feature is allowed to run.
CREATE TABLE kill_switches (
  name        TEXT PRIMARY KEY CHECK (name IN ('ai_chat', 'publishing', 'bridge')),
  enabled     BOOLEAN NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL
);
INSERT INTO kill_switches (name, enabled, updated_at) VALUES
  ('ai_chat', true, now()),
  ('publishing', true, now()),
  ('bridge', true, now());
