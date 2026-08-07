class HardwareController {
  constructor(service) { this.service = service; }
  sendError(res, error) {
    res.status(error.status || 500).json({ error: error.code || "HARDWARE_ERROR", message: error.status ? error.message : "ระบบจัดการ Hardware ไม่สามารถดำเนินการได้", ...(error.activeChannels ? { activeChannels: error.activeChannels } : {}), ...(error.emergency ? { emergency: error.emergency } : {}) });
  }
  handler(action, status = 200) {
    return async (req, res) => {
      try { res.status(status).json(await action.call(this, req)); } catch (error) { this.sendError(res, error); }
    };
  }
}

module.exports = { HardwareController };
