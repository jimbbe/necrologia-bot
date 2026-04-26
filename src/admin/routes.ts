import { Router, Request, Response } from "express";
import rateLimit from "express-rate-limit";
import { login, validateToken } from "./auth.js";
import { config } from "../config.js";
import { getAllSessionsSnapshot } from "../session.js";
import { cancelSessionFromAdmin } from "../handler.js";
import { forceReconnect, forceNewQR } from "../whatsapp.js";
import { getAllNumbers, addNumber, removeNumber } from "../whitelist.js";

const startTime = Date.now();

// Track WA status in memory (updated by ws.ts event listeners)
let waStatus: string = "connecting";
export function setWaStatus(s: string): void { waStatus = s; }

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: { error: "Too many login attempts. Try again in 15 minutes." },
  standardHeaders: true,
  legacyHeaders: false,
});

function authMiddleware(req: Request, res: Response, next: () => void): void {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const token = header.slice(7);
  if (!validateToken(token)) {
    res.status(401).json({ error: "Invalid or expired token" });
    return;
  }
  next();
}

export function createRouter(): Router {
  const router = Router();

  router.post("/login", loginLimiter, (req: Request, res: Response) => {
    const password = req.body?.password;
    if (!password) {
      res.status(400).json({ error: "Password required" });
      return;
    }
    const token = login(password);
    if (!token) {
      res.status(401).json({ error: "Invalid password" });
      return;
    }
    res.json({ token });
  });

  router.get("/health", (_req: Request, res: Response) => {
    res.json({ status: "ok", waStatus, uptime: Math.floor((Date.now() - startTime) / 1000) });
  });

  // All routes below require auth
  router.use(authMiddleware);

  router.get("/status", (_req: Request, res: Response) => {
    res.json({
      waStatus,
      sessions: getAllSessionsSnapshot().length,
      uptime: Math.floor((Date.now() - startTime) / 1000),
    });
  });

  router.get("/sessions", (_req: Request, res: Response) => {
    res.json(getAllSessionsSnapshot());
  });

  router.post("/sessions/:jid/cancel", async (req: Request, res: Response) => {
    const jid = decodeURIComponent(req.params.jid as string);
    const ok = await cancelSessionFromAdmin(jid);
    if (ok) {
      res.json({ success: true });
    } else {
      res.status(404).json({ error: "Session not found" });
    }
  });

  router.post("/reconnect", async (_req: Request, res: Response) => {
    try {
      await forceReconnect();
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  router.post("/force-qr", async (_req: Request, res: Response) => {
    try {
      await forceNewQR();
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  router.get("/config", (_req: Request, res: Response) => {
    res.json({
      PREVIEW_ONLY: config.PREVIEW_ONLY,
      DRY_RUN: config.DRY_RUN,
      AI_MODEL: config.AI_MODEL,
      SESSION_TIMEOUT_MS: config.SESSION_TIMEOUT_MS,
      MAX_HISTORY: config.MAX_HISTORY,
      ADMIN_PORT: config.ADMIN_PORT,
      FRONTEND_URL: config.FRONTEND_URL,
      BACKEND_URL: config.BACKEND_URL,
    });
  });

  router.get("/numbers", (_req: Request, res: Response) => {
    res.json(getAllNumbers());
  });

  router.post("/numbers", (req: Request, res: Response) => {
    const number = req.body?.number;
    const label = req.body?.label;
    if (!number || typeof number !== "string") {
      res.status(400).json({ error: "number is required" });
      return;
    }
    const clean = number.replace(/[^0-9]/g, "");
    if (!clean) {
      res.status(400).json({ error: "Invalid number" });
      return;
    }
    const ok = addNumber(clean, label);
    if (ok) {
      res.json({ success: true, number: clean });
    } else {
      res.status(409).json({ error: "Number already exists" });
    }
  });

  router.delete("/numbers/:number", (req: Request, res: Response) => {
    const ok = removeNumber(req.params.number as string);
    if (ok) {
      res.json({ success: true });
    } else {
      res.status(404).json({ error: "Number not found" });
    }
  });

  return router;
}
