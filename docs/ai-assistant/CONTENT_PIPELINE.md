# CONTENT_PIPELINE — Content studio และการโพสต์

## 1. Pipeline

```
Signals ─► Planner ─► Generator ─► Renderer ─► Approval ─► Publisher ─► Insights
(snapshot,  (แผนรายสัปดาห์) (แคปชัน,     (template    (แท็บใน       (Graph API)   (reach,
 promos,                    prompt ภาพ)  HTML→PNG)    88Snooker)                  engagement)
 ตารางแข่ง,                                                                           │
 เทศกาล)  ◄────────────────────────── feedback ──────────────────────────────────────┘
```

| ขั้น | ทำอะไร | Phase |
|---|---|---|
| Signals | อ่าน snapshot, promotions, ตารางแข่ง (กรอกใน Admin web), ปฏิทินเทศกาลไทย | A (snapshot+promos) |
| Planner | AI เสนอแผนโพสต์ 7 วัน: template, วัน-เวลา, เหตุผล | C |
| Generator | AI เขียนแคปชัน + แฮชแท็ก + (ถ้าต้องใช้ภาพพื้นหลัง) prompt สร้างภาพ | A |
| Renderer | เอา template + ข้อมูล + ภาพพื้นหลัง → PNG 1080×1080 | A |
| Approval | ส่งเข้า Approval queue (S-4.1) | A |
| Publisher | ตรวจซ้ำ (S-4.3) แล้วโพสต์/ตั้งเวลา | A |
| Insights | ดึงสถิติ 24 ชม. และ 7 วัน เก็บกับ ContentItem | C |

## 2. ระดับอิสระ

| ระดับ | พฤติกรรม | ใช้กับ |
|---|---|---|
| L0 | ร่างเก็บไว้ ไม่ส่งอนุมัติ | ทดสอบ template ใหม่ |
| L1 | ร่าง → รออนุมัติ → โพสต์ | **ค่าเริ่มต้นทุก template** |
| L2 | โพสต์อัตโนมัติ | เฉพาะ template ที่เจ้าของยกระดับ (Gate G5) |

เกณฑ์แนะนำก่อนยกเป็น L2: ใช้ L1 ≥ 4 สัปดาห์, อนุมัติโดยไม่แก้ ≥ 90%, ไม่มีโพสต์ผิดข้อมูล
L2 มีเพดาน ≤ 2 โพสต์/วัน (S-4.8) และยังผ่านการตรวจซ้ำ S-4.3 ทุกครั้ง

## 3. Data model

```ts
type ContentItem = {
  id: string;
  templateId: 'daily_tables' | 'happy_hour' | 'tournament' | string;
  targets: ('fb_page' | 'ig' | 'line' | 'tiktok')[];   // Phase A: ['fb_page']
  caption: string;
  hashtags: string[];
  media: { assetId: string; url: string; kind: 'image' | 'video' }[];
  imagePrompt?: string;              // prompt สำหรับสร้างภาพพื้นหลัง (ทาง A: ให้คนเอาไปใช้ใน ChatGPT)
  sourceSnapshot: { seq: number; generatedAt: string; data: unknown }; // S-4.2
  autonomyLevel: 'L0' | 'L1' | 'L2';
  status: 'draft' | 'pending_approval' | 'approved' | 'scheduled'
        | 'published' | 'failed' | 'rejected' | 'expired';
  scheduledAt?: string;
  expiresAt?: string;                // S-4.4
  approvedBy?: string;
  rejectReason?: string;             // ใช้ปรับ prompt รอบถัดไป
  platformPostId?: string;
  metrics?: { reach?: number; reactions?: number; comments?: number; shares?: number;
              messagesWithin24h?: number; fetchedAt: string };
  createdAt: string; updatedAt: string;
};

type Asset = {
  id: string;
  url: string;
  kind: 'image' | 'video';
  source: 'real' | 'ai' | 'template';
  consent: 'not_needed' | 'recorded' | 'missing';  // รูปที่มีคน = ต้อง recorded
  tags: string[];                     // เช่น ['table', 'night', 'tournament']
  allowedTemplates?: string[];
  uploadedBy: string; createdAt: string;
};
```

## 4. Brand guide — 88 Snooker Club

อ้างอิงโลโก้: `brand/logo-master.jpg` (badge navy-ทอง, ไม้คิวไขว้, ลูกสนุก, EST. 2026)

### 4.1 สี

