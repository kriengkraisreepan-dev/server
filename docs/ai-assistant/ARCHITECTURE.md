# ARCHITECTURE — 88Snooker AI Assistant

## 1. เป้าหมาย

- ลูกค้าทักเพจ Facebook แล้วได้คำตอบเรื่องโต๊ะว่าง ราคา เวลาเปิด-ปิด โปรโมชัน ได้ทันที 24 ชม.
- ลูกค้าขอจอง/เข้าคิวผ่านแชทได้ โดย **พนักงานเป็นคนยืนยัน** เสมอ
- AI ร่างคอนเทนต์จากข้อมูลจริงของร้าน และโพสต์ลงเพจหลังได้รับอนุมัติ
- ออกแบบให้เพิ่ม LINE / Instagram / TikTok ได้โดยไม่ต้องแก้แกนกลาง

## 2. ข้อจำกัดที่ต้องเคารพ (มาจากระบบเดิม)

- 88Snooker Manager เป็น **local-first** (Electron, Windows 10/11) — ร้านต้องทำงานได้แม้เน็ตหลุด
- Hardware polling เป็น read-only และ **Relay ไม่ถูกสั่งอัตโนมัติ** — AI ต้องไม่มีทางไปถึง Relay
- Secrets บนเครื่องร้านเก็บด้วย DPAPI (ใน Electron ใช้ `safeStorage`)
- ไม่เปิด inbound port ใด ๆ ที่เครื่องร้าน

## 3. ภาพรวม 3 ชั้น

```
┌──────────────────┐      ┌───────────────────────────────┐      ┌──────────────────────────┐
│  Channels        │      │  Cloud hub                     │      │  Shop PC                 │
│                  │ HTTPS│                               │ WSS  │                          │
│  Facebook Page ──┼─────►│  Channel adapters              │◄─────┼── ai-bridge (outbound)   │
│  (Messenger,     │◄─────┼─ AI chat agent (Claude API)    │      │       ▲                  │
│   comments,      │      │  Content studio + renderer     │      │       │ read-only        │
│   posts)         │      │  Approval queue                │─────►│  88Snooker core          │
│                  │      │  Publisher / scheduler         │      │  (POS, tables, booking)  │
│  LINE/IG/TikTok  │      │  Snapshot cache + Postgres     │      │  Approval tab (UI)       │
│  (อนาคต)         │      │  Admin web (เจ้าของ)            │      │                          │
└──────────────────┘      └───────────────────────────────┘      └──────────────────────────┘
```

ทิศทางการเชื่อมต่อ:
- Facebook → Cloud hub: webhook (HTTPS สาธารณะ)
- Shop PC → Cloud hub: WebSocket ขาออก (Shop PC เป็นฝ่ายเชื่อมเสมอ)
- Cloud hub → Facebook: Graph API

## 4. Components

### 4.1 `ai-bridge` (อยู่ใน Electron main process)
- สร้าง **Snapshot** จากข้อมูลใน 88Snooker (ผ่าน read-only query/service layer ที่มีอยู่)
- ส่ง snapshot ขึ้น Cloud: ทุก 30 วินาที + ทันทีเมื่อสถานะโต๊ะเปลี่ยน (debounce 2 วินาที)
- รับ event จาก Cloud: `approval.created`, `approval.updated`, `token.rotate`
- ส่งผลการตัดสินใจของพนักงาน (`approval.decision`) กลับขึ้นไป
- **ไม่มี** code path ใดที่รับคำสั่งจาก Cloud แล้วแก้ข้อมูล POS เอง — การจองจริงสร้างโดยพนักงานผ่าน UI ปกติ
- Spec: [BRIDGE_PROTOCOL.md](./BRIDGE_PROTOCOL.md)

