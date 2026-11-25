import React, { useCallback, useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import { toast } from "sonner";
import { Loader2, Plus, Search } from "lucide-react";
import PageShell from "@/components/PageShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatApiError } from "@/lib/api";
import { saasApi, formatLimit, formatMoney, LIMIT_LABEL, PAYMENT_STATUS, type Plan, type PlanLimits } from "@/lib/saasApi";

type Tab = "overview" | "users" | "teams" | "plans" | "payments" | "audit";
const TABS: Array<[Tab, string]> = [
  ["overview", "Özet"],
  ["users", "Üyeler"],
  ["teams", "Ekipler"],
  ["plans", "Paketler"],
  ["payments", "Ödemeler"],
  ["audit", "Kayıtlar"],
];

const fmtDate = (s: string | null | undefined) => (s ? new Date(s).toLocaleDateString("tr-TR") : "—");

/** Grant a plan to a workspace by hand (with an end date or open-ended), or clear it. */
function SubscriptionEditor({ workspaceId, current, plans, onDone }: { workspaceId: string; current: string; plans: Plan[]; onDone: () => void }) {
  const [plan, setPlan] = useState(current);
  const [end, setEnd] = useState("");
  const [busy, setBusy] = useState(false);
  async function save(clear = false) {
    setBusy(true);
    try {
      if (clear) await saasApi.adminClearSubscription(workspaceId);
      else await saasApi.adminSetSubscription(workspaceId, { plan_key: plan, period_end: end || null, note: "Yönetim panelinden" });
      toast.success(clear ? "Abonelik kaldırıldı; varsayılan pakete döndü" : "Paket tanımlandı");
      onDone();
    } catch (e) {
      toast.error(formatApiError(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <select className="h-7 rounded-md border border-border bg-background px-1 text-xs" value={plan} onChange={(e) => setPlan(e.target.value)} aria-label="Paket">
        {plans.map((p) => (
          <option key={p.plan_key} value={p.plan_key}>
            {p.name}
          </option>
        ))}
      </select>
      <Input type="date" value={end} onChange={(e) => setEnd(e.target.value)} className="h-7 w-auto text-xs" aria-label="Bitiş tarihi" title="Boş bırakılırsa süresiz" />
      <Button size="sm" variant="outline" className="h-7 px-2 text-xs" disabled={busy} onClick={() => save(false)}>
        Uygula
      </Button>
      <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" disabled={busy} onClick={() => save(true)} title="Varsayılan pakete döndür">
        Kaldır
      </Button>
    </div>
  );
}

function PlanForm({ initial, onSaved, onCancel }: { initial: Plan | null; onSaved: () => void; onCancel: () => void }) {
  const [f, setF] = useState<any>(
    initial
      ? { ...initial, features: initial.features.join("\n"), limits: { ...initial.limits } }
      : { plan_key: "", name: "", description: "", price_monthly: "0", price_yearly: "0", currency: "TRY", limits: {}, features: "", is_active: true, is_default: false, sort_order: 10 }
  );
  const [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const body: any = {
      name: f.name,
      description: f.description,
      price_monthly: String(f.price_monthly),
      price_yearly: String(f.price_yearly),
      currency: f.currency,
      limits: Object.fromEntries(Object.entries(f.limits).filter(([, v]) => v !== "" && v !== undefined && v !== null).map(([k, v]) => [k, Number(v)])),
      features: String(f.features || "").split("\n").map((s: string) => s.trim()).filter(Boolean),
      is_active: Boolean(f.is_active),
      is_default: Boolean(f.is_default),
      sort_order: Number(f.sort_order) || 0,
    };
    try {
      if (initial) await saasApi.adminUpdatePlan(initial.plan_key, body);
      else await saasApi.adminCreatePlan({ ...body, plan_key: f.plan_key });
      toast.success("Paket kaydedildi");
      onSaved();
    } catch (err) {
      toast.error(formatApiError(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={submit} className="grid gap-3 rounded-xl border border-primary/40 bg-card p-4 sm:grid-cols-2" data-testid="admin-plan-form">
      {!initial && (
        <div className="space-y-1">
          <Label htmlFor="pf-key">Anahtar</Label>
          <Input id="pf-key" value={f.plan_key} onChange={(e) => setF({ ...f, plan_key: e.target.value.toLowerCase() })} placeholder="ornek: business" required />
        </div>
      )}
      <div className="space-y-1">
        <Label htmlFor="pf-name">Ad</Label>
        <Input id="pf-name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required />
      </div>
      <div className="space-y-1 sm:col-span-2">
        <Label htmlFor="pf-desc">Açıklama</Label>
        <Input id="pf-desc" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />
      </div>
      <div className="space-y-1">
        <Label htmlFor="pf-pm">Aylık fiyat ({f.currency})</Label>
        <Input id="pf-pm" inputMode="decimal" value={f.price_monthly} onChange={(e) => setF({ ...f, price_monthly: e.target.value })} />
      </div>
      <div className="space-y-1">
        <Label htmlFor="pf-py">Yıllık fiyat ({f.currency})</Label>
        <Input id="pf-py" inputMode="decimal" value={f.price_yearly} onChange={(e) => setF({ ...f, price_yearly: e.target.value })} />
      </div>
      {(Object.keys(LIMIT_LABEL) as Array<keyof PlanLimits>).map((k) => (
        <div key={k} className="space-y-1">
          <Label htmlFor={`pf-${k}`}>{LIMIT_LABEL[k]} (-1 = sınırsız)</Label>
          <Input id={`pf-${k}`} inputMode="numeric" value={f.limits[k] ?? ""} onChange={(e) => setF({ ...f, limits: { ...f.limits, [k]: e.target.value } })} />
        </div>
      ))}
      <div className="space-y-1 sm:col-span-2">
        <Label htmlFor="pf-feat">Özellikler (her satıra bir tane)</Label>
        <textarea id="pf-feat" className="min-h-[70px] w-full rounded-md border border-border bg-background p-2 text-sm" value={f.features} onChange={(e) => setF({ ...f, features: e.target.value })} />
      </div>
      <div className="flex flex-wrap items-center gap-4 text-sm sm:col-span-2">
        <label className="flex items-center gap-1.5">
          <input type="checkbox" checked={f.is_active} onChange={(e) => setF({ ...f, is_active: e.target.checked })} /> Satışta
        </label>
        <label className="flex items-center gap-1.5">
          <input type="checkbox" checked={f.is_default} onChange={(e) => setF({ ...f, is_default: e.target.checked })} /> Varsayılan (ücretsiz olmalı)
        </label>
        <label className="flex items-center gap-1.5">
          Sıra <Input inputMode="numeric" className="h-7 w-16" value={f.sort_order} onChange={(e) => setF({ ...f, sort_order: e.target.value })} />
        </label>
      </div>
      <div className="flex gap-2 sm:col-span-2">
        <Button type="submit" size="sm" disabled={busy}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Kaydet"}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
          Vazgeç
        </Button>
      </div>
    </form>
  );
}

/** /admin — SaaS operator panel (INKWELL_ADMIN_EMAILS only). */
export default function AdminPage() {
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [tab, setTab] = useState<Tab>("overview");
  const [stats, setStats] = useState<any>(null);
  const [users, setUsers] = useState<{ total: number; users: any[] } | null>(null);
  const [q, setQ] = useState("");
  const [teams, setTeams] = useState<any[] | null>(null);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [editing, setEditing] = useState<Plan | "new" | null>(null);
  const [payments, setPayments] = useState<any[] | null>(null);
  const [audit, setAudit] = useState<any[] | null>(null);

  useEffect(() => {
    saasApi
      .adminMe()
      .then((r) => setAllowed(r.is_admin))
      .catch(() => setAllowed(false));
  }, []);

  const load = useCallback(() => {
    const err = (e: unknown) => toast.error(formatApiError(e));
    saasApi.adminPlans().then(setPlans).catch(err);
    if (tab === "overview") saasApi.adminStats().then(setStats).catch(err);
    if (tab === "users") saasApi.adminUsers(q).then(setUsers).catch(err);
    if (tab === "teams") saasApi.adminWorkspaces().then(setTeams).catch(err);
    if (tab === "payments") saasApi.adminPayments().then(setPayments).catch(err);
    if (tab === "audit") saasApi.adminAudit().then(setAudit).catch(err);
  }, [tab, q]);

  useEffect(() => {
    if (allowed) load();
  }, [allowed, load]);

  if (allowed === null) return <PageShell title="Yönetim">Yükleniyor…</PageShell>;
  if (!allowed) return <Navigate to="/" replace />;

  async function toggleUser(u: any) {
    if (!confirm(u.disabled ? `${u.email} yeniden etkinleştirilsin mi?` : `${u.email} devre dışı bırakılsın mı? Giriş yapamaz ve API'yi kullanamaz; verisi silinmez.`)) return;
    try {
      await saasApi.adminSetDisabled(u.user_id, !u.disabled);
      toast.success(u.disabled ? "Üye etkinleştirildi" : "Üye devre dışı bırakıldı");
      load();
    } catch (e) {
      toast.error(formatApiError(e));
    }
  }

  return (
    <PageShell title="Yönetim" subtitle="Üyeler, ekipler, paketler ve ödemeler" wide>
      <div className="space-y-4" data-testid="admin-page">
        <div className="flex flex-wrap gap-1.5" role="tablist">
          {TABS.map(([k, label]) => (
            <button
              key={k}
              type="button"
              role="tab"
              aria-selected={tab === k}
              onClick={() => setTab(k)}
              className={`rounded-full border px-3 py-1 text-xs ${tab === k ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card"}`}
              data-testid={`admin-tab-${k}`}
            >
              {label}
            </button>
          ))}
        </div>

        {tab === "overview" && stats && (
          <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-4" data-testid="admin-stats">
            {(
              [
                ["Üye", stats.users],
                ["Son 30 günde giriş", stats.active_users_30d],
                ["Devre dışı", stats.disabled_users],
                ["Ekip çalışma alanı", stats.team_workspaces],
                ["Etkin abonelik", stats.active_subscriptions],
                ["Sunucu YZ çağrısı (bu ay)", stats.server_ai_calls_month],
              ] as Array<[string, number]>
            ).map(([label, v]) => (
              <div key={label} className="rounded-xl border border-border bg-card p-3">
                <div className="text-xs text-muted-foreground">{label}</div>
                <div className="text-2xl font-semibold">{Number(v).toLocaleString("tr-TR")}</div>
              </div>
            ))}
            <div className="rounded-xl border border-border bg-card p-3">
              <div className="text-xs text-muted-foreground">Gelir (30 gün)</div>
              <div className="text-lg font-semibold">
                {stats.revenue_30d.length ? stats.revenue_30d.map((r: any) => formatMoney(r.total, r.currency)).join(" · ") : formatMoney("0")}
              </div>
            </div>
          </div>
        )}

        {tab === "users" && (
          <div className="space-y-3">
            <form
              className="flex max-w-md items-center gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                load();
              }}
            >
              <div className="relative flex-1">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="E-posta ya da ad" className="h-8 pl-8 text-sm" />
              </div>
              <Button size="sm" variant="outline" type="submit">
                Ara
              </Button>
            </form>
            {users && (
              <div className="overflow-x-auto rounded-xl border border-border">
                <table className="w-full text-xs" data-testid="admin-users">
                  <thead className="bg-muted/50 text-left text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2">Üye</th>
                      <th className="px-3 py-2">Kayıt / son giriş</th>
                      <th className="px-3 py-2">Kullanım</th>
                      <th className="px-3 py-2">Paket</th>
                      <th className="px-3 py-2">Durum</th>
                    </tr>
                  </thead>
                  <tbody>
                    {users.users.map((u) => (
                      <tr key={u.user_id} className="border-t border-border align-top" data-testid="admin-user-row">
                        <td className="px-3 py-2">
                          <div className="font-medium">{u.name}</div>
                          <div className="text-muted-foreground">{u.email}</div>
                          {u.is_admin && <span className="text-[10px] text-primary">platform yöneticisi</span>}
                        </td>
                        <td className="px-3 py-2">
                          {fmtDate(u.created_at)}
                          <br />
                          <span className="text-muted-foreground">{fmtDate(u.last_login_at)}</span>
                        </td>
                        <td className="px-3 py-2">
                          {u.usage.objects} nesne · {u.usage.storage_mb} MB · {u.usage.ai_calls_month} YZ
                          {u.team_count ? ` · ${u.team_count} ekip` : ""}
                        </td>
                        <td className="px-3 py-2">
                          <div className="mb-1">
                            {u.plan_name}
                            {u.subscription?.current_period_end ? ` · ${fmtDate(u.subscription.current_period_end)}` : ""}
                          </div>
                          <SubscriptionEditor workspaceId={u.workspace_id} current={u.plan_key} plans={plans} onDone={load} />
                        </td>
                        <td className="px-3 py-2">
                          <Button size="sm" variant={u.disabled ? "outline" : "ghost"} className="h-7 px-2 text-xs" onClick={() => toggleUser(u)} disabled={u.is_admin} data-testid="admin-user-toggle">
                            {u.disabled ? "Etkinleştir" : "Devre dışı bırak"}
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="px-3 py-2 text-[11px] text-muted-foreground">
                  {users.users.length} / {users.total} üye gösteriliyor
                </p>
              </div>
            )}
          </div>
        )}

        {tab === "teams" && teams && (
          <div className="overflow-x-auto rounded-xl border border-border">
            <table className="w-full text-xs" data-testid="admin-teams">
              <thead className="bg-muted/50 text-left text-muted-foreground">
                <tr>
                  <th className="px-3 py-2">Ekip</th>
                  <th className="px-3 py-2">Sahibi</th>
                  <th className="px-3 py-2">Kullanım</th>
                  <th className="px-3 py-2">Paket</th>
                </tr>
              </thead>
              <tbody>
                {teams.length === 0 && (
                  <tr>
                    <td className="px-3 py-3 text-muted-foreground" colSpan={4}>
                      Ekip çalışma alanı yok.
                    </td>
                  </tr>
                )}
                {teams.map((t) => (
                  <tr key={t.workspace_id} className="border-t border-border align-top">
                    <td className="px-3 py-2 font-medium">{t.name}</td>
                    <td className="px-3 py-2">{t.owner_email}</td>
                    <td className="px-3 py-2">
                      {t.usage.members} üye · {t.usage.objects} nesne
                    </td>
                    <td className="px-3 py-2">
                      <div className="mb-1">{t.plan_name}</div>
                      <SubscriptionEditor workspaceId={t.workspace_id} current={t.plan_key} plans={plans} onDone={load} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {tab === "plans" && (
          <div className="space-y-3">
            {editing ? (
              <PlanForm
                initial={editing === "new" ? null : editing}
                onSaved={() => {
                  setEditing(null);
                  load();
                }}
                onCancel={() => setEditing(null)}
              />
            ) : (
              <Button size="sm" onClick={() => setEditing("new")} data-testid="admin-plan-new">
                <Plus className="mr-1 h-4 w-4" /> Yeni paket
              </Button>
            )}
            <div className="grid gap-3 md:grid-cols-3" data-testid="admin-plans">
              {plans.map((p) => (
                <div key={p.plan_key} className={`rounded-xl border bg-card p-4 ${p.is_active ? "border-border" : "border-dashed border-border opacity-70"}`}>
                  <div className="flex items-center justify-between">
                    <span className="font-semibold">{p.name}</span>
                    <span className="text-[10px] text-muted-foreground">
                      {p.plan_key}
                      {p.is_default ? " · varsayılan" : ""}
                      {!p.is_active ? " · satışta değil" : ""}
                    </span>
                  </div>
                  <div className="mt-1 text-sm">
                    {formatMoney(p.price_monthly, p.currency)} / ay · {formatMoney(p.price_yearly, p.currency)} / yıl
                  </div>
                  <ul className="mt-2 space-y-0.5 text-xs text-muted-foreground">
                    {(Object.keys(LIMIT_LABEL) as Array<keyof PlanLimits>).map((k) => (
                      <li key={k}>
                        {LIMIT_LABEL[k]}: {formatLimit(p.limits[k])}
                      </li>
                    ))}
                  </ul>
                  <Button size="sm" variant="outline" className="mt-3" onClick={() => setEditing(p)} data-testid={`admin-plan-edit-${p.plan_key}`}>
                    Düzenle
                  </Button>
                </div>
              ))}
            </div>
            <p className="text-[11px] text-muted-foreground">Paketler silinmez; satıştan kaldırılan paketteki abonelikler süreleri bitene kadar devam eder.</p>
          </div>
        )}

        {tab === "payments" && payments && (
          <div className="overflow-x-auto rounded-xl border border-border">
            <table className="w-full text-xs" data-testid="admin-payments">
              <thead className="bg-muted/50 text-left text-muted-foreground">
                <tr>
                  <th className="px-3 py-2">Tarih</th>
                  <th className="px-3 py-2">Üye</th>
                  <th className="px-3 py-2">Paket</th>
                  <th className="px-3 py-2">Tutar</th>
                  <th className="px-3 py-2">Durum</th>
                </tr>
              </thead>
              <tbody>
                {payments.length === 0 && (
                  <tr>
                    <td className="px-3 py-3 text-muted-foreground" colSpan={5}>
                      Ödeme yok.
                    </td>
                  </tr>
                )}
                {payments.map((p) => (
                  <tr key={p.payment_id} className="border-t border-border">
                    <td className="px-3 py-2">{new Date(p.created_at).toLocaleString("tr-TR")}</td>
                    <td className="px-3 py-2">{p.email || "—"}</td>
                    <td className="px-3 py-2">
                      {p.plan_key} · {p.period === "year" ? "yıllık" : "aylık"}
                    </td>
                    <td className="px-3 py-2">{formatMoney(p.amount, p.currency)}</td>
                    <td className="px-3 py-2" title={p.error || ""}>
                      {PAYMENT_STATUS[p.status] || p.status}
                      {p.error ? ` · ${p.error}` : ""}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {tab === "audit" && audit && (
          <ul className="divide-y divide-border/60 rounded-xl border border-border bg-card text-xs" data-testid="admin-audit">
            {audit.length === 0 && <li className="px-3 py-3 text-muted-foreground">Kayıt yok.</li>}
            {audit.map((a) => (
              <li key={a.audit_id} className="flex flex-wrap gap-2 px-3 py-2">
                <span className="text-muted-foreground">{new Date(a.created_at).toLocaleString("tr-TR")}</span>
                <span className="font-mono">{a.action}</span>
                <span>{a.actor_email || "sistem"}</span>
                {a.target_id && <span className="text-muted-foreground">→ {a.target_type}:{a.target_id}</span>}
              </li>
            ))}
          </ul>
        )}
      </div>
    </PageShell>
  );
}
