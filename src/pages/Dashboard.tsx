import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import api from "@/lib/api";
import type { Note, Tag, Person, LocationItem, Category, ItemGroup, CalendarCounts, NoteType } from "@/types";
import TopBar from "@/components/TopBar";
import Sidebar from "@/components/Sidebar";
import NoteCard from "@/components/NoteCard";
import NoteComposer from "@/components/NoteComposer";
import CalendarPanel from "@/components/CalendarPanel";
import PinnedNotesPanel from "@/components/PinnedNotesPanel";
import SearchBar, { FilterChip } from "@/components/SearchBar";
import { FilterProvider, FilterType, FilterContextValue } from "@/contexts/FilterContext";
import { useSettings, NoteDefaultFilter } from "@/contexts/SettingsContext";
import {
  Search,
  Hash,
  AtSign,
  MapPin,
  CalendarDays,
  Menu,
  FileText,
  SlidersHorizontal,
  Layers,
  X,
} from "lucide-react";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { toast } from "sonner";

interface Props {
  mode: "day" | "tag" | "person" | "location" | "category";
}

interface ExtraFilters {
  q: string;
  tags: string[];
  people: string[];
  locationIds: string[];
  categoryIds: string[];
}

function todayIso(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export default function Dashboard({ mode }: Props) {
  const params = useParams<{ date?: string; name?: string; id?: string }>();
  const navigate = useNavigate();
  const { settings, updateSettings } = useSettings();

  const [notes, setNotes] = useState<Note[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [groups, setGroups] = useState<ItemGroup[]>([]);
  const [noteTypes, setNoteTypes] = useState<NoteType[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [people, setPeople] = useState<Person[]>([]);
  const [locations, setLocations] = useState<LocationItem[]>([]);
  const [calCounts, setCalCounts] = useState<CalendarCounts>({});
  const [refreshKey, setRefreshKey] = useState(0);

  const [extras, setExtras] = useState<ExtraFilters>({
    q: "",
    tags: [],
    people: [],
    locationIds: [],
    categoryIds: [],
  });

  const todayInit = todayIso();
  const initDate = params.date && /^\d{4}-\d{2}-\d{2}$/.test(params.date) ? params.date : todayInit;

  const [selectedDate, setSelectedDate] = useState<string>(initDate);
  const [calMonth, setCalMonth] = useState<{ year: number; month: number }>({
    year: parseInt(initDate.slice(0, 4)),
    month: parseInt(initDate.slice(5, 7)),
  });

  // Sync selectedDate with route parameter changes (e.g. clicking calendar dates)
  useEffect(() => {
    if (params.date && /^\d{4}-\d{2}-\d{2}$/.test(params.date)) {
      setSelectedDate(params.date);
      setCalMonth({
        year: parseInt(params.date.slice(0, 4)),
        month: parseInt(params.date.slice(5, 7)),
      });
    } else if (mode === "day" && !params.date) {
      const today = todayIso();
      setSelectedDate(today);
    }
  }, [params.date, mode]);

  const [leftOpen, setLeftOpen] = useState(false);
  const [rightOpen, setRightOpen] = useState(false);

  const locationMap = useMemo(() => {
    const m: Record<string, LocationItem> = {};
    (Array.isArray(locations) ? locations : []).forEach((l) => {
      if (l && l.location_id) m[l.location_id] = l;
    });
    return m;
  }, [locations]);

  const categoryMap = useMemo(() => {
    const m: Record<string, Category> = {};
    (Array.isArray(categories) ? categories : []).forEach((c) => {
      if (c && c.category_id) m[c.category_id] = c;
    });
    return m;
  }, [categories]);

  const noteTypeMap = useMemo(() => {
    const m: Record<string, NoteType> = {};
    (Array.isArray(noteTypes) ? noteTypes : []).forEach((nt) => {
      if (nt && nt.type_id) m[nt.type_id] = nt;
    });
    return m;
  }, [noteTypes]);

  const fetchAux = useCallback(async () => {
    try {
      const [c, g, t, p, l, nt] = await Promise.all([
        api.get<Category[]>("/categories"),
        api.get<ItemGroup[]>("/groups"),
        api.get<Tag[]>("/tags"),
        api.get<Person[]>("/people"),
        api.get<LocationItem[]>("/locations"),
        api.get<NoteType[]>("/note-types"),
      ]);
      setCategories(Array.isArray(c.data) ? c.data : []);
      setGroups(Array.isArray(g.data) ? g.data : []);
      setTags(Array.isArray(t.data) ? t.data : []);
      setPeople(Array.isArray(p.data) ? p.data : []);
      setLocations(Array.isArray(l.data) ? l.data : []);
      setNoteTypes(Array.isArray(nt.data) ? nt.data : []);
    } catch (err) {
      console.warn("Failed fetching aux data:", err);
    }
  }, []);

  const fetchCalendar = useCallback(async (y: number, m: number) => {
    try {
      const { data } = await api.get<CalendarCounts>("/notes/calendar", {
        params: { year: y, month: m },
      });
      setCalCounts(data || {});
    } catch (err) {
      console.warn("Failed fetching calendar counts:", err);
    }
  }, []);

  const hasSearchOrFilters =
    extras.q.trim().length > 0 ||
    extras.tags.length > 0 ||
    extras.people.length > 0 ||
    extras.locationIds.length > 0 ||
    extras.categoryIds.length > 0 ||
    mode !== "day";

  const fetchNotes = useCallback(async () => {
    const queryParams: Record<string, any> = {};

    // In day mode, strictly filter notes by the selected date (e.g. today or clicked calendar day)
    if (mode === "day") {
      queryParams.date = selectedDate;
    }

    // Combine route-based primary filter with extras
    const allTags = [...extras.tags];
    if (mode === "tag" && params.name) allTags.unshift(params.name);
    if (allTags.length > 0) queryParams.tags = allTags;

    const allPeople = [...extras.people];
    if (mode === "person" && params.name) allPeople.unshift(params.name);
    if (allPeople.length > 0) queryParams.people = allPeople;

    const allLocs = [...extras.locationIds];
    if (mode === "location" && params.id) allLocs.unshift(params.id);
    if (allLocs.length > 0) queryParams.location_ids = allLocs;

    if (mode === "category" && params.id) {
      queryParams.category_id = params.id;
    }

    if (extras.q.trim()) queryParams.q = extras.q.trim();

    try {
      const { data } = await api.get<Note[]>("/notes", { params: queryParams });
      let resNotes = Array.isArray(data) ? data : [];
      if (extras.categoryIds.length > 0) {
        resNotes = resNotes.filter((n) => n.category_id && extras.categoryIds.includes(n.category_id));
      }
      setNotes(resNotes);
    } catch (err) {
      console.warn("Failed fetching notes:", err);
    }
  }, [mode, params.name, params.id, selectedDate, extras]);

  useEffect(() => {
    fetchAux();
  }, [fetchAux]);

  useEffect(() => {
    fetchCalendar(calMonth.year, calMonth.month);
  }, [calMonth, fetchCalendar]);

  useEffect(() => {
    fetchNotes();
  }, [fetchNotes]);

  function onSelectDate(iso: string) {
    setSelectedDate(iso);
    navigate(`/day/${iso}`);
    setRightOpen(false);
  }

  function onChangeMonth(delta: number) {
    setCalMonth((cm) => {
      let m = cm.month + delta;
      let y = cm.year;
      if (m > 12) {
        m = 1;
        y++;
      }
      if (m < 1) {
        m = 12;
        y--;
      }
      return { year: y, month: m };
    });
  }

  async function onDeleteNote(id: string) {
    await api.delete(`/notes/${id}`);
    fetchNotes();
    fetchCalendar(calMonth.year, calMonth.month);
    fetchAux();
    setRefreshKey((k) => k + 1);
  }

  function onNoteCreated() {
    fetchNotes();
    fetchCalendar(calMonth.year, calMonth.month);
    fetchAux();
    setRefreshKey((k) => k + 1);
  }

  const filterCtx: FilterContextValue = useMemo(
    () => ({
      active: extras,
      tryAddFilter: (type: FilterType, value: string, e?: React.MouseEvent) => {
        if (!e || !(e.ctrlKey || e.metaKey)) return false;
        setExtras((prev) => {
          const norm = value.toLowerCase();
          if (type === "tag") {
            if (prev.tags.includes(norm)) return prev;
            toast.success(`+ #${norm}`);
            return { ...prev, tags: [...prev.tags, norm] };
          }
          if (type === "person") {
            if (prev.people.includes(norm)) return prev;
            toast.success(`+ @${norm}`);
            return { ...prev, people: [...prev.people, norm] };
          }
          if (type === "location") {
            if (prev.locationIds.includes(value)) return prev;
            toast.success("+ Konum filtresi eklendi");
            return { ...prev, locationIds: [...prev.locationIds, value] };
          }
          if (type === "category") {
            if (prev.categoryIds.includes(value)) return prev;
            toast.success("+ Kategori filtresi eklendi");
            return { ...prev, categoryIds: [...prev.categoryIds, value] };
          }
          return prev;
        });
        return true;
      },
    }),
    [extras]
  );

  // Filter notes based on quick filter
  const displayNotes = useMemo(() => {
    const filter = settings.defaultFilter;
    if (filter === "all") return notes;

    return notes.filter((n) => {
      const content = n.content || "";
      if (filter === "incomplete_tasks") {
        return /(^|\n)\s*- \[ \]/m.test(content);
      }
      if (filter === "completed_tasks") {
        return /(^|\n)\s*- \[[xX]\]/m.test(content);
      }
      if (filter === "with_reminders") {
        return content.includes("```reminder");
      }
      if (filter === "with_images") {
        return /!\[[^\]]*\]\([^)]+\)/.test(content);
      }
      if (filter === "pinned_only") {
        return Boolean(n.pinned);
      }
      return true;
    });
  }, [notes, settings.defaultFilter]);

  // Chips for SearchBar
  const chips: FilterChip[] = useMemo(() => {
    const list: FilterChip[] = [];
    (Array.isArray(extras?.tags) ? extras.tags : []).forEach((t) =>
      list.push({
        id: `tag-${t}`,
        type: "tag",
        value: t,
        label: `#${t}`,
      })
    );
    (Array.isArray(extras?.people) ? extras.people : []).forEach((p) =>
      list.push({
        id: `person-${p}`,
        type: "person",
        value: p,
        label: `@${p}`,
      })
    );
    (Array.isArray(extras?.locationIds) ? extras.locationIds : []).forEach((locId) =>
      list.push({
        id: `loc-${locId}`,
        type: "location",
        value: locId,
        label: locationMap[locId]?.name || "Konum",
      })
    );
    (Array.isArray(extras?.categoryIds) ? extras.categoryIds : []).forEach((catId) =>
      list.push({
        id: `cat-${catId}`,
        type: "category",
        value: catId,
        label: categoryMap[catId]?.name || "Kategori",
      })
    );
    return list;
  }, [extras, locationMap, categoryMap]);

  function onRemoveChip(chip: FilterChip) {
    setExtras((prev) => {
      if (chip.type === "tag") {
        return { ...prev, tags: prev.tags.filter((t) => t !== chip.value) };
      }
      if (chip.type === "person") {
        return { ...prev, people: prev.people.filter((p) => p !== chip.value) };
      }
      if (chip.type === "location") {
        return { ...prev, locationIds: prev.locationIds.filter((l) => l !== chip.value) };
      }
      if (chip.type === "category") {
        return { ...prev, categoryIds: prev.categoryIds.filter((c) => c !== chip.value) };
      }
      return prev;
    });
  }

  function HeaderForMode() {
    if (mode === "category") {
      const cat = params.id ? categoryMap[params.id] : null;
      return (
        <div className="mb-4">
          <div className="text-[10px] tracking-[0.3em] uppercase text-muted-foreground mb-1 flex items-center gap-1.5 font-mono">
            <Layers className="w-3 h-3 text-indigo-500" strokeWidth={1.5} /> Kategori Görünümü
          </div>
          <h1 className="font-serif text-3xl sm:text-4xl tracking-tight flex items-center gap-2">
            {cat?.color && <span className="w-3.5 h-3.5 rounded-full" style={{ backgroundColor: cat.color }} />}
            {cat?.name || "Kategori"}
          </h1>
        </div>
      );
    }
    if (mode === "tag") {
      return (
        <div className="mb-4">
          <div className="text-[10px] tracking-[0.3em] uppercase text-muted-foreground mb-1 flex items-center gap-1.5 font-mono">
            <Hash className="w-3 h-3 text-sky-500" strokeWidth={1.5} /> Etiket Görünümü
          </div>
          <h1 className="font-serif text-3xl sm:text-4xl tracking-tight">
            <span className="text-sky-500">#</span>
            {params.name}
          </h1>
        </div>
      );
    }
    if (mode === "person") {
      return (
        <div className="mb-4">
          <div className="text-[10px] tracking-[0.3em] uppercase text-muted-foreground mb-1 flex items-center gap-1.5 font-mono">
            <AtSign className="w-3 h-3 text-emerald-500" strokeWidth={1.5} /> Kişi Görünümü
          </div>
          <h1 className="font-serif text-3xl sm:text-4xl tracking-tight">
            <span className="text-emerald-500">@</span>
            {params.name}
          </h1>
        </div>
      );
    }
    if (mode === "location") {
      const loc = params.id ? locationMap[params.id] : null;
      return (
        <div className="mb-4">
          <div className="text-[10px] tracking-[0.3em] uppercase text-muted-foreground mb-1 flex items-center gap-1.5 font-mono">
            <MapPin className="w-3 h-3 text-rose-500" strokeWidth={1.5} /> Konum Görünümü
          </div>
          <h1 className="font-serif text-3xl sm:text-4xl tracking-tight">{loc?.name || "Konum"}</h1>
        </div>
      );
    }

    const isSearching =
      extras.q.trim().length > 0 ||
      extras.tags.length > 0 ||
      extras.people.length > 0 ||
      extras.locationIds.length > 0 ||
      extras.categoryIds.length > 0 ||
      settings.defaultFilter !== "all";

    if (isSearching) {
      return (
        <div className="mb-4">
          <div className="text-[10px] tracking-[0.3em] uppercase text-muted-foreground mb-1 flex items-center gap-1.5 font-mono">
            <Search className="w-3 h-3" strokeWidth={1.5} /> Genel Arama & Filtre Sonuçları
          </div>
          <h1 className="font-serif text-3xl sm:text-4xl tracking-tight" data-testid="search-heading">
            {extras.q.trim() ? `"${extras.q.trim()}"` : "Filtrelenmiş Notlar"}
          </h1>
        </div>
      );
    }

    const d = new Date(selectedDate + "T00:00:00");
    const dayLabel = d.toLocaleDateString("tr-TR", {
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
    });

    return (
      <div className="mb-4">
        <div className="text-[10px] tracking-[0.3em] uppercase text-muted-foreground mb-1 font-mono">
          Günlük Notlar
        </div>
        <h1 className="font-serif text-3xl sm:text-4xl tracking-tight" data-testid="day-heading">
          {dayLabel}
        </h1>
      </div>
    );
  }

  return (
    <FilterProvider value={filterCtx}>
      <div className="min-h-screen flex flex-col paper">
        <TopBar onLeftMenu={() => setLeftOpen(true)} onRightMenu={() => setRightOpen(true)} />

        <div className="flex-1 grid grid-cols-1 lg:grid-cols-[290px_1fr_320px] min-h-0">
          {/* Left Sidebar (Desktop) */}
          <div className="hidden lg:block border-r border-border min-h-0 overflow-hidden">
            <Sidebar
              categories={categories}
              groups={groups}
              tags={tags}
              people={people}
              locations={locations}
              onChange={() => {
                fetchAux();
                fetchNotes();
              }}
            />
          </div>

          {/* Main Feed: General Search on top, then Note Composer, then Notes List */}
          <main
            className="min-w-0 max-w-3xl w-full mx-auto px-4 sm:px-6 lg:px-10 py-6 pb-28 lg:pb-12"
            data-testid="main-feed"
          >
            {/* 1. Universal Search & Quick Filters (Located directly on top of notes) */}
            <SearchBar
              q={extras.q}
              onQChange={(v) => setExtras((p) => ({ ...p, q: v }))}
              chips={chips}
              onRemoveChip={onRemoveChip}
              activeFilter={settings.defaultFilter}
              onFilterChange={(f: NoteDefaultFilter) => updateSettings({ defaultFilter: f })}
              totalResults={displayNotes.length}
            />

            {/* 2. Header for current mode */}
            <HeaderForMode />

            {/* 3. Note Composer (Shown on Day view when not searching) */}
            {mode === "day" &&
              extras.q.trim().length === 0 &&
              extras.tags.length === 0 &&
              extras.people.length === 0 &&
              extras.locationIds.length === 0 &&
              extras.categoryIds.length === 0 &&
              settings.defaultFilter === "all" && (
                <div className="mb-6">
                  <NoteComposer
                    defaultDate={selectedDate}
                    locations={locations}
                    categories={categories}
                    noteTypes={noteTypes}
                    onCreated={onNoteCreated}
                    onLocationsChanged={fetchAux}
                  />
                </div>
              )}

            {/* 4. Notes List */}
            <div className="space-y-4">
              {displayNotes.length === 0 ? (
                <div className="text-center py-16 px-4 border border-dashed border-border rounded-xl bg-card/40">
                  <div className="font-serif text-lg text-foreground">
                    {hasSearchOrFilters ? "Arama kriterlerine uygun not bulunamadı." : "Bu gün için henüz not eklenmemiş."}
                  </div>
                  <p className="text-xs text-muted-foreground mt-1.5">
                    {hasSearchOrFilters
                      ? "Arama metnini veya aktif filtreleri değiştirerek tekrar deneyebilirsiniz."
                      : "Yukarıdaki kutuyu kullanarak günün ilk notunu yazabilirsiniz."}
                  </p>
                  {hasSearchOrFilters && (
                    <button
                      type="button"
                      onClick={() => {
                        setExtras({ q: "", tags: [], people: [], locationIds: [], categoryIds: [] });
                        updateSettings({ defaultFilter: "all" });
                      }}
                      className="mt-3.5 px-3 py-1.5 rounded-md border border-border text-xs text-muted-foreground hover:text-foreground hover:bg-muted transition-colors cursor-pointer inline-flex items-center gap-1.5"
                    >
                      <X className="w-3.5 h-3.5" /> Tüm Filtreleri Temizle
                    </button>
                  )}
                </div>
              ) : (
                displayNotes.map((n) => (
                  <NoteCard
                    key={n.note_id}
                    note={n}
                    categoryMap={categoryMap}
                    categories={categories}
                    noteTypeMap={noteTypeMap}
                    noteTypes={noteTypes}
                    locationMap={locationMap}
                    locations={locations}
                    onDelete={onDeleteNote}
                    onChanged={() => {
                      fetchNotes();
                      fetchCalendar(calMonth.year, calMonth.month);
                      fetchAux();
                      setRefreshKey((k) => k + 1);
                    }}
                    onLocationsChanged={fetchAux}
                  />
                ))
              )}
            </div>
          </main>

          {/* Right Sidebar (Desktop) */}
          <div className="hidden lg:block border-l border-border min-h-0 overflow-y-auto">
            <PinnedNotesPanel reloadKey={refreshKey} />
            <CalendarPanel
              year={calMonth.year}
              month={calMonth.month}
              counts={calCounts}
              selectedDate={mode === "day" ? selectedDate : null}
              onSelectDate={onSelectDate}
              onChangeMonth={onChangeMonth}
              onNoteCreated={() => {
                fetchNotes();
                fetchCalendar(calMonth.year, calMonth.month);
                fetchAux();
                setRefreshKey((k) => k + 1);
              }}
            />
          </div>
        </div>

        {/* Mobile 3-Tab Bottom Navigation Bar */}
        <nav
          data-testid="mobile-bottom-nav"
          className="lg:hidden fixed bottom-0 left-0 right-0 z-40 bg-card/95 backdrop-blur-md border-t border-border px-3 py-1.5 flex items-center justify-around shadow-lg select-none"
        >
          {/* Tab 1: Günün Notları */}
          <button
            type="button"
            onClick={() => {
              setLeftOpen(false);
              setRightOpen(false);
              if (mode !== "day" || selectedDate !== todayInit) {
                navigate(`/day/${todayInit}`);
              }
              window.scrollTo({ top: 0, behavior: "smooth" });
            }}
            data-testid="bottom-nav-today"
            className={`flex flex-col items-center justify-center py-1 px-3 rounded-md transition-all ${
              !leftOpen && !rightOpen
                ? "text-foreground font-semibold"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <FileText className="w-4 h-4 mb-0.5" strokeWidth={1.5} />
            <span className="text-[10px] tracking-tight">Günün Notları</span>
          </button>

          {/* Tab 2: Gezgin / Kategoriler (Sol Sidebar) */}
          <button
            type="button"
            onClick={() => {
              setRightOpen(false);
              setLeftOpen(!leftOpen);
            }}
            data-testid="bottom-nav-sidebar"
            className={`flex flex-col items-center justify-center py-1 px-3 rounded-md transition-all ${
              leftOpen
                ? "text-foreground font-semibold"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <Menu className="w-4 h-4 mb-0.5" strokeWidth={1.5} />
            <span className="text-[10px] tracking-tight">Gezgin & Gruplar</span>
          </button>

          {/* Tab 3: Takvim & Sabitlenenler (Sağ Panel) */}
          <button
            type="button"
            onClick={() => {
              setLeftOpen(false);
              setRightOpen(!rightOpen);
            }}
            data-testid="bottom-nav-calendar"
            className={`flex flex-col items-center justify-center py-1 px-3 rounded-md transition-all ${
              rightOpen
                ? "text-foreground font-semibold"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <CalendarDays className="w-4 h-4 mb-0.5" strokeWidth={1.5} />
            <span className="text-[10px] tracking-tight">Takvim</span>
          </button>
        </nav>

        {/* Mobile Sheets */}
        <Sheet open={leftOpen} onOpenChange={setLeftOpen}>
          <SheetContent side="left" className="w-[320px] p-0 bg-card border-border">
            <Sidebar
              categories={categories}
              groups={groups}
              tags={tags}
              people={people}
              locations={locations}
              onChange={() => {
                fetchAux();
                fetchNotes();
              }}
              onNavigate={() => setLeftOpen(false)}
            />
          </SheetContent>
        </Sheet>

        <Sheet open={rightOpen} onOpenChange={setRightOpen}>
          <SheetContent side="right" className="w-[340px] p-0 bg-card border-border overflow-y-auto">
            <PinnedNotesPanel reloadKey={refreshKey} />
            <CalendarPanel
              year={calMonth.year}
              month={calMonth.month}
              counts={calCounts}
              selectedDate={mode === "day" ? selectedDate : null}
              onSelectDate={onSelectDate}
              onChangeMonth={onChangeMonth}
              onNoteCreated={() => {
                fetchNotes();
                fetchCalendar(calMonth.year, calMonth.month);
                fetchAux();
                setRefreshKey((k) => k + 1);
                setRightOpen(false);
              }}
            />
          </SheetContent>
        </Sheet>
      </div>
    </FilterProvider>
  );
}
