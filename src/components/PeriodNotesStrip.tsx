import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { CalendarDays, CalendarRange, Lock, CheckSquare } from "lucide-react";
import api from "@/lib/api";
import type { Note } from "@/types";
import { periodLabel, periodStart, type NotePeriod } from "@/lib/period";
import { countTasks } from "@/lib/tasks";

interface Props {
  /** Selected day (YYYY-MM-DD); the strip shows that day's week and month notes. */
  date: string;
  reloadKey?: number;
  /** Keep both groups visible with an empty message (Today page); default hides empty groups. */
  showEmpty?: boolean;
}

/** Plain-text preview of a note's markdown, without blocks, comments or markup. */
function previewText(md: string): string {
  return (md || "")
    .replace(/<!--[\s\S]*?(?:-->|$)/g, " ")
    .replace(/```[\s\S]*?(?:```|$)/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^\s*(?:[-*+]|\d+[.)])\s+\[[ xX]\]\s*/gm, "")
    .replace(/^\s*(?:#{1,6}|>|[-*+]|\d+[.)])\s+/gm, "")
    .replace(/[*_`~]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function MiniCard({ note }: { note: Note }) {
  const locked = Boolean(note.is_encrypted);
  const preview = locked ? "" : previewText(note.content);
  const tasks = locked ? { total: 0, done: 0 } : countTasks(note.content);
  return (
    <Link
      to={`/note/${note.slug || note.note_id}`}
      className="block min-w-0 rounded-lg border border-border bg-card/70 hover:bg-muted/60 hover:border-foreground/20 transition-colors px-3 py-2"
      data-testid={`period-note-${note.note_id}`}
      title={note.title || "Başlıksız Not"}
    >
      <div className="flex items-center gap-1.5 min-w-0">
        {locked && <Lock className="w-3 h-3 text-amber-600 shrink-0" />}
        <span className="text-xs font-semibold text-foreground truncate">{note.title || "Başlıksız Not"}</span>
        {tasks.total > 0 && (
          <span className="ml-auto shrink-0 inline-flex items-center gap-0.5 text-[10px] font-mono text-muted-foreground">
            <CheckSquare className="w-3 h-3" />
            {tasks.done}/{tasks.total}
          </span>
        )}
      </div>
      <p className="text-[11px] text-muted-foreground line-clamp-2 mt-0.5 break-words [overflow-wrap:anywhere]">
        {locked ? "Şifreli not" : preview || "İçerik yok"}
      </p>
    </Link>
  );
}

function Group({ period, date, notes, showEmpty = false }: { period: NotePeriod; date: string; notes: Note[]; showEmpty?: boolean }) {
  if (notes.length === 0 && !showEmpty) return null;
  const Icon = period === "week" ? CalendarRange : CalendarDays;
  return (
    <section data-testid={`period-strip-${period}`}>
      <div className="flex items-center gap-1.5 text-[10px] tracking-[0.2em] uppercase text-muted-foreground font-mono mb-1.5">
        <Icon className="w-3 h-3" strokeWidth={1.5} />
        <span>{period === "week" ? "Haftanın Notları" : "Ayın Notları"}</span>
        <span className="normal-case tracking-normal opacity-70">· {periodLabel(date, period)}</span>
      </div>
      {notes.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          {period === "week" ? "Bu hafta için haftalık not yok." : "Bu ay için aylık not yok."} Takvimde hafta numarasına ya da ay adına tıklayıp oradan ekleyebilirsin.
        </p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {notes.map((n) => (
            <MiniCard key={n.note_id} note={n} />
          ))}
        </div>
      )}
    </section>
  );
}

export default function PeriodNotesStrip({ date, reloadKey = 0, showEmpty = false }: Props) {
  const [week, setWeek] = useState<Note[]>([]);
  const [month, setMonth] = useState<Note[]>([]);
  const weekKey = periodStart(date, "week");
  const monthKey = periodStart(date, "month");

  useEffect(() => {
    let cancelled = false;
    const load = (period: NotePeriod, periodDate: string) =>
      api
        .get<Note[]>("/notes", { params: { period, period_date: periodDate } })
        .then(({ data }) => (Array.isArray(data) ? data.filter((n) => !n.archived) : []))
        .catch(() => [] as Note[]);
    Promise.all([load("week", weekKey), load("month", monthKey)]).then(([w, m]) => {
      if (cancelled) return;
      setWeek(w);
      setMonth(m);
    });
    return () => {
      cancelled = true;
    };
  }, [weekKey, monthKey, reloadKey]);

  if (week.length === 0 && month.length === 0 && !showEmpty) return null;

  return (
    <div className={`${showEmpty ? "" : "mb-5 "}space-y-3`} data-testid="period-notes-strip">
      <Group period="week" date={date} notes={week} showEmpty={showEmpty} />
      <Group period="month" date={date} notes={month} showEmpty={showEmpty} />
    </div>
  );
}
