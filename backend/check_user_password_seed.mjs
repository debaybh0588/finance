import pg from "pg";

const { Client } = pg;

async function main() {
  const client = new Client({
    host: process.env.POSTGRES_HOST || "localhost",
    port: Number(process.env.POSTGRES_PORT || 5432),
    database: process.env.POSTGRES_DB || "accounting_ai",
    user: process.env.POSTGRES_USER || "postgres",
    password: process.env.POSTGRES_PASSWORD || "postgres",
    ssl: false
  });

  await client.connect();

  const counts = await client.query(
    "SELECT count(*)::int AS total, count(*) FILTER (WHERE password_hash IS NULL)::int AS null_passwords FROM users"
  );

  const sample = await client.query(
    "SELECT email, role::text AS role, (password_hash IS NULL) AS is_null FROM users ORDER BY email LIMIT 25"
  );

  const migrations = await client.query(
    "SELECT filename FROM schema_migrations WHERE filename = '011_seed_legacy_user_passwords.sql'"
  );

  console.log(JSON.stringify({
    migrationApplied: migrations.rowCount === 1,
    counts: counts.rows[0],
    users: sample.rows
  }, null, 2));

  await client.end();
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
