// Plans, quotas and iyzico period payments (Phase 3a).
//
// Every workspace has an effective plan: its subscription while the paid (or
// admin-granted) period lasts, else the default plan. Limits are checked when
// something is created; going over a limit never deletes anything, it only
// stops new objects, uploads, members or server-key AI calls.
//
// Payment: one Checkout Form payment per period (no stored cards, no
// automatic renewal). A payment counts only after the retrieve call says
// SUCCESS, the response signature verifies and amount, currency and basket
// match the pending order. Paying again extends the current period.
import crypto from "crypto";
import { and, desc, eq, gte, isNull, or, sql } from "drizzle-orm";
import {
  db, plans, subscriptions, payments, workspaces, workspaceMembers, notes, files, aiRuns, users, billingProfiles, auditLogs, invitations,
  type PlanLimits,
} from "../../src/db/index";
import { AccessError, ensurePersonalWorkspace } from "./workspaces";
import { genId } from "./notesCore";
import { encryptSecret, decryptSecret } from "../lib/secrets";
import {
  iyzicoConfig, isSandbox, formatPrice, initializeCheckout, retrieveCheckout, verifyRetrieveSignature, splitName, addPeriod,
} from "../lib/iyzico";

export type Period = "month" | "year";
export type QuotaKind = "objects" | "storage_mb" | "members" | "ai_calls_month";

const QUOTA_MESSAGES: Record<QuotaKind, string> = {
  objects: "Paketindeki nesne sınırına ulaştın. Yeni nesne eklemek için paketini yükselt ya da eski nesneleri arşivlemek yerine sil.",
  storage_mb: "Paketindeki dosya depolama sınırına ulaştın. Paketini yükselt ya da kullanmadığın dosyaları sil.",
  members: "Çalışma alanının paketindeki üye sınırına ulaşıldı. Daha fazla üye için paketi yükselt.",
  ai_calls_month: "Bu ayki yapay zeka kotan doldu. Paketini yükselt ya da Ayarlar > Yapay Zeka'dan kendi API anahtarını kullan.",
};

/** 402 Payment Required: a plan limit stops the action. Nothing is deleted. */
export class QuotaError extends AccessError {
  kind: QuotaKind;
  constructor(kind: QuotaKind) {
    super(402, QUOTA_MESSAGES[kind]);
    this.kind = kind;
  }
}

// ------------------------------------------------------------------ audit
export async function audit(actorId: string | null, action: string, targetType: string | null, targetId: string | null, details: Record<string, unknown> = {}) {
  try {
    await db.insert(auditLogs).values({ auditId: genId("aud"), actorId, action, targetType, targetId, details });
  } catch (e) {
    console.warn("[Audit] not recorded:", (e as Error).message);
  }
}

// ------------------------------------------------------------------ plans
type PlanRow = typeof plans.$inferSelect;

export function serializePlan(p: PlanRow) {
  return {
    plan_key: p.planKey,
    name: p.name,
    description: p.description,
    price_monthly: p.priceMonthly,
    price_yearly: p.priceYearly,
    currency: p.currency,
    limits: p.limits || {},
    features: p.features || [],
    is_active: p.isActive,
    is_default: p.isDefault,
    sort_order: p.sortOrder,
  };
}

export async function listPlans(includeInactive = false) {
  const rows = await db.select().from(plans).orderBy(plans.sortOrder, plans.planKey);
  return (rows as PlanRow[]).filter((p) => includeInactive || p.isActive);
}

async function planByKey(key: string): Promise<PlanRow | null> {
  const r = await db.select().from(plans).where(eq(plans.planKey, key)).limit(1);
  return r[0] || null;
}

