import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const MAX_BULK_UPLOAD_FILES = 10;
const MAX_FILE_SIZE_BYTES = 15 * 1024 * 1024;

let bulkInvoiceUpload;

try {
  const multer = require("multer");
  const storage = multer.memoryStorage();
  const upload = multer({
    storage,
    limits: {
      files: MAX_BULK_UPLOAD_FILES,
      fileSize: MAX_FILE_SIZE_BYTES
    }
  }).array("files[]", MAX_BULK_UPLOAD_FILES);

  bulkInvoiceUpload = (req, res, next) => {
    upload(req, res, (error) => {
      if (!error) {
        next();
        return;
      }

      if (error.code === "LIMIT_FILE_COUNT") {
        const mapped = new Error(`Maximum ${MAX_BULK_UPLOAD_FILES} files can be uploaded per request.`);
        mapped.statusCode = 400;
        mapped.code = "FILE_LIMIT_EXCEEDED";
        next(mapped);
        return;
      }

      if (error.code === "LIMIT_FILE_SIZE") {
        const mapped = new Error("One or more files exceeded the 15 MB limit.");
        mapped.statusCode = 400;
        mapped.code = "FILE_TOO_LARGE";
        next(mapped);
        return;
      }

      const mapped = new Error(error.message || "Invalid upload payload.");
      mapped.statusCode = 400;
      mapped.code = error.code || "UPLOAD_VALIDATION_ERROR";
      next(mapped);
    });
  };
} catch {
  bulkInvoiceUpload = (_req, _res, next) => {
    const error = new Error("Missing dependency 'multer'. Run: npm install --prefix backend multer@^1.4.5-lts.1");
    error.statusCode = 500;
    error.code = "MISSING_DEPENDENCY";
    next(error);
  };
}

export { bulkInvoiceUpload };
