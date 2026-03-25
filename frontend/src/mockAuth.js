export const mockAuthState = {
  // Change to "super_admin" to simulate super admin access.
  role: "normal_user"
};

export const isSuperAdmin = () => mockAuthState.role === "super_admin";