async function defaultPlan(): Promise<PlanRow> {
  const r = await db.select().from(plans).where(eq(plans.isDefault, true)).limit(1);
  if (r[0]) return r[0];
  const any = await db.select().from(plans).orderBy(plans.sortOrder).limit(1);
  if (any[0]) return any[0];
  // No plans at all (should not happen after migration 012): no limits
  return { planKey: "free", name: "Ücretsiz", description: "", priceMonthly: "0", priceYearly: "0", currency: "TRY", limits: {}, features: [], isActive: true, isDefault: true, sortOrder: 0, createdAt: new Date(), updatedAt: new Date() };
}

/** Effective plan of a workspace and the subscription behind it. */
export async function effectivePlan(workspaceId: string) {
  const sub = (await db.select().from(subscriptions).where(eq(subscriptions.workspaceId, workspaceId)).limit(1))[0] || null;
  const now = new Date();
  const active = Boolean(sub && (!sub.currentPeriodEnd || sub.currentPeriodEnd > now));
  const plan = active ? (await planByKey(sub!.planKey)) || (await defaultPlan()) : await defaultPlan();
  return {
    plan,
    subscription: sub
      ? {
          plan_key: sub.planKey,
          period: sub.period,
          current_period_end: sub.currentPeriodEnd ? sub.currentPeriodEnd.toISOString() : null,
          source: sub.source,
          active,
        }
      : null,
  };
}

/** -1 or a missing limit means unlimited. */
export function withinLimit(limit: number | undefined, used: number, adding = 1): boolean {
  if (limit === undefined || limit === null || limit < 0) return true;
  return used + adding <= limit;
}

function monthStart(d = new Date()): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}

/** Current usage of a workspace. Storage and AI calls belong to the owner of a personal workspace. */
export async function workspaceUsage(workspaceId: string) {
  const ws = (await db.select().from(workspaces).where(eq(workspaces.workspaceId, workspaceId)).limit(1))[0];
  if (!ws) throw new AccessError(404, "Çalışma alanı bulunamadı");
  const personal = ws.kind === "personal";
  const objCond = personal
    ? or(eq(notes.workspaceId, workspaceId), and(eq(notes.userId, ws.ownerId), isNull(notes.workspaceId)))
    : eq(notes.workspaceId, workspaceId);
  const [o] = await db.select({ n: sql<number>`count(*)` }).from(notes).where(objCond);
  const [m] = await db.select({ n: sql<number>`count(*)` }).from(workspaceMembers).where(eq(workspaceMembers.workspaceId, workspaceId));
  const [pending] = await db
    .select({ n: sql<number>`count(*)` })
    .from(invitations)
    .where(and(eq(invitations.workspaceId, workspaceId), isNull(invitations.acceptedAt), isNull(invitations.revokedAt), gte(invitations.expiresAt, new Date())));
  let storageBytes = 0;
  let aiCalls = 0;
  if (personal) {
    const [s] = await db
      .select({ n: sql<number>`coalesce(sum(${files.size}), 0)` })
      .from(files)
      .where(and(eq(files.userId, ws.ownerId), eq(files.isDeleted, false)));
    storageBytes = Number(s?.n || 0);
    const [a] = await db
      .select({ n: sql<number>`count(*)` })
      .from(aiRuns)
      .where(and(eq(aiRuns.userId, ws.ownerId), eq(aiRuns.keySource, "server"), gte(aiRuns.createdAt, monthStart())));
    aiCalls = Number(a?.n || 0);
  }
  return {
    objects: Number(o?.n || 0),
    storage_mb: Math.round((storageBytes / (1024 * 1024)) * 10) / 10,
    storage_bytes: storageBytes,
    members: Number(m?.n || 0),
    pending_invitations: Number(pending?.n || 0),
    ai_calls_month: aiCalls,
  };
}

/**
 * Throws QuotaError when adding `amount` would pass the limit. Objects are
 * counted in the workspace they go into; storage and AI calls on the user's
 * personal workspace plan.
 */
