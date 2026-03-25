import { configService } from "../services/configService.js";

export const configController = {
  async getTenantConfig(req, res) {
    const data = await configService.getTenantConfig(req.context);
    res.json({ success: true, data });
  }
};
