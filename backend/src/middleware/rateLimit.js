const createError = (message, statusCode, code) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
};

const toPositiveInt = (value, fallback) => {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.floor(n);
};

export const createInMemoryRateLimiter = ({
  windowMs = 60 * 1000,
  max = 10,
  keyFn = null
} = {}) => {
  const store = new Map();
  const resolvedWindowMs = toPositiveInt(windowMs, 60 * 1000);
  const resolvedMax = toPositiveInt(max, 10);

  return (req, _res, next) => {
    const now = Date.now();
    const key =
      (typeof keyFn === "function" ? keyFn(req) : null) ||
      req.context?.tenantId ||
      req.auth?.userId ||
      req.ip ||
      "anonymous";

    const current = store.get(key);
    if (!current || now >= current.resetAt) {
      store.set(key, { count: 1, resetAt: now + resolvedWindowMs });
      next();
      return;
    }

    if (current.count >= resolvedMax) {
      const waitSeconds = Math.max(1, Math.ceil((current.resetAt - now) / 1000));
      next(
        createError(
          `Rate limit exceeded. Try again in ${waitSeconds}s.`,
          429,
          "RATE_LIMIT_EXCEEDED"
        )
      );
      return;
    }

    current.count += 1;
    store.set(key, current);
    next();
  };
};