export async function checkQuota(userId: string, kind: QuotaKind, opts: { workspaceId?: string | null; amount?: number } = {}) {
  const workspaceId = kind === "storage_mb" || kind === "ai_calls_month" || !opts.workspaceId ? (await ensurePersonalWorkspace(userId)).workspaceId : opts.workspaceId;
  const { plan } = await effectivePlan(workspaceId);
  const limit = (plan.limits as PlanLimits)?.[kind];
  if (limit === undefined || limit === null || limit < 0) return;
  const u = await workspaceUsage(workspaceId);
  const used = kind === "members" ? u.members + u.pending_invitations : kind === "storage_mb" ? u.storage_bytes / (1024 * 1024) : (u as any)[kind];
  const adding = kind === "storage_mb" ? (opts.amount || 0) / (1024 * 1024) : opts.amount ?? 1;
  if (!withinLimit(limit, used, adding)) throw new QuotaError(kind);
}

/** True when the user may still make a server-key AI call this month (cached briefly). */
const aiQuotaCache = new Map<string, { ok: boolean; at: number }>();
export async function serverAiAllowed(userId: string): Promise<boolean> {
  const hit = aiQuotaCache.get(userId);
  if (hit && Date.now() - hit.at < 30_000) return hit.ok;
  let ok = true;
  try {
    await checkQuota(userId, "ai_calls_month");
  } catch (e) {
    if (e instanceof QuotaError) ok = false;
  }
  aiQuotaCache.set(userId, { ok, at: Date.now() });
  if (aiQuotaCache.size > 10_000) aiQuotaCache.clear();
  return ok;
}

// ---------------------------------------------------------------- billing
export async function requireWorkspaceRole(userId: string, workspaceId: string, roles: string[]) {
  const r = await db
    .select({ role: workspaceMembers.role })
    .from(workspaceMembers)
    .where(and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, userId)))
    .limit(1);
  if (!r[0]) throw new AccessError(404, "Çalışma alanı bulunamadı");
  if (!roles.includes(r[0].role)) throw new AccessError(403, "Bu işlem için çalışma alanında yönetici olmalısın");
  return r[0].role as string;
}

function serializePayment(p: typeof payments.$inferSelect) {
  return {
    payment_id: p.paymentId,
    workspace_id: p.workspaceId,
    user_id: p.userId,
    plan_key: p.planKey,
    period: p.period,
    amount: p.amount,
    currency: p.currency,
    status: p.status,
    provider: p.provider,
    error: p.error,
    period_end: p.periodEnd ? p.periodEnd.toISOString() : null,
    created_at: p.createdAt.toISOString(),
    paid_at: p.paidAt ? p.paidAt.toISOString() : null,
  };
}

export async function getBillingProfile(userId: string) {
  const r = (await db.select().from(billingProfiles).where(eq(billingProfiles.userId, userId)).limit(1))[0];
  if (!r) return null;
  let idHint: string | null = null;
  if (r.identityNumberEnc) {
    try {
      idHint = `•••••••${decryptSecret(r.identityNumberEnc).slice(-4)}`;
    } catch {
      idHint = null;
    }
  }
  return { full_name: r.fullName, phone: r.phone, address: r.address, city: r.city, country: r.country, zip_code: r.zipCode, identity_number_hint: idHint };
}

export async function saveBillingProfile(
  userId: string,
  input: { full_name: string; phone: string; address: string; city: string; country?: string; zip_code?: string | null; identity_number?: string | null }
) {
  const values: any = {
    userId,
    fullName: input.full_name.trim(),
    phone: input.phone.trim(),
    address: input.address.trim(),
    city: input.city.trim(),
    country: (input.country || "Turkey").trim(),
    zipCode: input.zip_code ? input.zip_code.trim() : null,
    updatedAt: new Date(),
  };
  if (input.identity_number) values.identityNumberEnc = encryptSecret(input.identity_number.trim());
  const existing = await db.select({ u: billingProfiles.userId }).from(billingProfiles).where(eq(billingProfiles.userId, userId)).limit(1);
  if (existing.length) {
    const { userId: _u, ...set } = values;
    await db.update(billingProfiles).set(set).where(eq(billingProfiles.userId, userId));
  } else await db.insert(billingProfiles).values(values);
  return getBillingProfile(userId);
}

