import React, { useState, useEffect, useMemo, useCallback } from "react";
import { Link } from "react-router-dom";
import api, { formatApiError } from "@/lib/api";
import type { Note, Category, LocationItem, NoteType, Tag, Person, ItemGroup } from "@/types";
import TopBar from "@/components/TopBar";
import Sidebar from "@/components/Sidebar";
import NoteCard from "@/components/NoteCard";
import NoteComposer from "@/components/NoteComposer";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import {
  FileText,
  SlidersHorizontal,
  ArrowDownUp,
  Sparkles,
  Search,
  Loader2,
  ChevronDown,
  CheckCircle2,
  X,
} from "lucide-react";
import { toast } from "sonner";

interface NotesResponse {
  items: Note[];
  total: number;
  filtered_total: number;
  has_more: boolean;
  limit: number;
  offset: number;
}

export default function AllNotes() {
  const [leftOpen, setLeftOpen] = useState(false);
  const [notes, setNotes] = useState<Note[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [filteredTotal, setFilteredTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);

  // Auxiliary data
  const [categories, setCategories] = useState<Category[]>([]);
  const [groups, setGroups] = useState<ItemGroup[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [people, setPeople] = useState<Person[]>([]);
  const [locations, setLocations] = useState<LocationItem[]>([]);
  const [noteTypes, setNoteTypes] = useState<NoteType[]>([]);

  // Filter States
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  const [selectedPerson, setSelectedPerson] = useState<string | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [selectedLocation, setSelectedLocation] = useState<string | null>(null);
  const [selectedNoteType, setSelectedNoteType] = useState<string | null>(null);
  const [sortOrder, setSortOrder] = useState<"newest" | "oldest">("newest");

  // Debounce search query to reduce unnecessary backend calls
  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedQuery(searchQuery.trim());
    }, 300);
    return () => clearTimeout(handler);
  }, [searchQuery]);

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

  // Server-side paginated & filtered notes fetcher
  const fetchNotes = useCallback(
    async (offset = 0, isAppend = false) => {
      if (isAppend) {
        setLoadingMore(true);
      } else {
        setLoading(true);
      }

      try {
        const params: Record<string, any> = {
          paginate: "true",
          limit: 10,
          offset,
          sortOrder,
        };

        if (debouncedQuery) params.q = debouncedQuery;
        if (selectedTag) params.tag = selectedTag;
        if (selectedPerson) params.person = selectedPerson;
        if (selectedCategory) params.category_id = selectedCategory;
        if (selectedLocation) params.location_id = selectedLocation;
        if (selectedNoteType) params.note_type_id = selectedNoteType;

        const { data } = await api.get<NotesResponse>("/notes", { params });

        if (data && Array.isArray(data.items)) {
          if (isAppend) {
            setNotes((prev) => [...prev, ...data.items]);
          } else {
            setNotes(data.items);
          }
          setTotalCount(data.total ?? 0);
          setFilteredTotal(data.filtered_total ?? 0);
          setHasMore(Boolean(data.has_more));
        } else if (Array.isArray(data)) {
          // Fallback if legacy array returned
          setNotes(data);
          setTotalCount(data.length);
          setFilteredTotal(data.length);
          setHasMore(false);
        }
      } catch (err: any) {
        toast.error(formatApiError(err) || "Notlar yüklenirken bir hata oluştu");
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [
      debouncedQuery,
      selectedTag,
      selectedPerson,
      selectedCategory,
      selectedLocation,
      selectedNoteType,
      sortOrder,
    ]
  );

  useEffect(() => {
    fetchAux();
  }, [fetchAux]);

  // Re-fetch from page 1 whenever filters, search query, or sorting change
  useEffect(() => {
    fetchNotes(0, false);
  }, [fetchNotes]);

  const handleLoadMore = () => {
    if (loadingMore || !hasMore) return;
    fetchNotes(notes.length, true);
  };

  const activeFilterCount =
    (selectedTag ? 1 : 0) +
    (selectedPerson ? 1 : 0) +
    (selectedCategory ? 1 : 0) +
    (selectedLocation ? 1 : 0) +
    (selectedNoteType ? 1 : 0);

  const clearFilters = () => {
    setSelectedTag(null);
    setSelectedPerson(null);
    setSelectedCategory(null);
    setSelectedLocation(null);
    setSelectedNoteType(null);
    setSearchQuery("");
  };

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col antialiased">
      <TopBar onLeftMenu={() => setLeftOpen(true)} />

      <div className="flex-1 flex w-full max-w-(--breakpoint-2xl) mx-auto">
        {/* Left Sidebar (Desktop) */}
        <aside className="hidden lg:block w-64 xl:w-72 shrink-0 border-r border-border p-4 sticky top-14 h-[calc(100vh-3.5rem)] overflow-y-auto">
          <Sidebar
            categories={categories}
            groups={groups}
            tags={tags}
            people={people}
            locations={locations}
            onChange={() => {
              fetchAux();
              fetchNotes(0, false);
            }}
          />
        </aside>

        {/* Mobile Left Sidebar */}
        <Sheet open={leftOpen} onOpenChange={setLeftOpen}>
          <SheetContent side="left" className="p-0 w-80 bg-sidebar border-border">
            <div className="p-4 h-full overflow-y-auto">
              <Sidebar
                categories={categories}
                groups={groups}
                tags={tags}
                people={people}
                locations={locations}
                onChange={() => {
                  fetchAux();
                  fetchNotes(0, false);
                }}
                onNavigate={() => setLeftOpen(false)}
              />
            </div>
          </SheetContent>
        </Sheet>

        {/* Main Content Area */}
        <main className="flex-1 min-w-0 p-4 sm:p-6 lg:p-8 space-y-6 max-w-4xl mx-auto">
          {/* Header Title & Sorting Control Bar */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-border">
            <div>
              <h1 className="font-serif text-2xl sm:text-3xl font-bold tracking-tight text-foreground flex items-center gap-2">
                <FileText className="w-6 h-6 text-primary" />
                <span>Bütün Notlar</span>
              </h1>
              <p className="text-xs text-muted-foreground mt-1">
                Tüm notlarınız sunucu taraflı hızlı arama ve 10'arlı sayfalama ile listelenmektedir.
              </p>
            </div>

            <div className="flex items-center gap-2 shrink-0 flex-wrap">
              <button
                type="button"
                onClick={() => setSortOrder(sortOrder === "newest" ? "oldest" : "newest")}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-secondary hover:bg-secondary/80 text-foreground border border-border rounded-lg transition-colors cursor-pointer"
                title="Sıralamayı değiştir"
                data-testid="toggle-sort-order-btn"
              >
                <ArrowDownUp className="w-3.5 h-3.5 text-primary" />
                <span>{sortOrder === "newest" ? "Yeniden Eskiye" : "Eskiden Yeniye"}</span>
              </button>

              {/* Total note count displays both currently loaded, matching filtered count and total count across system */}
              <span className="text-xs font-mono bg-muted text-foreground px-3 py-1.5 rounded-lg border border-border flex items-center gap-1.5 shadow-2xs font-semibold">
                <span>
                  {debouncedQuery || activeFilterCount > 0
                    ? `${filteredTotal} Sonuç (Toplam: ${totalCount})`
                    : `Toplam: ${totalCount} Not`}
                </span>
              </span>
            </div>
          </div>

          {/* Quick Note Composer */}
          <div className="rounded-xl border border-border/80 bg-card p-4 sm:p-5 shadow-2xs">
            <div className="text-xs font-semibold text-foreground/80 mb-2 flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5 text-primary" />
              <span>Hızlı Yeni Not Oluştur</span>
            </div>
            <NoteComposer
              defaultDate={new Date().toISOString().slice(0, 10)}
              categories={categories}
              locations={locations}
              noteTypes={noteTypes}
              onCreated={() => fetchNotes(0, false)}
            />
          </div>

          {/* Search & Dynamic Filter Chips Bar (Backend Powered) */}
          <div className="space-y-2.5">
            <div className="relative">
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Tüm notlar içinde metin, #etiket, @kişi veya başlık ara (Sunucu Araması)..."
                className="w-full h-10 pl-10 pr-9 rounded-xl border border-border bg-card text-xs text-foreground placeholder:text-muted-foreground focus:outline-hidden focus:border-primary shadow-2xs"
                data-testid="all-notes-search-input"
              />
              <Search className="w-4 h-4 text-muted-foreground absolute left-3.5 top-3" />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery("")}
                  className="absolute right-3 top-2.5 text-xs text-muted-foreground hover:text-foreground p-0.5 cursor-pointer"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            {/* Quick Type & Tag Filter Row */}
            <div className="flex items-center gap-1.5 overflow-x-auto pb-1 text-xs">
              <span className="text-[11px] font-medium text-muted-foreground shrink-0 mr-1 flex items-center gap-1">
                <SlidersHorizontal className="w-3 h-3" /> Filtreler:
              </span>

              {/* Note Types Filter */}
              {noteTypes.length > 0 && (
                <select
                  value={selectedNoteType || ""}
                  onChange={(e) => setSelectedNoteType(e.target.value || null)}
                  className="h-7 px-2 text-[11px] rounded-md border border-border bg-secondary/60 text-foreground cursor-pointer shrink-0 font-medium"
                >
                  <option value="">Tüm Not Tipleri</option>
                  {noteTypes.map((nt) => (
                    <option key={nt.type_id} value={nt.type_id}>
                      {nt.name}
                    </option>
                  ))}
                </select>
              )}

              {/* Location Filter */}
              {locations.length > 0 && (
                <select
                  value={selectedLocation || ""}
                  onChange={(e) => setSelectedLocation(e.target.value || null)}
                  className="h-7 px-2 text-[11px] rounded-md border border-border bg-secondary/60 text-foreground cursor-pointer shrink-0 font-medium"
                >
                  <option value="">Tüm Lokasyonlar</option>
                  {locations.map((l) => (
                    <option key={l.location_id} value={l.location_id}>
                      📍 {l.name}
                    </option>
                  ))}
                </select>
              )}

              {/* Clear All Filters */}
              {(activeFilterCount > 0 || searchQuery) && (
                <button
                  type="button"
                  onClick={clearFilters}
                  className="h-7 px-2.5 text-[11px] text-destructive hover:bg-destructive/10 rounded-md border border-destructive/20 font-medium shrink-0 cursor-pointer"
                >
                  Filtreleri Temizle ({activeFilterCount})
                </button>
              )}
            </div>
          </div>

          {/* Notes List Feed */}
          {loading ? (
            <div className="py-20 text-center text-xs text-muted-foreground flex flex-col items-center justify-center gap-2">
              <Loader2 className="w-5 h-5 text-primary animate-spin" />
              <span>Notlar yükleniyor...</span>
            </div>
          ) : notes.length === 0 ? (
            <div className="py-16 text-center rounded-xl border border-dashed border-border p-8 bg-card/40 space-y-3">
              <FileText className="w-8 h-8 text-muted-foreground/40 mx-auto" />
              <div className="font-serif text-base font-semibold text-foreground">
                Kriterlere uygun not bulunamadı
              </div>
              <p className="text-xs text-muted-foreground max-w-sm mx-auto">
                {activeFilterCount > 0 || searchQuery
                  ? "Filtreleri temizleyerek veya arama teriminizi değiştirerek tekrar deneyebilirsiniz."
                  : "Henüz hiç not eklenmemiş. Yukarıdaki alandan ilk notunuzu yazabilirsiniz."}
              </p>
              {(activeFilterCount > 0 || searchQuery) && (
                <button
                  type="button"
                  onClick={clearFilters}
                  className="text-xs text-primary font-medium hover:underline cursor-pointer"
                >
                  Tüm filtreleri sıfırla
                </button>
              )}
            </div>
          ) : (
            <div className="space-y-4" data-testid="all-notes-list">
              {notes.map((note) => (
                <NoteCard
                  key={note.note_id}
                  note={note}
                  locationMap={locationMap}
                  locations={locations}
                  categoryMap={categoryMap}
                  categories={categories}
                  noteTypeMap={noteTypeMap}
                  noteTypes={noteTypes}
                  onChanged={() => fetchNotes(0, false)}
                  onDelete={() => fetchNotes(0, false)}
                />
              ))}

              {/* 10-Item Load More Section */}
              <div className="pt-4 pb-8 flex flex-col items-center justify-center gap-2">
                {hasMore ? (
                  <button
                    type="button"
                    onClick={handleLoadMore}
                    disabled={loadingMore}
                    className="flex items-center gap-2 px-6 py-2.5 rounded-xl border border-border bg-card hover:bg-muted text-xs font-semibold text-foreground shadow-sm transition-all hover:scale-[1.01] active:scale-[0.99] cursor-pointer"
                  >
                    {loadingMore ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin text-primary" />
                        <span>Daha Fazla Not Yükleniyor...</span>
                      </>
                    ) : (
                      <>
                        <ChevronDown className="w-4 h-4 text-primary" />
                        <span>Daha Fazla Yükle (10 Not Daha — {notes.length}/{filteredTotal})</span>
                      </>
                    )}
                  </button>
                ) : (
                  <div className="text-[11px] font-mono text-muted-foreground/80 flex items-center gap-1.5 py-2">
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
                    <span>Tüm sonuçlar listelendi ({filteredTotal} / {totalCount} Not)</span>
                  </div>
                )}
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
