// Phase 3a end-to-end checks: plans and quotas, iyzico Checkout Form payments
// (against a local stand-in for iyzico that checks our IYZWSv2 signature),
// team workspaces, invitations and roles, and the platform admin panel.
//
// Needs a server started with (see .claude/launch.json "inkwell-saas"):
//   IYZICO_API_KEY=sandbox-test-key IYZICO_SECRET_KEY=sandbox-test-secret
//   IYZICO_BASE_URL=http://127.0.0.1:3199 INKWELL_ADMIN_EMAILS=saas-admin@example.test
// and then:
//   INKWELL_BASE_URL=http://localhost:3094 INKWELL_IYZICO_STUB_PORT=3199 npm run test:saas
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import crypto from "node:crypto";

const BASE = process.env.INKWELL_BASE_URL;
const STUB_PORT = Number(process.env.INKWELL_IYZICO_STUB_PORT || 0);
const SECRET = "sandbox-test-secret";
const API_KEY = "sandbox-test-key";
const ADMIN_EMAIL = "saas-admin@example.test";
const PASSWORD = "it-password-123";

type Req = (method: string, path: string, body?: unknown, opts?: { form?: boolean; redirect?: "manual" }) => Promise<{ status: number; body: any; headers: Headers }>;

async function client(email?: string): Promise<Req & { email: string }> {
  let cookie = "";
  const req: Req = async (method, path, body, opts = {}) => {
    const res = await fetch(`${BASE}/api${path}`, {
      method,
      redirect: opts.redirect || "follow",
      headers: {
        "Content-Type": opts.form ? "application/x-www-form-urlencoded" : "application/json",
        ...(cookie ? { Cookie: cookie } : {}),
      },
      body: body === undefined ? undefined : opts.form ? new URLSearchParams(body as Record<string, string>).toString() : JSON.stringify(body),
    });
    const set = res.headers.getSetCookie?.() || [];
    if (set.length) cookie = set.map((c) => c.split(";")[0]).join("; ");
    const text = await res.text();
    let parsed: any = null;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = text;
    }
    return { status: res.status, body: parsed, headers: res.headers };
  };
  const addr = email || `saas_${Date.now()}_${Math.random().toString(36).slice(2, 7)}@example.test`;
  const r = await req("POST", "/auth/register", { email: addr, password: PASSWORD, name: addr.split("@")[0] });
  if (r.status !== 200) {
    const l = await req("POST", "/auth/login", { email: addr, password: PASSWORD });
    assert.equal(l.status, 200, `login ${addr}: ${JSON.stringify(l.body)}`);
  }
  return Object.assign(req, { email: addr });
}

// ------------------------------------------------------- iyzico stand-in
interface StubOrder {
  price: string;
  currency: string;
  basketId: string;
  conversationId: string;
}
const orders = new Map<string, StubOrder>();
const behaviour = new Map<string, "ok" | "bad-signature" | "wrong-amount" | "declined">();
let badAuthCalls = 0;
const sig = (vals: unknown[]) => crypto.createHmac("sha256", SECRET).update(vals.map(String).join(":")).digest("hex");
const noZeros = (s: string) => (s.includes(".") ? s.replace(/0+$/, "").replace(/\.$/, "") : s);

function checkAuth(req: http.IncomingMessage, path: string, body: string): boolean {
  const h = String(req.headers.authorization || "");
  const rnd = String(req.headers["x-iyzi-rnd"] || "");
  if (!h.startsWith("IYZWSv2 ") || !rnd) return false;
  const decoded = Buffer.from(h.slice(8), "base64").toString("utf8");
  const expected = crypto.createHmac("sha256", SECRET).update(rnd + path + body).digest("hex");
  return decoded === `apiKey:${API_KEY}&randomKey:${rnd}&signature:${expected}`;
}