/** Billing page data for one workspace (default: the user's personal one). */
export async function billingOverview(userId: string, workspaceId?: string | null) {
  const wsId = workspaceId || (await ensurePersonalWorkspace(userId)).workspaceId;
  const role = await requireWorkspaceRole(userId, wsId, ["owner", "admin", "editor", "commenter", "viewer"]);
  const ws = (await db.select().from(workspaces).where(eq(workspaces.workspaceId, wsId)).limit(1))[0];
  const { plan, subscription } = await effectivePlan(wsId);
  const cfg = iyzicoConfig();
  const pays = await db.select().from(payments).where(eq(payments.workspaceId, wsId)).orderBy(desc(payments.createdAt)).limit(50);
  return {
    workspace: { workspace_id: wsId, name: ws.name, kind: ws.kind, role },
    plan: serializePlan(plan),
    subscription,
    usage: await workspaceUsage(wsId),
    plans: (await listPlans()).map(serializePlan),
    payments: pays.map(serializePayment),
    profile: await getBillingProfile(userId),
    payment: { configured: Boolean(cfg), provider: "iyzico", sandbox: cfg ? isSandbox(cfg) : null },
    can_manage: ["owner", "admin"].includes(role),
  };
}

function priceFor(plan: PlanRow, period: Period): string {
  return period === "year" ? plan.priceYearly : plan.priceMonthly;
}

/**
 * Starts a Checkout Form payment for one period of a plan. Returns the
 * iyzico page to send the browser to. The order is stored as pending first.
 */
export async function startCheckout(
  userId: string,
  input: { workspace_id?: string | null; plan_key: string; period: Period },
  ctx: { publicBaseUrl: string; ip?: string | null }
) {
  const cfg = iyzicoConfig();
  if (!cfg) throw new AccessError(503, "Ödeme altyapısı yapılandırılmamış (IYZICO_API_KEY / IYZICO_SECRET_KEY).");
  const wsId = input.workspace_id || (await ensurePersonalWorkspace(userId)).workspaceId;
  await requireWorkspaceRole(userId, wsId, ["owner", "admin"]);
  const plan = await planByKey(input.plan_key);
  if (!plan || !plan.isActive) throw new AccessError(404, "Paket bulunamadı");
  const amount = priceFor(plan, input.period);
  if (!(Number(amount) > 0)) throw new AccessError(400, "Bu paket ücretsiz; ödeme gerekmiyor");
  const profileRow = (await db.select().from(billingProfiles).where(eq(billingProfiles.userId, userId)).limit(1))[0];
  if (!profileRow) throw new AccessError(400, "Önce fatura bilgilerini gir");
  const user = (await db.select().from(users).where(eq(users.userId, userId)).limit(1))[0];
  let identity = "11111111111";
  if (profileRow.identityNumberEnc) {
    try {
      identity = decryptSecret(profileRow.identityNumberEnc);
    } catch {
      /* keep placeholder */
    }
  }
  const paymentId = genId("pay");
  const price = formatPrice(amount);
  await db.insert(payments).values({ paymentId, workspaceId: wsId, userId, planKey: plan.planKey, period: input.period, amount: price, currency: plan.currency, status: "pending" });
  const { name, surname } = splitName(profileRow.fullName);
  const res = await initializeCheckout(cfg, {
    conversationId: paymentId,
    price,
    currency: plan.currency,
    callbackUrl: `${ctx.publicBaseUrl.replace(/\/$/, "")}/api/billing/iyzico/callback`,
    itemId: `${plan.planKey}-${input.period}`,
    itemName: `Inkwell ${plan.name} (${input.period === "year" ? "yıllık" : "aylık"})`,
    buyer: {
      id: userId,
      name,
      surname,
      email: user.email,
      gsmNumber: profileRow.phone,
      identityNumber: identity,
      address: profileRow.address,
      city: profileRow.city,
      country: profileRow.country,
      zipCode: profileRow.zipCode,
      ip: ctx.ip || null,
    },
  }).catch((e) => ({ status: "failure", errorMessage: (e as Error).message }));
  if (res?.status !== "success" || !res.token || res.conversationId !== paymentId) {
    const msg = String(res?.errorMessage || "Ödeme başlatılamadı").slice(0, 300);
    await db.update(payments).set({ status: "failed", error: msg }).where(eq(payments.paymentId, paymentId));
    await audit(userId, "billing.checkout_failed", "payment", paymentId, { error: msg });
    throw new AccessError(502, `Ödeme başlatılamadı: ${msg}`);
  }
  await db.update(payments).set({ token: res.token }).where(eq(payments.paymentId, paymentId));
  await audit(userId, "billing.checkout_started", "payment", paymentId, { plan_key: plan.planKey, period: input.period, amount: price });
  return { payment_id: paymentId, token: res.token, payment_page_url: res.paymentPageUrl || null };
}

