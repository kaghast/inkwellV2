import React, { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { ArrowRight, CalendarClock, Loader2, X } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import BulletGlyph from "@/components/journal/BulletGlyph";
import { formatApiError } from "@/lib/api";
import { addMonths, monthLabel } from "@/lib/journal";
import { JOURNAL_CHANGED, journalApi, notifyJournalChanged, type MigrationTask } from "@/lib/workspaceApi";

/**
 * Migration: open tasks left on earlier days and months. Each can be carried
 * to today, scheduled into a month, or cancelled. The original line is kept
 * with its new state and a link to where the task went.
 */
export default function MigrationPanel({ date, onChanged }: { date: string; onChanged?: () => void }) {
  const [tasks, setTasks] = useState<MigrationTask[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const ym = date.slice(0, 7);

  const load = useCallback(() => {
    journalApi
      .migration(date)
      .then((r) => setTasks(r.tasks))
      .catch(() => setTasks([]));
  }, [date]);
  useEffect(() => {
    load();
    window.addEventListener(JOURNAL_CHANGED, load);
    return () => window.removeEventListener(JOURNAL_CHANGED, load);
  }, [load]);

  async function act(t: MigrationTask, action: "today" | "month" | "cancel", month?: string) {
    const key = `${t.note_id}:${t.task_index}`;
    setBusy(key);
    try {
      const r = await journalApi.migrate({ note_id: t.note_id, task_index: t.task_index, action, date, month });
      toast.success(action === "cancel" ? "Görev iptal edildi" : action === "today" ? "Bugüne taşındı" : `${monthLabel(month!)} ayına planlandı`, {
        description: r.target_title,
      });
      notifyJournalChanged();
      onChanged?.();
    } catch (e) {
      toast.error(formatApiError(e));
      load();
    } finally {
      setBusy(null);
    }
  }

  if (tasks === null) return <div className="text-sm text-muted-foreground">Yükleniyor…</div>;
  if (tasks.length === 0) return <p className="text-sm text-muted-foreground">Önceki günlerden taşınacak açık görev yok.</p>;
  const shown = showAll ? tasks : tasks.slice(0, 8);
  const months = Array.from({ length: 12 }, (_, i) => addMonths(ym, i));

  return (
    <div data-testid="migration-panel">
      <ul className="divide-y divide-border/60">
        {shown.map((t) => {
          const key = `${t.note_id}:${t.task_index}`;
          const pending = busy === key;
          const source = t.page === "daily" ? `/today/${t.date}` : `/journal/month/${t.date}`;
          return (
            <li key={key} className="flex items-start gap-2 py-2" data-testid="migration-item">
              <span className="mt-1">
                <BulletGlyph kind="task" state="open" signifier={t.signifier} />
              </span>
              <span className="min-w-0 flex-1 text-sm">
                <span className="break-words">{t.text}</span>
                <Link to={source} className="block text-[11px] text-muted-foreground hover:underline">
                  {t.page === "daily" ? new Date(`${t.date}T12:00:00`).toLocaleDateString("tr-TR", { day: "numeric", month: "long", weekday: "short" }) : monthLabel(t.date)}
                </Link>
              </span>
              <span className="flex shrink-0 items-center gap-0.5">
                {pending ? (
                  <Loader2 className="m-1.5 h-4 w-4 animate-spin text-muted-foreground" />
                ) : (
                  <>
                    <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => act(t, "today")} disabled={busy !== null} title="Bugüne taşı (›)" data-testid="migrate-today">
                      <ArrowRight className="h-3.5 w-3.5 sm:mr-1" /> <span className="hidden sm:inline">Bugüne</span>
                    </Button>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" disabled={busy !== null} title="Bir aya planla (‹)" data-testid="migrate-month">
                          <CalendarClock className="h-3.5 w-3.5 sm:mr-1" /> <span className="hidden sm:inline">Aya</span>
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-44">
                        <DropdownMenuLabel className="text-xs">Hangi aya?</DropdownMenuLabel>
                        <DropdownMenuSeparator />
                        {months.map((m) => (
                          <DropdownMenuItem key={m} className="cursor-pointer text-xs" onClick={() => act(t, "month", m)} data-testid={`migrate-month-${m}`}>
                            {monthLabel(m)}
                          </DropdownMenuItem>
                        ))}
                      </DropdownMenuContent>
                    </DropdownMenu>
                    <Button size="sm" variant="ghost" className="h-7 px-2 text-muted-foreground" onClick={() => act(t, "cancel")} disabled={busy !== null} title="İptal et (×)" aria-label="İptal et" data-testid="migrate-cancel">
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  </>
                )}
              </span>
            </li>
          );
        })}
      </ul>
      {tasks.length > shown.length && (
        <button type="button" className="mt-1 text-xs text-primary hover:underline" onClick={() => setShowAll(true)}>
          {tasks.length - shown.length} görev daha
        </button>
      )}
    </div>
  );
}
