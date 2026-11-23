# BRIDGE_PROTOCOL — Shop PC ↔ Cloud hub (v1)

## 1. หลักการ

- Shop PC เป็นฝ่าย **เชื่อมออก** เสมอ ผ่าน WSS (`wss://<hub>/bridge/v1`)
- Protocol เป็น **ข้อมูลไหลขึ้น + แจ้งเตือนไหลลง** ไม่มีคำสั่งที่แก้ข้อมูล POS (SAFETY S-1)
- ทุก message validate ด้วย zod schema ใน `packages/bridge-protocol` ทั้งสองฝั่ง
- Version อยู่ใน path (`/v1`) และใน envelope (`v: 1`)

## 2. Pairing (ครั้งแรก) — SAFETY GATE G1 สำหรับเครื่องจริง

1. เจ้าของเข้า Admin web → "เพิ่มเครื่องร้าน" → Cloud สร้าง **pairing code** 8 ตัวอักษร (A–Z, 2–9, ไม่มี O/0/I/1) อายุ 10 นาที ใช้ได้ครั้งเดียว
2. ที่ 88Snooker: Settings → AI Bridge → "เชื่อมต่อ" → ใส่ pairing code + ชื่อเครื่อง
3. Desktop เรียก `POST https://<hub>/bridge/v1/pair`
   ```json
   { "pairingCode": "K7MX2QPA", "deviceName": "Front desk PC", "appVersion": "x.y.z" }
   ```
4. Cloud ตอบ
   ```json
   { "deviceId": "dev_...", "deviceToken": "<base64url 32 bytes>", "hubUrl": "wss://<hub>/bridge/v1" }
   ```
5. Desktop เก็บ `deviceToken` ด้วย `safeStorage.encryptString` (DPAPI) — ห้ามเก็บ plaintext
6. Cloud เก็บเฉพาะ `sha256(deviceToken)`
7. Rate limit `/pair`: 5 ครั้ง/ชม./IP; ผิด 5 ครั้งติด → code นั้นถูกยกเลิก

**Revoke:** Admin web → ลบเครื่อง → ปิด connection ทันที, token ใช้ไม่ได้
**Disconnect จากฝั่งร้าน:** ลบ token ในเครื่อง + แจ้ง Cloud (ถ้าออนไลน์)

## 3. Connection

- Header ตอน upgrade: `Authorization: Bearer <deviceToken>`
- หลังเชื่อม: Shop ส่ง `hello` → Cloud ตอบ `hello.ack`
- Heartbeat: Shop ส่ง `heartbeat` ทุก 20 วินาที; Cloud ไม่ได้รับ 60 วินาที → mark offline
- Reconnect: exponential backoff 1s → 2s → 4s … สูงสุด 60s + jitter ±20%
- ระหว่าง offline: ร้านทำงานปกติทุกอย่าง; `ai-bridge` เก็บ `approval.decision` ที่ยังส่งไม่ได้ไว้ใน local queue (persist ลง disk) แล้วส่งเมื่อกลับมาออนไลน์
- Message ขนาดสูงสุด 256 KB

## 4. Envelope

```ts
type Envelope<T extends string, P> = {
  v: 1;
  type: T;
  id: string;        // ULID — ใช้กันซ้ำและอ้างอิงใน ack
  ts: string;        // ISO-8601 UTC
  payload: P;
};
```

ทุก message ที่ต้องการการยืนยันจะได้รับ `ack { refId }` กลับ; ไม่ได้ ack ใน 10 วินาที → ส่งซ้ำ (idempotent ด้วย `id`)

## 5. Message types (allowlist)

### Shop → Cloud

| type | payload | ack |
|---|---|---|
| `hello` | `{ deviceId, appVersion, protocolVersion: 1, timezone: "Asia/Bangkok" }` | `hello.ack` |
| `heartbeat` | `{}` | ไม่มี |
| `snapshot` | `Snapshot` (ดูข้อ 6) | ไม่มี (ส่งใหม่ทั้งก้อนทุกครั้ง) |
| `approval.decision` | `{ approvalId, decision: 'approved' \| 'rejected', reasonCode?, note?, decidedBy, editedPayload? }` | `ack` |
| `ack` | `{ refId }` — ยืนยัน `approval.created` / `approval.updated` / `token.rotate` (G6 อนุมัติ 2026-11-22) | ไม่มี |

### Cloud → Shop

| type | payload | ack |
|---|---|---|
| `hello.ack` | `{ serverTime, snapshotIntervalSec: 30 }` | ไม่มี |
| `ack` | `{ refId }` | ไม่มี |
| `approval.created` | `ApprovalItem` | `ack` |
| `approval.updated` | `{ approvalId, status }` (เช่น ลูกค้ายกเลิก, หมดอายุ) | `ack` |
| `token.rotate` | `{ newToken }` → Shop เก็บใหม่แล้วตอบ `ack`; Cloud ยอมรับ token เก่าอีก 5 นาที | `ack` |