/** Extends (or starts) the workspace subscription by one period. */
async function extendSubscription(workspaceId: string, planKey: string, period: Period, source: string) {
  const now = new Date();
  const cur = (await db.select().from(subscriptions).where(eq(subscriptions.workspaceId, workspaceId)).limit(1))[0];
  const base = cur && cur.planKey === planKey && cur.currentPeriodEnd && cur.currentPeriodEnd > now ? cur.currentPeriodEnd : now;
  const end = addPeriod(base, period);
  if (cur) {
    await db.update(subscriptions).set({ planKey, period, currentPeriodEnd: end, source, updatedAt: now }).where(eq(subscriptions.workspaceId, workspaceId));
  } else {
    await db.insert(subscriptions).values({ workspaceId, planKey, period, currentPeriodEnd: end, source });
  }
  await db.update(workspaces).set({ plan: planKey, updatedAt: now }).where(eq(workspaces.workspaceId, workspaceId));
  return end;
}

/**
 * iyzico posts the token here after the payment page. The result is read
 * back from iyzico (never trusted from the browser) and checked before the
 * period is granted. Idempotent: a token is processed once.
 */
export async function completeCheckout(token: string): Promise<{ ok: boolean; payment_id: string | null; message: string }> {
  const cfg = iyzicoConfig();
  if (!cfg || !token) return { ok: false, payment_id: null, message: "Ödeme doğrulanamadı" };
  const pay = (await db.select().from(payments).where(eq(payments.token, token)).limit(1))[0];
  if (!pay) return { ok: false, payment_id: null, message: "Ödeme kaydı bulunamadı" };
  if (pay.status === "paid") return { ok: true, payment_id: pay.paymentId, message: "Ödeme zaten işlendi" };
  if (pay.status !== "pending") return { ok: false, payment_id: pay.paymentId, message: pay.error || "Ödeme başarısız" };
  const r = await retrieveCheckout(cfg, token, pay.paymentId).catch((e) => ({ status: "failure", errorMessage: (e as Error).message }) as any);
  const fail = async (msg: string, status = "failed") => {
    await db.update(payments).set({ status, error: msg.slice(0, 300) }).where(and(eq(payments.paymentId, pay.paymentId), eq(payments.status, "pending")));
    await audit(pay.userId, "billing.payment_failed", "payment", pay.paymentId, { error: msg.slice(0, 300) });
    return { ok: false, payment_id: pay.paymentId, message: msg };
  };
  if (r?.status !== "success") return fail(String(r?.errorMessage || "Ödeme sonucu alınamadı"));
  if (!verifyRetrieveSignature(r, cfg.secretKey)) return fail("Ödeme yanıtının imzası doğrulanamadı");
  if (r.token !== token || r.basketId !== pay.paymentId || r.conversationId !== pay.paymentId) return fail("Ödeme yanıtı bu siparişe ait değil");
  if (r.paymentStatus !== "SUCCESS") return fail(String(r.errorMessage || "Ödeme tamamlanmadı"));
  if (Number(r.price) !== Number(pay.amount) || Number(r.paidPrice) < Number(pay.amount) || r.currency !== pay.currency) return fail("Ödenen tutar siparişle uyuşmuyor");
  if (Number(r.fraudStatus) === -1) return fail("Ödeme iyzico tarafından reddedildi");
  if (Number(r.fraudStatus) === 0) {
    await db.update(payments).set({ status: "review", providerPaymentId: String(r.paymentId || ""), error: "iyzico incelemesinde" }).where(eq(payments.paymentId, pay.paymentId));
    await audit(pay.userId, "billing.payment_review", "payment", pay.paymentId, {});
    return { ok: false, payment_id: pay.paymentId, message: "Ödeme iyzico incelemesinde; onaylanınca paket açılacak." };
  }
  // Mark paid first (only one request can move it out of pending), then grant the period
  const moved = await db
    .update(payments)
    .set({ status: "paid", paidAt: new Date(), providerPaymentId: String(r.paymentId || ""), error: null })
    .where(and(eq(payments.paymentId, pay.paymentId), eq(payments.status, "pending")))
    .returning({ id: payments.paymentId });
  if (moved.length === 0) return { ok: true, payment_id: pay.paymentId, message: "Ödeme zaten işlendi" };
  const end = await extendSubscription(pay.workspaceId, pay.planKey, pay.period as Period, "payment");
  await db.update(payments).set({ periodEnd: end }).where(eq(payments.paymentId, pay.paymentId));
  await audit(pay.userId, "billing.payment_paid", "payment", pay.paymentId, { plan_key: pay.planKey, period: pay.period, amount: pay.amount, period_end: end.toISOString() });
  return { ok: true, payment_id: pay.paymentId, message: "Ödeme alındı" };
}

