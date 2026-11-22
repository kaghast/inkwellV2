import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import { ChevronLeft, ChevronRight, Clock, Bell, Feather, ExternalLink, Loader2 } from "lucide-react";
import PageShell, { Empty, Section } from "@/components/PageShell";
import MarkdownView from "@/components/MarkdownView";
import TypeIcon from "@/components/TypeIcon";
import { Button } from "@/components/ui/button";
import api, { formatApiError } from "@/lib/api";
import { parseTimeSlotBlock, calculateDuration } from "@/lib/timeslot";
import { INBOX_CHANGED, notifyInboxChanged, objectPath, wsApi, type TodayData } from "@/lib/workspaceApi";

const pad = (n: number) => String(n).padStart(2, "0");
const localDay = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
function shift(day: string, delta: number) {
  const d = new Date(`${day}T12:00:00`);
  d.setDate(d.getDate() + delta);
  return localDay(d);
}

interface Slot {
  key: string;
  note_id: string;
  slug: string | null;
  note_title: string;
  start: string;
  end: string;
  title: string;
  color?: string;
  duration: string;
}

const TIMESLOT_RE = /```timeslot\s*\n([\s\S]*?)```/g;
const hhmm = (v: string) => (v.includes("T") ? v.split("T")[1] : v).slice(0, 5);

