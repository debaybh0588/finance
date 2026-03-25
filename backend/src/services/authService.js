import { authRepository } from "../repositories/authRepository.js";
import { authTokenService } from "./authTokenService.js";

const createError = (message, statusCode, code) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
};

const normalize = (value) => (typeof value === "string" ? value.trim() : "");

const toScope = async (user) => {
  const tenants = await authRepository.listAccessibleTenants(user);
  const resolvedTenantId = user.tenantId || tenants[0]?.id || null;
  const branches = resolvedTenantId ? await authRepository.listAccessibleBranches(user, resolvedTenantId) : [];

  return {
    tenants,
    branches,
    selectedTenantId: resolvedTenantId,
    selectedBranchId: user.defaultBranchId || branches.find((branch) => branch.isDefault)?.id || branches[0]?.id || null
  };
};

export const authService = {
  async login(payload = {}) {
    const email = normalize(payload.email).toLowerCase();
    const password = normalize(payload.password);

    if (!email || !password) {
      throw createError("email and password are required", 400, "VALIDATION_ERROR");
    }

    const user = await authRepository.findUserByEmailAndPassword(email, password);

    if (!user || !user.isActive) {
      throw createError("Invalid credentials", 401, "INVALID_CREDENTIALS");
    }

    const token = authTokenService.createToken({
      userId: user.id,
      role: user.role,
      tenantId: user.tenantId,
      branchId: user.defaultBranchId,
      email: user.email,
      fullName: user.fullName
    });

    const scope = await toScope(user);

    return {
      token,
      user: {
        id: user.id,
        email: user.email,
        fullName: user.fullName,
        role: user.role
      },
      scope
    };
  },

  async me(auth) {
    if (!auth?.userId) {
      throw createError("Unauthorized", 401, "UNAUTHORIZED");
    }

    const user = await authRepository.findUserByEmail(auth.email);
    if (!user || !user.isActive) {
      throw createError("Unauthorized", 401, "UNAUTHORIZED");
    }

    const scope = await toScope(user);

    return {
      user: {
        id: user.id,
        email: user.email,
        fullName: user.fullName,
        role: user.role
      },
      scope
    };
  }
};
