import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import { ChevronLeft, ChevronRight, Clock, Bell, Feather, ExternalLink, Loader2, LayoutTemplate, Square, Circle, Minus, FilePlus2 } from "lucide-react";
import { parseLogEntry, taskPatchBody, type BulletKind, type TaskState } from "@/lib/tasks";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useWorkspace } from "@/contexts/WorkspaceContext";
import PageShell, { Empty, Section } from "@/components/PageShell";
import MarkdownView from "@/components/MarkdownView";
import TypeIcon from "@/components/TypeIcon";
import { Button } from "@/components/ui/button";
import api, { formatApiError } from "@/lib/api";
import { parseTimeSlotBlock, calculateDuration } from "@/lib/timeslot";
import { INBOX_CHANGED, notifyInboxChanged, objectPath, wsApi, type TodayData } from "@/lib/workspaceApi";
import CalendarPanel from "@/components/CalendarPanel";
import PeriodNotesStrip from "@/components/PeriodNotesStrip";
import type { CalendarCounts } from "@/types";

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

type EntryKind = BulletKind | "object";
const KINDS: Array<{ id: EntryKind; label: string; hint: string; icon: React.ComponentType<{ className?: string }> }> = [
  { id: "task", label: "Görev", hint: ". ya da t", icon: Square },
  { id: "event", label: "Etkinlik", hint: "o", icon: Circle },
  { id: "note", label: "Not", hint: "-", icon: Minus },
  { id: "object", label: "Ayrı not", hint: "", icon: FilePlus2 },
];

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
  const [kind, setKind] = useState<EntryKind>("task");
  const [busy, setBusy] = useState(false);
  const { templates, openTemplate } = useWorkspace();
  const [reloadKey, setReloadKey] = useState(0);
  const [cal, setCal] = useState(() => ({ year: +date.slice(0, 4), month: +date.slice(5, 7) }));
  const [counts, setCounts] = useState<CalendarCounts>({});

  // The calendar follows the shown day; its arrows can browse other months.
  useEffect(() => setCal({ year: +date.slice(0, 4), month: +date.slice(5, 7) }), [date]);
  const loadCounts = useCallback(() => {
    api
      .get<CalendarCounts>("/notes/calendar", { params: { year: cal.year, month: cal.month } })
      .then((r) => setCounts(r.data || {}))
      .catch(() => setCounts({}));
  }, [cal]);
  useEffect(() => loadCounts(), [loadCounts]);
  const changeMonth = (delta: number) =>
    setCal((c) => {
      const m = c.month + delta;
      return m > 12 ? { year: c.year + 1, month: 1 } : m < 1 ? { year: c.year - 1, month: 12 } : { year: c.year, month: m };
    });

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

  async function toggleTask(noteId: string, index: number, next: boolean | TaskState) {
    try {
      await api.patch(`/notes/${noteId}/tasks`, taskPatchBody(index, next));
      load();
    } catch (e) {
      toast.error(formatApiError(e));
    }
  }

  // A typed prefix (". ", "o ", "- ") wins over the selected kind, as on paper.
  const typed = kind === "object" ? null : parseLogEntry(note, kind);

  async function addToDay(e: React.FormEvent) {
    e.preventDefault();
    const text = note;
    if (!text.trim() || busy) return;
    if (kind !== "object" && !typed?.text) return;
    // Clear at once so the next entry can be typed while this one saves; restore on failure
    setNote("");
    setBusy(true);
    try {
      if (kind === "object") {
        await wsApi.capture({ text: text.trim(), mode: "direct", source: "quick", captured_on: date });
        notifyInboxChanged();
        toast.success("Ayrı not olarak eklendi ve günlük nota bağlandı");
      } else {
        await wsApi.logToDay({ text, kind, date });
        load();
        setReloadKey((k) => k + 1);
      }
    } catch (err) {
      setNote((cur) => (cur ? cur : text));
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
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" variant="outline" className="mr-2 h-8 gap-1.5" data-testid="today-template-btn">
                <LayoutTemplate className="w-4 h-4" /> <span className="hidden sm:inline">Şablondan oluştur</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              {templates.filter((t) => t.id !== "daily").map((t) => (
                <DropdownMenuItem key={t.id} onClick={() => openTemplate(t.id)} className="cursor-pointer">
                  {t.name}
                </DropdownMenuItem>
              ))}
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => navigate("/settings?tab=templates")} className="cursor-pointer text-muted-foreground">
                Şablonları yönet…
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button size="icon" variant="ghost" aria-label="Önceki gün" onClick={() => navigate(`/today/${shift(date, -1)}`)}><ChevronLeft className="w-4 h-4" /></Button>
          {!isToday && <Button size="sm" variant="outline" onClick={() => navigate("/")}>Bugün</Button>}
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
              <form onSubmit={addToDay} className="mt-3 border-t border-border/60 pt-3" data-testid="today-log-form">
                <div className="mb-2 flex flex-wrap items-center gap-1" role="radiogroup" aria-label="Kayıt türü">
                  {KINDS.map((k) => {
                    const active = (typed && note.trim() ? typed.kind : kind) === k.id && (k.id !== "object" || kind === "object");
                    const Icon = k.icon;
                    return (
                      <button
                        key={k.id}
                        type="button"
                        role="radio"
                        aria-checked={active}
                        onClick={() => setKind(k.id)}
                        title={k.hint ? `Kısayol: satırın başına "${k.hint}"` : "Günlük nota bağlı ayrı bir not oluşturur"}
                        className={`inline-flex h-7 items-center gap-1 rounded-md px-2 text-xs transition-colors ${active ? "bg-primary/10 text-primary font-medium" : "text-muted-foreground hover:bg-muted"}`}
                        data-testid={`log-kind-${k.id}`}
                      >
                        <Icon className="w-3.5 h-3.5" /> {k.label}
                      </button>
                    );
                  })}
                  {typed?.signifier && (
                    <span className="ml-1 rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">{typed.signifier === "priority" ? "! öncelikli" : "? araştırılacak"}</span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <Feather className="w-4 h-4 text-primary" aria-hidden />
                  <input
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder={kind === "object" ? "Bu güne bağlı ayrı bir not yaz…" : "Hızlı kayıt: görev, etkinlik ya da not… (! öncelikli, ? araştır)"}
                    className="h-8 flex-1 min-w-0 bg-transparent text-sm outline-none"
                    aria-label="Güne ekle"
                    data-testid="today-append"
                  />
                  <Button type="submit" size="sm" disabled={busy || !note.trim() || (typed !== null && !typed.text)}>
                    {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "Ekle"}
                  </Button>
                </div>
              </form>
            </Section>

            <Section title="Hafta ve ay">
              <PeriodNotesStrip date={date} reloadKey={reloadKey} showEmpty />
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
            <section className="min-w-0 overflow-hidden rounded-lg border border-border bg-card" data-testid="today-calendar">
              <CalendarPanel
                year={cal.year}
                month={cal.month}
                counts={counts}
                selectedDate={date}
                onSelectDate={(iso) => navigate(iso === todayKey ? "/" : `/today/${iso}`)}
                onChangeMonth={changeMonth}
                onNoteCreated={() => {
                  load();
                  loadCounts();
                  setReloadKey((k) => k + 1);
                }}
              />
            </section>

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
