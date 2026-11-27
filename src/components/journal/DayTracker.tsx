import React, { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { Check, Flame } from "lucide-react";
import { formatApiError } from "@/lib/api";
import { habitApi, notifyJournalChanged, type HabitMonthData } from "@/lib/workspaceApi";

const pad = (n: number) => String(n).padStart(2, "0");
const localDay = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** The day's habits and mood/energy. Ticking a habit ticks its "#tag" line in the daily note. */
export default function DayTracker({ date }: { date: string }) {
  const today = localDay();
  const [data, setData] = useState<HabitMonthData | null>(null);
  const load = useCallback(() => {
    habitApi
      .month(date.slice(0, 7), today)
      .then(setData)
      .catch(() => setData(null));
  }, [date, today]);
  useEffect(() => load(), [load]);

  if (!data) return <div className="text-sm text-muted-foreground">Yükleniyor…</div>;
  const future = date > today;
  const rating = data.ratings.find((r) => r.day === date);

  async function toggle(id: string, done: boolean) {
    try {
      await habitApi.setDay(id, date, done, today);
      notifyJournalChanged();
      load();
    } catch (e) {
      toast.error(formatApiError(e));
    }
  }
  async function rate(field: "mood" | "energy", v: number) {
    try {
      await habitApi.rate(date, { [field]: rating?.[field] === v ? null : v });
      load();
    } catch (e) {
      toast.error(formatApiError(e));
    }
  }

  return (
    <div className="space-y-3" data-testid="day-tracker">
      {data.habits.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Takip ettiğin alışkanlık yok. <Link to="/journal/habits" className="text-primary hover:underline">Alışkanlık ekle</Link>
        </p>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {data.habits.map((h) => {
            const done = h.done_days.includes(date);
            return (
              <button
                key={h.habit_id}
                type="button"
                disabled={future}
                onClick={() => toggle(h.habit_id, !done)}
                className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors disabled:opacity-40 ${done ? "border-transparent text-white" : "border-border hover:border-foreground/30"}`}
                style={done ? { background: h.color || "hsl(var(--primary))" } : undefined}
                aria-pressed={done}
                data-testid={`day-habit-${h.habit_id}`}
              >
                {done ? <Check className="h-3 w-3" strokeWidth={3} /> : <span className="h-2 w-2 rounded-full" style={{ background: h.color || "hsl(var(--primary))" }} />}
                {h.name}
                <span className="opacity-60">#{h.tag}</span>
                {h.current > 1 && (
                  <span className="inline-flex items-center opacity-80"><Flame className="h-3 w-3" />{h.current}</span>
                )}
              </button>
            );
          })}
        </div>
      )}
      {(["mood", "energy"] as const).map((field) => (
        <div key={field} className="flex items-center gap-2 text-xs">
          <span className="w-16 text-muted-foreground">{field === "mood" ? "Ruh hali" : "Enerji"}</span>
          {[1, 2, 3, 4, 5].map((v) => {
            const on = rating?.[field] === v;
            return (
              <button
                key={v}
                type="button"
                disabled={future}
                onClick={() => rate(field, v)}
                className={`h-6 w-6 rounded-full border text-[11px] disabled:opacity-40 ${on ? "border-primary bg-primary text-primary-foreground font-bold" : "border-border hover:border-foreground/30"}`}
                aria-label={`${field === "mood" ? "Ruh hali" : "Enerji"} ${v}`}
                aria-pressed={on}
                data-testid={`day-${field}-${v}`}
              >
                {v}
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}
