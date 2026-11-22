import React, { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { ArrowRight, Check, Inbox, Link2, Sun, LayoutTemplate, Feather, Sparkles } from "lucide-react";
import PageShell, { Empty, Section } from "@/components/PageShell";
import TypeIcon from "@/components/TypeIcon";
import { Button } from "@/components/ui/button";
import { useWorkspace } from "@/contexts/WorkspaceContext";
import { useAuth } from "@/contexts/AuthContext";
import { formatApiError } from "@/lib/api";
import { INBOX_CHANGED, objectPath, wsApi, type HomeData, type TodayData } from "@/lib/workspaceApi";

const GOALS: Array<{ key: keyof HomeData["activation"]["goals"]; label: string }> = [
  { key: "captures", label: "Bir şey yakala" },
  { key: "objects", label: "5 nesne oluştur" },
  { key: "relations", label: "2 ilişki kur" },
  { key: "backlinks", label: "Bir [[bağlantı]] ile geri bağlantı oluştur" },
  { key: "active_days", label: "Ertesi gün geri dön" },
];

function timeAgo(iso: string) {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return "az önce";
  if (s < 3600) return `${Math.floor(s / 60)} dk önce`;
  if (s < 86400) return `${Math.floor(s / 3600)} sa önce`;
  return new Date(iso).toLocaleDateString("tr-TR", { day: "numeric", month: "short" });
}

export default function HomePage() {
  const { user } = useAuth();
  const { focusCapture, openTemplate, typeById } = useWorkspace();
  const [home, setHome] = useState<HomeData | null>(null);
  const [today, setToday] = useState<TodayData | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    Promise.all([wsApi.home(), wsApi.today()])
      .then(([h, t]) => {
        setHome(h);
        setToday(t);
        setError(null);
      })
      .catch((e) => setError(formatApiError(e)));
  }, []);

  useEffect(() => {
    load();
    window.addEventListener(INBOX_CHANGED, load);
    return () => window.removeEventListener(INBOX_CHANGED, load);
  }, [load]);

  const name = user && typeof user === "object" ? user.name?.split(" ")[0] : "";
  const a = home?.activation;
  const done = a ? GOALS.filter((g) => a[g.key] >= a.goals[g.key]).length : 0;

  async function acceptSuggestion(id: string) {
    try {
      await wsApi.acceptRelation(id);
      toast.success("İlişki eklendi");
      load();
    } catch (e) {
      toast.error(formatApiError(e));
    }
  }

  return (
    <PageShell title={name ? `Merhaba, ${name}` : "Ana sayfa"} subtitle="Yakala, bağla, anla." wide>
      {error && <div className="mb-4 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div>}

      <button
        type="button"
        onClick={focusCapture}
        className="mb-5 flex w-full items-center gap-3 rounded-xl border border-dashed border-primary/40 bg-primary/5 px-4 py-4 text-left text-muted-foreground hover:bg-primary/10 transition-colors"
        data-testid="home-capture"
      >
        <Feather className="w-5 h-5 text-primary" />
        <span className="flex-1 text-base">Aklında ne var? Bir düşünce, bağlantı ya da dosya…</span>
        <kbd className="rounded border border-border bg-background px-1.5 font-mono text-xs">C</kbd>
      </button>

      <div className="grid gap-4 md:grid-cols-3">
        <Section
          title="Gelen kutusu"
          action={<Link to="/inbox" className="text-xs text-primary hover:underline inline-flex items-center gap-1">Aç <ArrowRight className="w-3 h-3" /></Link>}
        >
          {home ? (
            home.inbox.needs_review > 0 ? (
              <Link to="/inbox" className="flex items-center gap-3 rounded-md p-1 hover:bg-muted/60">
                <Inbox className="w-5 h-5 text-amber-500" />
                <span className="text-sm"><b>{home.inbox.needs_review}</b> öğe incelemeni bekliyor</span>
              </Link>
            ) : home.inbox.new + home.inbox.processing > 0 ? (
              <Empty>{home.inbox.new + home.inbox.processing} öğe işleniyor…</Empty>
            ) : (
              <Empty>Gelen kutusu boş. Yakaladıkların burada incelenir.</Empty>
            )
          ) : (
            <Empty>Yükleniyor…</Empty>
          )}
        </Section>

        <Section
          title="Bugün"
          action={<Link to="/today" className="text-xs text-primary hover:underline inline-flex items-center gap-1">Aç <ArrowRight className="w-3 h-3" /></Link>}
        >
          {today ? (
            <div className="space-y-1.5 text-sm">
              <div className="flex items-center gap-2"><Sun className="w-4 h-4 text-amber-500" /> {today.tasks.length} açık görev</div>
              <div className="text-muted-foreground">{today.objects.length} nesne · {today.captures.length} yakalama · {today.reminders.length} hatırlatma</div>
              {today.tasks.slice(0, 3).map((t) => (
                <div key={`${t.note_id}-${t.task_index}`} className="truncate text-xs text-muted-foreground">☐ {t.text}</div>
              ))}
            </div>
          ) : (
            <Empty>Yükleniyor…</Empty>
          )}
        </Section>

        <Section title="Şablonlar">
          <div className="grid gap-1">
            {[
              ["meeting", "Toplantı"],
              ["project", "Proje"],
              ["research", "Araştırma"],
            ].map(([k, l]) => (
              <button key={k} type="button" onClick={() => openTemplate(k)} className="flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted/60">
                <LayoutTemplate className="w-4 h-4 text-muted-foreground" /> {l}
              </button>
            ))}
          </div>
        </Section>
      </div>

      <div className="mt-4 grid gap-4 md:grid-cols-3">
        <Section title="Son nesneler" className="md:col-span-2">
          {home && home.recent.length === 0 && <Empty>Henüz nesne yok. İlk düşünceni yakalayarak başla.</Empty>}
          <ul className="divide-y divide-border/60">
            {home?.recent.map((n) => {
              const t = typeById(n.note_type_id);
              return (
                <li key={n.note_id}>
                  <Link to={objectPath(n)} className="flex items-center gap-2.5 px-1 py-2 hover:bg-muted/50 rounded-md">
                    <TypeIcon icon={t?.icon} color={t?.color} className="w-4 h-4" />
                    <span className="flex-1 truncate text-sm">{n.title}</span>
                    <span className="text-[11px] text-muted-foreground">{t?.name}</span>
                    <span className="w-20 text-right text-[11px] text-muted-foreground">{timeAgo(n.updated_at)}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </Section>

        <div className="min-w-0 space-y-4">
          {home && home.suggestions.length > 0 && (
            <Section title="Bağlantı önerileri">
              <ul className="space-y-2">
                {home.suggestions.map((s) => (
                  <li key={s.relation_id} className="text-sm">
                    <div className="flex items-center gap-1.5">
                      <Link2 className="w-3.5 h-3.5 text-primary" />
                      <Link to={objectPath(s.source)} className="truncate hover:underline">{s.source.title}</Link>
                      <span className="text-muted-foreground">↔</span>
                      <Link to={objectPath(s.target)} className="truncate hover:underline">{s.target.title}</Link>
                    </div>
                    {s.reason && <div className="ml-5 text-xs text-muted-foreground">{s.reason}</div>}
                    <Button size="sm" variant="outline" className="ml-5 mt-1 h-6 text-xs" onClick={() => acceptSuggestion(s.relation_id)}>Bağla</Button>
                  </li>
                ))}
              </ul>
            </Section>
          )}

          {a && done < GOALS.length && (
            <Section title={`İlk adımlar · ${done}/${GOALS.length}`}>
              <ul className="space-y-1.5" data-testid="activation-checklist">
                {GOALS.map((g) => {
                  const ok = a[g.key] >= a.goals[g.key];
                  return (
                    <li key={g.key} className={`flex items-center gap-2 text-sm ${ok ? "text-muted-foreground line-through" : ""}`}>
                      <span className={`flex h-4 w-4 items-center justify-center rounded-full border ${ok ? "border-emerald-500 bg-emerald-500 text-white" : "border-border"}`}>
                        {ok && <Check className="w-3 h-3" />}
                      </span>
                      {g.label}
                      <span className="ml-auto text-[11px] text-muted-foreground">{Math.min(a[g.key], a.goals[g.key])}/{a.goals[g.key]}</span>
                    </li>
                  );
                })}
              </ul>
            </Section>
          )}

          {home && (
            <div className="flex items-center gap-1.5 px-1 text-[11px] text-muted-foreground">
              <Sparkles className="w-3 h-3" />
              {home.ai.is_model ? `Yakalamalar ${home.ai.label} ile işleniyor.` : "Yapay zeka anahtarı tanımlı değil; yakalamalar kural tabanlı işleniyor."}
            </div>
          )}
        </div>
      </div>
    </PageShell>
  );
}