const stub = http.createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    const send = (j: unknown) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(j));
    };
    const path = req.url || "";
    if (!checkAuth(req, path, body)) {
      badAuthCalls++;
      return send({ status: "failure", errorCode: "1000", errorMessage: "Geçersiz imza" });
    }
    const j = JSON.parse(body || "{}");
    if (path === "/payment/iyzipos/checkoutform/initialize/auth/ecom") {
      const token = crypto.randomUUID();
      const itemsTotal = (j.basketItems || []).reduce((s: number, i: any) => s + Number(i.price), 0);
      if (itemsTotal !== Number(j.price) || !j.buyer?.identityNumber || !j.callbackUrl) return send({ status: "failure", errorMessage: "Eksik alan" });
      orders.set(token, { price: j.price, currency: j.currency, basketId: j.basketId, conversationId: j.conversationId });
      return send({ status: "success", locale: "tr", conversationId: j.conversationId, token, tokenExpireTime: 1800, paymentPageUrl: `https://sandbox-cpp.iyzipay.com?token=${token}` });
    }
    if (path === "/payment/iyzipos/checkoutform/auth/ecom/detail") {
      const o = orders.get(j.token);
      if (!o) return send({ status: "failure", errorMessage: "Token bulunamadı" });
      const mode = behaviour.get(j.token) || "ok";
      const paymentStatus = mode === "declined" ? "FAILURE" : "SUCCESS";
      const price = mode === "wrong-amount" ? "1.00000000" : `${Number(o.price).toFixed(8)}`;
      const r: any = {
        status: "success", locale: "tr", conversationId: o.conversationId, price, paidPrice: price, currency: o.currency,
        basketId: o.basketId, paymentId: "22416032", fraudStatus: 1, paymentStatus, token: j.token,
      };
      r.signature = sig([r.paymentStatus, r.paymentId, r.currency, r.basketId, r.conversationId, noZeros(r.paidPrice), noZeros(r.price), r.token]);
      if (mode === "bad-signature") r.signature = sig(["tampered"]);
      return send(r);
    }
    send({ status: "failure", errorMessage: "unknown path" });
  });
});

