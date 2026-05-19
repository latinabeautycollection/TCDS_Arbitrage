import { Router } from "express";

const router = Router();

router.get("/healthz", (_req, res) => {
  res.status(200).json({ ok: true });
});

export default router;
