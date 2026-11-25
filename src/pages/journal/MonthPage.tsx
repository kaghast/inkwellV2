import React, { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import { ChevronLeft, ChevronRight, ExternalLink, Lock, Telescope } from "lucide-react";
import PageShell, { Empty, Section } from "@/components/PageShell";
import { taskToCard } from "@/components/journal/taskToCard";
import MarkdownView from "@/components/MarkdownView";
import QuickLog from "@/components/journal/QuickLog";
import MigrationPanel from "@/components/journal/MigrationPanel";
import ReflectionCard from "@/components/journal/ReflectionCard";
import MonthReview from "@/components/journal/MonthReview";
import { Button } from "@/components/ui/button";
import api, { formatApiError } from "@/lib/api";
import { addMonths, isMonthKey, monthLabel, MONTHLY_PROMPTS, WEEKDAY_SHORT, weekdayOf } from "@/lib/journal";
import { taskPatchBody, type TaskState } from "@/lib/tasks";
import { JOURNAL_CHANGED, journalApi, notifyJournalChanged, objectPath, type MonthViewData } from "@/lib/workspaceApi";

const pad = (n: number) => String(n).padStart(2, "0");
const localDay = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/**
 * Monthly log: the calendar list (one row per day, built from that month's
 * daily notes) beside the month's own page of goals, tasks and notes.
 */
export default function MonthPage() {
  const { month: param } = useParams();
  const navigate = useNavigate();
  const today = localDay();
  const current = today.slice(0, 7);
  const month = isMonthKey(param) ? param : current;
  const [data, setData] = useState<MonthViewData | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await journalApi.month(month));
    } catch (e) {
      toast.error(formatApiError(e));
    }
  }, [month]);

  useEffect(() => {
    setData(null);
    load();
    window.addEventListener(JOURNAL_CHANGED, load);
    return () => window.removeEventListener(JOURNAL_CHANGED, load);
  }, [load]);

  async function createMonthly() {
    try {
      await journalApi.ensureMonth(month);
      load();
    } catch (e) {
      toast.error(formatApiError(e));
    }
  }

  async function toggleTask(index: number, next: boolean | TaskState) {
    if (!data?.monthly) return;
    try {
      await api.patch(`/notes/${data.monthly.note_id}/tasks`, taskPatchBody(index, next, data.monthly.content));
      notifyJournalChanged();
    } catch (e) {
      toast.error(formatApiError(e));
      load();
    }
  }

  async function add(text: string, kind: string) {
    const target = data?.monthly?.note_id || (await journalApi.ensureMonth(month)).note_id;
    await journalApi.log({ note_id: target, text, kind: kind as any, section: kind === "note" ? "Notlar" : "Görevler" });
    load();
  }

  return (
    <PageShell
      title={monthLabel(month)}
      subtitle="Aylık kayıt"
      wide
      actions={
        <div className="flex items-center gap-1">
          <Button size="sm" variant="outline" className="mr-2 h-8 gap-1.5" onClick={() => navigate("/journal/future")}>
            <Telescope className="w-4 h-4" /> <span className="hidden sm:inline">Gelecek kaydı</span>
          </Button>
          <Button size="icon" variant="ghost" aria-label="Önceki ay" onClick={() => navigate(`/journal/month/${addMonths(month, -1)}`)}><ChevronLeft className="w-4 h-4" /></Button>
          {month !== current && <Button size="sm" variant="outline" onClick={() => navigate(`/journal/month/${current}`)}>Bu ay</Button>}
          <Button size="icon" variant="ghost" aria-label="Sonraki ay" onClick={() => navigate(`/journal/month/${addMonths(month, 1)}`)}><ChevronRight className="w-4 h-4" /></Button>
        </div>
      }
    >
      {!data ? (
        <div className="text-sm text-muted-foreground">Yükleniyor…</div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
          <Section title="Takvim">
            <ol className="divide-y divide-border/50" data-testid="month-calendar">
              {data.days.map((d) => {
                const wd = weekdayOf(d.date);
                const weekend = wd === 0 || wd === 6;
                const isToday = d.date === today;
                return (
                  <li key={d.date} className={`flex items-start gap-3 py-1.5 ${isToday ? "bg-primary/5 -mx-2 px-2 rounded" : ""}`} data-testid={`month-day-${d.date}`}>
                    <Link
                      to={d.date === today ? "/" : `/today/${d.date}`}
                      className={`w-14 shrink-0 font-mono text-xs leading-6 hover:underline ${weekend ? "text-muted-foreground" : ""} ${isToday ? "font-bold text-primary" : ""}`}
                    >
                      {pad(+d.date.slice(8))} {WEEKDAY_SHORT[wd]}
                    </Link>
                    <div className="min-w-0 flex-1 text-sm leading-6">
                      {d.locked ? (
                        <span className="inline-flex items-center gap-1 text-xs text-muted-foreground"><Lock className="w-3 h-3" /> kilitli</span>
                      ) : d.events.length > 0 ? (
                        d.events.map((e, i) => (
                          <div key={i} className="flex items-start gap-1.5">
                            <span className="mt-2 h-2 w-2 shrink-0 rounded-full border-2 border-[hsl(var(--accent-tag))]" aria-hidden />
                            <span className="break-words">{e}</span>
                          </div>
                        ))
                      ) : null}
                    </div>
                    {(d.open > 0 || d.done > 0) && (
                      <span className="shrink-0 text-[11px] leading-6 text-muted-foreground" title={`${d.done} tamamlandı, ${d.open} açık`}>
                        {d.done}/{d.open + d.done}
                      </span>
                    )}
                  </li>
                );
              })}
            </ol>
          </Section>

          <div className="min-w-0 space-y-4">
            <Section
              title="Ayın sayfası"
              action={
                data.monthly && (
                  <Link to={objectPath(data.monthly)} className="inline-flex items-center gap-1 text-xs text-primary hover:underline">
                    Düzenle <ExternalLink className="w-3 h-3" />
                  </Link>
                )
              }
            >
              {data.monthly ? (
                data.monthly.locked ? (
                  <Empty>Bu sayfa parola kilitli.</Empty>
                ) : (
                  <div className="prose-sm max-w-none" data-testid="month-page">
                    <MarkdownView
                      content={data.monthly.content}
                      onTaskToggle={toggleTask}
                      onTaskToCard={async (i) => {
                        if (data.monthly && (await taskToCard(data.monthly.note_id, i, data.monthly.content, navigate))) load();
                      }}
                    />
                  </div>
                )
              ) : (
                <div className="flex items-center justify-between gap-3">
                  <Empty>Bu ay için henüz sayfa yok. İlk kayıtla birlikte oluşturulur.</Empty>
                  <Button size="sm" variant="outline" onClick={createMonthly} data-testid="month-create">Oluştur</Button>
                </div>
              )}
              {!data.monthly?.locked && (
                <div className="mt-3 border-t border-border/60 pt-3">
                  <QuickLog onSubmit={add} placeholder="Bu aya görev, etkinlik ya da not ekle…" testId="month-log" />
                </div>
              )}
            </Section>

            {month <= current && (
              <Section title="Ayın değerlendirmesi">
                <MonthReview key={month} month={month} onSaved={load} />
              </Section>
            )}

            {month <= current && !data.monthly?.locked && (
              <Section title="Aylık yansıma">
                <ReflectionCard
                  day={`${month}-01`}
                  pool={MONTHLY_PROMPTS}
                  resolveNoteId={async () => data.monthly?.note_id || (await journalApi.ensureMonth(month)).note_id}
                  onSaved={load}
                />
              </Section>
            )}

            {month === current && (
              <Section title="Taşınacaklar">
                <MigrationPanel date={today} onChanged={load} />
              </Section>
            )}
          </div>
        </div>
      )}
    </PageShell>
  );
}
