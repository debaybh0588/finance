import { invoicesService } from "../services/invoicesService.js";

export const invoicesController = {
  async bulkUpload(req, res) {
    const result = await invoicesService.bulkUploadInvoices({
      context: req.context,
      body: req.body,
      files: req.files || []
    });
    res.status(201).json(result);
  },

  async dashboard(req, res) {
    const data = await invoicesService.dashboard(req.context, req.query);
    res.json({ success: true, data });
  },

  async list(req, res) {
    const data = await invoicesService.list({
      context: req.context,
      query: req.query
    });
    res.json({ success: true, data });
  },

  async register(req, res) {
    const data = await invoicesService.registerInvoice(req.context, req.body);
    res.status(201).json({ success: true, data });
  },

  async getById(req, res) {
    const data = await invoicesService.getById(req.params.id, req.context);
    res.json({ success: true, data });
  },

  async review(req, res) {
    const data = await invoicesService.reviewInvoice(req.params.id, req.context, req.body);
    res.json({ success: true, data });
  },

  async extractionStarted(req, res) {
    const data = await invoicesService.markExtractionStarted(req.params.id, req.context, req.body);
    res.status(200).json({ success: true, data });
  },

  async extractionResult(req, res) {
    const data = await invoicesService.applyExtractionResult(req.params.id, req.context, req.body);
    res.status(200).json({ success: true, data });
  },

  async extractionFailed(req, res) {
    const data = await invoicesService.markExtractionFailed(req.params.id, req.context, req.body);
    res.status(200).json({ success: true, data });
  },

  async extractionRetry(req, res) {
    const data = await invoicesService.retryExtraction(req.params.id, req.context, req.body);
    res.status(200).json({ success: true, data });
  },

  async runtimeContext(req, res) {
    const data = await invoicesService.getRuntimeContext(req.params.id, req.context);
    res.status(200).json({ success: true, data });
  },

  async approve(req, res) {
    const data = await invoicesService.approveInvoice(req.params.id, req.context, req.body);
    res.status(200).json({ success: true, data });
  },

  async reject(req, res) {
    const data = await invoicesService.rejectInvoice(req.params.id, req.context, req.body);
    res.status(200).json({ success: true, data });
  },

  async postingStarted(req, res) {
    const data = await invoicesService.startPosting(req.params.id, req.context, req.body);
    res.status(200).json({ success: true, data });
  },

  async postingExecutor(req, res) {
    const data = await invoicesService.executePosting(req.params.id, req.context, req.body);
    res.status(200).json({ success: true, data });
  },

  async postingDraft(req, res) {
    const data = await invoicesService.savePostingDraft(req.params.id, req.context, req.body);
    res.status(200).json({ success: true, data });
  },

  async postingResult(req, res) {
    const data = await invoicesService.applyPostingResult(req.params.id, req.context, req.body);
    res.status(200).json({ success: true, data });
  },

  async postingFailed(req, res) {
    const data = await invoicesService.markPostingFailed(req.params.id, req.context, req.body);
    res.status(200).json({ success: true, data });
  },

  async activity(req, res) {
    const data = await invoicesService.recordActivity(req.params.id, req.context, req.body);
    res.status(201).json({ success: true, data });
  }
};
