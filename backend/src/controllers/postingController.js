import { postingService } from "../services/postingService.js";

export const postingController = {
  async list(req, res) {
    const data = await postingService.list(req.context, req.query);
    res.json({ success: true, data });
  },

  async summary(req, res) {
    const data = await postingService.summary(req.context, req.query);
    res.json({ success: true, data });
  },

  async reviewQueue(req, res) {
    const data = await postingService.listPostingReviewQueue(req.context, req.query);
    res.json({ success: true, data });
  },

  async reviewDetail(req, res) {
    const data = await postingService.getPostingReviewDetail(req.params.invoiceId, req.context);
    res.json({ success: true, data });
  },

  async reviewApprove(req, res) {
    const data = await postingService.approvePostingReview(req.params.invoiceId, req.context, req.body);
    res.status(200).json({ success: true, data });
  },

  async reviewReject(req, res) {
    const data = await postingService.rejectPostingReview(req.params.invoiceId, req.context, req.body);
    res.status(200).json({ success: true, data });
  },

  async retry(req, res) {
    const data = await postingService.retryPosting(req.params.invoiceId, req.context, req.body);
    res.status(200).json({ success: true, data });
  }
};
