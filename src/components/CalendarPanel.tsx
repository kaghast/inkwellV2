import React, { useMemo, useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import {
  ChevronLeft,
  ChevronRight,
  Calendar as CalendarIcon,
  CalendarDays,
  Sparkles,
  Clock,
  MapPin,
  Users,
  Video,
  RefreshCw,
  ExternalLink,
  PlusCircle,
  FilePlus2,
  Check,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  connectGoogleCalendar,
  getCalendarAccessToken,
  getFirebaseUser,
} from "@/lib/firebase";
import {
  fetchCalendarEventsForDate,
  convertEventToNoteDraft,
  formatEventTimeRange,
  CalendarEvent,
} from "@/lib/calendar";
import api, { formatApiError } from "@/lib/api";
import { toast } from "sonner";
import type { CalendarCounts, Note } from "@/types";

/**
 * Calculates standard ISO 8601 week number for a given date
 */
function getISOWeek(date: Date): number {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
}

interface WeekRow {
  weekNum: number;
  isCurrentWeek: boolean;
  days: (number | null)[];
}

function getMonthWeeks(year: number, month: number, today: Date): WeekRow[] {
  const first = new Date(year, month - 1, 1);
  const startDay = (first.getDay() + 6) % 7; // Monday = 0, Sunday = 6
  const daysInMonth = new Date(year, month, 0).getDate();

  const flatCells: (number | null)[] = [];
  for (let i = 0; i < startDay; i++) flatCells.push(null);
  for (let d = 1; d <= daysInMonth; d++) flatCells.push(d);
  while (flatCells.length % 7 !== 0) flatCells.push(null);

  const currentYear = today.getFullYear();
  const currentMonth = today.getMonth() + 1;
  const currentDay = today.getDate();
  const currentISOWeek = getISOWeek(today);

  const weeks: WeekRow[] = [];
  for (let i = 0; i < flatCells.length; i += 7) {
    const weekDays = flatCells.slice(i, i + 7);
    
    // Find representative date for this week to calculate ISO week number
    const validDay = weekDays.find((d) => d !== null);
    let weekNum = 1;
    let isCurrentWeek = false;

    if (validDay !== null && validDay !== undefined) {
      const refDate = new Date(year, month - 1, validDay);
      weekNum = getISOWeek(refDate);

      // Check if current week matches
      if (year === currentYear && weekNum === currentISOWeek) {
        const hasTodayInRow = weekDays.some(
          (d) => d !== null && d === currentDay && month === currentMonth && year === currentYear
        );
        if (hasTodayInRow || (month === currentMonth && year === currentYear && Math.abs(weekNum - currentISOWeek) === 0)) {
          isCurrentWeek = true;
        }
      }
    }

    weeks.push({
      weekNum,
      isCurrentWeek,
      days: weekDays,
    });
  }

  return weeks;
}

const WEEKDAYS = ["Pzt", "Sal", "Çar", "Per", "Cum", "Cmt", "Paz"];
const MONTHS = [
  "Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran",
  "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"
];

interface Props {
  year: number;
  month: number; // 1-12
  onChangeMonth: (delta: number) => void;
  counts: CalendarCounts;
  selectedDate: string | null;
  onSelectDate: (iso: string) => void;
  onNoteCreated?: () => void;
}

export default function CalendarPanel({
  year,
  month,
  onChangeMonth,
  counts,
  selectedDate,
  onSelectDate,
  onNoteCreated,
}: Props) {
  const navigate = useNavigate();
  const today = useMemo(() => new Date(), []);
  const todayIso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;

  const activeDate = selectedDate || todayIso;
  const weeks = useMemo(() => getMonthWeeks(year, month, today), [year, month, today]);

  // Google Calendar integration state
  const [calToken, setCalToken] = useState<string | null>(getCalendarAccessToken());
  const [isConnecting, setIsConnecting] = useState(false);
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [loadingEvents, setLoadingEvents] = useState(false);
  const [convertingEventId, setConvertingEventId] = useState<string | null>(null);

  const fmtCellDate = (d: number) =>
    `${year}-${String(month).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

  // Formatted date string in Turkish for the header
  const formattedSelectedDate = useMemo(() => {
    try {
      const d = new Date(activeDate + "T00:00:00");
      return d.toLocaleDateString("tr-TR", {
        day: "numeric",
        month: "long",
        weekday: "short",
      });
    } catch {
      return activeDate;
    }
  }, [activeDate]);

  // Fetch events for active date
  const loadEventsForDate = async (tokenToUse?: string) => {
    const token = tokenToUse || calToken || getCalendarAccessToken();
    if (!token) return;

    setLoadingEvents(true);
    try {
      const fetchedEvents = await fetchCalendarEventsForDate(token, activeDate);
      setEvents(fetchedEvents);
    } catch (err: any) {
      console.warn("Calendar events fetch warning:", err);
      if (err.message?.includes("401") || err.message?.includes("oturum")) {
        setCalToken(null);
      }
    } finally {
      setLoadingEvents(false);
    }
  };

  useEffect(() => {
    const currentToken = getCalendarAccessToken();
    if (currentToken) {
      setCalToken(currentToken);
      loadEventsForDate(currentToken);
    }
  }, [activeDate]);

  // Connect Google Calendar
  const handleConnectCalendar = async () => {
    setIsConnecting(true);
    try {
      const { accessToken, user } = await connectGoogleCalendar();
      setCalToken(accessToken);
      toast.success(`Google Takvim bağlandı (${user.email})`);
      await loadEventsForDate(accessToken);
    } catch (err: any) {
      toast.error(err.message || "Google Takvim bağlantısı kurulamadı");
    } finally {
      setIsConnecting(false);
    }
  };

  // Convert event to Note and open in Edit screen
  const handleConvertEventToNote = async (event: CalendarEvent) => {
    setConvertingEventId(event.id);
    try {
      const draft = convertEventToNoteDraft(event, activeDate);

      // Save note to database
      const { data: newNote } = await api.post<Note>("/notes", {
        title: draft.title,
        content: draft.content,
        date: draft.date,
      });

      toast.success(`"${draft.title}" nota dönüştürüldü`);
      onNoteCreated?.();

      // Open note immediately in edit screen
      navigate(`/note/${newNote.note_id}?edit=true`);
    } catch (err: any) {
      toast.error(formatApiError(err) || "Nota dönüştürme başarısız oldu");
    } finally {
      setConvertingEventId(null);
    }
  };

  return (
    <aside className="h-full overflow-y-auto p-4 sm:p-5 space-y-5 select-none" data-testid="calendar-panel">
      {/* Month Navigation Header */}
      <div className="flex items-center justify-between">
        <Button
          size="icon"
          variant="ghost"
          onClick={() => onChangeMonth(-1)}
          data-testid="cal-prev-btn"
          className="h-8 w-8 rounded-sm hover:bg-secondary text-muted-foreground hover:text-foreground cursor-pointer"
          title="Önceki ay"
        >
          <ChevronLeft className="w-4 h-4" strokeWidth={1.5} />
        </Button>
        <div className="text-center">
          <div className="font-serif text-xl tracking-tight leading-none" data-testid="cal-title">
            {MONTHS[month - 1]}
          </div>
          <div className="text-xs text-muted-foreground font-mono mt-1 font-medium">{year}</div>
        </div>
        <Button
          size="icon"
          variant="ghost"
          onClick={() => onChangeMonth(1)}
          data-testid="cal-next-btn"
          className="h-8 w-8 rounded-sm hover:bg-secondary text-muted-foreground hover:text-foreground cursor-pointer"
          title="Sonraki ay"
        >
          <ChevronRight className="w-4 h-4" strokeWidth={1.5} />
        </Button>
      </div>

      {/* Calendar Grid with Week Numbers and Current Week Marker */}
      <div className="space-y-1">
        {/* Table Header: Week Num + Days */}
        <div className="grid grid-cols-[26px_repeat(7,1fr)] gap-1 items-center pb-1 border-b border-border/50">
          <div className="text-center text-[9px] font-mono font-semibold uppercase tracking-wider text-muted-foreground/60" title="Hafta numarası">
            Hf
          </div>
          {WEEKDAYS.map((w) => (
            <div
              key={w}
              className="text-center text-[10px] tracking-wider uppercase text-muted-foreground font-medium py-0.5"
            >
              {w}
            </div>
          ))}
        </div>

        {/* Calendar Rows */}
        <div className="space-y-1 pt-1">
          {weeks.map((week, wIdx) => (
            <div
              key={`week-${week.weekNum}-${wIdx}`}
              className={`grid grid-cols-[26px_repeat(7,1fr)] gap-1 items-center py-0.5 px-0.5 rounded transition-colors ${
                week.isCurrentWeek
                  ? "bg-accent/40 ring-1 ring-accent-foreground/20"
                  : "hover:bg-muted/30"
              }`}
            >
              {/* Week Number Badge */}
              <div className="flex items-center justify-center">
                <span
                  title={week.isCurrentWeek ? `Güncel Hafta (Hafta ${week.weekNum})` : `Hafta ${week.weekNum}`}
                  className={`text-[9px] font-mono px-1 py-0.5 rounded leading-none ${
                    week.isCurrentWeek
                      ? "bg-foreground text-background font-bold shadow-xs"
                      : "text-muted-foreground/60 hover:text-muted-foreground font-medium"
                  }`}
                >
                  {week.weekNum}
                </span>
              </div>

              {/* 7 Days in Week */}
              {week.days.map((d, dIdx) => {
                if (!d) {
                  return <div key={`empty-${wIdx}-${dIdx}`} className="aspect-square" />;
                }

                const iso = fmtCellDate(d);
                const count = counts[iso] || 0;
                const isToday = iso === todayIso;
                const isSelected = iso === (selectedDate || todayIso);

                return (
                  <button
                    key={`day-${iso}`}
                    type="button"
                    onClick={() => onSelectDate(iso)}
                    data-testid={`cal-day-${iso}`}
                    className={`relative aspect-square flex items-center justify-center font-mono text-xs rounded-sm border transition-all cursor-pointer ${
                      isSelected
                        ? "border-foreground bg-foreground text-background font-bold shadow-xs scale-105 z-10"
                        : isToday
                        ? "border-[hsl(var(--accent-tag))] bg-[hsl(var(--accent-tag))]/10 text-foreground font-bold"
                        : "border-transparent hover:border-border hover:bg-secondary/80 text-foreground"
                    }`}
                  >
                    <span>{d}</span>

                    {/* Note Count Badge */}
                    {count > 0 && (
                      <span
                        className={`absolute -top-1 -right-1 min-w-[14px] h-[14px] px-0.5 flex items-center justify-center text-[8px] font-mono font-bold rounded-full shadow-2xs ${
                          isSelected
                            ? "bg-background text-foreground ring-1 ring-foreground"
                            : "bg-[hsl(var(--accent-tag))] text-white"
                        }`}
                        data-testid={`cal-badge-${iso}`}
                        title={`${count} not`}
                      >
                        {count > 9 ? "9+" : count}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      </div>

      {/* Footer Info & Quick Jump */}
      <div className="pt-2 border-t border-border flex items-center justify-between text-[11px] text-muted-foreground">
        <div className="flex items-center gap-1.5 font-medium">
          <span className="w-2 h-2 rounded-full bg-foreground inline-block" />
          <span>Hafta {getISOWeek(today)}</span>
        </div>
        <button
          type="button"
          className="font-mono text-xs text-foreground font-semibold hover:underline flex items-center gap-1 hover:text-primary cursor-pointer"
          onClick={() => onSelectDate(todayIso)}
          data-testid="cal-today-btn"
        >
          <CalendarIcon className="w-3.5 h-3.5" />
          Bugüne dön
        </button>
      </div>

      {/* ========================================================= */}
      {/* GOOGLE CALENDAR EVENTS SECTION (UNDER CALENDAR GRID)      */}
      {/* ========================================================= */}
      <div className="pt-3 border-t border-border/80 space-y-3" data-testid="google-calendar-section">
        {/* Section Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <CalendarDays className="w-4 h-4 text-sky-500 shrink-0" />
            <span className="text-xs font-bold font-serif tracking-tight text-foreground">
              Google Takvim Etkinlikleri
            </span>
          </div>

          {calToken && (
            <button
              type="button"
              onClick={() => loadEventsForDate()}
              disabled={loadingEvents}
              title="Etkinlikleri Yenile"
              className="text-muted-foreground hover:text-foreground p-1 rounded hover:bg-muted transition-colors cursor-pointer"
            >
              <RefreshCw className={`w-3 h-3 ${loadingEvents ? "animate-spin" : ""}`} />
            </button>
          )}
        </div>

        {/* Selected Date Subtitle */}
        <div className="text-[11px] font-mono text-muted-foreground flex items-center justify-between">
          <span>📅 {formattedSelectedDate}</span>
          {calToken && (
            <span className="text-[10px] text-emerald-500 font-medium flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" /> Bağlı
            </span>
          )}
        </div>

        {/* State 1: Not connected to Google Calendar */}
        {!calToken ? (
          <div className="p-3 bg-muted/40 border border-border rounded-lg text-center space-y-2">
            <p className="text-[11px] text-muted-foreground leading-relaxed">
              Seçili güne ait Google Takvim etkinliklerini görüp tek tıkla <strong>nota dönüştürmek</strong> için bağlanın.
            </p>
            <Button
              type="button"
              onClick={handleConnectCalendar}
              disabled={isConnecting}
              size="sm"
              data-testid="connect-calendar-btn"
              className="w-full bg-sky-600 hover:bg-sky-700 text-white rounded-md text-xs font-medium h-8 cursor-pointer shadow-xs"
            >
              {isConnecting ? (
                <RefreshCw className="w-3.5 h-3.5 mr-1.5 animate-spin" />
              ) : (
                <CalendarDays className="w-3.5 h-3.5 mr-1.5" />
              )}
              Google Takvim'e Bağlan
            </Button>
          </div>
        ) : loadingEvents ? (
          /* State 2: Loading Events */
          <div className="py-6 text-center text-xs text-muted-foreground flex items-center justify-center gap-2">
            <RefreshCw className="w-3.5 h-3.5 animate-spin text-sky-500" />
            <span>Takvim taranıyor...</span>
          </div>
        ) : events.length === 0 ? (
          /* State 3: No Events on Selected Date */
          <div className="p-3.5 bg-muted/30 border border-dashed border-border rounded-lg text-center">
            <p className="text-[11px] text-muted-foreground italic">
              Bu tarihte kayıtlı Google Takvim etkinliği bulunamadı.
            </p>
          </div>
        ) : (
          /* State 4: List of Events with "Nota Dönüştür" Action */
          <div className="space-y-2.5 max-h-[320px] overflow-y-auto pr-0.5">
            {events.map((evt) => {
              const timeRange = formatEventTimeRange(evt);
              const isConverting = convertingEventId === evt.id;
              const hasAttendees = evt.attendees && evt.attendees.length > 0;

              return (
                <div
                  key={evt.id}
                  data-testid={`cal-event-${evt.id}`}
                  className="p-3 bg-card border border-border/80 hover:border-border rounded-lg text-xs space-y-2 transition-all shadow-2xs group"
                >
                  {/* Event Time & Title */}
                  <div>
                    <div className="flex items-center gap-1.5 text-[10px] font-mono text-sky-600 dark:text-sky-400 font-semibold mb-0.5">
                      <Clock className="w-3 h-3 shrink-0" />
                      <span>{timeRange}</span>
                    </div>
                    <div className="font-semibold text-foreground text-xs leading-snug line-clamp-2">
                      {evt.summary}
                    </div>
                  </div>

                  {/* Extra metadata: Location, Meet link, Attendees */}
                  <div className="space-y-1 text-[11px] text-muted-foreground">
                    {evt.location && (
                      <div className="flex items-center gap-1.5 truncate">
                        <MapPin className="w-3 h-3 text-rose-500 shrink-0" />
                        <span className="truncate">{evt.location}</span>
                      </div>
                    )}

                    {evt.hangoutLink && (
                      <div className="flex items-center gap-1.5 text-sky-500 truncate">
                        <Video className="w-3 h-3 shrink-0" />
                        <a
                          href={evt.hangoutLink}
                          target="_blank"
                          rel="noreferrer"
                          className="hover:underline truncate"
                        >
                          Google Meet Toplantısı
                        </a>
                      </div>
                    )}

                    {hasAttendees && (
                      <div className="flex items-center gap-1.5 truncate">
                        <Users className="w-3 h-3 text-emerald-500 shrink-0" />
                        <span className="truncate">
                          {evt.attendees!.length} katılımcı ({evt.attendees!.slice(0, 2).map(a => a.displayName || a.email?.split("@")[0]).join(", ")}{evt.attendees!.length > 2 ? "..." : ""})
                        </span>
                      </div>
                    )}
                  </div>

                  {/* Convert to Note Button */}
                  <div className="pt-1.5 border-t border-border/50 flex items-center justify-between">
                    {evt.htmlLink && (
                      <a
                        href={evt.htmlLink}
                        target="_blank"
                        rel="noreferrer"
                        className="text-[10px] text-muted-foreground hover:text-foreground flex items-center gap-1 hover:underline cursor-pointer"
                        title="Google Takvim'de Aç"
                      >
                        <ExternalLink className="w-2.5 h-2.5" /> Takvimde Gör
                      </a>
                    )}

                    <Button
                      type="button"
                      size="sm"
                      onClick={() => handleConvertEventToNote(evt)}
                      disabled={isConverting}
                      data-testid={`convert-event-btn-${evt.id}`}
                      className="ml-auto bg-foreground text-background hover:bg-foreground/90 text-[11px] font-medium h-7 px-2.5 rounded-md cursor-pointer flex items-center gap-1 shadow-2xs"
                    >
                      {isConverting ? (
                        <RefreshCw className="w-3 h-3 animate-spin" />
                      ) : (
                        <FilePlus2 className="w-3 h-3 text-sky-400" />
                      )}
                      <span>Nota Dönüştür</span>
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </aside>
  );
}
