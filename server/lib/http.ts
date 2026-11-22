// Small HTTP helpers for the route modules: async handler with uniform error
// mapping (no internal error text leaks to clients), zod validation and a
// per-user fixed-window rate limiter (in memory; Phase 3 moves it to a shared store).
import type { NextFunction, Request, Response } from "express";
import { z, ZodError, type ZodTypeAny } from "zod";
import { AccessError } from "../services/workspaces";

export interface AuthedRequest extends Request {
  user?: { userId: string; email: string; name: string };
}

export function uid(req: Request): string {
  return (req as AuthedRequest).user!.userId;
}

export function handle(fn: (req: AuthedRequest, res: Response) => Promise<unknown>) {
  return async (req: Request, res: Response, _next: NextFunction) => {
    try {
      const out = await fn(req as AuthedRequest, res);
      if (!res.headersSent) res.json(out ?? { ok: true });
    } catch (e) {
      if (res.headersSent) return;
      if (e instanceof AccessError) return res.status(e.status).json({ detail: e.message });
      if (e instanceof ZodError) {
        return res.status(400).json({ detail: "Geçersiz istek", issues: e.issues.map((i) => ({ path: i.path.join("."), message: i.message })) });
      }
      console.error(`[API] ${req.method} ${req.originalUrl} failed:`, e);
      res.status(500).json({ detail: "Beklenmeyen bir hata oluştu" });
    }
  };
}

export function parse<T extends ZodTypeAny>(schema: T, data: unknown): z.infer<T> {
  // Missing bodies/queries count as empty objects; scalar schemas see undefined (so defaults apply)
  return schema.parse(data === undefined && schema instanceof z.ZodObject ? {} : data);
}

const windows = new Map<string, { start: number; count: number }>();

/** Allow `max` requests per `windowMs` for each user (or IP when anonymous). */
export function rateLimit(bucket: string, max: number, windowMs = 60_000) {
  return (req: Request, res: Response, next: NextFunction) => {
    const who = (req as AuthedRequest).user?.userId || req.ip || "anon";
    const key = `${bucket}:${who}`;
    const now = Date.now();
    const w = windows.get(key);
    if (!w || now - w.start >= windowMs) {
      windows.set(key, { start: now, count: 1 });
      if (windows.size > 50_000) windows.clear();
      return next();
    }
    if (w.count >= max) {
      res.setHeader("Retry-After", String(Math.ceil((w.start + windowMs - now) / 1000)));
      return res.status(429).json({ detail: "Çok fazla istek. Lütfen biraz sonra tekrar dene." });
    }
    w.count++;
    next();
  };
}

export const isoDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export const id = z.string().min(1).max(200);