export default function TodayPage() {
  const { date: param } = useParams();
  const navigate = useNavigate();
  const todayKey = localDay();
  const date = param && /^\d{4}-\d{2}-\d{2}$/.test(param) ? param : todayKey;
  const isToday = date === todayKey;
  const [data, setData] = useState<TodayData | null>(null);
  const [note, setNote] = useState<string>("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      // The daily note is created automatically for today only.
      if (isToday) await wsApi.ensureDailyNote(date);
      const d = await wsApi.today(date);
      setData(d);
    } catch (e) {
      toast.error(formatApiError(e));
    }
  }, [date, isToday]);

  useEffect(() => {
    setData(null);
    load();
    window.addEventListener(INBOX_CHANGED, load);
    return () => window.removeEventListener(INBOX_CHANGED, load);
  }, [load]);

  const slots = useMemo<Slot[]>(() => {
    if (!data) return [];
    const all = [...(data.daily_note ? [data.daily_note] : []), ...data.objects];
    const out: Slot[] = [];
    for (const o of all) {
      let m: RegExpExecArray | null;
      const re = new RegExp(TIMESLOT_RE.source, "g");
      let i = 0;
      while ((m = re.exec(o.content || "")) !== null) {
        const s = parseTimeSlotBlock(m[1]);
        if (!s.start) continue;
        out.push({
          key: `${o.note_id}-${i++}`,
          note_id: o.note_id,
          slug: o.slug,
          note_title: o.title,
          start: hhmm(s.start),
          end: s.end ? hhmm(s.end) : "",
          title: s.title || o.title,
          color: s.color,
          duration: s.end ? calculateDuration(s.start, s.end).durationText : "",
        });
      }
    }
    return out.sort((a, b) => a.start.localeCompare(b.start));
  }, [data]);

  async function toggleTask(noteId: string, index: number, checked: boolean) {
    try {
      await api.patch(`/notes/${noteId}/tasks`, { index, checked });
      load();
    } catch (e) {
      toast.error(formatApiError(e));
    }
  }

  async function addToDay(e: React.FormEvent) {
    e.preventDefault();
    if (!note.trim()) return;
    setBusy(true);
    try {
      await wsApi.capture({ text: note.trim(), mode: "direct", source: "quick", captured_on: date });
      setNote("");
      notifyInboxChanged();
      toast.success("Güne eklendi ve günlük nota bağlandı");
    } catch (err) {
      toast.error(formatApiError(err));
    } finally {
      setBusy(false);
    }
  }

  async function createDaily() {
    try {
      const d = await wsApi.ensureDailyNote(date);
      navigate(objectPath({ slug: d.slug, note_id: d.note_id }));
    } catch (e) {
      toast.error(formatApiError(e));
    }
  }

  const title = new Date(`${date}T12:00:00`).toLocaleDateString("tr-TR", { weekday: "long", day: "numeric", month: "long", year: "numeric" });

  return (
    <PageShell
      title={isToday ? "Bugün" : title}
      subtitle={isToday ? title : undefined}
      wide
      actions={
        <div className="flex items-center gap-1">
          <Button size="icon" variant="ghost" aria-label="Önceki gün" onClick={() => navigate(`/today/${shift(date, -1)}`)}><ChevronLeft className="w-4 h-4" /></Button>
          {!isToday && <Button size="sm" variant="outline" onClick={() => navigate("/today")}>Bugün</Button>}
          <Button size="icon" variant="ghost" aria-label="Sonraki gün" onClick={() => navigate(`/today/${shift(date, 1)}`)}><ChevronRight className="w-4 h-4" /></Button>
        </div>
      }
    >
      {!data ? (
        <div className="text-sm text-muted-foreground">Yükleniyor…</div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
          <div className="min-w-0 space-y-4">
            <Section
              title="Günlük not"
              action={
                data.daily_note && (
                  <Link to={objectPath(data.daily_note)} className="inline-flex items-center gap-1 text-xs text-primary hover:underline">
                    Düzenle <ExternalLink className="w-3 h-3" />
                  </Link>
                )
              }
            >
              {data.daily_note ? (
                <div className="prose-sm max-w-none" data-testid="today-daily-note">
                  <MarkdownView content={data.daily_note.content} onTaskToggle={(i, c) => toggleTask(data.daily_note!.note_id, i, c)} />
                </div>
              ) : (
                <div className="flex items-center justify-between gap-3">
                  <Empty>Bu gün için günlük not yok.</Empty>
                  <Button size="sm" variant="outline" onClick={createDaily}>Günlük not oluştur</Button>
                </div>
              )}
              <form onSubmit={addToDay} className="mt-3 flex items-center gap-2 border-t border-border/60 pt-3">
                <Feather className="w-4 h-4 text-primary" aria-hidden />
                <input
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="Bu güne bir not, düşünce ya da görev ekle…"
                  className="h-8 flex-1 bg-transparent text-sm outline-none"
                  aria-label="Güne ekle"
                  data-testid="today-append"
                />
                <Button type="submit" size="sm" disabled={busy || !note.trim()}>{busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "Ekle"}</Button>
              </form>
            </Section>

            <Section title={`Bu günün nesneleri · ${data.objects.length}`}>
              {data.objects.length === 0 ? (
                <Empty>Bu gün oluşturulan ya da tarihlenen nesne yok.</Empty>
              ) : (
                <ul className="divide-y divide-border/60">
                  {data.objects.map((o) => (
                    <li key={o.note_id}>
                      <Link to={objectPath(o)} className="flex items-center gap-2.5 rounded-md px-1 py-2 hover:bg-muted/50">
                        <TypeIcon icon={o.type_icon} color={o.type_color} className="w-4 h-4" />
                        <span className="flex-1 truncate text-sm">{o.title}</span>
                        <span className="text-[11px] text-muted-foreground">{o.type_name}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </Section>
          </div>

          <div className="min-w-0 space-y-4">
            <Section title="Zaman çizelgesi">
              {slots.length === 0 ? (
                <Empty>Bu güne ait zaman bloğu yok. Notlara ```timeslot bloğu eklediğinde burada sıralanır.</Empty>
              ) : (
                <ol className="relative ml-2 border-l border-border pl-4 space-y-3" data-testid="today-timeline">
                  {slots.map((s) => (
                    <li key={s.key} className="relative">
                      <span className="absolute -left-[21px] top-1.5 h-2.5 w-2.5 rounded-full" style={{ background: s.color || "hsl(var(--primary))" }} />
                      <div className="text-xs font-mono text-muted-foreground">{s.start}{s.end && ` – ${s.end}`}{s.duration && ` · ${s.duration}`}</div>
                      <Link to={objectPath({ slug: s.slug, note_id: s.note_id })} className="text-sm font-medium hover:underline">{s.title}</Link>
                    </li>
                  ))}
                </ol>
              )}
            </Section>

            <Section title={`Açık görevler · ${data.tasks.length}`}>
              {data.tasks.length === 0 ? (
                <Empty>Açık görev yok.</Empty>
              ) : (
                <ul className="space-y-1.5" data-testid="today-tasks">
                  {data.tasks.map((t) => (
                    <li key={`${t.note_id}-${t.task_index}`} className="flex items-start gap-2 text-sm">
                      <input type="checkbox" className="mt-1" aria-label={`Tamamla: ${t.text}`} onChange={(e) => toggleTask(t.note_id, t.task_index, e.target.checked)} />
                      <span className="flex-1">
                        {t.text}
                        <Link to={`/note/${t.note_id}`} className="block text-[11px] text-muted-foreground hover:underline">{t.note_title || "Adsız"}</Link>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Section>

            {data.reminders.length > 0 && (
              <Section title="Hatırlatmalar">
                <ul className="space-y-1.5">
                  {data.reminders.map((r) => (
                    <li key={r.reminder_id} className="flex items-center gap-2 text-sm">
                      <Bell className="w-3.5 h-3.5 text-amber-500" />
                      <span className="font-mono text-xs text-muted-foreground">{new Date(r.at).toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" })}</span>
                      <Link to={`/note/${r.note_id}`} className="truncate hover:underline">{r.text}</Link>
                    </li>
                  ))}
                </ul>
              </Section>
            )}

            <Section title={`Yakalamalar · ${data.captures.length}`}>
              {data.captures.length === 0 ? (
                <Empty>Bu gün bir şey yakalanmadı.</Empty>
              ) : (
                <ul className="space-y-1.5">
                  {data.captures.map((c) => (
                    <li key={c.capture_id} className="flex items-center gap-2 text-sm">
                      <Clock className="w-3.5 h-3.5 text-muted-foreground" />
                      {c.object_id ? (
                        <Link to={`/note/${c.object_id}`} className="truncate hover:underline">{c.suggestion?.title || c.raw_text.split("\n")[0] || c.raw_url}</Link>
                      ) : (
                        <Link to={`/inbox?focus=${c.capture_id}`} className="truncate text-muted-foreground hover:underline">{c.raw_text.split("\n")[0] || c.raw_url || "Dosya"} · gelen kutusunda</Link>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </Section>
          </div>
        </div>
      )}
    </PageShell>
  );
}
