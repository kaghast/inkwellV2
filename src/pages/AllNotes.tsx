import React, { useState, useEffect, useMemo, useCallback } from "react";
import { Link, useNavigate } from "react-router-dom";
import api from "@/lib/api";
import type { Note, Tag, Person, LocationItem, Category, ItemGroup, NoteType } from "@/types";
import TopBar from "@/components/TopBar";
import Sidebar from "@/components/Sidebar";
import NoteCard from "@/components/NoteCard";
import NoteComposer from "@/components/NoteComposer";
import SearchBar, { FilterChip } from "@/components/SearchBar";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import {
  FileText,
  Clock,
  Calendar,
  Layers,
  SlidersHorizontal,
  ArrowDownUp,
  Tag as TagIcon,
  Users,
  MapPin,
  Folder,
  Boxes,
  Sparkles,
} from "lucide-react";
import { toast } from "sonner";

export default function AllNotes() {
  const [notes, setNotes] = useState<Note[]>([]);
  const [loading, setLoading] = useState(true);
  const [categories, setCategories] = useState<Category[]>([]);
  const [groups, setGroups] = useState<ItemGroup[]>([]);
  const [noteTypes, setNoteTypes] = useState<NoteType[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [people, setPeople] = useState<Person[]>([]);
  const [locations, setLocations] = useState<LocationItem[]>([]);
  const [leftOpen, setLeftOpen] = useState(false);

  // Filters
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  const [selectedPerson, setSelectedPerson] = useState<string | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [selectedLocation, setSelectedLocation] = useState<string | null>(null);
  const [selectedNoteType, setSelectedNoteType] = useState<string | null>(null);
  const [sortOrder, setSortOrder] = useState<"newest" | "oldest">("newest");

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

  const fetchAllNotes = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get<Note[]>("/notes");
      setNotes(Array.isArray(data) ? data : []);
    } catch (err: any) {
      toast.error("Notlar yüklenirken bir hata oluştu");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAux();
    fetchAllNotes();
  }, [fetchAux, fetchAllNotes]);

  // Filter and sort notes
  const filteredNotes = useMemo(() => {
    let list = Array.isArray(notes) ? [...notes] : [];

    // Search query
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      list = list.filter(
        (n) =>
          n.title.toLowerCase().includes(q) ||
          n.content.toLowerCase().includes(q) ||
          n.tags.some((t) => t.toLowerCase().includes(q)) ||
          n.people.some((p) => p.toLowerCase().includes(q))
      );
    }

    // Tag filter
    if (selectedTag) {
      list = list.filter((n) => n.tags.includes(selectedTag));
    }

    // Person filter
    if (selectedPerson) {
      list = list.filter((n) => n.people.includes(selectedPerson));
    }

    // Category filter
    if (selectedCategory) {
      list = list.filter((n) => n.category_id === selectedCategory);
    }

    // Location filter
    if (selectedLocation) {
      list = list.filter((n) => n.location_id === selectedLocation);
    }

    // Note Type filter
    if (selectedNoteType) {
      list = list.filter((n) => {
        if (selectedNoteType === "type_plain" || selectedNoteType === "default") {
          return !n.note_type_id || n.note_type_id === "type_plain" || n.note_type_id === "default";
        }
        return n.note_type_id === selectedNoteType;
      });
    }

    // Strict Sorting: En son tarihten en eskiye (newest first)
    list.sort((a, b) => {
      const timeA = new Date(a.date || a.created_at).getTime();
      const timeB = new Date(b.date || b.created_at).getTime();
      if (sortOrder === "newest") {
        return timeB - timeA;
      } else {
        return timeA - timeB;
      }
    });

    return list;
  }, [
    notes,
    searchQuery,
    selectedTag,
    selectedPerson,
    selectedCategory,
    selectedLocation,
    selectedNoteType,
    sortOrder,
  ]);

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
              fetchAllNotes();
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
                  fetchAllNotes();
                }}
              />
            </div>
          </SheetContent>
        </Sheet>

        {/* Main Content Feed */}
        <main className="flex-1 min-w-0 p-4 sm:p-6 lg:p-8 space-y-6 max-w-4xl mx-auto">
          {/* Header Banner */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-border">
            <div>
              <h1 className="font-serif text-2xl sm:text-3xl font-bold flex items-center gap-2.5 text-foreground">
                <FileText className="w-6 h-6 text-primary" strokeWidth={1.5} />
                <span>Bütün Notlar</span>
              </h1>
              <p className="text-xs text-muted-foreground mt-1">
                Tüm zamanlara ait notlarınız kronolojik olarak en son tarihten en eskiye doğru listeleniyor.
              </p>
            </div>

            <div className="flex items-center gap-2 shrink-0">
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

              <span className="text-xs font-mono bg-muted text-muted-foreground px-2.5 py-1.5 rounded-lg border border-border">
                {filteredNotes.length} / {notes.length} Not
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
              onCreated={fetchAllNotes}
            />
          </div>

          {/* Search & Dynamic Filter Chips Bar */}
          <div className="space-y-2.5">
            <div className="relative">
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Tüm notlar içinde metin, #etiket, @kişi veya başlık ara..."
                className="w-full h-10 pl-10 pr-4 rounded-xl border border-border bg-card text-xs text-foreground placeholder:text-muted-foreground focus:outline-hidden focus:border-primary shadow-2xs"
                data-testid="all-notes-search-input"
              />
              <FileText className="w-4 h-4 text-muted-foreground absolute left-3.5 top-3" />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery("")}
                  className="absolute right-3 top-2.5 text-xs text-muted-foreground hover:text-foreground cursor-pointer"
                >
                  ✕
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

              {/* Category Filter */}
              {categories.length > 0 && (
                <select
                  value={selectedCategory || ""}
                  onChange={(e) => setSelectedCategory(e.target.value || null)}
                  className="h-7 px-2 text-[11px] rounded-md border border-border bg-secondary/60 text-foreground cursor-pointer shrink-0 font-medium"
                >
                  <option value="">Tüm Kategoriler</option>
                  {categories.map((c) => (
                    <option key={c.category_id} value={c.category_id}>
                      {c.name}
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
            <div className="py-16 text-center text-xs text-muted-foreground">
              Notlar yükleniyor...
            </div>
          ) : filteredNotes.length === 0 ? (
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
              {filteredNotes.map((note) => (
                <NoteCard
                  key={note.note_id}
                  note={note}
                  locationMap={locationMap}
                  locations={locations}
                  categoryMap={categoryMap}
                  categories={categories}
                  noteTypeMap={noteTypeMap}
                  noteTypes={noteTypes}
                  onChanged={fetchAllNotes}
                  onDelete={fetchAllNotes}
                />
              ))}
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
