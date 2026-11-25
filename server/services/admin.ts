// Platform administration (Phase 3a): the SaaS operator manages members
// (users), plans and subscriptions and sees payments and the audit log.
// Who is an operator comes only from INKWELL_ADMIN_EMAILS (comma separated);
// nothing in the database can make someone an operator.
import { and, desc, eq, gte, ilike, or, sql } from "drizzle-orm";
import { db, users, workspaces, workspaceMembers, notes, files, aiRuns, payments, auditLogs, subscriptions } from "../../src/db/index";
import { AccessError, ensurePersonalWorkspace } from "./workspaces";
import { audit, effectivePlan, workspaceUsage } from "./billing";

export function adminEmails(env: NodeJS.ProcessEnv = process.env): Set<string> {
  return new Set(
    (env.INKWELL_ADMIN_EMAILS || "")
      .split(",")
      .map((e) => e.trim().toLowerCase())
      .filter((e) => e.includes("@"))
  );
}

export function isPlatformAdminEmail(email: string | null | undefined, env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(email) && adminEmails(env).has(String(email).toLowerCase());
}

function monthStart(d = new Date()): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}

export async function adminStats() {
  const [u] = await db.select({ n: sql<number>`count(*)` }).from(users);
  const [d] = await db.select({ n: sql<number>`count(*)` }).from(users).where(eq(users.disabled, true));
  const since30 = new Date(Date.now() - 30 * 24 * 3600 * 1000);
  const [active] = await db.select({ n: sql<number>`count(*)` }).from(users).where(gte(users.lastLoginAt, since30));
  const [teams] = await db.select({ n: sql<number>`count(*)` }).from(workspaces).where(eq(workspaces.kind, "team"));
  const [paid] = await db
    .select({ n: sql<number>`count(*)` })
    .from(subscriptions)
    .where(sql`${subscriptions.currentPeriodEnd} IS NULL OR ${subscriptions.currentPeriodEnd} > now()`);
  const revenue = await db
    .select({ currency: payments.currency, total: sql<string>`coalesce(sum(cast(${payments.amount} as numeric)), 0)::text`, n: sql<number>`count(*)` })
    .from(payments)
    .where(and(eq(payments.status, "paid"), gte(payments.paidAt, since30)))
    .groupBy(payments.currency);
  const [ai] = await db.select({ n: sql<number>`count(*)` }).from(aiRuns).where(and(eq(aiRuns.keySource, "server"), gte(aiRuns.createdAt, monthStart())));
  return {
    users: Number(u?.n || 0),
    disabled_users: Number(d?.n || 0),
    active_users_30d: Number(active?.n || 0),
    team_workspaces: Number(teams?.n || 0),
    active_subscriptions: Number(paid?.n || 0),
    revenue_30d: revenue.map((r: any) => ({ currency: r.currency, total: r.total, payments: Number(r.n) })),
    server_ai_calls_month: Number(ai?.n || 0),
  };
}

/** Users with their personal workspace plan and usage, newest first. */
export async function adminUsers(q = "", limit = 100, offset = 0) {
  const where = q.trim() ? or(ilike(users.email, `%${q.trim()}%`), ilike(users.name, `%${q.trim()}%`)) : undefined;
  const rows = await db
    .select({ userId: users.userId, email: users.email, name: users.name, createdAt: users.createdAt, lastLoginAt: users.lastLoginAt, disabled: users.disabled, authProvider: users.authProvider })
    .from(users)
    .where(where as any)
    .orderBy(desc(users.createdAt))
    .limit(Math.min(Math.max(limit, 1), 200))
    .offset(Math.max(offset, 0));
  const [total] = await db.select({ n: sql<number>`count(*)` }).from(users).where(where as any);
  const out = [];
  for (const r of rows as any[]) {
    const ws = await ensurePersonalWorkspace(r.userId);
    const { plan, subscription } = await effectivePlan(ws.workspaceId);
    const usage = await workspaceUsage(ws.workspaceId);
    const [teams] = await db
      .select({ n: sql<number>`count(*)` })
      .from(workspaceMembers)
      .innerJoin(workspaces, eq(workspaces.workspaceId, workspaceMembers.workspaceId))
      .where(and(eq(workspaceMembers.userId, r.userId), eq(workspaces.kind, "team")));
    out.push({
      user_id: r.userId,
      email: r.email,
      name: r.name,
      auth_provider: r.authProvider,
      created_at: r.createdAt.toISOString(),
      last_login_at: r.lastLoginAt ? r.lastLoginAt.toISOString() : null,
      disabled: Boolean(r.disabled),
      is_admin: isPlatformAdminEmail(r.email),
      workspace_id: ws.workspaceId,
      plan_key: plan.planKey,
      plan_name: plan.name,
      subscription,
      usage,
      team_count: Number(teams?.n || 0),
    });
  }
  return { total: Number(total?.n || 0), users: out };
}