describe("SaaS: plans, iyzico, teams, admin", { skip: !BASE || !STUB_PORT }, () => {
  let admin: Awaited<ReturnType<typeof client>>;
  let a: Awaited<ReturnType<typeof client>>;
  let b: Awaited<ReturnType<typeof client>>;
  let c: Awaited<ReturnType<typeof client>>;

  before(async () => {
    await new Promise<void>((r) => stub.listen(STUB_PORT, "127.0.0.1", () => r()));
    admin = await client(ADMIN_EMAIL);
    a = await client();
    b = await client();
    c = await client();
  });
  after(() => stub.close());

  async function pay(req: Req, plan: string, period: "month" | "year", mode: "ok" | "bad-signature" | "wrong-amount" | "declined" = "ok", workspace_id?: string) {
    const r = await req("POST", "/billing/checkout", { plan_key: plan, period, ...(workspace_id ? { workspace_id } : {}) });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    behaviour.set(r.body.token, mode);
    const cb = await req("POST", "/billing/iyzico/callback", { token: r.body.token }, { form: true, redirect: "manual" });
    assert.equal(cb.status, 303);
    return { token: r.body.token as string, location: String(cb.headers.get("location")) };
  }

  test("billing overview: default plan, usage, plans, payment configured", async () => {
    const r = await a("GET", "/billing");
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.plan.plan_key, "free");
    assert.equal(r.body.payment.configured, true);
    assert.equal(r.body.payment.sandbox, true);
    assert.ok(r.body.plans.some((p: any) => p.plan_key === "pro"));
    assert.equal(r.body.usage.objects >= 0, true);
  });

  test("checkout needs a billing profile; a paid, verified payment grants one period", async () => {
    assert.equal((await a("POST", "/billing/checkout", { plan_key: "pro", period: "month" })).status, 400);
    assert.equal((await a("PUT", "/billing/profile", { full_name: "Ayşe Kaya", phone: "123", address: "Adres 1", city: "İstanbul" })).status, 400, "bad phone");
    const p = await a("PUT", "/billing/profile", { full_name: "Ayşe Kaya", phone: "+90 555 111 22 33", address: "Kadıköy Mah. 1", city: "İstanbul", identity_number: "12345678901" });
    assert.equal(p.status, 200, JSON.stringify(p.body));
    assert.equal(p.body.identity_number_hint, "•••••••8901", "only the last digits come back");
    assert.equal((await a("POST", "/billing/checkout", { plan_key: "free", period: "month" })).status, 400, "free plans are not sold");

    const { token, location } = await pay(a, "pro", "month");
    assert.match(location, /payment=ok/);
    const after1 = (await a("GET", "/billing")).body;
    assert.equal(after1.plan.plan_key, "pro");
    assert.equal(after1.subscription.active, true);
    const end1 = new Date(after1.subscription.current_period_end).getTime();
    assert.ok(end1 > Date.now() + 27 * 86400e3 && end1 < Date.now() + 32 * 86400e3);
    assert.equal(after1.payments[0].status, "paid");
    assert.equal(after1.payments[0].amount, "149.0");

    // The same callback again changes nothing
    const again = await a("POST", "/billing/iyzico/callback", { token }, { form: true, redirect: "manual" });
    assert.match(String(again.headers.get("location")), /payment=ok/);
    assert.equal(new Date((await a("GET", "/billing")).body.subscription.current_period_end).getTime(), end1);

    // Paying again for the same plan extends from the current end
    await pay(a, "pro", "month");
    const end2 = new Date((await a("GET", "/billing")).body.subscription.current_period_end).getTime();
    assert.ok(end2 > end1 + 27 * 86400e3);
    assert.equal(badAuthCalls, 0, "every request to iyzico carried a valid IYZWSv2 signature");
  });

  test("forged, tampered, wrong-amount or declined results never grant a plan", async () => {
    await b("PUT", "/billing/profile", { full_name: "Bora Ak", phone: "+905551112244", address: "Çankaya 2", city: "Ankara" });
    for (const mode of ["bad-signature", "wrong-amount", "declined"] as const) {
      const { location } = await pay(b, "pro", "month", mode);
      assert.match(location, /payment=failed/, mode);
    }
    const forged = await b("POST", "/billing/iyzico/callback", { token: "not-a-real-token" }, { form: true, redirect: "manual" });
    assert.match(String(forged.headers.get("location")), /payment=failed/);
    const bill = (await b("GET", "/billing")).body;
    assert.equal(bill.plan.plan_key, "free");
    assert.deepEqual(bill.payments.map((p: any) => p.status), ["failed", "failed", "failed"]);
  });

  test("admin: only listed e-mails; plans, subscriptions, members, audit", async () => {
    assert.equal((await a("GET", "/admin/me")).body.is_admin, false);
    assert.equal((await a("GET", "/admin/stats")).status, 404, "the panel is hidden from members");
    assert.equal((await admin("GET", "/admin/me")).body.is_admin, true);
    const stats = await admin("GET", "/admin/stats");
    assert.equal(stats.status, 200);
    assert.ok(stats.body.users >= 4);
    assert.ok(stats.body.revenue_30d.some((r: any) => r.currency === "TRY" && Number(r.total) >= 298));

    // A tiny plan to test quotas; the default plan cannot be paid
    const key = `tiny${Date.now().toString(36)}`;
    assert.equal((await admin("POST", "/admin/plans", { plan_key: key, name: "Minik", price_monthly: "5", price_yearly: "50", limits: { objects: 2, members: 2 }, is_default: true })).status, 400);
    const created = await admin("POST", "/admin/plans", { plan_key: key, name: "Minik", price_monthly: "5", price_yearly: "50", limits: { objects: 2, members: 2, storage_mb: -1 }, is_active: false, sort_order: 99 });
    assert.equal(created.status, 200, JSON.stringify(created.body));
    assert.deepEqual(created.body.limits, { objects: 2, members: 2, storage_mb: -1 });
    assert.equal((await a("GET", "/plans")).body.some((p: any) => p.plan_key === key), false, "inactive plans are not offered");

    const users = (await admin("GET", `/admin/users?q=${encodeURIComponent(c.email)}`)).body;
    assert.equal(users.users.length, 1);
    const cu = users.users[0];
    const set = await admin("PUT", `/admin/workspaces/${cu.workspace_id}/subscription`, { plan_key: key, period_end: null, note: "test" });
    assert.equal(set.status, 200, JSON.stringify(set.body));

    // Quota: the third object is refused with 402; nothing is deleted
    const n1 = await c("POST", "/notes", { title: "Bir", content: "" });
    const n2 = await c("POST", "/notes", { title: "İki", content: "" });
    const n3 = await c("POST", "/notes", { title: "Üç", content: "" });
    // A new account may already hold a welcome object, so count what was accepted
    const statuses = [n1.status, n2.status, n3.status];
    assert.equal(n3.status, 402, JSON.stringify(statuses));
    assert.match(n3.body.detail, /nesne sınırına/);
    assert.equal((await c("GET", "/billing")).body.usage.objects, 2, "exactly the limit, nothing deleted");
    assert.ok(statuses.every((s) => s === 200 || s === 402));
    const viaObjects = await c("POST", "/capture", { text: "yeni not", mode: "direct" });
    assert.equal(viaObjects.status, 402, "every create path is covered");
    assert.equal((await admin("DELETE", `/admin/workspaces/${cu.workspace_id}/subscription`)).status, 200);
    assert.equal((await c("POST", "/notes", { title: "Dört", content: "" })).status, 200, "back on the default plan");

    // Disable / enable a member
    assert.equal((await admin("PATCH", `/admin/users/${cu.user_id}`, { disabled: true })).status, 200);
    assert.equal((await c("GET", "/billing")).status, 403);
    assert.equal((await admin("PATCH", `/admin/users/${cu.user_id}`, { disabled: false })).status, 200);
    assert.equal((await c("GET", "/billing")).status, 200);
    const me = (await admin("GET", `/admin/users?q=${encodeURIComponent(ADMIN_EMAIL)}`)).body.users[0];
    assert.equal((await admin("PATCH", `/admin/users/${me.user_id}`, { disabled: true })).status, 400, "an admin cannot lock themself out");

    const audit = (await admin("GET", "/admin/audit")).body.map((x: any) => x.action);
    for (const act of ["admin.plan_created", "admin.subscription_set", "admin.user_disabled", "billing.payment_paid", "billing.payment_failed"]) {
      assert.ok(audit.includes(act), act);
    }
    const pays = (await admin("GET", "/admin/payments")).body;
    assert.ok(pays.some((p: any) => p.email === a.email && p.status === "paid"));
  });

  test("teams: invite, accept, roles decide read/write, other tenants see nothing", async () => {
    const ws = await a("POST", "/workspaces", { name: "Ürün ekibi" });
    assert.equal(ws.status, 200, JSON.stringify(ws.body));
    const wsId = ws.body.workspace_id;
    // The default plan allows one member: inviting needs a team plan
    const tooMany = await a("POST", `/workspaces/${wsId}/invitations`, { email: b.email, role: "viewer" });
    assert.equal(tooMany.status, 402);
    await pay(a, "team", "month", "ok", wsId);
    assert.equal((await a("GET", `/workspaces/${wsId}`)).body.plan.plan_key, "team");

    const inv = await a("POST", `/workspaces/${wsId}/invitations`, { email: b.email, role: "viewer" });
    assert.equal(inv.status, 200, JSON.stringify(inv.body));
    const token = inv.body.path.split("/").pop();
    assert.equal((await c("POST", `/invitations/${token}/accept`)).status, 403, "the link only works for the invited address");
    const preview = await b("GET", `/invitations/${token}`);
    assert.equal(preview.body.workspace_name, "Ürün ekibi");
    assert.equal(preview.body.email_matches, true);
    assert.equal((await b("POST", `/invitations/${token}/accept`)).status, 200);
    assert.equal((await b("POST", `/invitations/${token}/accept`)).status, 404, "a link works once");

    const detail = (await a("GET", `/workspaces/${wsId}`)).body;
    const space = detail.spaces.find((s: any) => s.is_default);
    const note = await a("POST", "/notes", { title: "Yol haritası", content: "Q1 hedefleri", space_id: space.space_id });
    assert.equal(note.status, 200, JSON.stringify(note.body));
    const nid = note.body.note_id;

    // Viewer: reads, cannot write or delete
    const seen = await b("GET", `/notes/${nid}`);
    assert.equal(seen.status, 200);
    assert.equal(seen.body.access_role, "viewer");
    assert.equal((await b("PUT", `/notes/${nid}`, { title: "Değişti", content: "x" })).status, 403);
    assert.equal((await b("DELETE", `/notes/${nid}`)).status, 403);
    assert.ok((await b("GET", `/workspaces/${wsId}/objects`)).body.some((o: any) => o.note_id === nid));

    // Editor: writes, cannot delete someone else's object
    const bId = detail.members.find((m: any) => m.email === b.email)?.user_id || (await a("GET", `/workspaces/${wsId}`)).body.members.find((m: any) => m.email === b.email).user_id;
    assert.equal((await b("PATCH", `/workspaces/${wsId}/members/${bId}`, { role: "admin" })).status, 403, "a viewer cannot promote itself");
    assert.equal((await a("PATCH", `/workspaces/${wsId}/members/${bId}`, { role: "editor" })).status, 200);
    const edit = await b("PUT", `/notes/${nid}`, { title: "Yol haritası", content: "Q1 hedefleri ve riskler" });
    assert.equal(edit.status, 200, JSON.stringify(edit.body));
    assert.equal((await a("GET", `/notes/${nid}`)).body.content, "Q1 hedefleri ve riskler");
    assert.equal((await b("DELETE", `/notes/${nid}`)).status, 403);

    // Outsiders: 404 everywhere
    assert.equal((await c("GET", `/notes/${nid}`)).status, 404);
    assert.equal((await c("GET", `/workspaces/${wsId}`)).status, 404);
    assert.equal((await c("GET", `/workspaces/${wsId}/objects`)).status, 404);

    // Personal objects are never shared through a team
    const priv = await a("POST", "/notes", { title: "Özel", content: "" });
    assert.equal((await b("GET", `/notes/${priv.body.note_id}`)).status, 404);

    // Leave; access ends
    assert.equal((await b("DELETE", `/workspaces/${wsId}/members/${bId}`)).status, 200);
    assert.equal((await b("GET", `/notes/${nid}`)).status, 404);
    assert.equal((await a("DELETE", `/workspaces/${wsId}/members/${detail.members[0].user_id}`)).status, 400, "the owner cannot be removed");
  });
});
