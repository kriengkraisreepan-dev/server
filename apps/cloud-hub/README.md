# @88snooker/cloud-hub — Cloud hub (Task A2 skeleton)

Cloud side of the 88Snooker AI assistant. A2 scope: Shop PC pairing, the bridge WSS endpoint,
the snapshot cache with staleness, and the owner Admin web ("เครื่องร้าน" + kill switches).
Spec: [`docs/ai-assistant/`](../../docs/ai-assistant/) — ARCHITECTURE §4.3, BRIDGE_PROTOCOL §2–6, SAFETY_RULES.

JavaScript (CommonJS) + JSDoc, same as the rest of the repo. Separate app: it is **not** part of
the Electron build and must not require anything from the 88Snooker Manager app
(checked by `test/boundary.test.js`, S-1.1/S-1.2).

## Run (dev, one command)

```bash
cd apps/cloud-hub
npm install
npm run dev                 # PGlite (in-process Postgres) in ./.dev-data, no Docker needed
# or
docker compose up --build   # real Postgres 17 + hub
```

Admin web: <http://localhost:8080/admin/>. The dev owner password is printed at start-up
(set `DEV_ADMIN_PASSWORD` to choose it). Bridge URL: `ws://localhost:8080/bridge/v1`.

## Test

```bash
npm test                                 # from apps/cloud-hub (or `npm run test:cloud-hub` at the repo root)
TEST_DATABASE_URL=postgres://hub:hub-dev-only@localhost:5432/cloud_hub npm run test:postgres
```

`bridge-protocol` is installed as a **copy** (`.npmrc` `install-links=true`) so the Docker image
works without the rest of the repo. After changing `packages/bridge-protocol`, run `npm install`
here again; `test/boundary.test.js` fails if the copy is out of date.

## Configuration (env)

| Var | Meaning |
|---|---|
| `DATABASE_URL` | Postgres URL. Required outside development. |
| `ADMIN_PASSWORD_HASH` | Owner login. Create with `echo -n '<password>' \| npm run -s hash-password` (≥ 10 chars). |
| `PUBLIC_WS_URL` | URL given to the Shop PC at pairing. Must be `wss://` outside development (TLS at the reverse proxy). |
| `PORT`, `HOST` | Listen address (default `8080`, `0.0.0.0`). |
| `TRUST_PROXY` | Number of reverse proxies in front, for client IP / rate limits (default `0`). |
| `SECURE_COOKIES` | Default `true` except in development. |
| `PGLITE_DIR` | Dev only: where PGlite keeps its data. |
| `FB_APP_SECRET` | A4: Meta app secret, checks `X-Hub-Signature-256` (S-5.1). Without it every webhook POST is 401. |
| `FB_VERIFY_TOKEN` | A4: any random string; the same value goes in the Meta app's webhook settings. |
| `FB_PAGE_ACCESS_TOKEN` | A4: Page token for the Send API. Sent only in the `Authorization` header (S-5.3). |
| `FB_APP_ID` | A4: lets the hub tell its own echoed replies from staff replies in the Page inbox (staff reply → AI stops for that chat). Without it echoes are ignored. |
| `ANTHROPIC_API_KEY` | A4: Claude API key. If unset the hub uses the free `rules` answerer. |
| `AI_PROVIDER` | `claude` or `rules` (default: `claude` when a key is set). |
| `AI_MODEL`, `AI_EFFORT` | Default `claude-opus-5-5`, effort `low`. |
| `CHAT_RETENTION_DAYS` | Conversation log retention (default 90, S-6.2). |

## Layout

```
src/
  app.js               composition root (Express + ws on one HTTP server)
  config.js  server.js  logger.js  ids.js  audit.js  kill-switches.js  rate-limit.js
  db/                  pg / PGlite wrapper, migrate(), migrations/*.sql
  bridge/devices.js    pairing codes, device tokens (sha256 only), rotate, revoke
  bridge/snapshots.js  latest snapshot per device, stale = >90 s old or device offline
  bridge/ws-server.js  /bridge/v1: auth, hello/heartbeat/snapshot/approval.decision, dedupe, close codes
  admin/               owner login (scrypt, in-memory sessions), API routes, static page
scripts/               dev.js, hash-password.js, test-postgres.js
test/                  node --test suites (see below)
```

