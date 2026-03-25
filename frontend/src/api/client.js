const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || (import.meta.env.DEV ? "http://localhost:4000/api" : "/api");
const AUTH_STORAGE_KEY = "accounting_ai_auth";

const getSessionHeaders = () => {
  try {
    const raw = localStorage.getItem(AUTH_STORAGE_KEY);
    if (!raw) return {};

    const session = JSON.parse(raw);
    const headers = {};

    if (session?.token) {
      headers.Authorization = `Bearer ${session.token}`;
    }

    if (session?.selectedTenantId) {
      headers["x-tenant-id"] = session.selectedTenantId;
    }

    if (session?.selectedBranchId) {
      headers["x-branch-id"] = session.selectedBranchId;
    }

    return headers;
  } catch {
    return {};
  }
};

const toError = (message, code = "REQUEST_FAILED") => {
  const error = new Error(message);
  error.code = code;
  return error;
};

const request = async (path, { method = "GET", body, isMultipart = false } = {}) => {
  const headers = {
    ...getSessionHeaders()
  };

  if (!isMultipart) {
    headers["Content-Type"] = "application/json";
  }

  const response = await fetch(`${API_BASE_URL}${path}`, {
    method,
    headers,
    body: body ? (isMultipart ? body : JSON.stringify(body)) : undefined
  });

  const json = await response.json().catch(() => ({}));

  if (!response.ok || json.success === false) {
    const message = json?.error?.message || `Request failed with status ${response.status}`;
    const code = json?.error?.code || "REQUEST_FAILED";
    throw toError(message, code);
  }

  return json;
};

const requestBlob = async (path, { method = "GET", body } = {}) => {
  const headers = {
    ...getSessionHeaders()
  };

  const response = await fetch(`${API_BASE_URL}${path}`, {
    method,
    headers,
    body
  });

  if (!response.ok) {
    const json = await response.json().catch(() => ({}));
    const message = json?.error?.message || `Request failed with status ${response.status}`;
    const code = json?.error?.code || "REQUEST_FAILED";
    throw toError(message, code);
  }

  return response.blob();
};

export const get = async (path, options = {}) => {
  const response = await request(path, { ...options, method: "GET" });
  return response.data;
};

export const post = async (path, body, options = {}) => {
  const response = await request(path, { ...options, method: "POST", body });
  return response.data;
};

export const postMultipart = async (path, formData, options = {}) => {
  const response = await request(path, { ...options, method: "POST", body: formData, isMultipart: true });
  return response;
};

export const patch = async (path, body, options = {}) => {
  const response = await request(path, { ...options, method: "PATCH", body });
  return response.data;
};

export const put = async (path, body, options = {}) => {
  const response = await request(path, { ...options, method: "PUT", body });
  return response.data;
};

export const del = async (path, options = {}) => {
  const response = await request(path, { ...options, method: "DELETE" });
  return response.data;
};

export const getBlob = async (path, options = {}) => requestBlob(path, { ...options, method: "GET" });
