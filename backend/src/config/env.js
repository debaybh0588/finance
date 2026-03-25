import dotenv from "dotenv";

dotenv.config();

const toBool = (value, defaultValue = false) => {
  if (value === undefined) return defaultValue;
  return value === "true" || value === "1";
};

export const env = {
  nodeEnv: process.env.NODE_ENV || "development",
  port: Number(process.env.PORT || 4000),
  postgres: {
    host: process.env.POSTGRES_HOST || "localhost",
    port: Number(process.env.POSTGRES_PORT || 5432),
    database: process.env.POSTGRES_DB || "accounting_ai",
    user: process.env.POSTGRES_USER || "postgres",
    password: process.env.POSTGRES_PASSWORD || "postgres",
    ssl: toBool(process.env.POSTGRES_SSL, false)
  },
  defaults: {
    tenantId: process.env.DEFAULT_TENANT_ID || "tenant_demo",
    branchId: process.env.DEFAULT_BRANCH_ID || "branch_main"
  },
  integrations: {
    n8nBaseUrl: process.env.N8N_BASE_URL || "",
    n8nApiKey: process.env.N8N_API_KEY || "",
    tallyBaseUrl: process.env.TALLY_BASE_URL || "",
    tallyApiKey: process.env.TALLY_API_KEY || ""
  }
};
