import { auditService } from "../services/auditService.js";

export const auditController = {
  async list(req, res) {
    const data = await auditService.list(req.context, req.query);
    res.json({ success: true, data });
  }
};
