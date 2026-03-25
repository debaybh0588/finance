import { superAdminTenantService } from "../services/superAdminTenantService.js";

export const superAdminTenantController = {
  async listTenants(_req, res) {
    const data = await superAdminTenantService.listTenants();
    res.status(200).json({ success: true, data });
  },

  async getOnboardingTemplate(_req, res) {
    const data = await superAdminTenantService.getOnboardingTemplate();
    res.status(200).json({ success: true, data });
  },

  async testConnectivity(req, res) {
    const data = await superAdminTenantService.testConnectivity(req.body);
    res.status(200).json({ success: true, data });
  },

  async createTenant(req, res) {
    const data = await superAdminTenantService.createTenant(req.body);
    res.status(201).json({ success: true, data });
  },

  async updateTenant(req, res) {
    const data = await superAdminTenantService.updateTenant(req.params.tenantId, req.body);
    res.status(200).json({ success: true, data });
  },

  async createBranch(req, res) {
    const data = await superAdminTenantService.createBranch(req.params.tenantId, req.body);
    res.status(201).json({ success: true, data });
  },

  async replaceBranches(req, res) {
    const data = await superAdminTenantService.replaceBranches(req.params.tenantId, req.body);
    res.status(200).json({ success: true, data });
  },

  async upsertStorageConfig(req, res) {
    const data = await superAdminTenantService.upsertStorageConfig(req.params.tenantId, req.body);
    res.status(200).json({ success: true, data });
  },

  async upsertN8nConfig(req, res) {
    const data = await superAdminTenantService.upsertN8nConfig(req.params.tenantId, req.body);
    res.status(200).json({ success: true, data });
  },

  async upsertTenantAdminUser(req, res) {
    const data = await superAdminTenantService.upsertTenantAdminUser(req.params.tenantId, req.body);
    res.status(200).json({ success: true, data });
  },

  async upsertTallyConfig(req, res) {
    const data = await superAdminTenantService.upsertTallyConfig(req.params.tenantId, req.body);
    res.status(200).json({ success: true, data });
  },

  async getFullConfig(req, res) {
    const data = await superAdminTenantService.getFullConfig(req.params.tenantId);
    res.status(200).json({ success: true, data });
  },

  async deleteTenant(req, res) {
    const data = await superAdminTenantService.deleteTenant(req.params.tenantId);
    res.status(200).json({ success: true, data });
  }
};
