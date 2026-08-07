const MESSAGES = Object.freeze({
  DEVICE_NOT_FOUND:["ยังไม่พบกล่องควบคุม","ตรวจว่าเปิดเครื่องอยู่และเชื่อมต่อเราเตอร์เดียวกับคอมพิวเตอร์ แล้วลองใหม่",true],
  DEVICE_TIMEOUT:["ติดต่อกล่องควบคุมไม่สำเร็จ","ตรวจว่าเปิดเครื่องอยู่และเชื่อมต่อเครือข่ายเดียวกับคอมพิวเตอร์",true],
  NETWORK_UNREACHABLE:["ติดต่อกล่องควบคุมไม่ได้","ตรวจ IP และเครือข่าย แล้วลองใหม่",true],
  INVALID_DEVICE_RESPONSE:["อุปกรณ์ตอบกลับ แต่ไม่ใช่ Lucky Relay Controller ที่รองรับ","ตรวจว่าใส่เลขอุปกรณ์ถูกต้อง",false],
  UNSUPPORTED_API_VERSION:["เวอร์ชันของกล่องควบคุมยังไม่รองรับกับโปรแกรมรุ่นนี้","ติดต่อผู้ดูแลระบบเพื่ออัปเดตอย่างปลอดภัย",false],
  DEVICE_ID_MISMATCH:["ข้อมูลประจำตัวของกล่องควบคุมไม่ตรงกัน","ลองรีสตาร์ตกล่องแล้วตรวจสอบใหม่",true],
  RELAY_COUNT_MISMATCH:["จำนวน Relay ที่กล่องรายงานไม่ตรงกัน","ตรวจสอบการตั้งค่ากล่องควบคุม",true],
  WIFI_DISCONNECTED:["กล่องควบคุมยังไม่เชื่อมต่อ Wi-Fi","รอให้กล่องเชื่อมต่อ Wi-Fi แล้วลองใหม่",true],
  AUTHENTICATION_FAILED:["รหัสอุปกรณ์ไม่ถูกต้อง","ตรวจรหัสอุปกรณ์แล้วลองใหม่",true],
  RELAY_TEST_FAILED:["ทดสอบ Relay ไม่สำเร็จ","ตรวจการเชื่อมต่อแล้วลองทดสอบช่องนี้ใหม่",true],
  RELAY_CLEANUP_FAILED:["ไม่สามารถยืนยันว่าปิด Relay ทั้งหมดแล้ว","ปิดไฟเลี้ยงกล่องและตรวจสอบอุปกรณ์ทันที",true],
  DEVICE_ALREADY_EXISTS:["กล่องควบคุมนี้มีอยู่ในระบบแล้ว","เลือกอัปเดตข้อมูลอุปกรณ์เดิม",false],
  SAVE_FAILED:["บันทึกข้อมูลอุปกรณ์ไม่สำเร็จ","ลองใหม่อีกครั้งโดยข้อมูลเดิมยังไม่ถูกเปลี่ยน",true],
  OPERATION_CANCELLED:["ยกเลิกการตั้งค่าแล้ว","สามารถเริ่มตั้งค่าใหม่ได้ทุกเมื่อ",true],
  UNKNOWN_ERROR:["เกิดข้อผิดพลาดระหว่างตั้งค่า","ลองใหม่ หรือติดต่อผู้ดูแลระบบ",true]
});
const EXTRA_MESSAGES = Object.freeze({
  USB_REAUTHENTICATION_REQUIRED:["ยังไม่มีข้อมูลยืนยันกล่องนี้ในเครื่องคอมพิวเตอร์","กรุณาเชื่อมต่อ USB เพื่อเพิ่มกล่องอย่างปลอดภัย",true],
  DEVICE_ID_AMBIGUOUS:["พบข้อมูล Device ID ซ้ำ","กรุณาตรวจข้อมูลกล่องก่อนดำเนินการต่อ",false],
  AUTHENTICATION_REQUEST_REJECTED:["คำขอยืนยันอุปกรณ์ไม่ปลอดภัย","กรุณาเริ่มขั้นตอนใหม่โดยไม่กรอกรหัสอุปกรณ์",false]
});
class HardwareWizardError extends Error {
  constructor(code, technicalDetail, status=400) {
    const [userMessage,recoveryMessage,retryable]=MESSAGES[code]||EXTRA_MESSAGES[code]||MESSAGES.UNKNOWN_ERROR;
    super(userMessage); Object.assign(this,{code,userMessage,recoveryMessage,retryable,technicalDetail,status});
  }
  public() { return { code:this.code,userMessage:this.userMessage,recoveryMessage:this.recoveryMessage,retryable:this.retryable }; }
}
module.exports={HardwareWizardError,MESSAGES};
