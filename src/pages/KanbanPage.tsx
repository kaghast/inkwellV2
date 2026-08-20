import React, { useState, useEffect, useMemo, useCallback } from "react";
import { Link, useNavigate } from "react-router-dom";
import api from "@/lib/api";
import type {
  Note,
  Tag,
  Person,
  LocationItem,
  Category,
  ItemGroup,
  NoteType,
  KanbanColumn,
} from "@/types";
import TopBar from "@/components/TopBar";
import { CustomFieldsView } from "@/components/CustomFieldsRenderer";
import {
  Kanban as KanbanIcon,
  Plus,
  MoreVertical,
  Edit2,
  Trash2,
  Tag as TagIcon,
  User as UserIcon,
  MapPin,
  Folder,
  Layers,
  Sparkles,
  ExternalLink,
  Search,
  Calendar,
  Clock,
  Move,
  GripVertical,
  CheckCircle2,
  ChevronRight,
  SlidersHorizontal,
  X,
  Palette,
  Network,
} from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface DragPayload {
  type: "tag" | "person" | "location" | "category" | "card";
  data: any;
}

const COLOR_PALETTE = [
  "#3b82f6", // Blue
  "#f59e0b", // Amber
  "#8b5cf6", // Purple
  "#10b981", // Emerald
  "#ec4899", // Pink
  "#06b6d4", // Cyan
  "#f97316", // Orange
  "#64748b", // Slate
];

