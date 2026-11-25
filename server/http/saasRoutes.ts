// Phase 3a API: billing (plans, usage, iyzico Checkout Form), team
// workspaces and invitations, and the platform admin panel. Mounted under
// /api by server.ts. Admin routes answer 404 to everyone who is not listed
// in INKWELL_ADMIN_EMAILS, so their existence is not revealed.
import express, { type NextFunction, type Request, type RequestHandler, type Response } from "express";
import { z } from "zod";
import { handle, parse, uid, rateLimit, id, type AuthedRequest } from "../lib/http";
import {
  billingOverview, saveBillingProfile, startCheckout, completeCheckout, listPlans, serializePlan,
  adminSetSubscription, adminClearSubscription, adminUpsertPlan, adminPayments,
} from "../services/billing";
import {
  listMyWorkspaces, createTeamWorkspace, renameWorkspace, workspaceDetail, workspaceObjects, changeMemberRole, removeMember,
  inviteMember, revokeInvitation, invitationPreview, acceptInvitation,
} from "../services/teams";
import { AccessError } from "../services/workspaces";
import { isPlatformAdminEmail, adminStats, adminUsers, adminWorkspaces, adminSetUserDisabled, adminUserDetail, adminAudit } from "../services/admin";

const role = z.enum(["admin", "editor", "commenter", "viewer"]);
const money = z.union([z.string(), z.number()]).transform((v) => String(v).trim().replace(",", "."));

/** Origin the browser used, for iyzico's callback (PUBLIC_BASE_URL wins when set). */
export function publicBaseUrl(req: Request): string {
  const fixed = (process.env.PUBLIC_BASE_URL || "").trim();
  if (fixed) return fixed.replace(/\/$/, "");
  const proto = String(req.headers["x-forwarded-proto"] || req.protocol || "http").split(",")[0].trim();
  const host = String(req.headers["x-forwarded-host"] || req.headers.host || "localhost").split(",")[0].trim();
  return `${proto}://${host}`;
}