// ------------------------------------------------------------ admin helpers
export async function adminSetSubscription(adminId: string, workspaceId: string, planKey: string, periodEnd: Date | null, note?: string | null) {
  const ws = (await db.select().from(workspaces).where(eq(workspaces.workspaceId, workspaceId)).limit(1))[0];
  if (!ws) throw new AccessError(404, "Çalışma alanı bulunamadı");
  const plan = await planByKey(planKey);
  if (!plan) throw new AccessError(404, "Paket bulunamadı");
  const now = new Date();
  const cur = (await db.select().from(subscriptions).where(eq(subscriptions.workspaceId, workspaceId)).limit(1))[0];
  const values = { planKey, period: "month", currentPeriodEnd: periodEnd, source: "admin", note: note || null, updatedAt: now };
  if (cur) await db.update(subscriptions).set(values).where(eq(subscriptions.workspaceId, workspaceId));
  else await db.insert(subscriptions).values({ workspaceId, ...values });
  await db.update(workspaces).set({ plan: planKey, updatedAt: now }).where(eq(workspaces.workspaceId, workspaceId));
  await audit(adminId, "admin.subscription_set", "workspace", workspaceId, { plan_key: planKey, period_end: periodEnd ? periodEnd.toISOString() : null, note: note || null, previous: cur?.planKey || null });
  return effectivePlan(workspaceId);
}

export async function adminClearSubscription(adminId: string, workspaceId: string) {
  await db.delete(subscriptions).where(eq(subscriptions.workspaceId, workspaceId));
  const def = await defaultPlan();
  await db.update(workspaces).set({ plan: def.planKey, updatedAt: new Date() }).where(eq(workspaces.workspaceId, workspaceId));
  await audit(adminId, "admin.subscription_cleared", "workspace", workspaceId, {});
  return effectivePlan(workspaceId);
}