## HTTP / WS surface

| Endpoint | Notes |
|---|---|
| `POST /bridge/v1/pair` | §2. 5 req/h/IP. 5 wrong codes in a row cancel every outstanding code. Errors never say why a code failed. |
| `GET /bridge/v1` (upgrade) | `Authorization: Bearer <deviceToken>` only (not in the URL). 401 wrong/revoked token, 503 bridge kill switch off. Max frame 256 KB. |
| `/admin/` | Static page. `/admin/api/*` needs the owner session cookie **and** header `x-hub-admin: 1` (CSRF). |

WebSocket close codes the Shop PC should handle: `4401` revoked (delete token, do not retry),
`4403` deviceId ≠ token, `4408` heartbeat timeout (60 s), `4409` replaced by a newer connection,
`4503` bridge kill switch off, `1009` frame too large.

## AI chat (Task A4)

```
Meta webhook ──► /webhooks/messenger  (signature on raw body, 200 at once, process in background)
                   └► chat/service      dedupe by mid · per-customer queue · handoff? · S-3.8 rate limit
                                         · S-3.7 24 h window · ai_chat kill switch → fixed text
                        └► agent/agent  deterministic handoff (booking, complaint, money, lost item,
                                         accident, threat, "talk to a person") → provider (claude | rules)
                                         with the 7 tools → output guards → stale time / intro
                             └► channels/fb-messenger  Send API
```

- `src/agent/tools.js` — `get_table_status`, `get_wait_estimate`, `get_price_list`, `get_shop_info`,
  `get_promotions`, `search_faq`, `handoff_to_staff`. Data: snapshot cache (latest non-revoked device)
  + shop info / FAQ from the Admin web.
- `src/agent/safety.js` — guards that run for every provider: a reply is replaced by "staff will
  answer" if it has a number not found in this turn's tool results (S-3.1; the customer's own
  message is *not* a source), a booking/discount/payment promise (S-3.2) or a copy of the system
  prompt (S-3.3). Stale data → data time appended (S-3.5). New conversation → intro (S-3.6).
- `src/agent/llm-rules.js` — free answerer (no AI service): keyword intents → same tools → fixed
  templates. Used when there is no API key, and as the deterministic provider for tests/evals.
- `src/agent/llm-claude.js` — Messages API manual tool loop, static cached system prompt,
  server-side refusal fallback. Errors/refusals → handoff with a fixed message.
- Admin web: "AI ตอบแชท Facebook" status, "ลองถาม AI" (same agent, no Facebook), customer chats
  (handoff / release / delete for S-6.3), shop info, FAQ.

### Eval

```bash
npm run eval               # evals/chat.yaml, free rules provider (Claude if ANTHROPIC_API_KEY is set — costs money)
npm run eval -- --verbose  # print every reply
```

Pass bar (A4): safety 100%, quality ≥ 90%. `test/agent.test.js` runs it with the rules provider.

## Known limits (Phase A)

- Staff "notification" for a handoff is the Admin web badge + audit log; there is no push yet.
- Render free plan sleeps after 15 min idle, so the first Messenger reply after a quiet period can
  take ~1 min (Meta retries; duplicates are dropped). Upgrade before G2/G3.

- Sessions, rate limits, the online map and message dedupe are in memory → one hub instance.
- Protocol v1 has no Shop → Cloud `ack`, so `token.rotate` is resent 3× (same id, 10 s apart)
  and the Shop must treat repeats as idempotent. Adding that ack is Gate G6.
- `approval.decision` is only recorded in the audit log and acked; the approval queue comes later.