### 4.2 Approval tab (UI ใน 88Snooker Manager)
- แสดงรายการรออนุมัติ: คำขอจอง, โพสต์, คำตอบคอมเมนต์ที่ AI ร่าง
- แจ้งเตือนด้วยเสียง + badge
- ปุ่ม: อนุมัติ / แก้ไขแล้วอนุมัติ / ปฏิเสธ (ต้องเลือกเหตุผล)
- คำขอจอง: เมื่อกดอนุมัติ ให้เปิดหน้าสร้างการจองปกติของ 88Snooker พร้อมเติมข้อมูลไว้ให้ พนักงานกดบันทึกเอง

### 4.3 Cloud hub
| Module | หน้าที่ |
|---|---|
| `channels/` | Adapter ต่อแพลตฟอร์ม — Phase A: `facebook-messenger`, `facebook-comments`, `facebook-publisher` |
| `agent/` | AI chat agent: system prompt, tools, conversation memory ระยะสั้น, handoff |
| `bridge/` | WSS endpoint, pairing, auth, snapshot cache, staleness |
| `approvals/` | Approval queue (state machine), แจ้งไปที่ร้านผ่าน bridge |
| `content/` | Planner, generator, renderer (Playwright), asset library |
| `publisher/` | โพสต์/ตั้งเวลาโพสต์, retry, audit log |
| `admin/` | หน้าเว็บสำหรับเจ้าของ: สถานะระบบ, kill switch, ตั้งค่า, logs |

### 4.4 Channel adapter — รูปแบบข้อความกลาง

```ts
type InboundMessage = {
  id: string;                 // id ภายใน
  channel: 'fb_messenger' | 'fb_comment' | 'line' | 'ig_dm' | 'ig_comment' | 'tiktok';
  channelMessageId: string;   // id จากแพลตฟอร์ม (ใช้กันซ้ำ)
  customerRef: string;        // PSID / LINE userId ฯลฯ (ไม่ใช่ชื่อ)
  threadType: 'dm' | 'comment';
  text?: string;
  attachments?: { type: 'image' | 'video' | 'file' | 'sticker'; url: string }[];
  receivedAt: string;         // ISO
  context?: { postId?: string; parentCommentId?: string };
};

interface ChannelAdapter {
  verifyWebhook(req): boolean;                 // ตรวจ signature
  parse(req): InboundMessage[];
  sendReply(msg: OutboundMessage): Promise<SendResult>;
  canMessage(customerRef): Promise<boolean>;   // เช็ก messaging window ของแพลตฟอร์ม
}
```

เพิ่มแพลตฟอร์มใหม่ = เขียน adapter ใหม่ ไม่แตะ `agent/`

## 5. Data flows หลัก

### 5.1 ลูกค้าถามโต๊ะว่าง
1. ลูกค้าส่งข้อความในเพจ → Meta ส่ง webhook มา Cloud hub
2. Adapter ตรวจ `X-Hub-Signature-256` → แปลงเป็น `InboundMessage` → กันซ้ำด้วย `channelMessageId`
3. Agent เรียก tool `get_table_status` → อ่านจาก **snapshot cache** (ไม่เรียกเข้าเครื่องร้านแบบ synchronous)
4. ถ้า snapshot เก่าเกิน 90 วินาที → ตอบพร้อมระบุเวลา "ข้อมูล ณ HH:MM" และแนะนำให้โทร/รอพนักงาน
5. ส่งคำตอบผ่าน adapter → บันทึก conversation log

### 5.2 ลูกค้าขอจอง
1. Agent เก็บข้อมูลที่จำเป็น (วัน เวลา จำนวนคน ประเภทโต๊ะ ชื่อเรียก เบอร์ถ้าลูกค้าให้)
2. Agent เรียก `create_booking_request` → สร้าง Approval item สถานะ `pending`
3. Agent ตอบลูกค้า: "ได้รับคำขอแล้ว รอพนักงานยืนยันสักครู่" (**ห้ามบอกว่าจองสำเร็จ**)
4. Cloud ส่ง `approval.created` ไปที่ Shop PC → Approval tab แจ้งเตือน
5. พนักงานอนุมัติ → สร้างการจองใน 88Snooker เอง → `approval.decision` ขึ้น Cloud
6. Cloud แจ้งลูกค้าผลการจอง (ถ้ายังอยู่ใน messaging window; ถ้าไม่ → แจ้งพนักงานให้ติดต่อเอง)
7. ถ้าไม่มีใครตอบใน 15 นาที → แจ้งลูกค้าว่ากำลังติดต่อกลับ + แจ้งเตือนซ้ำที่ร้าน

