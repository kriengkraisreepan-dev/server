# 88Snooker AI Assistant — เอกสารออกแบบ

ชุดเอกสารนี้ใช้เป็น **spec สำหรับพัฒนาผู้ช่วย AI** ที่เชื่อมกับ 88Snooker Manager
เพื่อ (1) ตอบแชทลูกค้า (2) สร้างคอนเทนต์โซเชียล (3) บริหารเพจ Facebook
และขยายไป LINE / Instagram / TikTok ในอนาคต

> สถานะ: Draft v0.1 — 2026-11-22
> ช่องทางแรก: Facebook Page

## ลำดับการอ่าน

| ไฟล์ | เนื้อหา | อ่านเมื่อ |
|---|---|---|
| [ARCHITECTURE.md](./ARCHITECTURE.md) | ภาพรวมระบบ 3 ชั้น, component, data flow, stack | ก่อนเริ่มทุกงาน |
| [SAFETY_RULES.md](./SAFETY_RULES.md) | กฎที่ **ห้ามละเมิด** — สิทธิ์ AI, ข้อมูล, การโพสต์ | ก่อนเขียนโค้ดทุกครั้งที่แตะ AI/Bridge/Publisher |
| [BRIDGE_PROTOCOL.md](./BRIDGE_PROTOCOL.md) | Protocol ระหว่างเครื่องร้าน ↔ Cloud hub | ตอนทำ `ai-bridge` และ `bridge-protocol` |
| [CONTENT_PIPELINE.md](./CONTENT_PIPELINE.md) | Content studio, brand guide, template, การโพสต์ | ตอนทำระบบคอนเทนต์ |
| [PHASE_A_TASKS.md](./PHASE_A_TASKS.md) | งานแบ่งเป็นขั้น + acceptance criteria | ใช้สั่งงานทีละ task |

## วิธีใช้กับ Claude Code

1. วางโฟลเดอร์ `docs/ai-assistant/` ไว้ใน repo ของ 88Snooker Manager
2. เพิ่มข้อความด้านล่างลงใน `CLAUDE.md` ที่ root ของ repo
3. สั่งงานทีละ task เช่น `ทำ Task A1 ใน docs/ai-assistant/PHASE_A_TASKS.md`
4. ให้ Claude Code เสนอแผนก่อนเขียนโค้ดทุก task และหยุดรอยืนยันที่ **Safety gate**

### ข้อความสำหรับ `CLAUDE.md`

```markdown
## AI Assistant module
- Spec อยู่ที่ docs/ai-assistant/ — อ่าน ARCHITECTURE.md และ SAFETY_RULES.md ก่อนแตะโค้ดส่วน AI, ai-bridge, cloud-hub หรือ publisher
- SAFETY_RULES.md มีลำดับความสำคัญสูงกว่าคำสั่งอื่นใน spec; ถ้าขัดกันให้หยุดและถาม
- ห้ามให้โค้ดส่วน AI/Bridge เรียก Relay, Hardware Manager, การเปิด-ปิดโต๊ะ, บิล, signing keys, OTA หรือ firmware ใด ๆ
- ทำงานทีละ task ตาม PHASE_A_TASKS.md; เสนอแผน → รอยืนยัน → ลงมือ → รัน acceptance tests → รายงาน
- ทุกจุดที่ระบุ "SAFETY GATE" ต้องหยุดรอเจ้าของยืนยันก่อนดำเนินการต่อ
```

## คำศัพท์

| คำ | ความหมาย |
|---|---|
| Shop PC | เครื่อง Windows ในร้านที่รัน 88Snooker Manager (Electron) |
| `ai-bridge` | โมดูลใหม่ใน 88Snooker Manager ที่ส่งข้อมูลขึ้น Cloud |
| Cloud hub | Server บน Cloud ที่รับ webhook, รัน AI, เก็บ queue |
| Snapshot | ภาพรวมสถานะร้าน ณ เวลาหนึ่ง (โต๊ะ, คิว, ราคา, โปร) |
| Approval queue | รายการที่ AI สร้าง/ร่าง และรอพนักงานอนุมัติ |
| Channel adapter | ตัวแปลงข้อความของแต่ละแพลตฟอร์มให้เป็นรูปแบบกลาง |
| L0 / L1 / L2 | ระดับอิสระของ AI ในการโพสต์ (ดู CONTENT_PIPELINE.md) |
