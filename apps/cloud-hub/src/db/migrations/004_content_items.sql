-- Task A6: post drafts and the approval queue (CONTENT_PIPELINE §3 ContentItem, S-4.1–S-4.4).
-- autonomy_level: Phase A has no way to raise a template above L1 (S-4.1).
-- source_snapshot: the shop data every number in the post must come from (S-4.2).
CREATE TABLE content_items (
  id                 TEXT PRIMARY KEY,
  template_id        TEXT NOT NULL,
  status             TEXT NOT NULL,
  autonomy_level     TEXT NOT NULL DEFAULT 'L1' CHECK (autonomy_level = 'L1'),
  summary            TEXT NOT NULL,
  caption            TEXT NOT NULL,
  hashtags           JSONB NOT NULL DEFAULT '[]'::jsonb,
  template_data      JSONB NOT NULL,
  asset_id           TEXT,
  image_prompt       TEXT NOT NULL DEFAULT '',
  source_snapshot    JSONB NOT NULL,
  variant            INTEGER NOT NULL DEFAULT 0,
  scheduled_at       TIMESTAMPTZ,
  expires_at         TIMESTAMPTZ NOT NULL,
  approved_by        TEXT,
  approved_at        TIMESTAMPTZ,
  reject_reason_code TEXT,
  reject_note        TEXT,
  edited             BOOLEAN NOT NULL DEFAULT false,
  created_by         TEXT NOT NULL,
  created_at         TIMESTAMPTZ NOT NULL,
  updated_at         TIMESTAMPTZ NOT NULL
);
CREATE INDEX content_items_status_idx ON content_items (status, created_at DESC);