### 5.3 คอนเทนต์
ดู [CONTENT_PIPELINE.md](./CONTENT_PIPELINE.md)

## 6. Tech stack (แนะนำ)

| ส่วน | เลือก | เหตุผล |
|---|---|---|
| ภาษา | TypeScript ทั้งหมด | ใช้ type ของ protocol ร่วมกันระหว่าง Electron กับ Cloud |
| Schema validation | `zod` | validate ทุก message ทั้งสองฝั่ง |
| Cloud web framework | Fastify หรือ Hono | เบา, รองรับ WebSocket |
| DB | Postgres (+ Drizzle/Prisma) | approvals, conversations, content, audit log |
| AI | Claude API (tool use) — model ตั้งผ่าน env `AI_MODEL` | |
| Image render | Playwright (headless Chromium) render HTML → PNG | รองรับการตัดคำ/สระภาษาไทยถูกต้อง |
| Hosting | VPS เล็ก หรือ Render/Fly.io + managed Postgres | ต้องมี HTTPS สาธารณะสำหรับ webhook |
| Secrets (Cloud) | env + encrypted column สำหรับ Page token | |
| Secrets (Shop) | Electron `safeStorage` (DPAPI) | ใช้แนวเดียวกับระบบเดิม |

## 7. โครงสร้าง code (ปรับตาม repo จริง)

```
packages/
  bridge-protocol/        # zod schemas + types ใช้ร่วมกัน (versioned)
apps/
  cloud-hub/
    src/channels/facebook/
    src/agent/
    src/bridge/
    src/approvals/
    src/content/
    src/publisher/
    src/admin/
  desktop/ (88Snooker Manager เดิม)
    src/main/ai-bridge/   # โมดูลใหม่
    src/renderer/approvals/  # Approval tab
```

ถ้า repo เดิมไม่ใช่ monorepo: ให้ Claude Code เสนอทางเลือก (เช่น publish `bridge-protocol` เป็น local package หรือ git submodule) ก่อนลงมือ

## 8. Environments

| Env | Facebook | Shop PC | หมายเหตุ |
|---|---|---|---|
| dev | Test Page + Meta app ใน dev mode | เครื่อง dev + mock snapshot | |
| staging | Test Page | Shop PC จริง (pair แยก) | ทดสอบกับข้อมูลจริงแต่ไม่โพสต์เพจจริง |
| production | เพจ 88 Snooker Club | Shop PC จริง | เปิดหลังผ่าน checklist ใน PHASE_A_TASKS.md |

## 9. Roadmap

| Phase | ขอบเขต |
|---|---|
| A | Bridge read-only + Cloud hub + Messenger bot (สถานะโต๊ะ/ราคา/FAQ) + Content studio L1 แบบพื้นฐาน |
| B | Booking request ผ่าน Approval queue |
| C | Content studio เต็ม: planner, asset library, scheduler, insights |
| D | จัดการคอมเมนต์และรีวิว, inbox รวม |
| E | รายงานเจ้าของทาง LINE, CRM/สมาชิก, LINE OA, IG, TikTok |

## 10. Meta setup ที่ต้องเริ่มคู่ขนาน (ใช้เวลารอ)

- [ ] Meta Developer App + เชื่อมเพจ 88 Snooker Club
- [ ] Business Verification
- [ ] App Review สำหรับ permission: messaging, จัดการโพสต์, อ่าน engagement, จัดการคอมเมนต์ (ตรวจชื่อ permission ล่าสุดใน Meta docs ตอนยื่น)
- [ ] Test Page สำหรับ dev/staging
- [ ] Privacy Policy URL ของร้าน (Meta ต้องใช้ตอน App Review และต้องสอดคล้อง PDPA)
