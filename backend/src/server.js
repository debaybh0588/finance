import app from "./app.js";
import { env } from "./config/env.js";
import { pool } from "./db/pool.js";
import { tallyRuntimeService } from "./services/tallyRuntimeService.js";
import { extractionDispatchService } from "./services/extractionDispatchService.js";

const server = app.listen(env.port, () => {
  console.log(`Backend listening on port ${env.port}`);
  tallyRuntimeService.startScheduler();
  extractionDispatchService.startScheduler();
});

const shutdown = async (signal) => {
  console.log(`${signal} received, closing backend`);

  server.close(async () => {
    tallyRuntimeService.stopScheduler();
    extractionDispatchService.stopScheduler();
    await pool.end();
    process.exit(0);
  });
};

process.on("SIGINT", () => {
  shutdown("SIGINT");
});

process.on("SIGTERM", () => {
  shutdown("SIGTERM");
});
