import React, { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { CreditCard, Loader2, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatApiError } from "@/lib/api";
import {
  saasApi, formatLimit, formatMoney, LIMIT_LABEL, PAYMENT_STATUS,
  type BillingOverview, type Plan, type PlanLimits, type WorkspaceSummary,
} from "@/lib/saasApi";

function UsageBar({ label, used, limit, unit = "" }: { label: string; used: number; limit: number | undefined; unit?: string }) {
  const unlimited = limit === undefined || limit === null || limit < 0;
  const pct = unlimited ? 0 : Math.min(100, Math.round((used / Math.max(limit!, 1)) * 100));
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className={pct >= 90 ? "font-semibold text-destructive" : ""}>
          {used.toLocaleString("tr-TR")}
          {unit} / {formatLimit(limit)}
        </span>
      </div>
      {!unlimited && (
        <div className="h-1.5 overflow-hidden rounded-full bg-muted">
          <div className={`h-full ${pct >= 90 ? "bg-destructive" : "bg-primary"}`} style={{ width: `${pct}%` }} />
        </div>
      )}
    </div>
  );
}

/** Settings > Paket ve Ödeme: plan, usage, plan purchase with iyzico, payments. */
export default function BillingSettings() {
  const [params, setParams] = useSearchParams();
  const [workspaces, setWorkspaces] = useState<WorkspaceSummary[]>([]);
  const [wsId, setWsId] = useState<string | undefined>(params.get("workspace") || undefined);
  const [data, setData] = useState<BillingOverview | null>(null);
  const [period, setPeriod] = useState<"month" | "year">("month");
  const [buying, setBuying] = useState<string | null>(null);
  const [profileOpen, setProfileOpen] = useState(false);
  const [profile, setProfile] = useState({ full_name: "", phone: "", address: "", city: "", zip_code: "", identity_number: "" });
  const [savingProfile, setSavingProfile] = useState(false);

  const load = useCallback(() => {
    saasApi
      .billing(wsId)
      .then((d) => {
        setData(d);
        if (d.profile) setProfile((p) => ({ ...p, full_name: d.profile!.full_name, phone: d.profile!.phone, address: d.profile!.address, city: d.profile!.city, zip_code: d.profile!.zip_code || "" }));
      })
      .catch((e) => toast.error(formatApiError(e)));
  }, [wsId]);

  useEffect(load, [load]);
  useEffect(() => {
    saasApi.workspaces().then(setWorkspaces).catch(() => setWorkspaces([]));
  }, []);

  // Result of the iyzico payment page (the server redirected here)
  useEffect(() => {
    const r = params.get("payment");
    if (!r) return;
    const msg = params.get("message") || "";
    if (r === "ok") toast.success(msg || "Ödeme alındı; paketin güncellendi.");
    else toast.error(msg || "Ödeme tamamlanamadı.");
    const next = new URLSearchParams(params);
    next.delete("payment");
    next.delete("message");
    setParams(next, { replace: true });
  }, [params, setParams]);

  async function buy(plan: Plan) {
    if (!data) return;
    if (!data.profile) {
      setProfileOpen(true);
      toast.info("Ödeme için önce fatura bilgilerini gir.");
      return;
    }
    setBuying(plan.plan_key);
    try {
      const r = await saasApi.checkout({ workspace_id: data.workspace.workspace_id, plan_key: plan.plan_key, period });
      if (r.payment_page_url) window.location.href = r.payment_page_url;
      else toast.error("iyzico ödeme sayfası adresi dönmedi.");
    } catch (e) {
      toast.error(formatApiError(e));
    } finally {
      setBuying(null);
    }
  }

  async function saveProfile(e: React.FormEvent) {
    e.preventDefault();
    setSavingProfile(true);
    try {
      const body: any = { ...profile };
      if (!body.identity_number) delete body.identity_number;
      await saasApi.saveProfile(body);
      toast.success("Fatura bilgileri kaydedildi");
      setProfileOpen(false);
      setProfile((p) => ({ ...p, identity_number: "" }));
      load();
    } catch (err) {
      toast.error(formatApiError(err));
    } finally {
      setSavingProfile(false);
    }
  }

  if (!data) return <div className="text-sm text-muted-foreground">Yükleniyor…</div>;
  const limits = data.plan.limits as PlanLimits;
  const sub = data.subscription;

  return (
    <div className="space-y-6" data-testid="billing-settings">
      <div>
        <h2 className="flex items-center gap-2 text-lg font-semibold">
          <CreditCard className="h-5 w-5 text-primary" /> Paket ve Ödeme
        </h2>
        <p className="text-sm text-muted-foreground">Paketin, kullanımın ve ödemelerin. Ödemeler iyzico'nun güvenli ödeme sayfasında alınır; kart bilgin Inkwell'e gelmez.</p>
      </div>

      {workspaces.length > 1 && (
        <div className="flex items-center gap-2 text-sm">
          <Label htmlFor="billing-ws">Çalışma alanı</Label>
          <select
            id="billing-ws"
            className="h-8 rounded-md border border-border bg-background px-2 text-sm"
            value={data.workspace.workspace_id}
            onChange={(e) => setWsId(e.target.value)}
            data-testid="billing-workspace"
          >
            {workspaces.map((w) => (
              <option key={w.workspace_id} value={w.workspace_id}>
                {w.kind === "personal" ? "Kişisel" : w.name}
              </option>
            ))}
          </select>
        </div>
      )}

      <section className="rounded-xl border border-border bg-card p-4 space-y-3" data-testid="billing-current">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div>
            <div className="text-xs uppercase tracking-wide text-muted-foreground">Mevcut paket</div>
            <div className="text-xl font-semibold">{data.plan.name}</div>
          </div>
          <div className="text-right text-xs text-muted-foreground">
            {sub?.active && sub.current_period_end
              ? `${new Date(sub.current_period_end).toLocaleDateString("tr-TR")} tarihine kadar geçerli${sub.source === "admin" ? " (yönetici tanımladı)" : ""}`
              : sub?.active
                ? "Süresiz (yönetici tanımladı)"
                : sub && !sub.active
                  ? `Süresi ${sub.current_period_end ? new Date(sub.current_period_end).toLocaleDateString("tr-TR") : ""} tarihinde doldu; varsayılan pakettesin`
                  : "Varsayılan paket"}
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <UsageBar label="Nesne" used={data.usage.objects} limit={limits.objects} />
          {data.workspace.kind === "personal" && <UsageBar label="Depolama" used={data.usage.storage_mb} limit={limits.storage_mb} unit=" MB" />}
          {data.workspace.kind === "team" && <UsageBar label="Üye (davetler dahil)" used={data.usage.members + data.usage.pending_invitations} limit={limits.members} />}
          {data.workspace.kind === "personal" && <UsageBar label="Yapay zeka çağrısı (bu ay, sunucu anahtarı)" used={data.usage.ai_calls_month} limit={limits.ai_calls_month} />}
        </div>
        <p className="text-[11px] text-muted-foreground">Sınıra ulaşınca hiçbir şey silinmez; yalnızca yeni ekleme durur. Kendi yapay zeka anahtarınla yapılan çağrılar kotadan düşmez.</p>
      </section>

      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-semibold">Paketler</h3>
          <div className="inline-flex rounded-lg border border-border p-0.5 text-xs" role="tablist">
            {(["month", "year"] as const).map((p) => (
              <button
                key={p}
                type="button"
                role="tab"
                aria-selected={period === p}
                onClick={() => setPeriod(p)}
                className={`rounded-md px-3 py-1 ${period === p ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}
              >
                {p === "month" ? "Aylık" : "Yıllık"}
              </button>
            ))}
          </div>
        </div>
        {!data.payment.configured && (
          <p className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs" data-testid="billing-not-configured">
            Ödeme altyapısı henüz yapılandırılmadı (iyzico anahtarları eksik). Paketler görüntülenebilir ama satın alınamaz.
          </p>
        )}
        {data.payment.configured && data.payment.sandbox && (
          <p className="rounded-md border border-sky-500/40 bg-sky-500/10 px-3 py-2 text-xs">iyzico test (sandbox) ortamı: gerçek ödeme alınmaz.</p>
        )}
        <div className="grid gap-3 md:grid-cols-3">
          {data.plans.map((p) => {
            const price = period === "year" ? p.price_yearly : p.price_monthly;
            const current = p.plan_key === data.plan.plan_key;
            const paid = Number(price) > 0;
            return (
              <div key={p.plan_key} className={`flex flex-col rounded-xl border p-4 ${current ? "border-primary" : "border-border"} bg-card`} data-testid={`plan-${p.plan_key}`}>
                <div className="flex items-center justify-between">
                  <span className="font-semibold">{p.name}</span>
                  {current && <span className="rounded-full bg-primary/15 px-2 py-0.5 text-[10px] text-primary">Mevcut</span>}
                </div>
                <div className="mt-1 text-2xl font-bold">
                  {paid ? formatMoney(price, p.currency) : "Ücretsiz"}
                  {paid && <span className="text-xs font-normal text-muted-foreground"> / {period === "year" ? "yıl" : "ay"}</span>}
                </div>
                <p className="mt-1 text-xs text-muted-foreground">{p.description}</p>
                <ul className="mt-3 flex-1 space-y-1 text-xs">
                  {(Object.keys(LIMIT_LABEL) as Array<keyof PlanLimits>).map((k) => (
                    <li key={k}>
                      {LIMIT_LABEL[k]}: <b>{formatLimit(p.limits[k])}</b>
                    </li>
                  ))}
                  {p.features.map((f) => (
                    <li key={f}>• {f}</li>
                  ))}
                </ul>
                {paid && (
                  <Button
                    className="mt-3"
                    size="sm"
                    disabled={!data.payment.configured || !data.can_manage || buying !== null}
                    onClick={() => buy(p)}
                    data-testid={`buy-${p.plan_key}`}
                  >
                    {buying === p.plan_key ? <Loader2 className="h-4 w-4 animate-spin" /> : current ? "Süreyi uzat" : "Satın al"}
                  </Button>
                )}
              </div>
            );
          })}
        </div>
        {!data.can_manage && <p className="text-xs text-muted-foreground">Bu çalışma alanının paketini yalnızca sahibi ya da yöneticileri değiştirebilir.</p>}
        <p className="text-[11px] text-muted-foreground">
          Ödeme tek seferliktir ve seçtiğin dönem kadar geçerlidir; otomatik yenilenmez. Süre bitmeden aynı paketi yeniden alırsan süre uzar.
        </p>
      </section>

      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="flex items-center gap-1.5 font-semibold">
            <ShieldCheck className="h-4 w-4" /> Fatura bilgileri
          </h3>
          <Button size="sm" variant="outline" onClick={() => setProfileOpen((v) => !v)} data-testid="billing-profile-toggle">
            {data.profile ? "Düzenle" : "Ekle"}
          </Button>
        </div>
        {data.profile && !profileOpen && (
          <p className="text-sm text-muted-foreground">
            {data.profile.full_name} · {data.profile.phone} · {data.profile.city}
            {data.profile.identity_number_hint ? ` · T.C. ${data.profile.identity_number_hint}` : ""}
          </p>
        )}
        {profileOpen && (
          <form onSubmit={saveProfile} className="grid gap-3 rounded-xl border border-border bg-card p-4 sm:grid-cols-2" data-testid="billing-profile-form">
            {(
              [
                ["full_name", "Ad soyad", "text"],
                ["phone", "Telefon (+90…)", "tel"],
                ["city", "Şehir", "text"],
                ["zip_code", "Posta kodu (isteğe bağlı)", "text"],
              ] as const
            ).map(([k, label, type]) => (
              <div key={k} className="space-y-1">
                <Label htmlFor={`bp-${k}`}>{label}</Label>
                <Input id={`bp-${k}`} type={type} value={(profile as any)[k]} onChange={(e) => setProfile({ ...profile, [k]: e.target.value })} />
              </div>
            ))}
            <div className="space-y-1 sm:col-span-2">
              <Label htmlFor="bp-address">Adres</Label>
              <Input id="bp-address" value={profile.address} onChange={(e) => setProfile({ ...profile, address: e.target.value })} />
            </div>
            <div className="space-y-1 sm:col-span-2">
              <Label htmlFor="bp-id">T.C. kimlik numarası (isteğe bağlı)</Label>
              <Input
                id="bp-id"
                inputMode="numeric"
                autoComplete="off"
                value={profile.identity_number}
                placeholder={data.profile?.identity_number_hint ? `Kayıtlı: ${data.profile.identity_number_hint}` : "11 hane"}
                onChange={(e) => setProfile({ ...profile, identity_number: e.target.value.replace(/\D/g, "").slice(0, 11) })}
              />
              <p className="text-[11px] text-muted-foreground">iyzico fatura için ister; şifreli saklanır. Boş bırakırsan iyzico'nun kabul ettiği genel değer gönderilir.</p>
            </div>
            <div className="sm:col-span-2">
              <Button type="submit" size="sm" disabled={savingProfile}>
                {savingProfile ? <Loader2 className="h-4 w-4 animate-spin" /> : "Kaydet"}
              </Button>
            </div>
          </form>
        )}
      </section>

      <section className="space-y-2">
        <h3 className="font-semibold">Ödemeler</h3>
        {data.payments.length === 0 ? (
          <p className="text-sm text-muted-foreground">Henüz ödeme yok.</p>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-border">
            <table className="w-full text-xs" data-testid="billing-payments">
              <thead className="bg-muted/50 text-left text-muted-foreground">
                <tr>
                  <th className="px-3 py-2">Tarih</th>
                  <th className="px-3 py-2">Paket</th>
                  <th className="px-3 py-2">Tutar</th>
                  <th className="px-3 py-2">Durum</th>
                </tr>
              </thead>
              <tbody>
                {data.payments.map((p) => (
                  <tr key={p.payment_id} className="border-t border-border">
                    <td className="px-3 py-2">{new Date(p.created_at).toLocaleString("tr-TR")}</td>
                    <td className="px-3 py-2">
                      {data.plans.find((x) => x.plan_key === p.plan_key)?.name || p.plan_key} · {p.period === "year" ? "yıllık" : "aylık"}
                    </td>
                    <td className="px-3 py-2">{formatMoney(p.amount, p.currency)}</td>
                    <td className="px-3 py-2" title={p.error || ""}>
                      {PAYMENT_STATUS[p.status] || p.status}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
