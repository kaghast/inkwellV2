import React, { useState, useEffect, useMemo, useRef } from "react";
import { Link, useNavigate } from "react-router-dom";
import api from "@/lib/api";
import type { Note, LocationItem, Category, NoteType } from "@/types";
import AppMenubar from "@/components/AppMenubar";
import { formatDateKey, getISOWeekNumber, formatDisplayDatetime, toDateTimeLocal } from "@/lib/datetime";
import {
  CalendarRange,
  Calendar as CalendarIcon,
  ChevronLeft,
  ChevronRight,
  Plus,
  Pin,
  PinOff,
  GripVertical,
  ArrowUpRight,
  FileText,
  Search,
  ExternalLink,
  MapPin,
  Tag,
  Kanban,
  CheckCircle2,
  Clock,
  Sparkles,
  ChevronDown,
  ChevronUp,
  X,
  Layers,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { toast } from "sonner";

interface TimelineDay {
  date: Date;
  dateKey: string; // YYYY-MM-DD
  dayNumber: number;
  monthName: string;
  year: number;
  isToday: boolean;
  isCurrentMonth: boolean;
  notes: Note[];
}

interface TimelineWeek {
  weekNumber: number;
  year: number;
  monthLabel?: string;
  days: TimelineDay[];
}

const DAY_NAMES = [
  { full: "Pazartesi", short: "Pzt" },
  { full: "Salı", short: "Sal" },
  { full: "Çarşamba", short: "Çar" },
  { full: "Perşembe", short: "Per" },
  { full: "Cuma", short: "Cum" },
  { full: "Cumartesi", short: "Cmt" },
  { full: "Pazar", short: "Paz" },
];

export default function TimelinePage() {
  const navigate = useNavigate();
  const [notes, setNotes] = useState<Note[]>([]);
  const [locations, setLocations] = useState<LocationItem[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [noteTypes, setNoteTypes] = useState<NoteType[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [pinnedNotesOrder, setPinnedNotesOrder] = useState<string[]>([]);
  const [draggedPinnedIdx, setDraggedPinnedIdx] = useState<number | null>(null);
  const [dragOverPinnedIdx, setDragOverPinnedIdx] = useState<number | null>(null);
  const [selectedDay, setSelectedDay] = useState<TimelineDay | null>(null);
  const [dayModalOpen, setDayModalOpen] = useState(false);
  const [showRightSidebar, setShowRightSidebar] = useState(true);
  const [pastMonthsCount, setPastMonthsCount] = useState(3);
  const [futureMonthsCount, setFutureMonthsCount] = useState(3);

  const todayRef = useRef<HTMLDivElement | null>(null);

  // Load saved pinned order from localStorage
  useEffect(() => {
    try {
      const savedOrder = localStorage.getItem("inkwell_pinned_notes_order");
      if (savedOrder) {
        setPinnedNotesOrder(JSON.parse(savedOrder));
      }
    } catch {}
  }, []);

  const fetchData = async () => {
    try {
      setLoading(true);
      const [notesRes, locsRes, catsRes, typesRes] = await Promise.all([
        api.get<Note[]>("/notes"),
        api.get<LocationItem[]>("/locations"),
        api.get<Category[]>("/categories"),
        api.get<NoteType[]>("/note-types"),
      ]);

      setNotes(Array.isArray(notesRes.data) ? notesRes.data : []);
      setLocations(Array.isArray(locsRes.data) ? locsRes.data : []);
      setCategories(Array.isArray(catsRes.data) ? catsRes.data : []);
      setNoteTypes(Array.isArray(typesRes.data) ? typesRes.data : []);
    } catch (err) {
      toast.error("Zaman çizelgesi verileri yüklenirken hata oluştu");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  // Quick helper maps
  const locationMap = useMemo(() => {
    const map: Record<string, LocationItem> = {};
    locations.forEach((l) => (map[l.location_id] = l));
    return map;
  }, [locations]);

  const categoryMap = useMemo(() => {
    const map: Record<string, Category> = {};
    categories.forEach((c) => (map[c.category_id] = c));
    return map;
  }, [categories]);

  const noteTypeMap = useMemo(() => {
    const map: Record<string, NoteType> = {};
    noteTypes.forEach((nt) => (map[nt.type_id] = nt));
    return map;
  }, [noteTypes]);

  // Notes grouped by YYYY-MM-DD
  const notesByDate = useMemo(() => {
    const map: Record<string, Note[]> = {};
    notes.forEach((note) => {
      if (note.archived) return;

      // Filter by search query if present
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const matchesTitle = note.title.toLowerCase().includes(q);
        const matchesContent = note.content.toLowerCase().includes(q);
        const matchesTag = note.tags.some((t) => t.toLowerCase().includes(q));
        const matchesPerson = note.people.some((p) => p.toLowerCase().includes(q));
        if (!matchesTitle && !matchesContent && !matchesTag && !matchesPerson) return;
      }

      const dateKey = note.date.slice(0, 10);
      if (!map[dateKey]) map[dateKey] = [];
      map[dateKey].push(note);
    });
    return map;
  }, [notes, searchQuery]);

  // Generate dynamic window: Past X months + Current Month + Future X months
  const timelineWeeks = useMemo(() => {
    const now = new Date();
    const todayKey = formatDateKey(now);
    const currentMonthIdx = now.getMonth();

    // Start pastMonthsCount months back from the 1st of that month
    const startRange = new Date(now.getFullYear(), now.getMonth() - pastMonthsCount, 1);
    // End futureMonthsCount months forward at the end of that month
    const endRange = new Date(now.getFullYear(), now.getMonth() + futureMonthsCount + 1, 0);

    // Rewind startRange to the preceding Monday
    const startDate = new Date(startRange);
    const dayOfWeek = startDate.getDay(); // 0 is Sunday, 1 is Monday
    const distToMon = (dayOfWeek + 6) % 7;
    startDate.setDate(startDate.getDate() - distToMon);

    // Fast-forward endRange to the succeeding Sunday
    const endDate = new Date(endRange);
    const endDayOfWeek = endDate.getDay();
    const distToSun = (7 - endDayOfWeek) % 7;
    endDate.setDate(endDate.getDate() + distToSun);

    const weeks: TimelineWeek[] = [];
    const cur = new Date(startDate);

    let lastMonthSeen = -1;

    while (cur <= endDate) {
      const weekMonday = new Date(cur);
      const weekNumber = getISOWeekNumber(weekMonday);
      const days: TimelineDay[] = [];

      let monthLabelForWeek: string | undefined = undefined;

      for (let i = 0; i < 7; i++) {
        const dayDate = new Date(cur);
        const dateKey = formatDateKey(dayDate);
        const isToday = dateKey === todayKey;
        const dayMonth = dayDate.getMonth();

        // If this week crosses into a new month for the first time, attach a label
        if (dayDate.getDate() <= 7 && dayMonth !== lastMonthSeen) {
          lastMonthSeen = dayMonth;
          monthLabelForWeek = dayDate.toLocaleDateString("tr-TR", { month: "long", year: "numeric" });
        }

        days.push({
          date: dayDate,
          dateKey,
          dayNumber: dayDate.getDate(),
          monthName: dayDate.toLocaleDateString("tr-TR", { month: "short" }),
          year: dayDate.getFullYear(),
          isToday,
          isCurrentMonth: dayMonth === currentMonthIdx,
          notes: notesByDate[dateKey] || [],
        });

        cur.setDate(cur.getDate() + 1);
      }

      weeks.push({
        weekNumber,
        year: weekMonday.getFullYear(),
        monthLabel: monthLabelForWeek,
        days,
      });
    }

    return weeks;
  }, [notesByDate, pastMonthsCount, futureMonthsCount]);

  // Pinned notes list sorted with custom drag & drop order
  const pinnedNotes = useMemo(() => {
    const rawPinned = notes.filter((n) => n.pinned && !n.archived);

    if (pinnedNotesOrder.length === 0) return rawPinned;

    const orderMap = new Map<string, number>();
    pinnedNotesOrder.forEach((id, index) => orderMap.set(id, index));

    return [...rawPinned].sort((a, b) => {
      const idxA = orderMap.has(a.note_id) ? orderMap.get(a.note_id)! : 9999;
      const idxB = orderMap.has(b.note_id) ? orderMap.get(b.note_id)! : 9999;
      if (idxA !== idxB) return idxA - idxB;
      return new Date(b.date).getTime() - new Date(a.date).getTime();
    });
  }, [notes, pinnedNotesOrder]);

  // Drag and Drop reordering for Pinned Notes
  const handlePinnedDragStart = (e: React.DragEvent, index: number) => {
    setDraggedPinnedIdx(index);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", String(index));
  };

  const handlePinnedDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    if (dragOverPinnedIdx !== index) {
      setDragOverPinnedIdx(index);
    }
  };

  const handlePinnedDrop = (e: React.DragEvent, targetIndex: number) => {
    e.preventDefault();
    setDragOverPinnedIdx(null);
    if (draggedPinnedIdx === null || draggedPinnedIdx === targetIndex) {
      setDraggedPinnedIdx(null);
      return;
    }

    const updated = [...pinnedNotes];
    const [movedItem] = updated.splice(draggedPinnedIdx, 1);
    updated.splice(targetIndex, 0, movedItem);

    const newOrderIds = updated.map((n) => n.note_id);
    setPinnedNotesOrder(newOrderIds);
    try {
      localStorage.setItem("inkwell_pinned_notes_order", JSON.stringify(newOrderIds));
      toast.success("Sabitlenen notların sırası güncellendi", { duration: 1500 });
    } catch {}

    setDraggedPinnedIdx(null);
  };

  // Toggle pin status
  const handleTogglePin = async (note: Note) => {
    try {
      await api.patch(`/notes/${note.note_id}/pin`);
      toast.success(note.pinned ? "Sabitleme kaldırıldı" : "Not panoya sabitlendi");
      fetchData();
    } catch {
      toast.error("Sabitleme durumu güncellenemedi");
    }
  };

  // Auto scroll to today on load
  const scrollToToday = () => {
    if (todayRef.current) {
      todayRef.current.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  };

  useEffect(() => {
    if (!loading && timelineWeeks.length > 0) {
      setTimeout(scrollToToday, 250);
    }
  }, [loading, timelineWeeks.length]);

  return (
    <div className="paper min-h-screen flex flex-col">
      <AppMenubar />

      <div className="pt-14 lg:pl-16 flex-1 flex flex-col min-w-0">
        {/* Top Sticky Toolbar */}
        <header className="h-14 border-b border-border/80 bg-background/90 backdrop-blur-md px-4 sm:px-6 flex items-center justify-between gap-3 sticky top-14 z-20 select-none">
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-8 h-8 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0">
              <CalendarRange className="w-4 h-4" />
            </div>
            <div>
              <h1 className="font-serif font-bold text-sm sm:text-base text-foreground truncate flex items-center gap-2">
                <span>Zaman Çizelgesi</span>
                <span className="text-[10px] font-mono font-medium px-2 py-0.5 rounded-full bg-primary/10 text-primary hidden sm:inline-block">
                  ±3 Ay (Haftalık)
                </span>
              </h1>
            </div>
          </div>

          {/* Actions & Filters */}
          <div className="flex items-center gap-2 shrink-0">
            {/* Search Input */}
            <div className="relative w-44 sm:w-60">
              <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Çizelgede ara (#etiket, @kişi)..."
                className="pl-8 h-8 text-xs bg-muted/40 border-border/70"
                data-testid="timeline-search-input"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery("")}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>

            {/* Jump to Today Button */}
            <Button
              size="sm"
              variant="outline"
              onClick={scrollToToday}
              className="h-8 text-xs font-mono font-semibold cursor-pointer border-border hover:bg-muted"
              title="Bugünün haftasına odaklan"
              data-testid="jump-today-btn"
            >
              <Clock className="w-3.5 h-3.5 mr-1.5 text-primary" />
              <span>Bugün</span>
            </Button>

            {/* Toggle Right Sidebar Button */}
            <Button
              size="sm"
              variant={showRightSidebar ? "secondary" : "outline"}
              onClick={() => setShowRightSidebar(!showRightSidebar)}
              className="h-8 text-xs cursor-pointer"
              title="Sabitlenen notlar yan panelini aç/kapat"
              data-testid="toggle-pinned-sidebar-btn"
            >
              <Pin className="w-3.5 h-3.5 mr-1" />
              <span className="hidden sm:inline">Sabitlenenler ({pinnedNotes.length})</span>
            </Button>
          </div>
        </header>

        {/* Main Content Area: Timeline Grid + Right Pinned Sidebar */}
        <div className="flex-1 flex min-h-0 overflow-hidden">
          {/* Timeline Grid (Scrollable) */}
          <main className="flex-1 overflow-y-auto overflow-x-auto min-w-0 bg-background/50 flex flex-col">
            {/* Fixed Sticky Header for Day Names */}
            <div className="sticky top-0 z-10 bg-card border-b border-border shadow-xs grid grid-cols-[70px_repeat(7,minmax(120px,1fr))] sm:grid-cols-[90px_repeat(7,1fr)] select-none">
              <div className="p-2.5 text-center text-[11px] font-mono font-bold text-muted-foreground border-r border-border/60 flex items-center justify-center bg-muted/30">
                Hafta
              </div>
              {DAY_NAMES.map((d, i) => (
                <div
                  key={d.full}
                  className={`p-2.5 text-center text-xs font-serif font-bold text-foreground border-r border-border/40 last:border-r-0 ${
                    i >= 5 ? "bg-muted/15 text-muted-foreground" : "bg-card"
                  }`}
                >
                  <span className="hidden md:inline">{d.full}</span>
                  <span className="md:hidden">{d.short}</span>
                </div>
              ))}
            </div>

            {/* Load Earlier 3 Months Button */}
            <div className="p-3 bg-muted/20 border-b border-border/80 flex items-center justify-center select-none shrink-0">
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setPastMonthsCount((prev) => prev + 3);
                  toast.success("Önceki 3 ayın haftaları ve notları yüklendi");
                }}
                className="h-8 text-xs font-serif font-semibold text-primary border-primary/30 hover:bg-primary/10 flex items-center gap-1.5 shadow-2xs cursor-pointer"
                data-testid="load-past-months-btn"
              >
                <ChevronUp className="w-4 h-4" />
                <span>Önceki 3 Ayı Yükle (-3 Ay)</span>
              </Button>
            </div>

            {/* Weekly Rows */}
            <div className="divide-y divide-border/60">
              {timelineWeeks.map((week) => {
                const containsToday = week.days.some((d) => d.isToday);

                return (
                  <div key={`${week.year}-W${week.weekNumber}`}>
                    {/* Month Separator Banner if present */}
                    {week.monthLabel && (
                      <div className="px-4 py-2 bg-muted/40 border-y border-border/80 text-xs font-serif font-bold text-primary flex items-center gap-2 select-none sticky top-[41px] z-5 backdrop-blur-sm">
                        <CalendarIcon className="w-3.5 h-3.5 text-primary" />
                        <span className="capitalize">{week.monthLabel}</span>
                      </div>
                    )}

                    {/* Week Row Grid */}
                    <div
                      ref={containsToday ? todayRef : null}
                      className={`grid grid-cols-[70px_repeat(7,minmax(120px,1fr))] sm:grid-cols-[90px_repeat(7,1fr)] transition-colors ${
                        containsToday ? "bg-primary/[0.03]" : "hover:bg-muted/10"
                      }`}
                    >
                      {/* Week Number Cell */}
                      <div
                        className={`p-2.5 text-center border-r border-border/60 flex flex-col items-center justify-center select-none ${
                          containsToday
                            ? "bg-primary/15 border-primary/40 font-bold"
                            : "bg-muted/20 text-muted-foreground"
                        }`}
                      >
                        <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
                          Hafta
                        </span>
                        <span
                          className={`text-sm font-mono font-bold ${
                            containsToday ? "text-primary text-base" : "text-foreground"
                          }`}
                        >
                          {week.weekNumber}
                        </span>
                        {containsToday && (
                          <span className="text-[9px] bg-primary text-primary-foreground font-semibold px-1.5 py-0.5 rounded-full mt-1">
                            Bu Hafta
                          </span>
                        )}
                      </div>

                      {/* 7 Days in Week */}
                      {week.days.map((day) => {
                        const hasNotes = day.notes.length > 0;
                        const noteCount = day.notes.length;

                        return (
                          <div
                            key={day.dateKey}
                            onClick={() => {
                              setSelectedDay(day);
                              setDayModalOpen(true);
                            }}
                            onDoubleClick={(e) => {
                              e.stopPropagation();
                              navigate(`/new?date=${day.dateKey}`);
                            }}
                            className={`min-h-[110px] sm:min-h-[130px] p-2 border-r border-border/40 last:border-r-0 flex flex-col justify-between transition-all cursor-pointer group relative ${
                              day.isToday
                                ? "ring-2 ring-inset ring-primary bg-primary/10 hover:bg-primary/15"
                                : hasNotes
                                ? "bg-purple-500/[0.07] dark:bg-purple-950/20 hover:bg-purple-500/15 border-purple-500/30"
                                : day.isCurrentMonth
                                ? "bg-card hover:bg-muted/30"
                                : "bg-muted/20 opacity-70 hover:opacity-100"
                            }`}
                            data-testid={`timeline-day-${day.dateKey}`}
                          >
                            {/* Day Header: Date Number + Month + Note Count Badge */}
                            <div className="flex items-start justify-between gap-1 mb-1.5">
                              <div className="flex items-baseline gap-1">
                                <span
                                  className={`font-mono text-xs sm:text-sm font-bold leading-none ${
                                    day.isToday
                                      ? "text-primary text-base font-extrabold"
                                      : "text-foreground"
                                  }`}
                                >
                                  {day.dayNumber}
                                </span>
                                <span className="text-[10px] font-mono text-muted-foreground uppercase">
                                  {day.monthName}
                                </span>
                              </div>

                              {/* Note Count Badge */}
                              {hasNotes ? (
                                <span
                                  className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[10px] font-mono font-bold bg-primary text-primary-foreground shadow-2xs group-hover:scale-105 transition-transform"
                                  title={`${noteCount} not bulundu`}
                                >
                                  <FileText className="w-2.5 h-2.5" />
                                  <span>{noteCount}</span>
                                </span>
                              ) : (
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    navigate(`/new?date=${day.dateKey}`);
                                  }}
                                  className="opacity-0 group-hover:opacity-100 p-0.5 hover:bg-primary hover:text-primary-foreground rounded text-muted-foreground transition-all cursor-pointer"
                                  title="Bu güne yeni not ekle"
                                >
                                  <Plus className="w-3 h-3" />
                                </button>
                              )}
                            </div>

                            {/* Note Previews in Day Cell */}
                            <div className="flex-1 space-y-1 overflow-hidden min-h-0">
                              {day.notes.slice(0, 2).map((n) => (
                                <div
                                  key={n.note_id}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    navigate(`/note/${n.slug || n.note_id}`);
                                  }}
                                  className="px-1.5 py-1 rounded bg-card/90 hover:bg-card text-[10px] font-serif border border-border/70 hover:border-primary/50 shadow-2xs truncate flex items-center gap-1 group/item transition-all"
                                  title={n.title || "Başlıksız Not"}
                                >
                                  <span className="w-1.5 h-1.5 rounded-full bg-primary shrink-0" />
                                  <span className="truncate flex-1 font-medium text-foreground">
                                    {n.title || "Başlıksız Not"}
                                  </span>
                                  {n.pinned && (
                                    <Pin className="w-2.5 h-2.5 text-primary shrink-0" />
                                  )}
                                </div>
                              ))}

                              {noteCount > 2 && (
                                <div className="text-[9px] font-mono font-semibold text-primary px-1 hover:underline">
                                  +{noteCount - 2} not daha...
                                </div>
                              )}
                            </div>

                            {/* Bottom Day Tag / Today indicator */}
                            <div className="pt-1 flex items-center justify-between text-[9px] text-muted-foreground font-mono">
                              {day.isToday && (
                                <span className="font-bold text-primary">BUGÜN</span>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Load Next 3 Months Button */}
            <div className="p-4 bg-muted/20 border-t border-border/80 flex items-center justify-center select-none shrink-0">
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setFutureMonthsCount((prev) => prev + 3);
                  toast.success("Gelecek 3 ayın haftaları ve notları yüklendi");
                }}
                className="h-8 text-xs font-serif font-semibold text-primary border-primary/30 hover:bg-primary/10 flex items-center gap-1.5 shadow-2xs cursor-pointer"
                data-testid="load-future-months-btn"
              >
                <ChevronDown className="w-4 h-4" />
                <span>Gelecek 3 Ayı Yükle (+3 Ay)</span>
              </Button>
            </div>
          </main>

          {/* Right Sidebar: Pinned Notes with Drag and Drop Reordering */}
          {showRightSidebar && (
            <aside
              className="w-80 border-l border-border bg-card/80 backdrop-blur-sm flex flex-col shrink-0 overflow-hidden shadow-sm"
              data-testid="timeline-pinned-sidebar"
            >
              {/* Sidebar Header */}
              <div className="p-3.5 border-b border-border flex items-center justify-between bg-muted/20 select-none">
                <div className="flex items-center gap-2">
                  <Pin className="w-4 h-4 text-primary" />
                  <h2 className="font-serif font-bold text-xs sm:text-sm text-foreground">
                    Sabitlenen Notlar
                  </h2>
                  <span className="text-[10px] font-mono font-bold bg-primary/10 text-primary px-2 py-0.5 rounded-full">
                    {pinnedNotes.length}
                  </span>
                </div>

                <div className="text-[10px] text-muted-foreground font-mono">
                  Sürükle & Sırala
                </div>
              </div>

              {/* Pinned Notes Feed */}
              <div className="flex-1 overflow-y-auto p-3 space-y-2.5">
                {pinnedNotes.length === 0 ? (
                  <div className="py-12 text-center p-4 border border-dashed border-border/80 rounded-xl bg-muted/10 space-y-2">
                    <Pin className="w-6 h-6 text-muted-foreground/40 mx-auto" />
                    <p className="font-serif text-xs font-semibold text-foreground">
                      Sabitlenmiş not yok
                    </p>
                    <p className="text-[11px] text-muted-foreground leading-relaxed">
                      Herhangi bir not kartındaki pin ikonuna tıklayarak buraya sabitleyebilir ve sıralayabilirsiniz.
                    </p>
                  </div>
                ) : (
                  pinnedNotes.map((note, index) => {
                    const isDragging = draggedPinnedIdx === index;
                    const isOver = dragOverPinnedIdx === index;
                    const noteCat = note.category_id ? categoryMap[note.category_id] : undefined;
                    const noteLoc = note.location_id ? locationMap[note.location_id] : undefined;

                    return (
                      <div
                        key={note.note_id}
                        draggable
                        onDragStart={(e) => handlePinnedDragStart(e, index)}
                        onDragOver={(e) => handlePinnedDragOver(e, index)}
                        onDrop={(e) => handlePinnedDrop(e, index)}
                        className={`p-3 rounded-xl border bg-card text-foreground shadow-2xs transition-all cursor-grab active:cursor-grabbing group relative select-none ${
                          isDragging
                            ? "opacity-40 scale-95 border-dashed border-primary"
                            : isOver
                            ? "border-primary ring-2 ring-primary/30 bg-primary/5 scale-[1.01]"
                            : "border-border/80 hover:border-primary/50 hover:shadow-xs"
                        }`}
                        data-testid={`pinned-note-item-${note.note_id}`}
                      >
                        {/* Top row: Drag handle + Title + Actions */}
                        <div className="flex items-start justify-between gap-1.5 mb-1.5">
                          <div className="flex items-center gap-1.5 min-w-0 flex-1">
                            <GripVertical className="w-3.5 h-3.5 text-muted-foreground/40 group-hover:text-foreground shrink-0 transition-colors" />
                            <Link
                              to={`/note/${note.slug || note.note_id}`}
                              className="font-serif font-bold text-xs text-foreground truncate hover:text-primary transition-colors flex items-center gap-1"
                            >
                              <span>{note.title || "Başlıksız Not"}</span>
                              <ArrowUpRight className="w-3 h-3 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
                            </Link>
                          </div>

                          <div className="flex items-center gap-1 shrink-0">
                            <button
                              type="button"
                              onClick={() => handleTogglePin(note)}
                              className="p-1 hover:bg-muted text-muted-foreground hover:text-destructive rounded transition-colors cursor-pointer"
                              title="Sabitlemeyi kaldır"
                            >
                              <PinOff className="w-3 h-3" />
                            </button>
                          </div>
                        </div>

                        {/* Note Snippet */}
                        {note.content && (
                          <p className="text-[11px] text-muted-foreground line-clamp-2 font-serif leading-relaxed mb-2">
                            {note.content.replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, "$1")}
                          </p>
                        )}

                        {/* Metadata Footer: Date, Category, Location */}
                        <div className="flex flex-wrap items-center gap-1.5 pt-1.5 border-t border-border/40 text-[10px] text-muted-foreground font-mono">
                          <span className="flex items-center gap-1">
                            <CalendarIcon className="w-3 h-3 text-primary" />
                            {formatDisplayDatetime(note.date)}
                          </span>

                          {noteCat && (
                            <span
                              className="px-1.5 py-0.5 rounded text-[9px] font-medium"
                              style={{
                                backgroundColor: `${noteCat.color || "#6366f1"}15`,
                                color: noteCat.color || "#6366f1",
                              }}
                            >
                              {noteCat.name}
                            </span>
                          )}

                          {noteLoc && (
                            <span className="flex items-center gap-0.5 text-blue-600 dark:text-blue-400">
                              <MapPin className="w-2.5 h-2.5" />
                              <span className="truncate max-w-[80px]">{noteLoc.name}</span>
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </aside>
          )}
        </div>
      </div>

      {/* Selected Day Notes Modal Dialog */}
      {selectedDay && (
        <Dialog open={dayModalOpen} onOpenChange={setDayModalOpen}>
          <DialogContent className="max-w-xl bg-card border-border shadow-2xl p-5 sm:p-6 max-h-[85vh] flex flex-col">
            <DialogHeader className="border-b border-border pb-3 shrink-0">
              <div className="flex items-center justify-between">
                <div>
                  <DialogTitle className="font-serif text-base sm:text-lg font-bold text-foreground flex items-center gap-2">
                    <CalendarIcon className="w-4 h-4 text-primary" />
                    <span>
                      {selectedDay.date.toLocaleDateString("tr-TR", {
                        day: "numeric",
                        month: "long",
                        year: "numeric",
                        weekday: "long",
                      })}
                    </span>
                  </DialogTitle>
                  <DialogDescription className="text-xs text-muted-foreground font-mono mt-0.5">
                    Bu tarihe kayıtlı {selectedDay.notes.length} not bulunuyor.
                  </DialogDescription>
                </div>

                <Button
                  size="sm"
                  onClick={() => {
                    setDayModalOpen(false);
                    navigate(`/new?date=${selectedDay.dateKey}`);
                  }}
                  className="h-8 text-xs bg-primary text-primary-foreground font-semibold shadow-xs"
                >
                  <Plus className="w-3.5 h-3.5 mr-1" /> Bu Güne Not Ekle
                </Button>
              </div>
            </DialogHeader>

            {/* Day Notes Feed */}
            <div className="flex-1 overflow-y-auto py-3 space-y-3 min-h-[160px]">
              {selectedDay.notes.length === 0 ? (
                <div className="py-12 text-center text-muted-foreground text-xs space-y-2">
                  <p>Bu tarihe ait henüz not eklenmemiş.</p>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setDayModalOpen(false);
                      navigate(`/new?date=${selectedDay.dateKey}`);
                    }}
                    className="text-xs"
                  >
                    + İlk notu oluştur
                  </Button>
                </div>
              ) : (
                selectedDay.notes.map((note) => (
                  <div
                    key={note.note_id}
                    onClick={() => {
                      setDayModalOpen(false);
                      navigate(`/note/${note.slug || note.note_id}`);
                    }}
                    className="p-3.5 rounded-xl border border-border bg-muted/20 hover:bg-muted/40 transition-all cursor-pointer group flex flex-col justify-between gap-2 shadow-2xs"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <h4 className="font-serif font-bold text-sm text-foreground group-hover:text-primary transition-colors">
                        {note.title || "Başlıksız Not"}
                      </h4>
                      <ArrowUpRight className="w-4 h-4 text-muted-foreground opacity-40 group-hover:opacity-100 group-hover:text-primary transition-all shrink-0" />
                    </div>

                    {note.content && (
                      <p className="text-xs text-muted-foreground line-clamp-2 leading-relaxed">
                        {note.content.replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, "$1")}
                      </p>
                    )}

                    <div className="flex items-center gap-2 pt-1.5 border-t border-border/40 text-[10px] text-muted-foreground font-mono">
                      <span>{formatDisplayDatetime(note.date, true)}</span>
                      {note.tags.map((t) => (
                        <span key={t} className="text-primary font-bold">
                          #{t}
                        </span>
                      ))}
                    </div>
                  </div>
                ))
              )}
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