/** Team workspaces with owner, members, plan and usage. */
export async function adminWorkspaces(limit = 200) {
  const rows = await db
    .select({ ws: workspaces, ownerEmail: users.email })
    .from(workspaces)
    .leftJoin(users, eq(users.userId, workspaces.ownerId))
    .where(eq(workspaces.kind, "team"))
    .orderBy(desc(workspaces.createdAt))
    .limit(Math.min(Math.max(limit, 1), 500));
  const out = [];
  for (const r of rows as any[]) {
    const { plan, subscription } = await effectivePlan(r.ws.workspaceId);
    out.push({
      workspace_id: r.ws.workspaceId,
      name: r.ws.name,
      owner_email: r.ownerEmail,
      created_at: r.ws.createdAt.toISOString(),
      plan_key: plan.planKey,
      plan_name: plan.name,
      subscription,
      usage: await workspaceUsage(r.ws.workspaceId),
    });
  }
  return out;
}

export async function adminSetUserDisabled(adminId: string, userId: string, disabled: boolean) {
  if (adminId === userId) throw new AccessError(400, "Kendi hesabını devre dışı bırakamazsın");
  const u = (await db.select({ email: users.email }).from(users).where(eq(users.userId, userId)).limit(1))[0];
  if (!u) throw new AccessError(404, "Üye bulunamadı");
  if (disabled && isPlatformAdminEmail(u.email)) throw new AccessError(400, "Bir platform yöneticisi devre dışı bırakılamaz");
  await db.update(users).set({ disabled }).where(eq(users.userId, userId));
  await audit(adminId, disabled ? "admin.user_disabled" : "admin.user_enabled", "user", userId, { email: u.email });
  return { ok: true, disabled };
}

/** One user's objects/files counts and recent payments (no note contents). */
export async function adminUserDetail(userId: string) {
  const u = (await db.select().from(users).where(eq(users.userId, userId)).limit(1))[0];
  if (!u) throw new AccessError(404, "Üye bulunamadı");
  const [n] = await db.select({ n: sql<number>`count(*)` }).from(notes).where(eq(notes.userId, userId));
  const [f] = await db.select({ n: sql<number>`count(*)` }).from(files).where(and(eq(files.userId, userId), eq(files.isDeleted, false)));
  const pays = await db.select().from(payments).where(eq(payments.userId, userId)).orderBy(desc(payments.createdAt)).limit(20);
  return {
    user_id: u.userId,
    email: u.email,
    name: u.name,
    objects: Number(n?.n || 0),
    files: Number(f?.n || 0),
    payments: pays.map((p: any) => ({ payment_id: p.paymentId, plan_key: p.planKey, period: p.period, amount: p.amount, currency: p.currency, status: p.status, created_at: p.createdAt.toISOString() })),
  };
}

export async function adminAudit(limit = 200, action?: string) {
  const rows = await db
    .select({ a: auditLogs, email: users.email })
    .from(auditLogs)
    .leftJoin(users, eq(users.userId, auditLogs.actorId))
    .where(action ? ilike(auditLogs.action, `${action}%`) : (undefined as any))
    .orderBy(desc(auditLogs.createdAt))
    .limit(Math.min(Math.max(limit, 1), 500));
  return rows.map((r: any) => ({
    audit_id: r.a.auditId,
    actor_id: r.a.actorId,
    actor_email: r.email || null,
    action: r.a.action,
    target_type: r.a.targetType,
    target_id: r.a.targetId,
    details: r.a.details,
    created_at: r.a.createdAt.toISOString(),
  }));
}
