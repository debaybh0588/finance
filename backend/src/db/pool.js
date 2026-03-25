import pg from "pg";
import { env } from "../config/env.js";

const { Pool } = pg;

export const pool = new Pool({
  host: env.postgres.host,
  port: env.postgres.port,
  database: env.postgres.database,
  user: env.postgres.user,
  password: env.postgres.password,
  ssl: env.postgres.ssl ? { rejectUnauthorized: false } : false
});

export const query = (text, params) => pool.query(text, params);

export const getClient = () => pool.connect();
