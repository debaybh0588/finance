export const configService = {
  async getTenantConfig(context) {
    return {
      tenantId: context.tenantId,
      branchId: context.branchId,
      storage: null,
      n8n: null,
      tally: null,
      placeholder: true
    };
  }
};
