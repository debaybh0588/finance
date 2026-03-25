import { get, post } from "./client.js";

export const authService = {
  login(payload) {
    return post("/auth/login", payload);
  },

  logout() {
    return post("/auth/logout", {});
  },

  me() {
    return get("/auth/me");
  },

  listTenants() {
    return get("/tenants/my");
  },

  getBranches(tenantId) {
    return get(`/tenants/${tenantId}/branches`);
  }
};
