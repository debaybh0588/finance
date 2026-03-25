import { tenantsService } from "../services/tenantsService.js";

export const tenantsController = {
  async list(req, res) {
    const data = await tenantsService.list(req.context);
    res.json({ success: true, data });
  },

  async listMy(req, res) {
    const data = await tenantsService.listMy(req.auth);
    res.json({ success: true, data });
  },

  async branchesForTenant(req, res) {
    const data = await tenantsService.branchesForTenant(req.params.tenantId, req.context);
    res.json({ success: true, data });
  },

  async getById(req, res) {
    const data = await tenantsService.getById(req.params.tenantId, req.context);
    res.json({ success: true, data });
  }
};