export function createSaasRouter(auth: RequestHandler) {
  const r = express.Router();

  // ------------------------------------------------------------- billing
  // iyzico posts the token to this URL (form-encoded) after the payment page;
  // it carries no session, so it is not behind auth. The result is read back
  // from iyzico and verified before anything changes.
  r.post(
    "/billing/iyzico/callback",
    express.urlencoded({ extended: false, limit: "16kb" }),
    rateLimit("iyzico-callback", 60),
    async (req: Request, res: Response) => {
      const token = typeof req.body?.token === "string" ? req.body.token : "";
      let out: { ok: boolean; message: string };
      try {
        out = await completeCheckout(token);
      } catch (e) {
        console.error("[Billing] callback failed:", e);
        out = { ok: false, message: "Ödeme doğrulanamadı" };
      }
      const q = new URLSearchParams({ tab: "billing", payment: out.ok ? "ok" : "failed", message: out.message });
      res.redirect(303, `/settings?${q.toString()}`);
    }
  );

  r.use(["/billing", "/plans", "/workspaces", "/invitations", "/admin"], auth);

  r.get("/plans", handle(async () => (await listPlans()).map(serializePlan)));
  r.get(
    "/billing",
    handle(async (req) => billingOverview(uid(req), parse(z.object({ workspace_id: id.optional() }), req.query).workspace_id))
  );
  const profileBody = z.object({
    full_name: z.string().trim().min(3).max(120),
    phone: z.string().trim().regex(/^\+?[0-9 ()-]{10,20}$/, "Telefon numarası geçersiz"),
    address: z.string().trim().min(5).max(300),
    city: z.string().trim().min(2).max(60),
    country: z.string().trim().min(2).max(60).optional(),
    zip_code: z.string().trim().max(12).optional().nullable(),
    identity_number: z.string().trim().regex(/^\d{11}$/, "T.C. kimlik numarası 11 haneli olmalı").optional().nullable().or(z.literal("")),
  });
  r.put("/billing/profile", handle(async (req) => saveBillingProfile(uid(req), parse(profileBody, req.body) as any)));
  r.post(
    "/billing/checkout",
    rateLimit("checkout", 10),
    handle(async (req) => {
      const b = parse(z.object({ workspace_id: id.optional().nullable(), plan_key: id, period: z.enum(["month", "year"]) }), req.body);
      return startCheckout(uid(req), b as any, { publicBaseUrl: publicBaseUrl(req), ip: req.ip || null });
    })
  );

  // ----------------------------------------------------------- workspaces
  r.get("/workspaces", handle(async (req) => listMyWorkspaces(uid(req))));
  r.post(
    "/workspaces",
    rateLimit("ws-create", 10),
    handle(async (req) => createTeamWorkspace(uid(req), parse(z.object({ name: z.string().trim().min(2).max(80) }), req.body).name))
  );
  r.get("/workspaces/:id", handle(async (req) => workspaceDetail(uid(req), req.params.id)));
  r.put(
    "/workspaces/:id",
    handle(async (req) => renameWorkspace(uid(req), req.params.id, parse(z.object({ name: z.string().trim().min(2).max(80) }), req.body).name))
  );
  r.get(
    "/workspaces/:id/objects",
    handle(async (req) => {
      const q = parse(z.object({ space_id: id.optional(), limit: z.coerce.number().int().min(1).max(500).optional() }), req.query);
      return workspaceObjects(uid(req), req.params.id, q.space_id, q.limit);
    })
  );
  r.patch(
    "/workspaces/:id/members/:userId",
    handle(async (req) => changeMemberRole(uid(req), req.params.id, req.params.userId, parse(z.object({ role }), req.body).role))
  );
  r.delete("/workspaces/:id/members/:userId", handle(async (req) => removeMember(uid(req), req.params.id, req.params.userId)));
  r.post(
    "/workspaces/:id/invitations",
    rateLimit("invite", 30),
    handle(async (req) => {
      const b = parse(z.object({ email: z.string().trim().email().max(200), role: role.default("editor") }), req.body);
      return inviteMember(uid(req), req.params.id, b.email, b.role);
    })
  );
  r.delete("/workspaces/:id/invitations/:invId", handle(async (req) => revokeInvitation(uid(req), req.params.id, req.params.invId)));
  r.get("/invitations/:token", rateLimit("invite-view", 30), handle(async (req) => invitationPreview(uid(req), req.params.token)));
  r.post("/invitations/:token/accept", rateLimit("invite-accept", 10), handle(async (req) => acceptInvitation(uid(req), req.params.token)));

  // ---------------------------------------------------------------- admin
  r.get("/admin/me", handle(async (req) => ({ is_admin: isPlatformAdminEmail((req as AuthedRequest).user?.email) })));
  const adminOnly = (req: Request, res: Response, next: NextFunction) => {
    if (!isPlatformAdminEmail((req as AuthedRequest).user?.email)) return res.status(404).json({ detail: "Bulunamadı" });
    next();
  };
  r.use("/admin", adminOnly);
  r.get("/admin/stats", handle(async () => adminStats()));
  r.get(
    "/admin/users",
    handle(async (req) => {
      const q = parse(z.object({ q: z.string().max(200).default(""), limit: z.coerce.number().int().min(1).max(200).default(100), offset: z.coerce.number().int().min(0).default(0) }), req.query);
      return adminUsers(q.q, q.limit, q.offset);
    })
  );
  r.get("/admin/users/:id", handle(async (req) => adminUserDetail(req.params.id)));
  r.patch(
    "/admin/users/:id",
    handle(async (req) => adminSetUserDisabled(uid(req), req.params.id, parse(z.object({ disabled: z.boolean() }), req.body).disabled))
  );
  r.get("/admin/workspaces", handle(async () => adminWorkspaces()));
  r.put(
    "/admin/workspaces/:id/subscription",
    handle(async (req) => {
      const b = parse(
        z.object({ plan_key: id, period_end: z.string().datetime({ offset: true }).or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).nullable(), note: z.string().max(300).optional().nullable() }),
        req.body
      );
      const end = b.period_end ? new Date(b.period_end.length === 10 ? `${b.period_end}T23:59:59Z` : b.period_end) : null;
      if (end && isNaN(end.getTime())) throw new AccessError(400, "Geçersiz tarih");
      return adminSetSubscription(uid(req), req.params.id, b.plan_key, end, b.note);
    })
  );
  r.delete("/admin/workspaces/:id/subscription", handle(async (req) => adminClearSubscription(uid(req), req.params.id)));
  r.get("/admin/plans", handle(async () => (await listPlans(true)).map(serializePlan)));
  const planBody = z.object({
    name: z.string().trim().min(1).max(60),
    description: z.string().max(300).optional(),
    price_monthly: money,
    price_yearly: money,
    currency: z.enum(["TRY", "USD", "EUR"]).optional(),
    limits: z.record(z.union([z.number(), z.string(), z.null()])).optional(),
    features: z.array(z.string().max(80)).max(12).optional(),
    is_active: z.boolean().optional(),
    is_default: z.boolean().optional(),
    sort_order: z.number().int().min(0).max(1000).optional(),
  });
  r.post(
    "/admin/plans",
    handle(async (req) => {
      const b = parse(planBody.extend({ plan_key: z.string().regex(/^[a-z][a-z0-9_-]{1,30}$/, "Anahtar küçük harf, rakam, - ve _ olabilir") }), req.body);
      return adminUpsertPlan(uid(req), b as any, true);
    })
  );
  r.put("/admin/plans/:key", handle(async (req) => adminUpsertPlan(uid(req), { ...(parse(planBody, req.body) as any), plan_key: req.params.key }, false)));
  r.get("/admin/payments", handle(async () => adminPayments()));
  r.get(
    "/admin/audit",
    handle(async (req) => {
      const q = parse(z.object({ action: z.string().max(60).optional(), limit: z.coerce.number().int().min(1).max(500).default(200) }), req.query);
      return adminAudit(q.limit, q.action);
    })
  );

  return r;
}