const LIMIT_KEYS: QuotaKind[] = ["objects", "storage_mb", "members", "ai_calls_month"];

export function cleanLimits(input: Record<string, unknown> | undefined): PlanLimits {
  const out: PlanLimits = {};
  for (const k of LIMIT_KEYS) {
    const v = input?.[k];
    if (v === undefined || v === null || v === "") continue;
    const n = Math.trunc(Number(v));
    if (!Number.isFinite(n) || n < -1) throw new AccessError(400, `Geçersiz sınır: ${k}`);
    (out as any)[k] = n;
  }
  return out;
}

export async function adminUpsertPlan(
  adminId: string,
  input: {
    plan_key: string; name: string; description?: string; price_monthly: string; price_yearly: string; currency?: string;
    limits?: Record<string, unknown>; features?: string[]; is_active?: boolean; is_default?: boolean; sort_order?: number;
  },
  create: boolean
) {
  const existing = await planByKey(input.plan_key);
  if (create && existing) throw new AccessError(409, "Bu anahtarla bir paket zaten var");
  if (!create && !existing) throw new AccessError(404, "Paket bulunamadı");
  for (const p of [input.price_monthly, input.price_yearly]) {
    if (!/^\d{1,7}(\.\d{1,2})?$/.test(String(p))) throw new AccessError(400, "Fiyat 0 ya da pozitif bir sayı olmalı (en fazla 2 ondalık, nokta ile)");
  }
  const values = {
    name: input.name.trim(),
    description: (input.description || "").trim(),
    priceMonthly: String(input.price_monthly),
    priceYearly: String(input.price_yearly),
    currency: input.currency || existing?.currency || "TRY",
    limits: cleanLimits(input.limits),
    features: (input.features || []).map((f) => f.trim()).filter(Boolean).slice(0, 12),
    isActive: input.is_active ?? existing?.isActive ?? true,
    isDefault: input.is_default ?? existing?.isDefault ?? false,
    sortOrder: input.sort_order ?? existing?.sortOrder ?? 0,
    updatedAt: new Date(),
  };
  if (values.isDefault && !values.isActive) throw new AccessError(400, "Varsayılan paket pasif olamaz");
  if (values.isDefault && (Number(values.priceMonthly) > 0 || Number(values.priceYearly) > 0)) {
    throw new AccessError(400, "Varsayılan paket ücretsiz olmalı (süresi biten herkes bu pakete düşer)");
  }
  if (values.isDefault) await db.update(plans).set({ isDefault: false }).where(eq(plans.isDefault, true));
  if (existing) {
    if (existing.isDefault && !values.isDefault) throw new AccessError(400, "Önce başka bir paketi varsayılan yap");
    await db.update(plans).set(values).where(eq(plans.planKey, input.plan_key));
  } else {
    await db.insert(plans).values({ planKey: input.plan_key, ...values });
  }
  await audit(adminId, create ? "admin.plan_created" : "admin.plan_updated", "plan", input.plan_key, {
    before: existing ? serializePlan(existing) : null,
    after: { ...values, updatedAt: undefined },
  });
  return serializePlan((await planByKey(input.plan_key))!);
}

/** Admin list of payments, newest first. */
export async function adminPayments(limit = 200) {
  const rows = await db
    .select({ p: payments, email: users.email })
    .from(payments)
    .leftJoin(users, eq(users.userId, payments.userId))
    .orderBy(desc(payments.createdAt))
    .limit(Math.min(Math.max(limit, 1), 500));
  return rows.map((r: any) => ({ ...serializePayment(r.p), email: r.email || null }));
}

/** Secure random token and its SHA-256 (only the hash is stored). */
export function newToken(): { token: string; hash: string } {
  const token = crypto.randomBytes(24).toString("base64url");
  return { token, hash: crypto.createHash("sha256").update(token).digest("hex") };
}
export const hashToken = (t: string) => crypto.createHash("sha256").update(t).digest("hex");
