import React, { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import { Archive, ArchiveRestore, ChevronLeft, ChevronRight, Flame, Loader2, MoreHorizontal, Plus, Trash2 } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import PageShell, { Empty } from "@/components/PageShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatApiError } from "@/lib/api";
import { addMonths, isMonthKey, monthLabel, WEEKDAY_SHORT, weekdayOf } from "@/lib/journal";
import { habitApi, type HabitMonthData, type HabitRow } from "@/lib/workspaceApi";

const pad = (n: number) => String(n).padStart(2, "0");
const localDay = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

const SCALE_COLORS = ["", "bg-red-500/70", "bg-orange-400/70", "bg-yellow-400/70", "bg-lime-500/70", "bg-emerald-500/80"];

/**
 * Habit tracker: one row per habit, one cell per day of the month, plus mood
 * and energy rows (1–5). Future days cannot be ticked.
 */
export default function HabitsPage() {
  const { month: param } = useParams();
  const navigate = useNavigate();
  const today = localDay();
  const current = today.slice(0, 7);
  const month = isMonthKey(param) ? param : current;
  const [data, setData] = useState<HabitMonthData | null>(null);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [showArchived, setShowArchived] = useState(false);

  const load = useCallback(() => {
    habitApi
      .month(month, today, showArchived)
      .then(setData)
      .catch((e) => toast.error(formatApiError(e)));
  }, [month, today, showArchived]);
  useEffect(() => load(), [load]);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    try {
      await habitApi.create(name.trim());
      setName("");
      load();
    } catch (err) {
      toast.error(formatApiError(err));
    } finally {
      setBusy(false);
    }
  }

  async function toggle(h: HabitRow, day: string) {
    if (!data || day > today) return;
    const done = !h.done_days.includes(day);
    // Optimistic: flip the cell at once, reload for streaks
    setData({ ...data, habits: data.habits.map((x) => (x.habit_id === h.habit_id ? { ...x, done_days: done ? [...x.done_days, day] : x.done_days.filter((d) => d !== day) } : x)) });
    try {
      await habitApi.setDay(h.habit_id, day, done);
      load();
    } catch (err) {
      toast.error(formatApiError(err));
      load();
    }
  }

  async function rate(day: string, field: "mood" | "energy") {
    if (!data || day > today) return;
    const cur = data.ratings.find((r) => r.day === day)?.[field] ?? null;
    const next = cur == null ? 1 : cur >= 5 ? null : cur + 1;
    try {
      await habitApi.rate(day, { [field]: next });
      load();
    } catch (err) {
      toast.error(formatApiError(err));
    }
  }

  async function archive(h: HabitRow) {
    try {
      await habitApi.update(h.habit_id, { archived: !h.archived });
      toast.success(h.archived ? "Alışkanlık geri alındı" : "Alışkanlık arşivlendi; geçmişi korunuyor");
      load();
    } catch (err) {
      toast.error(formatApiError(err));
    }
  }

  async function remove(h: HabitRow) {
    if (!window.confirm(`"${h.name}" ve tüm geçmişi kalıcı olarak silinsin mi? Geçmişi korumak için arşivleyebilirsin.`)) return;
    try {
      await habitApi.remove(h.habit_id);
      toast.success("Alışkanlık silindi");
      load();
    } catch (err) {
      toast.error(formatApiError(err));
    }
  }

  const cell = "h-6 w-6 shrink-0 rounded-sm border text-[10px] leading-none";

  return (
    <PageShell
      title="Alışkanlıklar"
      subtitle={monthLabel(month)}
      wide
      actions={
        <div className="flex items-center gap-1">
          <Button size="icon" variant="ghost" aria-label="Önceki ay" onClick={() => navigate(`/journal/habits/${addMonths(month, -1)}`)}><ChevronLeft className="w-4 h-4" /></Button>
          {month !== current && <Button size="sm" variant="outline" onClick={() => navigate(`/journal/habits/${current}`)}>Bu ay</Button>}
          <Button size="icon" variant="ghost" aria-label="Sonraki ay" onClick={() => navigate(`/journal/habits/${addMonths(month, 1)}`)}><ChevronRight className="w-4 h-4" /></Button>
        </div>
      }
    >
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <form onSubmit={add} className="flex min-w-0 flex-1 items-center gap-2 sm:max-w-md" data-testid="habit-create">
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Yeni alışkanlık, ör. 20 dk okuma" aria-label="Alışkanlık adı" />
            <Button type="submit" size="sm" disabled={busy || !name.trim()}>
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
            </Button>
          </form>
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} /> Arşivdekileri göster
          </label>
        </div>

        {!data ? (
          <div className="text-sm text-muted-foreground">Yükleniyor…</div>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border bg-card p-3" data-testid="habit-grid">
            <table className="border-separate border-spacing-0.5 text-xs">
              <thead>
                <tr>
                  <th className="sticky left-0 z-10 min-w-36 bg-card pr-2 text-left font-medium text-muted-foreground">Gün</th>
                  {data.days.map((d) => {
                    const wd = weekdayOf(d);
                    return (
                      <th key={d} className={`w-6 text-center font-normal ${d === today ? "text-primary font-bold" : wd === 0 || wd === 6 ? "text-muted-foreground/60" : "text-muted-foreground"}`}>
                        <div>{+d.slice(8)}</div>
                        <div className="text-[9px]">{WEEKDAY_SHORT[wd].slice(0, 2)}</div>
                      </th>
                    );
                  })}
                  <th className="pl-2 text-right font-medium text-muted-foreground">Ay</th>
                </tr>
              </thead>
              <tbody>
                {data.habits.length === 0 && (
                  <tr>
                    <td colSpan={data.days.length + 2} className="py-3">
                      <Empty>Henüz alışkanlık yok. Yukarıdan bir tane ekle; her gün yaptığında işaretle.</Empty>
                    </td>
                  </tr>
                )}
                {data.habits.map((h) => (
                  <tr key={h.habit_id} className={h.archived ? "opacity-50" : ""} data-testid={`habit-row-${h.habit_id}`}>
                    <td className="sticky left-0 z-10 bg-card pr-2">
                      <div className="flex items-center gap-1.5">
                        <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: h.color || "hsl(var(--primary))" }} />
                        <span className="min-w-0 flex-1 truncate text-sm" title={h.name}>{h.name}</span>
                        {h.current > 0 && (
                          <span className="inline-flex items-center text-[10px] text-orange-600 dark:text-orange-400" title={`Seri: ${h.current} gün · en uzun ${h.longest}`}>
                            <Flame className="h-3 w-3" />{h.current}
                          </span>
                        )}
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <button type="button" className="rounded p-0.5 text-muted-foreground hover:bg-muted" aria-label={`${h.name} seçenekleri`}>
                              <MoreHorizontal className="h-3.5 w-3.5" />
                            </button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="start" className="w-44">
                            <DropdownMenuItem className="cursor-pointer text-xs" onClick={() => archive(h)}>
                              {h.archived ? <ArchiveRestore className="mr-2 h-3.5 w-3.5" /> : <Archive className="mr-2 h-3.5 w-3.5" />}
                              {h.archived ? "Arşivden çıkar" : "Arşivle"}
                            </DropdownMenuItem>
                            <DropdownMenuItem className="cursor-pointer text-xs text-destructive" onClick={() => remove(h)}>
                              <Trash2 className="mr-2 h-3.5 w-3.5" /> Sil
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </td>
                    {data.days.map((d) => {
                      const done = h.done_days.includes(d);
                      const future = d > today;
                      return (
                        <td key={d}>
                          <button
                            type="button"
                            disabled={future || h.archived}
                            onClick={() => toggle(h, d)}
                            className={`${cell} ${done ? "border-transparent" : "border-border hover:border-foreground/40"} ${future ? "opacity-30 cursor-default" : ""}`}
                            style={done ? { background: h.color || "hsl(var(--primary))" } : undefined}
                            aria-label={`${h.name} ${d} ${done ? "yapıldı" : "yapılmadı"}`}
                            aria-pressed={done}
                            data-testid={`habit-cell-${h.habit_id}-${d}`}
                          />
                        </td>
                      );
                    })}
                    <td className="pl-2 text-right tabular-nums text-muted-foreground">{h.month_count}</td>
                  </tr>
                ))}
                {(["mood", "energy"] as const).map((field) => (
                  <tr key={field}>
                    <td className="sticky left-0 z-10 bg-card pr-2 pt-2 text-sm text-muted-foreground">{field === "mood" ? "Ruh hali" : "Enerji"}</td>
                    {data.days.map((d) => {
                      const v = data.ratings.find((r) => r.day === d)?.[field] ?? null;
                      const future = d > today;
                      return (
                        <td key={d} className="pt-2">
                          <button
                            type="button"
                            disabled={future}
                            onClick={() => rate(d, field)}
                            className={`${cell} ${v ? `${SCALE_COLORS[v]} border-transparent font-bold text-white` : "border-dashed border-border"} ${future ? "opacity-30" : ""}`}
                            title={`${field === "mood" ? "Ruh hali" : "Enerji"} ${d}: ${v ?? "—"} (tıkla: 1→5→boş)`}
                            data-testid={`rating-${field}-${d}`}
                          >
                            {v ?? ""}
                          </button>
                        </td>
                      );
                    })}
                    <td />
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </PageShell>
  );
}
