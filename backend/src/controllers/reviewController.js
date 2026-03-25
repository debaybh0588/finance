import path from "node:path";
import { reviewService } from "../services/reviewService.js";

export const reviewController = {
  async queue(req, res) {
    const data = await reviewService.queue(req.context, req.query);
    res.json({ success: true, data });
  },

  async getDetail(req, res) {
    const data = await reviewService.getDetail(req.params.invoiceId, req.context);
    res.json({ success: true, data });
  },

  async getFile(req, res) {
    const file = await reviewService.getFile(req.params.invoiceId, req.context);
    const filePath = path.resolve(file.path);

    res.setHeader("Content-Type", file.mimeType || "application/octet-stream");
    if (file.fileName) {
      const safeName = String(file.fileName).replace(/["\r\n]/g, "_");
      res.setHeader("Content-Disposition", `inline; filename="${safeName}"`);
    }

    res.sendFile(filePath);
  },

  async update(req, res) {
    const data = await reviewService.update(req.params.invoiceId, req.context, req.body);
    res.status(200).json({ success: true, data });
  },

  async reject(req, res) {
    const data = await reviewService.reject(req.params.invoiceId, req.context, req.body);
    res.status(200).json({ success: true, data });
  }
};