| Token | Hex | ใช้กับ |
|---|---|---|
| `--navy` | `#0C1D55` | พื้นหลังหลัก แถบหัวข้อ |
| `--navy-deep` | `#0C0C1A` | พื้นหลังลึก เงา vignette |
| `--gold` | `#D9AB54` | หัวข้อ ตัวเลขสำคัญ กรอบ |
| `--gold-light` | `#EFE19E` | ไฮไลต์ ขอบประกาย |
| `--gold-dark` | `#9A6725` | เส้นขอบ เงาตัวอักษรทอง |
| `--white` | `#FAFAFA` | เนื้อหาบนพื้น navy |
| `--accent-red` | `#C8102E` | ป้าย "โปร"/"ด่วน" เท่านั้น ใช้น้อย |

กฎ: พื้น navy + ตัวอักษรทอง/ขาว; ห้ามตัวทองบนพื้นขาว; สีแดงไม่เกิน 10% ของพื้นที่

### 4.2 ตัวอักษร (Google Fonts, ฝังใน renderer)
- หัวข้อ EN: **Zilla Slab** Bold (เข้ากับ slab serif ในโลโก้)
- หัวข้อ TH: **Kanit** SemiBold/Bold
- เนื้อหา TH/EN: **Sarabun** Regular/Medium
- ตัวเลขราคา/เวลา: Zilla Slab Bold สีทอง

### 4.3 น้ำเสียง
- ภูมิฐานแต่เป็นกันเอง — "คลับที่สมาชิกรู้จักกัน"
- ประโยคสั้น ชัด ไม่ขายแรง ไม่ใช้คำเกินจริง ("ที่สุดในประเทศ", "ถูกที่สุด")
- อีโมจิ ≤ 3 ต่อโพสต์ จากชุด: 🎱 🏆 ✨ 🕗 📍
- ลงท้ายด้วย CTA เดียว เช่น "ทักแชทเพจเพื่อจองโต๊ะ"
- เล่นกับเลข 88 ได้ (เช่น โปรวันที่ 8, 8 โมง–8 ทุ่ม) แต่ไม่เกิน 1 ครั้ง/โพสต์
- คำต้องห้าม: แทงพนัน, ได้เงิน, การันตีชนะ, คำพาดพิงร้านอื่น

### 4.4 โลโก้
- โลโก้ master เป็นแบบ 3D รายละเอียดสูง → ใช้ในโพสต์ขนาดใหญ่เท่านั้น
- ต้องเตรียมเพิ่ม: `logo-transparent.png` (พื้นโปร่ง) และ `logo-flat.svg` (2 สี navy/ทอง) สำหรับลายน้ำและขนาดเล็ก
- ลายน้ำ: มุมขวาล่าง กว้าง 12% ของภาพ, opacity 90%

## 5. Templates (Phase A)

ทุก template = HTML + CSS ใช้ token สีข้างบน, render ด้วย Playwright ที่ 1080×1080 (และ 1080×1350 สำหรับ portrait ในอนาคต)

### Layout ร่วม
```
┌──────────────────────────────┐
│ [logo เล็ก] 88 SNOOKER CLUB  │  ← แถบบน navy-deep, ตัวทอง
│                              │
│      หัวข้อใหญ่ (ทอง)         │  ← กลาง: พื้น navy หรือภาพพื้นหลัง + overlay navy 55%
│      ข้อความรอง (ขาว)         │
│                              │
├──────────────────────────────┤
│ ราคา/เวลา (ขาว)   จองทางแชท ► │  ← แถบล่าง navy-deep
└──────────────────────────────┘
```

### T1 `daily_tables` — โต๊ะว่างวันนี้
- Signals: snapshot (`tables`, `queue`, `shop.isOpenNow`)
- เงื่อนไขสร้าง: ร้านเปิด, มีโต๊ะว่าง ≥ 2, snapshot ไม่ stale
- หัวข้อ: "คืนนี้โต๊ะว่าง {n} โต๊ะ" / "ว่างตอนนี้ {n} โต๊ะ"
- `expiresAt` = เวลาที่สร้าง + 60 นาที (S-4.4)
- ก่อนโพสต์: นับโต๊ะว่างใหม่จาก snapshot ล่าสุด ถ้าต่างจากในภาพ → regenerate (S-4.3)
- ความถี่สูงสุด: 1 ครั้ง/วัน

### T2 `happy_hour` — โปรช่วงเวลา
- Signals: `promotions` ที่ active + ช่วงเวลาที่ในอดีตโต๊ะว่างเยอะ (Phase C)
- ข้อมูลโปรทั้งหมดดึงจาก `promotions` เท่านั้น (S-3.1, S-4.2)
- `expiresAt` = `validTo` ของโปร

### T3 `tournament` — ประกาศ/ผลการแข่ง
- Signals: ข้อมูลการแข่งที่พนักงานกรอกใน Admin web (ชื่อรายการ, วัน, ค่าสมัคร, รางวัล, ผล)
- ชื่อผู้เล่นในโพสต์ผลการแข่ง ใส่ได้เฉพาะเมื่อมี consent (S-4.5)
- ห้ามคำที่สื่อการพนัน

