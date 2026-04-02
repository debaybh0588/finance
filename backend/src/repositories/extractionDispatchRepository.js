import { getClient, query } from "../db/pool.js";

const selectColumns = `
  id,
  tenant_id AS "tenantId",
  branch_id AS "branchId",
  invoice_id AS "invoiceId",
  status,
  attempt_count AS "attemptCount",
  available_at AS "availableAt",
  locked_at AS "lockedAt",
  dispatched_at AS "dispatchedAt",
  last_http_status AS "lastHttpStatus",
  last_error AS "lastError",
  created_at AS "createdAt",
  updated_at AS "updatedAt"
`;

const selectColumnsQualified = `
  q.id,
  q.tenant_id AS "tenantId",
  q.branch_id AS "branchId",
  q.invoice_id AS "invoiceId",
  q.status,
  q.attempt_count AS "attemptCount",
  q.available_at AS "availableAt",
  q.locked_at AS "lockedAt",
  q.dispatched_at AS "dispatchedAt",
  q.last_http_status AS "lastHttpStatus",
  q.last_error AS "lastError",
  q.created_at AS "createdAt",
  q.updated_at AS "updatedAt"
`;

export const extractionDispatchRepository = {
  getClient,

  async enqueueInvoiceJob({ tenantId, branchId, invoiceId }, client = null) {
    const executor = client || { query };
    const result = await executor.query(
      `
        INSERT INTO extraction_dispatch_queue (
          tenant_id,
          branch_id,
          invoice_id,
          status,
          attempt_count,
          available_at,
          updated_at
        )
        VALUES ($1, $2, $3, 'PENDING', 0, NOW(), NOW())
        ON CONFLICT (invoice_id) DO NOTHING
        RETURNING ${selectColumns}
      `,
      [tenantId, branchId, invoiceId]
    );

    return result.rows[0] || null;
  },

  async claimPendingJobs(limit = 10, client = null) {
    const executor = client || { query };
    const safeLimit = Number.isFinite(Number(limit)) ? Math.max(1, Number(limit)) : 10;

    const result = await executor.query(
      `
        WITH picked AS (
          SELECT id
          FROM extraction_dispatch_queue
          WHERE status = 'PENDING'
            AND available_at <= NOW()
          ORDER BY available_at ASC, created_at ASC
          LIMIT $1
          FOR UPDATE SKIP LOCKED
        )
        UPDATE extraction_dispatch_queue q
        SET
          status = 'PROCESSING',
          attempt_count = q.attempt_count + 1,
          locked_at = NOW(),
          updated_at = NOW()
        FROM picked
        WHERE q.id = picked.id
        RETURNING ${selectColumnsQualified}
      `,
      [safeLimit]
    );

    return result.rows;
  },

  async markJobDispatched(jobId, { httpStatus = null } = {}, client = null) {
    const executor = client || { query };
    const result = await executor.query(
      `
        UPDATE extraction_dispatch_queue
        SET
          status = 'DISPATCHED',
          dispatched_at = NOW(),
          locked_at = NULL,
          last_http_status = $2,
          last_error = NULL,
          updated_at = NOW()
        WHERE id = $1
        RETURNING ${selectColumns}
      `,
      [jobId, httpStatus]
    );

    return result.rows[0] || null;
  },

  async markJobRetry(jobId, { delayMs = 5000, errorMessage = null, httpStatus = null } = {}, client = null) {
    const executor = client || { query };
    const safeDelayMs = Number.isFinite(Number(delayMs)) ? Math.max(500, Number(delayMs)) : 5000;

    const result = await executor.query(
      `
        UPDATE extraction_dispatch_queue
        SET
          status = 'PENDING',
          available_at = NOW() + (($2::text || ' milliseconds')::interval),
          locked_at = NULL,
          last_error = $3,
          last_http_status = $4,
          updated_at = NOW()
        WHERE id = $1
        RETURNING ${selectColumns}
      `,
      [jobId, safeDelayMs, errorMessage, httpStatus]
    );

    return result.rows[0] || null;
  },

  async markJobFailed(jobId, { errorMessage = null, httpStatus = null } = {}, client = null) {
    const executor = client || { query };
    const result = await executor.query(
      `
        UPDATE extraction_dispatch_queue
        SET
          status = 'FAILED',
          locked_at = NULL,
          last_error = $2,
          last_http_status = $3,
          updated_at = NOW()
        WHERE id = $1
        RETURNING ${selectColumns}
      `,
      [jobId, errorMessage, httpStatus]
    );

    return result.rows[0] || null;
  },

  async recoverStaleProcessingJobs(lockTimeoutMs = 10 * 60 * 1000, client = null) {
    const executor = client || { query };
    const safeTimeout = Number.isFinite(Number(lockTimeoutMs)) ? Math.max(30_000, Number(lockTimeoutMs)) : 600_000;

    const result = await executor.query(
      `
        UPDATE extraction_dispatch_queue
        SET
          status = 'PENDING',
          locked_at = NULL,
          available_at = NOW(),
          last_error = COALESCE(last_error, 'Worker lock timeout; re-queued'),
          updated_at = NOW()
        WHERE status = 'PROCESSING'
          AND locked_at IS NOT NULL
          AND locked_at < NOW() - (($1::text || ' milliseconds')::interval)
        RETURNING ${selectColumns}
      `,
      [safeTimeout]
    );

    return result.rows;
  }
};
