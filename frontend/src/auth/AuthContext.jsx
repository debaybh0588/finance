import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { authService } from "../api/authService.js";

const AUTH_STORAGE_KEY = "accounting_ai_auth";
const DEFAULT_DATE_RANGE = "all-time";

const AuthContext = createContext(null);

const readStoredSession = () => {
  try {
    const raw = localStorage.getItem(AUTH_STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
};

const persistSession = (session) => {
  localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(session));
};

const clearSession = () => {
  localStorage.removeItem(AUTH_STORAGE_KEY);
};

export function AuthProvider({ children }) {
  const [session, setSession] = useState(() => readStoredSession());
  const [tenants, setTenants] = useState([]);
  const [loading, setLoading] = useState(true);

  // currentSession is the just-persisted session used to auto-initialize
  // selectedTenantId/selectedBranchId if they weren't resolved during login/hydrate.
  const loadTenants = async (currentSession) => {
    try {
      const response = await authService.listTenants();
      const items = response.items || [];
      setTenants(items);

      // Auto-initialize scope if the session has no tenant selected yet.
      if (currentSession && !currentSession.selectedTenantId && items.length > 0) {
        const firstTenant = items[0];
        const defaultBranch =
          firstTenant.branches?.find((b) => b.isDefault) || firstTenant.branches?.[0] || null;
        setSession((prev) => {
          if (!prev || prev.selectedTenantId) return prev;
          const next = {
            ...prev,
            selectedTenantId: firstTenant.id,
            selectedBranchId: defaultBranch?.id || null
          };
          persistSession(next);
          return next;
        });
      }
    } catch {
      // Non-fatal: selectors stay empty if the endpoint is unreachable.
    }
  };

  const hydrate = async () => {
    const stored = readStoredSession();
    if (!stored?.token) {
      setSession(null);
      setLoading(false);
      return;
    }

    try {
      const me = await authService.me();
      const next = {
        token: stored.token,
        user: me.user,
        selectedTenantId: stored.selectedTenantId || me.scope?.selectedTenantId || null,
        selectedBranchId: stored.selectedBranchId || me.scope?.selectedBranchId || null,
        selectedDateRange: stored.selectedDateRange || DEFAULT_DATE_RANGE
      };
      persistSession(next);
      setSession(next);
      await loadTenants(next);
    } catch {
      clearSession();
      setSession(null);
      setTenants([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    hydrate();
  }, []);

  const login = async ({ email, password }) => {
    const data = await authService.login({ email, password });
    const next = {
      token: data.token,
      user: data.user,
      selectedTenantId: data.scope?.selectedTenantId || null,
      selectedBranchId: data.scope?.selectedBranchId || null,
      selectedDateRange: DEFAULT_DATE_RANGE
    };
    persistSession(next);
    setSession(next);
    await loadTenants(next);
    return data;
  };

  const logout = async () => {
    try {
      await authService.logout();
    } catch {
      // ignore logout network/token errors; client-side session clear is authoritative
    } finally {
      clearSession();
      setSession(null);
      setTenants([]);
    }
  };

  const setTenantBranchScope = ({ tenantId, branchId }) => {
    setSession((prev) => {
      if (!prev) return prev;
      const next = {
        ...prev,
        selectedTenantId: tenantId || prev.selectedTenantId,
        // Allow branchId to clear to null when switching tenants with no matching branch;
        // treat undefined as "keep existing", empty string as "none" (falls back to null).
        selectedBranchId: branchId !== undefined ? (branchId || null) : prev.selectedBranchId
      };
      persistSession(next);
      return next;
    });
  };

  const setDateRangeScope = (dateRange) => {
    setSession((prev) => {
      if (!prev) return prev;
      const next = {
        ...prev,
        selectedDateRange: dateRange || DEFAULT_DATE_RANGE
      };
      persistSession(next);
      return next;
    });
  };

  const branches = useMemo(() => {
    if (!session?.selectedTenantId) return [];
    const tenant = tenants.find((item) => item.id === session.selectedTenantId);
    return tenant?.branches || [];
  }, [tenants, session?.selectedTenantId]);

  const value = {
    loading,
    session,
    user: session?.user || null,
    isAuthenticated: Boolean(session?.token),
    tenants,
    branches,
    selectedTenantId: session?.selectedTenantId || null,
    selectedBranchId: session?.selectedBranchId || null,
    selectedDateRange: session?.selectedDateRange || DEFAULT_DATE_RANGE,
    login,
    logout,
    setTenantBranchScope,
    setDateRangeScope
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export const useAuth = () => {
  const value = useContext(AuthContext);
  if (!value) {
    throw new Error("useAuth must be used inside AuthProvider");
  }
  return value;
};
