import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pool } from "./pool.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const migrationsDir = path.resolve(__dirname, "../../sql/migrations");

const migrationTableSql = `
  CREATE TABLE IF NOT EXISTS schema_migrations (
    id BIGSERIAL PRIMARY KEY,
    filename TEXT NOT NULL UNIQUE,
    checksum TEXT NOT NULL,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )
`;

const hashContent = (content) => createHash("sha256").update(content).digest("hex");

async function getMigrationFiles() {
  const entries = await readdir(migrationsDir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".sql"))
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right));
}

async function ensureMigrationTable(client) {
  await client.query(migrationTableSql);
}

async function getAppliedMigrations(client) {
  const result = await client.query("SELECT filename, checksum FROM schema_migrations ORDER BY filename");
  return new Map(result.rows.map((row) => [row.filename, row.checksum]));
}

/**
 * Split a SQL file into individual statements, correctly handling:
 *   - Dollar-quoted strings  ($$ ... $$ and $tag$ ... $tag$)
 *   - Single-quoted strings  ('...' with '' escape)
 *   - Line comments          (-- ...)
 *   - Block comments         (/* ... *\/)
 *
 * Executing statements one-by-one is required because PostgreSQL rejects
 * ALTER TYPE ADD VALUE inside a multi-command string (simple query protocol),
 * even when the statement is outside a BEGIN/COMMIT block.
 */
function parseSqlStatements(sql) {
  const stmts = [];
  let i = 0;
  let start = 0;

  while (i < sql.length) {
    const ch = sql[i];

    // -- line comment: skip to end of line
    if (ch === "-" && sql[i + 1] === "-") {
      while (i < sql.length && sql[i] !== "\n") i++;
      continue;
    }

    // /* block comment */
    if (ch === "/" && sql[i + 1] === "*") {
      i += 2;
      while (i < sql.length - 1 && !(sql[i] === "*" && sql[i + 1] === "/")) i++;
      i += 2;
      continue;
    }

    // 'single-quoted string' with '' escape
    if (ch === "'") {
      i++;
      while (i < sql.length) {
        if (sql[i] === "'" && sql[i + 1] === "'") { i += 2; continue; }
        if (sql[i] === "'") { i++; break; }
        i++;
      }
      continue;
    }

    // $tag$dollar-quoted string$tag$ — tag is empty ($$) or word chars
    if (ch === "$") {
      let j = i + 1;
      while (j < sql.length && sql[j] !== "$" && sql[j] !== "\n" && /\w/.test(sql[j])) j++;
      if (j < sql.length && sql[j] === "$") {
        const tag = sql.slice(i, j + 1); // e.g. "$$" or "$func$"
        i = j + 1;
        const closeIdx = sql.indexOf(tag, i);
        i = closeIdx >= 0 ? closeIdx + tag.length : sql.length;
        continue;
      }
    }

    // Semicolon = statement boundary
    if (ch === ";") {
      const stmt = sql.slice(start, i).trim();
      if (stmt) stmts.push(stmt);
      start = i + 1;
    }

    i++;
  }

  const tail = sql.slice(start).trim();
  if (tail) stmts.push(tail);

  // Drop whitespace-only or pure-comment fragments
  return stmts.filter((s) => s.replace(/--[^\n]*/g, "").trim());
}

async function applyMigration(client, filename) {
  const filePath = path.join(migrationsDir, filename);
  const sql = await readFile(filePath, "utf8");
  const checksum = hashContent(sql);

  // Execute statements individually so that ALTER TYPE ADD VALUE (which cannot
  // be sent as part of a multi-command string) works correctly at any PG version.
  for (const stmt of parseSqlStatements(sql)) {
    await client.query(stmt);
  }

  await client.query("INSERT INTO schema_migrations (filename, checksum) VALUES ($1, $2)", [filename, checksum]);

  return checksum;
}

async function main() {
  const client = await pool.connect();

  try {
    await ensureMigrationTable(client);
    const appliedMigrations = await getAppliedMigrations(client);
    const migrationFiles = await getMigrationFiles();

    if (migrationFiles.length === 0) {
      console.log("No migration files found.");
      return;
    }

    for (const filename of migrationFiles) {
      const filePath = path.join(migrationsDir, filename);
      const content = await readFile(filePath, "utf8");
      const checksum = hashContent(content);
      const appliedChecksum = appliedMigrations.get(filename);

      if (appliedChecksum) {
        if (appliedChecksum !== checksum) {
          throw new Error(`Migration checksum mismatch for ${filename}.`);
        }

        console.log(`Skipping ${filename} (already applied).`);
        continue;
      }

      console.log(`Applying ${filename}...`);
      await applyMigration(client, filename);
      console.log(`Applied ${filename}.`);
    }

    console.log("All migrations are up to date.");
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
