# ขั้นตอน Test Signing Key

Pipeline สร้าง Ed25519 key pair ใหม่ทุกครั้งด้วย Node.js CSPRNG Private key อยู่ใน memory ระหว่าง process เท่านั้น ไม่เขียนลง package, Backend, logs หรือ repository ส่วน public key เขียนไว้ที่ `runtime/firmware-packages/test/.test-keys` เพื่อใช้ตรวจ Test Package และ directory นี้ถูก ignore

ข้อห้าม:

- ห้ามใช้ Test key กับ production channel
- ห้าม commit `.pem`, `.key`, private seed หรือ exported private key
- ห้ามใส่ private key ใน portable package
- ห้ามสร้าง Production private keyด้วย script นี้

ก่อน production release ต้องสร้าง key ceremony และระบบเก็บ private keyภายนอก repository/ร้าน แล้วติดตั้งเฉพาะ public keyใน Backend package

