-- Task A5: asset library for post images (docs/ai-assistant/CONTENT_PIPELINE.md §3 Asset).
-- Image bytes live in Postgres: the free hosting disk is wiped on every restart/deploy.
-- consent: 'not_needed' (no people) | 'recorded' (people, permission on file) | 'missing' (people, no permission → cannot be used, S-4.5)
CREATE TABLE assets (
  id                 TEXT PRIMARY KEY,
  kind               TEXT NOT NULL,
  mime               TEXT NOT NULL,
  width              INTEGER NOT NULL,
  height             INTEGER NOT NULL,
  bytes              INTEGER NOT NULL,
  sha256             TEXT NOT NULL,
  data               BYTEA NOT NULL,
  source             TEXT NOT NULL,
  consent            TEXT NOT NULL,
  tags               JSONB NOT NULL DEFAULT '[]'::jsonb,
  allowed_templates  JSONB,
  note               TEXT NOT NULL DEFAULT '',
  uploaded_by        TEXT NOT NULL,
  created_at         TIMESTAMPTZ NOT NULL,
  updated_at         TIMESTAMPTZ NOT NULL
);
CREATE INDEX assets_created_idx ON assets (created_at DESC);