export default function KanbanPage() {
  const navigate = useNavigate();

  const [columns, setColumns] = useState<KanbanColumn[]>([]);
  const [notes, setNotes] = useState<Note[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [groups, setGroups] = useState<ItemGroup[]>([]);
  const [noteTypes, setNoteTypes] = useState<NoteType[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [people, setPeople] = useState<Person[]>([]);
  const [locations, setLocations] = useState<LocationItem[]>([]);
  const [loading, setLoading] = useState(true);

  // Search & Filter
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedNoteType, setSelectedNoteType] = useState<string | null>(null);

  // Column Management Modals
  const [colModalOpen, setColModalOpen] = useState(false);
  const [editingCol, setEditingCol] = useState<KanbanColumn | null>(null);
  const [colName, setColName] = useState("");
  const [colColor, setColColor] = useState("#3b82f6");

  // New Note in Column Modal
  const [newNoteModalOpen, setNewNoteModalOpen] = useState(false);
  const [targetColIdForNewNote, setTargetColIdForNewNote] = useState<string | null>(null);
  const [newNoteTitle, setNewNoteTitle] = useState("");
  const [newNoteContent, setNewNoteContent] = useState("");
  const [newNoteTypeId, setNewNoteTypeId] = useState<string>("type_plain");
  const [newNoteLocationId, setNewNoteLocationId] = useState<string>("");
  const [newNoteCategoryId, setNewNoteCategoryId] = useState<string>("");

  // Drag over states
  const [dragOverCardId, setDragOverCardId] = useState<string | null>(null);
  const [dragOverColId, setDragOverColId] = useState<string | null>(null);

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

  const fetchKanbanData = useCallback(async () => {
    try {
      const [colRes, noteRes, catRes, grpRes, tagRes, pplRes, locRes, ntRes] =
        await Promise.all([
          api.get<KanbanColumn[]>("/kanban/columns"),
          api.get<Note[]>("/notes"),
          api.get<Category[]>("/categories"),
          api.get<ItemGroup[]>("/groups"),
          api.get<Tag[]>("/tags"),
          api.get<Person[]>("/people"),
          api.get<LocationItem[]>("/locations"),
          api.get<NoteType[]>("/note-types"),
        ]);

      setColumns(Array.isArray(colRes.data) ? colRes.data : []);
      setNotes(Array.isArray(noteRes.data) ? noteRes.data : []);
      setCategories(Array.isArray(catRes.data) ? catRes.data : []);
      setGroups(Array.isArray(grpRes.data) ? grpRes.data : []);
      setTags(Array.isArray(tagRes.data) ? tagRes.data : []);
      setPeople(Array.isArray(pplRes.data) ? pplRes.data : []);
      setLocations(Array.isArray(locRes.data) ? locRes.data : []);
      setNoteTypes(Array.isArray(ntRes.data) ? ntRes.data : []);
    } catch (err) {
      console.warn("Failed fetching kanban data:", err);
      toast.error("Kanban verileri yüklenemedi");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchKanbanData();
  }, [fetchKanbanData]);

  // Map notes to columns (Only display notes of type 'Kart' / 'type_card')
  const columnNotesMap = useMemo(() => {
    const map: Record<string, Note[]> = {};
    const cols = Array.isArray(columns) ? columns : [];
    const noteList = Array.isArray(notes) ? notes : [];
    cols.forEach((c) => {
      if (c && c.column_id) map[c.column_id] = [];
    });

    const fallbackColId = cols.length > 0 ? cols[0].column_id : "todo";

    noteList.forEach((note) => {
      // Strictly only display notes of type "type_card" on the Kanban board
      if (note.note_type_id !== "type_card") return;

      // Check search filter
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const matchesTitle = note.title.toLowerCase().includes(q);
        const matchesContent = note.content.toLowerCase().includes(q);
        const matchesTag = note.tags.some((t) => t.toLowerCase().includes(q));
        const matchesPerson = note.people.some((p) => p.toLowerCase().includes(q));
        if (!matchesTitle && !matchesContent && !matchesTag && !matchesPerson) return;
      }

      // Find column for note
      const assignedCol = (note.custom_fields && note.custom_fields.kanban_column) || fallbackColId;
      if (map[assignedCol]) {
        map[assignedCol].push(note);
      } else if (map[fallbackColId]) {
        map[fallbackColId].push(note);
      }
    });

    return map;
  }, [columns, notes, searchQuery]);

  // Column CRUD
  const handleSaveColumn = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!colName.trim()) {
      toast.error("Sütun adı zorunludur");
      return;
    }

    try {
      if (editingCol) {
        // Update column
        const { data } = await api.put<KanbanColumn>(`/kanban/columns/${editingCol.column_id}`, {
          name: colName.trim(),
          color: colColor,
        });
        setColumns((prev) => prev.map((c) => (c.column_id === data.column_id ? data : c)));
        toast.success(`"${data.name}" sütunu güncellendi`);
      } else {
        // Create column
        const { data } = await api.post<KanbanColumn>("/kanban/columns", {
          name: colName.trim(),
          color: colColor,
          order_index: columns.length,
        });
        setColumns((prev) => [...prev, data]);
        toast.success(`"${data.name}" sütunu eklendi`);
      }
      setColModalOpen(false);
      setEditingCol(null);
      setColName("");
    } catch (err: any) {
      toast.error(err.response?.data?.detail || "İşlem gerçekleştirilemedi");
    }
  };

  const handleDeleteColumn = async (col: KanbanColumn) => {
    if (columns.length <= 1) {
      toast.error("En az bir sütun bulunmalıdır");
      return;
    }
    if (!confirm(`"${col.name}" sütununu silmek istediğinizden emin misiniz?`)) return;

    try {
      await api.delete(`/kanban/columns/${col.column_id}`);
      setColumns((prev) => prev.filter((c) => c.column_id !== col.column_id));
      toast.success(`"${col.name}" sütunu silindi`);
      fetchKanbanData();
    } catch (err: any) {
      toast.error(err.response?.data?.detail || "Sütun silinemedi");
    }
  };

  // Drag start handler for sidebar items and cards
  const handleDragStart = (e: React.DragEvent, payload: DragPayload) => {
    e.dataTransfer.setData("application/json", JSON.stringify(payload));
    e.dataTransfer.effectAllowed = "copyMove";
  };

  // Drop handler on a Kanban Card (Drop Tag, Person, Location, Category onto note)
  const handleDropOnCard = async (e: React.DragEvent, targetNote: Note) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOverCardId(null);

    const rawData = e.dataTransfer.getData("application/json");
    if (!rawData) return;

    try {
      const payload: DragPayload = JSON.parse(rawData);

      let updatedTags = [...targetNote.tags];
      let updatedPeople = [...targetNote.people];
      let updatedLocationId = targetNote.location_id;
      let updatedCategoryId = targetNote.category_id;
      let updatedContent = targetNote.content || "";

      if (payload.type === "tag") {
        const tagName = String(payload.data.name).trim().toLowerCase();
        if (!updatedTags.includes(tagName)) {
          updatedTags.push(tagName);
        }
        // Append #tag to content if not present
        if (!updatedContent.includes(`#${tagName}`)) {
          updatedContent = updatedContent ? `${updatedContent}\n#${tagName}` : `#${tagName}`;
        }
        toast.success(`"#${tagName}" etiketi "${targetNote.title || 'Not'}" içeriğine eklendi`);
      } else if (payload.type === "person") {
        const personName = String(payload.data.name).trim().toLowerCase();
        if (!updatedPeople.includes(personName)) {
          updatedPeople.push(personName);
        }
        // Append @person to content if not present
        if (!updatedContent.includes(`@${personName}`)) {
          updatedContent = updatedContent ? `${updatedContent}\n@${personName}` : `@${personName}`;
        }
        toast.success(`"@${personName}" kişi bilgisi "${targetNote.title || 'Not'}" içeriğine eklendi`);
      } else if (payload.type === "location") {
        const locItem: LocationItem = payload.data;
        updatedLocationId = locItem.location_id;
        // Append location pin text to content
        const locTag = `📍 ${locItem.name}`;
        if (!updatedContent.includes(locTag)) {
          updatedContent = updatedContent ? `${updatedContent}\n${locTag}` : locTag;
        }
        toast.success(`"${locItem.name}" konumu "${targetNote.title || 'Not'}" notuna eklendi`);
      } else if (payload.type === "category") {
        const catItem: Category = payload.data;
        updatedCategoryId = catItem.category_id;
        toast.success(`"${catItem.name}" kategorisi nota atandı`);
      } else {
        return;
      }

      // Persist update to note
      const { data: updatedNote } = await api.put<Note>(`/notes/${targetNote.note_id}`, {
        title: targetNote.title,
        content: updatedContent,
        date: targetNote.date,
        tags: updatedTags,
        people: updatedPeople,
        location_id: updatedLocationId,
        category_id: updatedCategoryId,
        note_type_id: targetNote.note_type_id,
        custom_fields: targetNote.custom_fields,
        pinned: targetNote.pinned,
      });

      setNotes((prev) => prev.map((n) => (n.note_id === updatedNote.note_id ? updatedNote : n)));
    } catch (err: any) {
      console.error("Drop on card failed:", err);
      toast.error("Not güncellenirken bir hata oluştu");
    }
  };

  // Drop handler on a Column (Move Card between columns)
  const handleDropOnColumn = async (e: React.DragEvent, targetColId: string) => {
    e.preventDefault();
    setDragOverColId(null);

    const rawData = e.dataTransfer.getData("application/json");
    if (!rawData) return;

    try {
      const payload: DragPayload = JSON.parse(rawData);

      if (payload.type === "card") {
        const cardNote: Note = payload.data;
        const currentCustomFields = cardNote.custom_fields || {};
        if (currentCustomFields.kanban_column === targetColId) return;

        const newCustomFields = {
          ...currentCustomFields,
          kanban_column: targetColId,
        };

        const targetColumn = columns.find((c) => c.column_id === targetColId);

        // Optimistically update
        setNotes((prev) =>
          prev.map((n) =>
            n.note_id === cardNote.note_id ? { ...n, custom_fields: newCustomFields } : n
          )
        );

        await api.put(`/notes/${cardNote.note_id}`, {
          custom_fields: newCustomFields,
        });

        toast.success(`Not "${targetColumn?.name || 'Sütun'}" sütununa taşındı`);
      }
    } catch (err: any) {
      console.error("Drop on column failed:", err);
      toast.error("Not taşınamadı");
      fetchKanbanData();
    }
  };

  // Quick note creation in a column
  const handleCreateNoteInColumn = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newNoteTitle.trim() && !newNoteContent.trim()) {
      toast.error("Başlık veya içerik giriniz");
      return;
    }

    try {
      const customFields: Record<string, any> = {
        kanban_column: targetColIdForNewNote || (columns[0] && columns[0].column_id) || "todo",
      };

      const { data } = await api.post<Note>("/notes", {
        title: newNoteTitle.trim(),
        content: newNoteContent.trim(),
        date: new Date().toISOString().slice(0, 10),
        note_type_id: "type_card",
        location_id: newNoteLocationId || undefined,
        category_id: newNoteCategoryId || undefined,
        custom_fields: customFields,
      });

      setNotes((prev) => [data, ...prev]);
      setNewNoteModalOpen(false);
      setNewNoteTitle("");
      setNewNoteContent("");
      setNewNoteLocationId("");
      setNewNoteCategoryId("");
      toast.success("Yeni kart oluşturuldu");
    } catch (err: any) {
      toast.error(err.response?.data?.detail || "Kart oluşturulamadı");
    }
  };

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col antialiased">
      <TopBar />

      <div className="flex-1 flex h-[calc(100vh-3.5rem)] overflow-hidden">
        {/* Left Drag & Drop Sidebar (Tags, People, Locations, Categories) */}
        <aside className="w-64 xl:w-72 border-r border-border bg-card/60 flex flex-col shrink-0 overflow-hidden select-none">
          <div className="p-3.5 border-b border-border bg-background/50 space-y-1">
            <div className="flex items-center justify-between">
              <span className="font-serif font-bold text-xs text-foreground flex items-center gap-1.5">
                <Move className="w-3.5 h-3.5 text-primary" /> Sürüklenebilir Ögeler
              </span>
              <span className="text-[10px] font-mono text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
                Sürükle & Bırak
              </span>
            </div>
            <p className="text-[11px] text-muted-foreground leading-tight">
              Aşağıdaki etiket, kişi ve lokasyonları Kanban kartlarının üzerine sürükleyerek nota ekleyin.
            </p>
          </div>

          <div className="flex-1 overflow-y-auto p-3 space-y-4 divide-y divide-border/40">
            {/* Draggable Tags */}
            <div className="space-y-2">
              <div className="flex items-center justify-between text-[11px] font-semibold text-foreground/80">
                <span className="flex items-center gap-1.5">
                  <TagIcon className="w-3 h-3 text-[hsl(var(--accent-tag))]" />
                  <span>Etiketler (#{tags.length})</span>
                </span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {tags.length === 0 ? (
                  <span className="text-[11px] text-muted-foreground italic">Etiket yok</span>
                ) : (
                  tags.map((t) => (
                    <div
                      key={t.tag_id}
                      draggable
                      onDragStart={(e) => handleDragStart(e, { type: "tag", data: t })}
                      className="px-2 py-1 bg-secondary hover:bg-primary/10 border border-border hover:border-primary/40 rounded-md text-xs font-mono font-medium text-foreground cursor-grab active:cursor-grabbing transition-all flex items-center gap-1 shadow-2xs group"
                      title="Bu etiketi bir karta sürükleyin"
                    >
                      <GripVertical className="w-2.5 h-2.5 text-muted-foreground opacity-40 group-hover:opacity-100" />
                      <span>#{t.name}</span>
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* Draggable People */}
            <div className="pt-3 space-y-2">
              <div className="flex items-center justify-between text-[11px] font-semibold text-foreground/80">
                <span className="flex items-center gap-1.5">
                  <UserIcon className="w-3 h-3 text-[hsl(var(--accent-mention))]" />
                  <span>Kişiler (@{people.length})</span>
                </span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {people.length === 0 ? (
                  <span className="text-[11px] text-muted-foreground italic">Kişi yok</span>
                ) : (
                  people.map((p) => (
                    <div
                      key={p.person_id}
                      draggable
                      onDragStart={(e) => handleDragStart(e, { type: "person", data: p })}
                      className="px-2 py-1 bg-secondary hover:bg-primary/10 border border-border hover:border-primary/40 rounded-md text-xs font-mono font-medium text-foreground cursor-grab active:cursor-grabbing transition-all flex items-center gap-1 shadow-2xs group"
                      title="Bu kişiyi bir karta sürükleyin"
                    >
                      <GripVertical className="w-2.5 h-2.5 text-muted-foreground opacity-40 group-hover:opacity-100" />
                      <span>@{p.name}</span>
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* Draggable Locations */}
            <div className="pt-3 space-y-2">
              <div className="flex items-center justify-between text-[11px] font-semibold text-foreground/80">
                <span className="flex items-center gap-1.5">
                  <MapPin className="w-3 h-3 text-blue-500" />
                  <span>Lokasyonlar ({locations.length})</span>
                </span>
              </div>
              <div className="flex flex-col gap-1.5">
                {locations.length === 0 ? (
                  <span className="text-[11px] text-muted-foreground italic">Lokasyon yok</span>
                ) : (
                  locations.map((loc) => (
                    <div
                      key={loc.location_id}
                      draggable
                      onDragStart={(e) => handleDragStart(e, { type: "location", data: loc })}
                      className="p-1.5 bg-secondary hover:bg-primary/10 border border-border hover:border-primary/40 rounded-md text-xs font-medium text-foreground cursor-grab active:cursor-grabbing transition-all flex items-center justify-between shadow-2xs group"
                      title="Bu lokasyonu bir karta sürükleyin"
                    >
                      <div className="flex items-center gap-1.5 min-w-0">
                        <GripVertical className="w-3 h-3 text-muted-foreground opacity-40 group-hover:opacity-100 shrink-0" />
                        <span className="truncate">📍 {loc.name}</span>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* Draggable Categories */}
            <div className="pt-3 space-y-2">
              <div className="flex items-center justify-between text-[11px] font-semibold text-foreground/80">
                <span className="flex items-center gap-1.5">
                  <Folder className="w-3 h-3 text-amber-500" />
                  <span>Kategoriler ({categories.length})</span>
                </span>
              </div>
              <div className="flex flex-col gap-1.5">
                {categories.length === 0 ? (
                  <span className="text-[11px] text-muted-foreground italic">Kategori yok</span>
                ) : (
                  categories.map((c) => (
                    <div
                      key={c.category_id}
                      draggable
                      onDragStart={(e) => handleDragStart(e, { type: "category", data: c })}
                      className="p-1.5 bg-secondary hover:bg-primary/10 border border-border hover:border-primary/40 rounded-md text-xs font-medium text-foreground cursor-grab active:cursor-grabbing transition-all flex items-center gap-1.5 shadow-2xs group"
                      title="Bu kategoriyi bir karta sürükleyin"
                    >
                      <GripVertical className="w-3 h-3 text-muted-foreground opacity-40 group-hover:opacity-100 shrink-0" />
                      <div
                        className="w-2.5 h-2.5 rounded-full shrink-0"
                        style={{ backgroundColor: c.color || "#6366f1" }}
                      />
                      <span className="truncate">{c.name}</span>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </aside>

        {/* Kanban Board Canvas */}
        <main className="flex-1 flex flex-col h-full overflow-hidden bg-background">
          {/* Top Control Bar */}
          <div className="p-3 sm:px-6 border-b border-border bg-card/40 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shrink-0">
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2">
                <KanbanIcon className="w-5 h-5 text-primary" />
                <h1 className="font-serif font-bold text-base sm:text-lg text-foreground">
                  Kanban Panosu
                </h1>
              </div>

              <div className="flex items-center gap-1.5">
                <span className="text-xs font-mono bg-purple-500/10 text-purple-600 dark:text-purple-400 px-2 py-0.5 rounded border border-purple-500/20 font-medium flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-purple-500" />
                  Kart Tipi
                </span>
                <span className="text-xs font-mono bg-muted text-muted-foreground px-2 py-0.5 rounded border border-border">
                  {Object.values(columnNotesMap).reduce((acc, list) => acc + list.length, 0)} Kart • {columns.length} Sütun
                </span>
              </div>
            </div>

            <div className="flex items-center gap-2">
              {/* Search input */}
              <div className="relative">
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Kartlarda ara..."
                  className="h-8 pl-7 pr-3 text-xs bg-background rounded-md border border-border text-foreground placeholder:text-muted-foreground focus:outline-hidden focus:border-primary w-40 sm:w-56"
                />
                <Search className="w-3.5 h-3.5 text-muted-foreground absolute left-2 top-2.5" />
              </div>

              {/* Add Column Button */}
              <button
                type="button"
                onClick={() => {
                  setEditingCol(null);
                  setColName("");
                  setColColor("#3b82f6");
                  setColModalOpen(true);
                }}
                className="flex items-center gap-1.5 text-xs px-3 py-1.5 bg-primary text-primary-foreground font-semibold rounded-md hover:opacity-90 transition-opacity cursor-pointer shadow-2xs shrink-0"
                data-testid="add-column-btn"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Yeni Sütun Ekle</span>
              </button>
            </div>
          </div>

          {/* Kanban Columns Horizontal Container */}
          <div className="flex-1 p-4 sm:p-6 overflow-x-auto overflow-y-hidden flex gap-4 items-start select-none">
            {columns.map((col) => {
              const colNotes = columnNotesMap[col.column_id] || [];
              const isColOver = dragOverColId === col.column_id;

              return (
                <div
                  key={col.column_id}
                  onDragOver={(e) => {
                    e.preventDefault();
                    setDragOverColId(col.column_id);
                  }}
                  onDragLeave={() => {
                    setDragOverColId((cur) => (cur === col.column_id ? null : cur));
                  }}
                  onDrop={(e) => handleDropOnColumn(e, col.column_id)}
                  className={`w-72 sm:w-80 shrink-0 max-h-full flex flex-col rounded-xl border bg-card/80 shadow-2xs transition-colors ${
                    isColOver
                      ? "border-primary ring-2 ring-primary/20 bg-primary/5"
                      : "border-border"
                  }`}
                  data-testid={`kanban-column-${col.column_id}`}
                >
                  {/* Column Header */}
                  <div className="p-3 border-b border-border/80 flex items-center justify-between shrink-0">
                    <div className="flex items-center gap-2 min-w-0">
                      <div
                        className="w-3 h-3 rounded-full shrink-0 shadow-xs"
                        style={{ backgroundColor: col.color || "#3b82f6" }}
                      />
                      <h3 className="font-serif font-bold text-xs sm:text-sm text-foreground truncate">
                        {col.name}
                      </h3>
                      <span className="text-[10px] font-mono font-bold bg-muted text-muted-foreground px-1.5 py-0.5 rounded-full">
                        {colNotes.length}
                      </span>
                    </div>

                    <div className="flex items-center gap-0.5">
                      <button
                        type="button"
                        onClick={() => {
                          setTargetColIdForNewNote(col.column_id);
                          setNewNoteModalOpen(true);
                        }}
                        className="p-1 hover:bg-muted text-muted-foreground hover:text-foreground rounded cursor-pointer transition-colors"
                        title="Bu sütuna yeni kart ekle"
                        data-testid={`add-card-to-${col.column_id}`}
                      >
                        <Plus className="w-3.5 h-3.5" />
                      </button>

                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <button
                            type="button"
                            className="p-1 hover:bg-muted text-muted-foreground hover:text-foreground rounded cursor-pointer"
                          >
                            <MoreVertical className="w-3.5 h-3.5" />
                          </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-44 bg-popover border-border">
                          <DropdownMenuItem
                            onClick={() => {
                              setEditingCol(col);
                              setColName(col.name);
                              setColColor(col.color || "#3b82f6");
                              setColModalOpen(true);
                            }}
                            className="cursor-pointer text-xs"
                          >
                            <Edit2 className="w-3.5 h-3.5 mr-2" /> Sütunu Düzenle
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            onClick={() => handleDeleteColumn(col)}
                            className="cursor-pointer text-xs text-destructive focus:text-destructive"
                          >
                            <Trash2 className="w-3.5 h-3.5 mr-2" /> Sütunu Sil
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </div>

                  {/* Cards Feed in Column */}
                  <div className="flex-1 overflow-y-auto p-2.5 space-y-2.5 min-h-[140px]">
                    {colNotes.length === 0 ? (
                      <div className="py-8 text-center border border-dashed border-border/70 rounded-lg p-4 bg-muted/20">
                        <p className="text-[11px] text-muted-foreground">Bu sütunda kart yok</p>
                        <button
                          type="button"
                          onClick={() => {
                            setTargetColIdForNewNote(col.column_id);
                            setNewNoteModalOpen(true);
                          }}
                          className="mt-1.5 text-[11px] text-primary font-medium hover:underline cursor-pointer"
                        >
                          + Kart Ekle
                        </button>
                      </div>
                    ) : (
                      colNotes.map((note) => {
                        const isCardOver = dragOverCardId === note.note_id;
                        const noteType = note.note_type_id ? noteTypeMap[note.note_type_id] : undefined;
                        const noteLoc = note.location_id ? locationMap[note.location_id] : undefined;
                        const noteCat = note.category_id ? categoryMap[note.category_id] : undefined;

                        return (
                          <div
                            key={note.note_id}
                            draggable
                            onDragStart={(e) =>
                              handleDragStart(e, { type: "card", data: note })
                            }
                            onDragOver={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              setDragOverCardId(note.note_id);
                            }}
                            onDragLeave={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              setDragOverCardId((cur) => (cur === note.note_id ? null : cur));
                            }}
                            onDrop={(e) => handleDropOnCard(e, note)}
                            className={`p-3 rounded-lg border bg-card text-foreground shadow-2xs transition-all cursor-grab active:cursor-grabbing group relative ${
                              isCardOver
                                ? "border-emerald-500 ring-2 ring-emerald-500/30 bg-emerald-500/5 scale-[1.01]"
                                : "border-border/80 hover:border-primary/50 hover:shadow-xs"
                            }`}
                            data-testid={`kanban-card-${note.note_id}`}
                          >
                            {/* Card Header */}
                            <div className="flex items-start justify-between gap-1.5 mb-1.5">
                              <div className="flex items-center gap-1.5 min-w-0">
                                {noteCat && (
                                  <div
                                    className="w-2 h-2 rounded-full shrink-0"
                                    style={{ backgroundColor: noteCat.color || "#6366f1" }}
                                    title={`Kategori: ${noteCat.name}`}
                                  />
                                )}
                                <h4 className="font-serif font-bold text-xs text-foreground truncate group-hover:text-primary transition-colors">
                                  {note.title || "Başlıksız Not"}
                                </h4>
                              </div>

                              {/* Action: Kartı Güncelle */}
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  navigate(`/note/${note.slug || note.note_id}`);
                                }}
                                className="flex items-center gap-1 text-[10px] px-1.5 py-0.5 bg-secondary hover:bg-primary hover:text-primary-foreground text-muted-foreground rounded transition-colors cursor-pointer shrink-0 font-medium"
                                title="Not detay ve güncelleme ekranını aç"
                                data-testid={`edit-note-btn-${note.note_id}`}
                              >
                                <Edit2 className="w-2.5 h-2.5" />
                                <span>Kartı Güncelle</span>
                              </button>
                            </div>

                            {/* Note Type Badge */}
                            {noteType && (
                              <div className="mb-1.5">
                                <span
                                  className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-medium"
                                  style={{
                                    backgroundColor: `${noteType.color || "#6366f1"}20`,
                                    color: noteType.color || "#6366f1",
                                  }}
                                >
                                  <span>📦 {noteType.name}</span>
                                </span>
                              </div>
                            )}

                            {/* Content Snippet */}
                            {note.content && (
                              <p className="text-[11px] text-muted-foreground line-clamp-3 mb-2 font-serif leading-relaxed whitespace-pre-wrap">
                                {note.content}
                              </p>
                            )}

                            {/* Dynamic Calculated & Custom Parameters preview */}
                            {noteType && noteType.fields && noteType.fields.length > 0 && note.custom_fields && (
                              <div className="mb-2 p-1.5 rounded bg-muted/40 text-[10px] border border-border/50">
                                <CustomFieldsView
                                  fields={noteType.fields}
                                  values={note.custom_fields}
                                />
                              </div>
                            )}

                            {/* Metadata Pills: Location, Tags, People, Wiki-links */}
                            <div className="flex flex-wrap items-center gap-1 pt-1 border-t border-border/40 text-[10px]">
                              {(() => {
                                const wikiMatches = note.content ? note.content.match(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g) : null;
                                const wikiCount = wikiMatches ? wikiMatches.length : 0;
                                if (wikiCount === 0) return null;
                                return (
                                  <Link
                                    to="/graph"
                                    onClick={(e) => e.stopPropagation()}
                                    className="inline-flex items-center gap-0.5 text-primary bg-primary/10 hover:bg-primary/20 px-1.5 py-0.5 rounded font-mono font-medium transition-colors"
                                    title={`${wikiCount} ilişkili not (Ağ Görünümünde Aç)`}
                                  >
                                    <Network className="w-2.5 h-2.5" />
                                    <span>{wikiCount} bağ</span>
                                  </Link>
                                );
                              })()}

                              {noteLoc && (
                                <span className="inline-flex items-center gap-0.5 text-blue-600 dark:text-blue-400 bg-blue-500/10 px-1.5 py-0.5 rounded font-mono font-medium">
                                  <MapPin className="w-2.5 h-2.5" />
                                  <span className="truncate max-w-[90px]">{noteLoc.name}</span>
                                </span>
                              )}

                              {note.tags.map((t) => (
                                <span
                                  key={t}
                                  className="inline-flex items-center text-[hsl(var(--accent-tag))] bg-[hsl(var(--accent-tag))/0.1] px-1.5 py-0.5 rounded font-mono"
                                >
                                  #{t}
                                </span>
                              ))}

                              {note.people.map((p) => (
                                <span
                                  key={p}
                                  className="inline-flex items-center text-[hsl(var(--accent-mention))] bg-[hsl(var(--accent-mention))/0.1] px-1.5 py-0.5 rounded font-mono"
                                >
                                  @{p}
                                </span>
                              ))}
                            </div>

                            {/* Drop hint indicator when item dragged over */}
                            {isCardOver && (
                              <div className="absolute inset-0 bg-emerald-500/10 backdrop-blur-2xs rounded-lg flex items-center justify-center pointer-events-none border-2 border-dashed border-emerald-500">
                                <span className="text-xs font-bold text-emerald-600 bg-card px-2.5 py-1 rounded-md shadow-md">
                                  + Not İçeriğine Ekle
                                </span>
                              </div>
                            )}
                          </div>
                        );
                      })
                    )}
                  </div>

                  {/* Quick Add Button at bottom of column */}
                  <div className="p-2 border-t border-border/60 bg-muted/20">
                    <button
                      type="button"
                      onClick={() => {
                        setTargetColIdForNewNote(col.column_id);
                        setNewNoteModalOpen(true);
                      }}
                      className="w-full py-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-background rounded-md border border-dashed border-border/80 transition-colors flex items-center justify-center gap-1 cursor-pointer font-medium"
                    >
                      <Plus className="w-3 h-3" /> Yeni Kart Ekle
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </main>
      </div>

      {/* Add / Edit Kanban Column Modal */}
      <Dialog open={colModalOpen} onOpenChange={setColModalOpen}>
        <DialogContent className="sm:max-w-md bg-card border-border">
          <DialogHeader>
            <DialogTitle className="font-serif text-lg flex items-center gap-2">
              <KanbanIcon className="w-5 h-5 text-primary" />
              <span>{editingCol ? "Sütunu Düzenle" : "Yeni Kanban Sütunu Ekle"}</span>
            </DialogTitle>
          </DialogHeader>

          <form onSubmit={handleSaveColumn} className="space-y-4 pt-2">
            <div>
              <label className="block text-xs font-medium text-foreground mb-1">
                Sütun Başlığı *
              </label>
              <input
                type="text"
                value={colName}
                onChange={(e) => setColName(e.target.value)}
                placeholder="Örn: Yapılacaklar, Test Ediliyor, Tamamlandı..."
                className="w-full h-9 px-3 text-xs bg-background rounded-md border border-border text-foreground placeholder:text-muted-foreground focus:outline-hidden focus:border-primary"
                required
                autoFocus
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-foreground mb-1.5 flex items-center gap-1">
                <Palette className="w-3.5 h-3.5 text-primary" />
                <span>Sütun Rengi</span>
              </label>
              <div className="flex items-center gap-2">
                {COLOR_PALETTE.map((color) => (
                  <button
                    key={color}
                    type="button"
                    onClick={() => setColColor(color)}
                    className={`w-7 h-7 rounded-full transition-transform cursor-pointer border-2 ${
                      colColor === color ? "scale-115 border-foreground" : "border-transparent"
                    }`}
                    style={{ backgroundColor: color }}
                  />
                ))}
              </div>
            </div>

            <DialogFooter className="pt-2">
              <button
                type="button"
                onClick={() => setColModalOpen(false)}
                className="px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground font-medium rounded-md hover:bg-muted cursor-pointer"
              >
                İptal
              </button>
              <button
                type="submit"
                className="px-4 py-1.5 text-xs bg-primary text-primary-foreground font-semibold rounded-md hover:opacity-90 cursor-pointer shadow-2xs"
              >
                {editingCol ? "Değişiklikleri Kaydet" : "Sütunu Oluştur"}
              </button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* New Card Modal for Specific Column */}
      <Dialog open={newNoteModalOpen} onOpenChange={setNewNoteModalOpen}>
        <DialogContent className="sm:max-w-lg bg-card border-border">
          <DialogHeader>
            <DialogTitle className="font-serif text-lg flex items-center gap-2">
              <Plus className="w-5 h-5 text-primary" />
              <span>
                "
                {columns.find((c) => c.column_id === targetColIdForNewNote)?.name || "Kanban"}"
                Sütununa Kart Ekle
              </span>
            </DialogTitle>
          </DialogHeader>

          <form onSubmit={handleCreateNoteInColumn} className="space-y-3.5 pt-2">
            <div>
              <label className="block text-xs font-medium text-foreground mb-1">
                Kart / Not Başlığı
              </label>
              <input
                type="text"
                value={newNoteTitle}
                onChange={(e) => setNewNoteTitle(e.target.value)}
                placeholder="Örn: Frontend refaktör çalışması..."
                className="w-full h-9 px-3 text-xs bg-background rounded-md border border-border text-foreground placeholder:text-muted-foreground focus:outline-hidden focus:border-primary"
                autoFocus
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-foreground mb-1">
                İçerik (Metin, #etiket veya @kişi ekleyebilirsiniz)
              </label>
              <textarea
                value={newNoteContent}
                onChange={(e) => setNewNoteContent(e.target.value)}
                placeholder="Not içeriğini buraya yazın..."
                rows={4}
                className="w-full p-3 text-xs bg-background rounded-md border border-border text-foreground placeholder:text-muted-foreground focus:outline-hidden focus:border-primary font-serif resize-none"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              {/* Note Type Selection */}
              <div>
                <label className="block text-xs font-medium text-foreground mb-1">
                  Not Tipi
                </label>
                <div className="w-full h-9 px-3 text-xs bg-secondary/50 rounded-md border border-border text-foreground flex items-center gap-2 font-medium">
                  <span className="w-2.5 h-2.5 rounded-full bg-purple-500 shrink-0" />
                  <span>Kart (Kanban Tipi)</span>
                </div>
              </div>

              {/* Location Selection */}
              <div>
                <label className="block text-xs font-medium text-foreground mb-1">
                  Lokasyon
                </label>
                <select
                  value={newNoteLocationId}
                  onChange={(e) => setNewNoteLocationId(e.target.value)}
                  className="w-full h-9 px-2.5 text-xs bg-background rounded-md border border-border text-foreground cursor-pointer"
                >
                  <option value="">Lokasyon Yok</option>
                  {locations.map((loc) => (
                    <option key={loc.location_id} value={loc.location_id}>
                      📍 {loc.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <DialogFooter className="pt-2">
              <button
                type="button"
                onClick={() => setNewNoteModalOpen(false)}
                className="px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground font-medium rounded-md hover:bg-muted cursor-pointer"
              >
                İptal
              </button>
              <button
                type="submit"
                className="px-4 py-1.5 text-xs bg-primary text-primary-foreground font-semibold rounded-md hover:opacity-90 cursor-pointer shadow-2xs"
              >
                Kartı Kaydet
              </button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
