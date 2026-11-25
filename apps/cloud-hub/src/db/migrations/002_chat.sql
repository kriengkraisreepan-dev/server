-- Task A4: Messenger adapter + AI chat agent (docs/ai-assistant/PHASE_A_TASKS.md A4).
-- Customers are identified only by the platform's opaque id (PSID), never by name or phone.

-- One row per customer per channel. `handoff` = staff answers; the AI stays silent until released (S-3.4).
CREATE TABLE conversations (
  id                 TEXT PRIMARY KEY,
  channel            TEXT NOT NULL,
  customer_ref       TEXT NOT NULL,
  created_at         TIMESTAMPTZ NOT NULL,
  last_inbound_at    TIMESTAMPTZ,
  last_activity_at   TIMESTAMPTZ NOT NULL,
  handoff            BOOLEAN NOT NULL DEFAULT false,
  handoff_reason     TEXT,
  handoff_at         TIMESTAMPTZ,
  unsure_streak      INTEGER NOT NULL DEFAULT 0,
  UNIQUE (channel, customer_ref)
);
CREATE INDEX conversations_activity_idx ON conversations (last_activity_at DESC);

-- Conversation log (S-6.2: deleted after the retention period).
-- role: 'customer' | 'ai' | 'staff' | 'system'
CREATE TABLE chat_messages (
  id                  BIGSERIAL PRIMARY KEY,
  conversation_id     TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  at                  TIMESTAMPTZ NOT NULL,
  role                TEXT NOT NULL,
  text                TEXT NOT NULL,
  channel_message_id  TEXT,
  meta                JSONB NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX chat_messages_conv_idx ON chat_messages (conversation_id, id);
CREATE INDEX chat_messages_at_idx ON chat_messages (at);

-- Webhook dedupe: Meta retries deliveries, so every platform message id is processed once.
CREATE TABLE processed_inbound (
  channel             TEXT NOT NULL,
  channel_message_id  TEXT NOT NULL,
  received_at         TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (channel, channel_message_id)
);

-- Shop info edited by the owner in the Admin web (hours text, address, directions, contact).
CREATE TABLE shop_info (
  key         TEXT PRIMARY KEY,
  value       TEXT NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL
);

-- FAQ knowledge base, edited in the Admin web.
CREATE TABLE faq (
  id          TEXT PRIMARY KEY,
  question    TEXT NOT NULL,
  answer      TEXT NOT NULL,
  keywords    TEXT NOT NULL DEFAULT '',
  enabled     BOOLEAN NOT NULL DEFAULT true,
  updated_at  TIMESTAMPTZ NOT NULL
);