## 6. ภาพพื้นหลัง

### ทาง A (Phase A) — ใช้ ChatGPT Plus แบบทำเอง
1. Generator สร้าง `imagePrompt` จาก template ด้านล่าง
2. Approval tab แสดง prompt พร้อมปุ่ม "คัดลอก"
3. เจ้าของสร้างภาพใน ChatGPT → ดาวน์โหลด → อัปโหลดเข้า Asset library (`source: 'ai'`)
4. เลือก asset ให้ ContentItem → re-render

> ChatGPT Plus ไม่มี API — ห้ามเขียน automation ไปควบคุมหน้าเว็บ ChatGPT

### ทาง B (Phase C) — API อัตโนมัติ
- Interface `ImageProvider { generate(prompt, size): Promise<Buffer[]> }`
- Implementation แรกอาจเป็น OpenAI Images API (ต้องมี API key แยก คิดเงินตามการใช้) หรือ provider อื่น
- สร้าง 3 ตัวเลือกให้เลือกในหน้าอนุมัติ

### Prompt template (ภาษาอังกฤษ)
```
Premium snooker club promotional background, {SCENE},
color palette deep navy blue (#0C1D55) and metallic gold (#D9AB54),
elegant classic club atmosphere, soft vignette, warm pendant lighting,
leave empty space at {TEXT_AREA} for text overlay,
NO text, NO letters, NO numbers, NO logos, NO people, NO faces, square 1:1
```
- `{SCENE}` ตัวอย่าง: `close-up of red snooker balls on green baize`, `cue tip chalk detail`, `trophy on dark wooden table`
- `{TEXT_AREA}`: `top third` / `center` / `bottom third`
- กฎ S-4.6, S-4.7: ไม่สร้างภาพที่ดูเหมือนรูปร้านจริง ไม่มีคน ไม่มีตัวอักษร

### วิดีโอ
- Phase A ไม่ทำวิดีโอ
- Phase C+: วิดีโอสั้นจาก **ฟุตเทจจริงของร้าน** + template overlay (Remotion หรือ ffmpeg)
- AI video provider ภายนอก (ถ้าใช้) ต้องผ่าน interface `VideoProvider` และกฎเดียวกับภาพ

## 7. Publisher — Facebook Page

- โพสต์รูป: `POST /{page-id}/photos` (caption ใน `message`)
- โพสต์ข้อความ/ลิงก์: `POST /{page-id}/feed`
- ตั้งเวลา: `published=false` + `scheduled_publish_time` (Unix) — ช่วงที่อนุญาต 10 นาที ถึง 30 วันข้างหน้า; **ต้องส่งคู่กันเสมอ** (S-4.9)
- Reels: ใช้ Reels Publishing API แยก, ตั้งเวลาด้วย Graph API ไม่ได้ → ใช้ scheduler ของ Cloud hub, มีเพดานจำนวนต่อ 24 ชม.
- รูปกับวิดีโอรวมในโพสต์เดียวไม่ได้
- โพสต์ลง Group ผ่าน API ไม่ได้
- ตรวจ Graph API version และชื่อ permission ล่าสุดจาก Meta docs ก่อน implement

### ลำดับการ publish
1. โหลด ContentItem สถานะ `approved`
2. เช็ก kill switch (S-1.5) และเพดาน L2 (S-4.8)
3. เช็ก `expiresAt` (S-4.4)
4. เช็ก snapshot ล่าสุดไม่ stale และตัวเลขตรงกับ `sourceSnapshot` (S-4.3)
5. อัปโหลด/โพสต์ → เก็บ `platformPostId` → status `scheduled` หรือ `published`
6. ล้มเหลว → retry 3 ครั้ง (backoff) → `failed` + แจ้งเจ้าของ
7. บันทึก audit log ทุกขั้น

### Scheduling strategy
- Facebook feed/photo: ใช้ native scheduling ของ Facebook (พนักงานเห็นใน Business Suite, โพสต์ขึ้นแม้ Cloud hub ล่ม)
  - ข้อยกเว้น: template ที่มี `expiresAt` สั้น (เช่น `daily_tables`) ให้ Cloud hub โพสต์เองตอนถึงเวลา เพื่อทำการตรวจซ้ำ S-4.3 ได้
- Reels และแพลตฟอร์มอื่น: scheduler ของ Cloud hub

## 8. Insights (Phase C)
- ดึงสถิติหลังโพสต์ 24 ชม. และ 7 วัน
- นับข้อความแชทที่เข้ามาใน 24 ชม. หลังโพสต์ เป็นตัวชี้วัดหลัก (ลูกค้าทักมาจอง)
- Planner ใช้ข้อมูลนี้ + `rejectReason` ปรับแผนสัปดาห์ถัดไป
