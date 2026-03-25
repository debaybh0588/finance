import { authService } from "../services/authService.js";

export const authController = {
  async login(req, res) {
    const data = await authService.login(req.body);
    res.status(200).json({ success: true, data });
  },

  async logout(_req, res) {
    res.status(200).json({ success: true, data: { loggedOut: true } });
  },

  async me(req, res) {
    const data = await authService.me(req.auth);
    res.status(200).json({ success: true, data });
  }
};