**ไม่มี** message type อื่น การเพิ่ม type ใหม่ = SAFETY GATE G6
Shop PC ได้ type ที่ไม่รู้จัก → ไม่ทำอะไร + log `bridge.unknown_message` (S-1.3)

## 6. Snapshot schema

```ts
const Snapshot = z.object({
  seq: z.number().int().nonnegative(),          // เพิ่มทุกครั้งที่สร้าง
  generatedAt: z.string().datetime(),
  shop: z.object({
    isOpenNow: z.boolean(),
    todayHours: z.object({ open: z.string(), close: z.string() }).nullable(), // "HH:MM" เวลาไทย
    note: z.string().max(200).optional(),        // เช่น "วันนี้ปิด 2 ทุ่มเพราะ..." (พนักงานตั้ง)
  }).strict(),
  tables: z.array(z.object({
    tableNo: z.string().max(10),                 // หมายเลขที่แสดงต่อลูกค้า
    kind: z.enum(['snooker', 'pool']),
    status: z.enum(['available', 'in_use', 'reserved', 'maintenance']),
    elapsedMin: z.number().int().nonnegative().optional(),  // เฉพาะ in_use
    reservedFrom: z.string().optional(),         // "HH:MM" เฉพาะ reserved
  }).strict()).max(100),
  queue: z.object({ waiting: z.number().int().nonnegative() }).strict(),
  priceList: z.array(z.object({
    kind: z.enum(['snooker', 'pool']),
    label: z.string().max(60),                   // เช่น "ปกติ", "หลัง 2 ทุ่ม"
    pricePerHourTHB: z.number().nonnegative(),
    timeRange: z.string().max(30).optional(),
  }).strict()).max(30),
  promotions: z.array(z.object({
    id: z.string(),
    title: z.string().max(80),
    detail: z.string().max(400),
    validFrom: z.string(),                       // ISO date
    validTo: z.string(),
    days: z.array(z.number().int().min(0).max(6)).optional(),
    timeRange: z.string().max(30).optional(),
  }).strict()).max(20),
}).strict();
```

**ห้ามเพิ่ม** ชื่อลูกค้า เบอร์ ยอดเงินบิล ชื่อพนักงาน รหัสอุปกรณ์ (S-2) — การเพิ่มฟิลด์ใด ๆ = SAFETY GATE G6

### การสร้าง snapshot ฝั่งร้าน
- อ่านผ่าน read-only service layer ของ 88Snooker
- ส่งทุก `snapshotIntervalSec` และเมื่อสถานะโต๊ะเปลี่ยน (debounce 2s)
- ถ้าสร้าง snapshot ไม่สำเร็จ → ไม่ส่ง (Cloud จะเห็นว่า stale เอง) + log

### Staleness ฝั่ง Cloud
- `stale = now - generatedAt > 90s` หรือ device offline
- Agent และ Publisher ต้องเช็ก `stale` ทุกครั้ง (S-3.5, S-4.3)

## 7. ApprovalItem

```ts
type ApprovalItem = {
  approvalId: string;
  kind: 'booking_request' | 'post' | 'comment_reply';
  createdAt: string;
  expiresAt: string;
  summary: string;               // ข้อความสั้นสำหรับแสดงใน list
  payload:
    | { kind: 'booking_request'; date: string; time: string; partySize: number;
        tableKind: 'snooker' | 'pool'; displayName: string; phoneMasked?: string;
        channel: string; note?: string }
    | { kind: 'post'; contentId: string; caption: string; mediaUrls: string[];
        scheduledAt?: string; templateId: string }
    | { kind: 'comment_reply'; postUrl: string; commentText: string; draftReply: string };
};
```

- เบอร์โทรเต็มไม่ส่งผ่าน bridge; พนักงานดูได้จาก Admin web ถ้าจำเป็น
- `reasonCode` ตอนปฏิเสธ: `table_full`, `closed`, `wrong_info`, `off_brand`, `wrong_numbers`, `other`

## 8. State machine ของ Approval (ฝั่ง Cloud)

```
pending ──approved──► approved ──(booking: แจ้งลูกค้า / post: ส่ง publisher)──► done
   │                                                         
   ├──rejected──► rejected
   ├──expiresAt──► expired
   └──customer_cancelled──► cancelled
```

## 9. Tests ที่ต้องมี

- [ ] Snapshot ที่มีฟิลด์เกิน → reject ทั้งสองฝั่ง
- [ ] Unknown message type → Shop ไม่ทำอะไรและ log
- [ ] Token ผิด/ถูก revoke → upgrade ถูกปฏิเสธ
- [ ] Reconnect + ส่ง `approval.decision` ที่ค้างใน local queue หลังออนไลน์
- [ ] Duplicate message `id` → ประมวลผลครั้งเดียว
- [ ] Token rotate ระหว่างใช้งานไม่ทำให้ connection หลุดถาวร
