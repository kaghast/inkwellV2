import React, { useEffect, useState, useMemo, useCallback } from "react";
import { useParams, useNavigate, Link, useSearchParams } from "react-router-dom";
import api, { formatApiError } from "@/lib/api";
import TopBar from "@/components/TopBar";
import MarkdownEditor from "@/components/MarkdownEditor";
import MarkdownView, { toggleTaskInMarkdown } from "@/components/MarkdownView";
import MiniMap from "@/components/MiniMap";
import LocationPicker from "@/components/LocationPicker";
import { CustomFieldsForm, CustomFieldsView } from "@/components/CustomFieldsRenderer";
import { formatDisplayDatetime, toDateTimeLocal } from "@/lib/datetime";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  ArrowLeft,
  MapPin,
  Pencil,
  Save,
  Trash2,
  X,
  Boxes,
  Calendar,
  Layers,
  Pin,
  Copy,
  Check,
  Link as LinkIcon,
  Network,
  Kanban,
  Link2,
  ArrowUpRight,
  FileText,
  PenTool,
  ListTree,
  Archive,
  ArchiveRestore,
} from "lucide-react";
import { toast } from "sonner";
import type { Note, LocationItem, NoteType, Category } from "@/types";
import DrawingEditor from "@/components/drawing/DrawingEditor";
import DrawingViewer from "@/components/drawing/DrawingViewer";
import OutlineEditor from "@/components/outline/OutlineEditor";
import OutlineViewer from "@/components/outline/OutlineViewer";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

export type ContentMode = "markdown" | "drawing" | "outline";

function detectContentMode(content: string, customFields?: Record<string, any>): ContentMode {
  if (customFields?.content_mode) {
    return customFields.content_mode as ContentMode;
  }
  if (/```drawing\s*[\s\S]*?```/.test(content)) {
    return "drawing";
  }
  const lines = (content || "").trim().split("\n").filter((l) => l.trim().length > 0);
  if (lines.length >= 2 && lines.every((l) => /^([ \t]*[-*+]|\d+\.)/.test(l))) {
    return "outline";
  }
  return "markdown";
}

export default function NoteDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [note, setNote] = useState<Note | null>(null);
  const [allNotes, setAllNotes] = useState<Note[]>([]);
  const [loc, setLoc] = useState<LocationItem | null>(null);
  const [noteTypes, setNoteTypes] = useState<NoteType[]>([]);
  const [editing, setEditing] = useState(searchParams.get("edit") === "true");
  const [contentMode, setContentMode] = useState<ContentMode>("markdown");
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [dateTime, setDateTime] = useState("");
  const [slug, setSlug] = useState("");
  const [locationId, setLocationId] = useState<string | null>(null);
  const [noteTypeId, setNoteTypeId] = useState<string>("type_plain");
  const [customFields, setCustomFields] = useState<Record<string, any>>({});
  const [locations, setLocations] = useState<LocationItem[]>([]);
  const [picker, setPicker] = useState(false);
  const [busy, setBusy] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);
  const [editingDateInline, setEditingDateInline] = useState(false);
  const [inlineDateVal, setInlineDateVal] = useState("");

  useEffect(() => {
    if (searchParams.get("edit") === "true") {
      setEditing(true);
    }
  }, [searchParams]);

  useEffect(() => {
    if (!id) return;
    (async () => {
      try {
        const [noteRes, locsRes, typesRes, allNotesRes] = await Promise.all([
          api.get<Note>(`/notes/${id}`),
          api.get<LocationItem[]>("/locations"),
          api.get<NoteType[]>("/note-types"),
          api.get<Note[]>("/notes"),
        ]);
        const data = noteRes.data;
        setNote(data);
        setAllNotes(Array.isArray(allNotesRes.data) ? allNotesRes.data : []);
        setTitle(data.title || "");
        setContent(data.content || "");
        setContentMode(detectContentMode(data.content || "", data.custom_fields));
        setDateTime(toDateTimeLocal(data.date));
        setInlineDateVal(toDateTimeLocal(data.date));
        setSlug(data.slug || "");
        setLocationId(data.location_id || null);
        setNoteTypeId(data.note_type_id || "type_plain");
        setCustomFields(data.custom_fields || {});
        setLocations(locsRes.data || []);
        setNoteTypes(typesRes.data || []);

        if (data.location_id) {
          const found = (locsRes.data || []).find((l) => l.location_id === data.location_id);
          setLoc(found || null);
        }
      } catch {
        toast.error("Not bulunamadı");
        navigate("/");
      }
    })();
  }, [id, navigate]);

  // Compute backlinks and referenced notes
  const relatedNotes = useMemo(() => {
    if (!note || !allNotes.length) return [];
    const currentTitle = (note.title || "").toLowerCase().trim();
    const currentSlug = (note.slug || "").toLowerCase().trim();
    const currentId = note.note_id.toLowerCase().trim();

    // 1. Backlinks: Other notes referencing this note via [[...]]
    const backlinks = allNotes.filter((other) => {
      if (other.note_id === note.note_id || !other.content) return false;
      const matches = Array.from(other.content.matchAll(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/gu));
      return matches.some((m) => {
        const target = (m[1] || "").toLowerCase().trim();
        return (
          (currentTitle && target === currentTitle) ||
          (currentSlug && target === currentSlug) ||
          target === currentId
        );
      });
    });

    // 2. Outgoing links: Notes referenced in this note's content via [[...]]
    const outgoingMatches = note.content
      ? Array.from(note.content.matchAll(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/gu))
      : [];
    const outgoingTargets = outgoingMatches.map((m) => (m[1] || "").toLowerCase().trim());

    const outgoingNotes = allNotes.filter((other) => {
      if (other.note_id === note.note_id) return false;
      const oTitle = (other.title || "").toLowerCase().trim();
      const oSlug = (other.slug || "").toLowerCase().trim();
      const oId = other.note_id.toLowerCase().trim();
      return (
        (oTitle && outgoingTargets.includes(oTitle)) ||
        (oSlug && outgoingTargets.includes(oSlug)) ||
        outgoingTargets.includes(oId)
      );
    });

    // Merge and deduplicate
    const map = new Map<string, { note: Note; isBacklink: boolean; isOutgoing: boolean }>();
    backlinks.forEach((n) => {
      map.set(n.note_id, { note: n, isBacklink: true, isOutgoing: false });
    });
    outgoingNotes.forEach((n) => {
      if (map.has(n.note_id)) {
        map.get(n.note_id)!.isOutgoing = true;
      } else {
        map.set(n.note_id, { note: n, isBacklink: false, isOutgoing: true });
      }
    });

    return Array.from(map.values());
  }, [note, allNotes]);

  const currentType = noteTypes.find(
    (nt) => nt.type_id === (editing ? noteTypeId : note?.note_type_id || "type_plain")
  );

  async function save() {
    if (!note) return;
    setBusy(true);
    try {
      const updatedFields = {
        ...customFields,
        content_mode: contentMode,
      };
      const { data } = await api.put<Note>(`/notes/${note.note_id}`, {
        title,
        content,
        date: dateTime,
        slug: slug.trim() || undefined,
        location_id: locationId,
        note_type_id: noteTypeId !== "type_plain" ? noteTypeId : null,
        custom_fields: updatedFields,
      });
      setNote(data);
      setDateTime(toDateTimeLocal(data.date));
      setInlineDateVal(toDateTimeLocal(data.date));
      setSlug(data.slug || "");
      setEditing(false);
      setContentMode(detectContentMode(data.content || "", data.custom_fields));
      setLoc(locations.find((l) => l.location_id === data.location_id) || null);
      toast.success("Not kaydedildi");

      if (data.slug && data.slug !== id) {
        navigate(`/note/${data.slug}`, { replace: true });
      }
    } catch {
      toast.error("Kayıt başarısız");
    } finally {
      setBusy(false);
    }
  }

  async function handleTogglePin() {
    if (!note) return;
    try {
      await api.patch(`/notes/${note.note_id}/pin`);
      const newPinned = !note.pinned;
      setNote((prev) => (prev ? { ...prev, pinned: newPinned } : prev));
      toast.success(newPinned ? "Not panoya sabitlendi" : "Sabitleme kaldırıldı");
    } catch {
      toast.error("Sabitleme durumu değiştirilemedi");
    }
  }

  async function handleToggleArchive() {
    if (!note) return;
    try {
      const id = encodeURIComponent(note.note_id);
      let res;
      try {
        res = await api.patch(`/notes/${id}/archive`);
      } catch (err: any) {
        if (err?.response?.status === 404 || err?.response?.status === 405) {
          res = await api.post(`/notes/${id}/archive`);
        } else {
          throw err;
        }
      }
      const nextArchived = Boolean(res?.data?.archived);
      setNote((prev) => (prev ? { ...prev, archived: nextArchived } : prev));
      if (editing) setEditing(false);
      toast.success(nextArchived ? "Not arşivlendi" : "Not arşivden çıkarıldı");
    } catch (err: any) {
      toast.error(err?.response?.data?.detail || "Arşivleme işlemi başarısız");
    }
  }

  async function handleSaveInlineDate() {
    if (!note || !inlineDateVal) return;
    try {
      const { data } = await api.put<Note>(`/notes/${note.note_id}`, {
        date: inlineDateVal,
      });
      setNote(data);
      setDateTime(toDateTimeLocal(data.date));
      setEditingDateInline(false);
      toast.success("Tarih güncellendi");
    } catch {
      toast.error("Tarih güncellenemedi");
    }
  }

  async function copyNoteUrl() {
    if (!note) return;
    const noteSlugOrId = note.slug || note.note_id;
    const fullUrl = `${window.location.origin}/note/${noteSlugOrId}`;
    try {
      await navigator.clipboard.writeText(fullUrl);
      setCopiedLink(true);
      toast.success("Not bağlantısı kopyalandı");
      setTimeout(() => setCopiedLink(false), 2500);
    } catch {
      toast.error("Bağlantı kopyalanamadı");
    }
  }

  async function deleteNote() {
    if (!note) return;
    await api.delete(`/notes/${note.note_id}`);
    toast.success("Not silindi");
    navigate("/");
  }

  async function saveNewLocation({ name, lat, lng }: { name: string; lat: number; lng: number }) {
    try {
      const { data } = await api.post<LocationItem>("/locations", { name, lat, lng });
      setLocations((prev) => [data, ...prev]);
      setLocationId(data.location_id);
      setLoc(data);
      toast.success("Konum eklendi");
    } catch (err: any) {
      toast.error(formatApiError(err) || "Konum kaydedilemedi");
    }
  }

  if (!note) {
    return (
      <div className="paper min-h-screen">
        <TopBar />
      </div>
    );
  }

  const formattedDate = formatDisplayDatetime(note.date, true);

  return (
    <div className="paper min-h-screen flex flex-col">
      <TopBar />
      <main className="flex-1 max-w-3xl w-full mx-auto px-5 py-8" data-testid="note-detail">
        {/* Navigation & Actions Top Bar */}
        <div className="flex items-center justify-between gap-2 mb-6">
          <button
            className="flex items-center gap-1.5 text-xs uppercase tracking-[0.2em] text-muted-foreground hover:text-foreground cursor-pointer transition-colors"
            onClick={() => navigate(-1)}
            data-testid="note-back-btn"
          >
            <ArrowLeft className="w-3.5 h-3.5" strokeWidth={1.25} /> Geri
          </button>

          <div className="flex items-center gap-2">
            {/* Direct Slug Share Button */}
            <button
              onClick={copyNoteUrl}
              className="inline-flex items-center gap-1 text-xs font-mono px-2 py-1 rounded border border-border/80 bg-secondary/60 hover:bg-secondary text-foreground hover:border-foreground/40 transition-colors cursor-pointer"
              title="Notun slug bağlantısını kopyala"
              data-testid="copy-slug-btn"
            >
              {copiedLink ? (
                <>
                  <Check className="w-3 h-3 text-emerald-500" />
                  <span className="text-emerald-500">Kopyalandı</span>
                </>
              ) : (
                <>
                  <LinkIcon className="w-3 h-3 text-muted-foreground" />
                  <span className="truncate max-w-[140px]">/{note.slug || note.note_id}</span>
                  <Copy className="w-3 h-3 ml-0.5 text-muted-foreground" />
                </>
              )}
            </button>
          </div>
        </div>

        {/* Archived Alert Banner */}
        {note.archived && (
          <div className="mb-4 p-3 rounded-lg border border-amber-500/40 bg-amber-500/10 flex items-center justify-between gap-3 text-xs text-amber-800 dark:text-amber-300">
            <div className="flex items-center gap-2">
              <Archive className="w-4 h-4 text-amber-500 shrink-0" />
              <span>Bu not arşivlendi. Notu düzenlemek veya silmek için lütfen önce arşivden çıkarın.</span>
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={handleToggleArchive}
              className="h-7 text-xs border-amber-500/40 text-amber-800 dark:text-amber-300 hover:bg-amber-500/20 cursor-pointer shrink-0"
            >
              <ArchiveRestore className="w-3.5 h-3.5 mr-1" /> Arşivden Çıkar
            </Button>
          </div>
        )}

        {/* Metadata Header (Date, Category, Note Type) */}
        <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
          {/* Editable Date in read mode */}
          {editingDateInline ? (
            <div className="inline-flex items-center gap-1 bg-secondary border border-border rounded px-2 py-1">
              <input
                type="datetime-local"
                value={inlineDateVal}
                onChange={(e) => setInlineDateVal(e.target.value)}
                className="bg-transparent text-xs text-foreground font-mono outline-none cursor-pointer"
                autoFocus
              />
              <button
                type="button"
                onClick={handleSaveInlineDate}
                className="text-emerald-600 hover:text-emerald-500 p-0.5 cursor-pointer"
                title="Tarihi Kaydet"
              >
                <Check className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={() => {
                  setEditingDateInline(false);
                  setInlineDateVal(toDateTimeLocal(note.date));
                }}
                className="text-muted-foreground hover:text-foreground p-0.5 cursor-pointer"
                title="İptal"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          ) : (
            <button
              onClick={() => {
                if (note.archived) {
                  toast.error("Arşivlenmiş notların tarihi düzenlenemez");
                  return;
                }
                setInlineDateVal(toDateTimeLocal(note.date));
                setEditingDateInline(true);
              }}
              disabled={Boolean(note.archived)}
              className={`inline-flex items-center gap-1.5 text-xs font-mono px-2 py-1 rounded transition-colors ${
                note.archived
                  ? "opacity-75 cursor-default text-muted-foreground"
                  : "text-muted-foreground hover:text-foreground hover:bg-secondary/60 cursor-pointer"
              }`}
              title={note.archived ? "Arşivlenmiş not (tarih düzenlenemez)" : "Tarih ve saati düzenlemek için tıklayın"}
              data-testid="detail-datetime-btn"
            >
              <Calendar className="w-3.5 h-3.5 text-muted-foreground" />
              <span>{formattedDate}</span>
              {!note.archived && <Pencil className="w-2.5 h-2.5 opacity-40 hover:opacity-100" />}
            </button>
          )}

          <div className="flex items-center gap-2">
            {/* Archived Badge in View Mode */}
            {note.archived && (
              <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold border border-amber-500/40 text-amber-700 dark:text-amber-300 bg-amber-500/10 shadow-2xs">
                <Archive className="w-3.5 h-3.5" />
                <span>Arşivlendi</span>
              </div>
            )}

            {/* Note Type Badge in View Mode */}
            {!editing &&
              currentType &&
              currentType.type_id !== "type_plain" &&
              currentType.type_id !== "default" && (
                <div
                  className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold border shadow-2xs"
                  style={{
                    color: currentType.color || "#3b82f6",
                    borderColor: `${currentType.color || "#3b82f6"}40`,
                    backgroundColor: `${currentType.color || "#3b82f6"}15`,
                  }}
                >
                  <Boxes className="w-3.5 h-3.5" />
                  <span>{currentType.name}</span>
                </div>
              )}
          </div>
        </div>

        {editing ? (
          <div className="space-y-4">
            {/* Note Type & Date Selectors in Edit Mode */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 p-2.5 rounded-md bg-secondary/50 border border-border/80 text-xs">
              {/* Note Type */}
              <div className="flex items-center gap-1.5">
                <Boxes className="w-4 h-4 text-primary shrink-0" />
                <select
                  value={noteTypeId}
                  onChange={(e) => setNoteTypeId(e.target.value)}
                  className="w-full bg-background border border-border text-xs rounded px-2 py-1 text-foreground cursor-pointer font-medium"
                  data-testid="edit-note-type-select"
                >
                  <option value="type_plain">Düz Metin (Varsayılan)</option>
                  {noteTypes
                    .filter(
                      (nt) =>
                        nt.type_id !== "type_plain" &&
                        nt.type_id !== "default"
                    )
                    .map((nt) => (
                      <option key={nt.type_id} value={nt.type_id}>
                        {nt.name}
                      </option>
                    ))}
                </select>
              </div>

              {/* DateTime */}
              <div className="flex items-center gap-1.5">
                <Calendar className="w-4 h-4 text-muted-foreground shrink-0" />
                <input
                  type="datetime-local"
                  value={dateTime}
                  onChange={(e) => setDateTime(e.target.value)}
                  className="w-full bg-background border border-border text-xs rounded px-2 py-1 text-foreground font-mono cursor-pointer"
                  data-testid="edit-datetime-input"
                />
              </div>
            </div>

            {/* Title & Slug */}
            <div className="space-y-2">
              <Input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Başlık"
                data-testid="edit-title-input"
                className="font-serif text-3xl border-0 px-0 focus-visible:ring-0 shadow-none"
              />

              <div className="flex items-center gap-2 text-xs font-mono text-muted-foreground">
                <span className="shrink-0">Slug adresi:</span>
                <input
                  type="text"
                  value={slug}
                  onChange={(e) => setSlug(e.target.value)}
                  placeholder="ornek-not-slug"
                  className="flex-1 bg-secondary/60 border border-border px-2 py-0.5 rounded text-foreground text-xs font-mono"
                  data-testid="edit-slug-input"
                />
              </div>
            </div>

            {/* Custom fields form if note type has parameters */}
            {currentType && currentType.fields && currentType.fields.length > 0 && (
              <CustomFieldsForm
                fields={currentType.fields}
                values={customFields}
                onChange={(fieldId, val) =>
                  setCustomFields((prev) => ({ ...prev, [fieldId]: val }))
                }
                disabled={busy}
              />
            )}

            {/* 3-Mode Content Switcher in Edit Mode */}
            <div className="flex items-center justify-between gap-2 p-1.5 rounded-lg bg-secondary/60 border border-border/80 flex-wrap">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-foreground px-1.5">
                <span>İçerik Düzenleme Modu:</span>
              </div>
              <div className="flex items-center gap-1 bg-background p-0.5 rounded-md border border-border">
                <button
                  type="button"
                  onClick={() => {
                    setContentMode("markdown");
                    setCustomFields((prev) => ({ ...prev, content_mode: "markdown" }));
                  }}
                  className={`flex items-center gap-1.5 px-3 py-1 rounded text-xs font-medium transition-all cursor-pointer ${
                    contentMode === "markdown"
                      ? "bg-primary text-primary-foreground font-bold shadow-xs"
                      : "hover:bg-muted text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <FileText className="w-3.5 h-3.5" /> Metin (Markdown)
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setContentMode("drawing");
                    setCustomFields((prev) => ({ ...prev, content_mode: "drawing" }));
                    if (!/```drawing/.test(content)) {
                      setContent("```drawing\n{\n  \"version\": 1,\n  \"elements\": [],\n  \"gridMode\": \"dots\"\n}\n```");
                    }
                  }}
                  className={`flex items-center gap-1.5 px-3 py-1 rounded text-xs font-medium transition-all cursor-pointer ${
                    contentMode === "drawing"
                      ? "bg-primary text-primary-foreground font-bold shadow-xs"
                      : "hover:bg-muted text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <PenTool className="w-3.5 h-3.5" /> Çizim & Şema (Canvas)
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setContentMode("outline");
                    setCustomFields((prev) => ({ ...prev, content_mode: "outline" }));
                    if (!content.trim() || /```drawing/.test(content)) {
                      setContent("- [ ] İlk ana madde\n  - [ ] Alt görev veya not\n- [ ] İkinci ana madde");
                    }
                  }}
                  className={`flex items-center gap-1.5 px-3 py-1 rounded text-xs font-medium transition-all cursor-pointer ${
                    contentMode === "outline"
                      ? "bg-primary text-primary-foreground font-bold shadow-xs"
                      : "hover:bg-muted text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <ListTree className="w-3.5 h-3.5" /> Hiyerarşik Outline
                </button>
              </div>
            </div>

            {/* Active Editor */}
            {contentMode === "drawing" ? (
              <DrawingEditor initialContent={content} onChange={setContent} height={520} />
            ) : contentMode === "outline" ? (
              <OutlineEditor initialContent={content} onChange={setContent} />
            ) : (
              <MarkdownEditor value={content} onChange={setContent} />
            )}

            <div className="flex items-center justify-between flex-wrap gap-2 pt-2 border-t border-border/60">
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPicker(true)}
                  data-testid="edit-location-btn"
                  className="rounded-sm"
                >
                  <MapPin className="w-3.5 h-3.5 mr-1.5" strokeWidth={1.25} />
                  {loc ? loc.name : "Konum ekle"}
                </Button>
                {locations.length > 0 && (
                  <select
                    value={locationId || ""}
                    onChange={(e) => {
                      setLocationId(e.target.value || null);
                      setLoc(locations.find((l) => l.location_id === e.target.value) || null);
                    }}
                    className="bg-secondary border border-border text-xs rounded-sm px-2 py-1 font-mono"
                  >
                    <option value="">— konum yok —</option>
                    {locations.map((l) => (
                      <option key={l.location_id} value={l.location_id}>
                        {l.name}
                      </option>
                    ))}
                  </select>
                )}
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="ghost"
                  onClick={() => {
                    setEditing(false);
                    setTitle(note.title);
                    setContent(note.content);
                    setContentMode(detectContentMode(note.content, note.custom_fields));
                    setDateTime(toDateTimeLocal(note.date));
                    setSlug(note.slug || "");
                    setNoteTypeId(note.note_type_id || "type_plain");
                    setCustomFields(note.custom_fields || {});
                  }}
                >
                  <X className="w-3.5 h-3.5 mr-1.5" /> İptal
                </Button>
                <Button
                  onClick={save}
                  disabled={busy}
                  data-testid="save-edit-btn"
                  className="bg-foreground text-background hover:bg-foreground/90 rounded-sm cursor-pointer"
                >
                  <Save className="w-3.5 h-3.5 mr-1.5" /> {busy ? "Kaydediliyor..." : "Kaydet"}
                </Button>
              </div>
            </div>
          </div>
        ) : (
          <>
            <div className="flex items-start justify-between gap-4 mb-4">
              <h1
                className="font-serif text-4xl sm:text-5xl tracking-tight leading-[1.05]"
                data-testid="note-title"
              >
                {note.title || <span className="text-muted-foreground">Başlıksız Not</span>}
              </h1>
              <div className="flex items-center gap-1 shrink-0">
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={handleTogglePin}
                  title={note.pinned ? "Sabitlemeyi Kaldır" : "Panoya Sabitle"}
                  data-testid="pin-note-btn"
                >
                  <Pin
                    className={`w-4 h-4 ${note.pinned ? "fill-primary text-primary" : "text-muted-foreground"}`}
                    strokeWidth={1.5}
                  />
                </Button>

                {/* Archive / Unarchive Button */}
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={handleToggleArchive}
                  title={note.archived ? "Arşivden Çıkar" : "Arşivle"}
                  data-testid="archive-note-btn"
                  className={note.archived ? "text-amber-500 hover:text-amber-600 hover:bg-amber-500/10" : "text-muted-foreground hover:text-foreground"}
                >
                  {note.archived ? (
                    <ArchiveRestore className="w-4 h-4" strokeWidth={1.5} />
                  ) : (
                    <Archive className="w-4 h-4" strokeWidth={1.5} />
                  )}
                </Button>

                {/* Edit & Delete are disabled / hidden when archived */}
                {!note.archived && (
                  <>
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={() => setEditing(true)}
                      title="Düzenle"
                      data-testid="edit-note-btn"
                    >
                      <Pencil className="w-4 h-4" strokeWidth={1.25} />
                    </Button>
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="text-muted-foreground hover:text-destructive"
                          title="Sil"
                          data-testid="delete-note-btn"
                        >
                          <Trash2 className="w-4 h-4" strokeWidth={1.25} />
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent className="bg-card border-border rounded-sm">
                        <AlertDialogHeader>
                          <AlertDialogTitle className="font-serif">Notu sil?</AlertDialogTitle>
                          <AlertDialogDescription>Bu işlem geri alınamaz.</AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>İptal</AlertDialogCancel>
                          <AlertDialogAction onClick={deleteNote} className="bg-destructive">
                            Sil
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </>
                )}
              </div>
            </div>

            {/* Custom fields view in read mode */}
            {currentType && currentType.fields && currentType.fields.length > 0 && (
              <CustomFieldsView fields={currentType.fields} values={note.custom_fields} />
            )}

            {loc && (
              <div className="mb-6">
                <Link
                  to={`/location/${loc.location_id}`}
                  className="inline-flex items-center gap-1.5 text-xs uppercase tracking-[0.2em] text-muted-foreground hover:text-foreground mb-2"
                >
                  <MapPin className="w-3 h-3" strokeWidth={1.5} /> {loc.name}
                </Link>
                <MiniMap lat={loc.lat} lng={loc.lng} height={180} />
              </div>
            )}

            {/* Content View Modes */}
            {contentMode === "drawing" || /```drawing\s*[\s\S]*?```/.test(note.content) ? (
              <DrawingViewer
                content={note.content}
                onEdit={() => {
                  setContentMode("drawing");
                  setEditing(true);
                }}
              />
            ) : contentMode === "outline" ? (
              <OutlineViewer
                content={note.content}
                onEdit={() => {
                  setContentMode("outline");
                  setEditing(true);
                }}
                onUpdateContent={async (newContent) => {
                  try {
                    const { data } = await api.put<Note>(`/notes/${note.note_id}`, {
                      title: note.title,
                      content: newContent,
                      date: note.date,
                      location_id: note.location_id,
                      note_type_id: note.note_type_id,
                      custom_fields: note.custom_fields,
                    });
                    setNote(data);
                    setContent(newContent);
                  } catch {
                    toast.error("Güncellenemedi");
                  }
                }}
              />
            ) : (
              <MarkdownView
                content={note.content}
                onTaskToggle={async (idx, checked) => {
                  const newContent = toggleTaskInMarkdown(note.content, idx, checked);
                  try {
                    const { data } = await api.put<Note>(`/notes/${note.note_id}`, {
                      title: note.title,
                      content: newContent,
                      date: note.date,
                      location_id: note.location_id,
                      note_type_id: note.note_type_id,
                      custom_fields: note.custom_fields,
                    });
                    setNote(data);
                    setContent(newContent);
                  } catch {
                    toast.error("Güncellenemedi");
                  }
                }}
              />
            )}

            {/* Tags and People */}
            {(note.tags?.length > 0 || note.people?.length > 0) && (
              <div className="flex flex-wrap items-center gap-1.5 mt-8 pt-4 border-t border-border/40">
                {note.tags?.map((t) => (
                  <Link
                    key={t}
                    to={`/tag/${encodeURIComponent(t)}`}
                    className="text-xs font-mono px-2.5 py-0.5 rounded-full bg-sky-500/10 text-sky-600 dark:text-sky-400 hover:bg-sky-500/20 transition-colors"
                  >
                    #{t}
                  </Link>
                ))}
                {note.people?.map((p) => (
                  <Link
                    key={p}
                    to={`/person/${encodeURIComponent(p)}`}
                    className="text-xs font-mono px-2.5 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/20 transition-colors"
                  >
                    @{p}
                  </Link>
                ))}
              </div>
            )}

            {/* Related Notes & Backlinks Section */}
            <div className="mt-10 pt-6 border-t border-border/60 space-y-3.5" data-testid="related-notes-section">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Network className="w-4 h-4 text-purple-600 dark:text-purple-400" />
                  <h3 className="font-serif text-base font-bold text-foreground">
                    {note.note_type_id === "type_card"
                      ? "İlişkili Notlar & Kart Referansları"
                      : "İlişkili Notlar & Bağlantılar"}
                  </h3>
                  <span className="text-[11px] font-mono font-medium px-2 py-0.5 rounded-full bg-purple-500/10 text-purple-600 dark:text-purple-400">
                    {relatedNotes.length} Referans
                  </span>
                </div>
              </div>

              {relatedNotes.length === 0 ? (
                <div className="p-5 rounded-lg border border-dashed border-border/80 bg-muted/20 text-xs text-muted-foreground text-center space-y-1.5">
                  <p className="font-medium text-foreground">Henüz referans verilmiş bir not bulunmuyor</p>
                  <p className="text-[11px] text-muted-foreground max-w-md mx-auto">
                    Herhangi bir notun içinde <code className="px-1.5 py-0.5 bg-muted rounded border border-border">[[{note.title || "Bu Not"}]]</code> yazarak veya bu not içerisinden <code className="px-1.5 py-0.5 bg-muted rounded border border-border">[[</code> ile diğer notları seçip ilişkilendirebilirsiniz.
                  </p>
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {relatedNotes.map(({ note: rNote, isBacklink, isOutgoing }) => {
                    const isCard = rNote.note_type_id === "type_card";
                    const detailPath = rNote.slug ? `/${rNote.slug}` : `/note/${rNote.note_id}`;

                    return (
                      <Link
                        key={rNote.note_id}
                        to={detailPath}
                        className="p-3.5 rounded-lg border border-border hover:border-purple-500/50 bg-card hover:bg-muted/20 transition-all shadow-2xs group flex flex-col justify-between gap-2.5"
                      >
                        <div>
                          <div className="flex items-center justify-between gap-2 mb-1.5">
                            <span className="font-serif font-bold text-sm text-foreground group-hover:text-purple-600 dark:group-hover:text-purple-400 transition-colors truncate">
                              {rNote.title || "Başlıksız Not"}
                            </span>
                            <div className="flex items-center gap-1 shrink-0">
                              {isCard && (
                                <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-purple-500/10 text-purple-600 dark:text-purple-400 flex items-center gap-1">
                                  <Kanban className="w-3 h-3" /> Kart
                                </span>
                              )}
                              <ArrowUpRight className="w-3.5 h-3.5 text-muted-foreground opacity-40 group-hover:opacity-100 group-hover:text-purple-600 transition-all" />
                            </div>
                          </div>

                          <p className="text-xs text-muted-foreground line-clamp-2 leading-relaxed">
                            {rNote.content?.replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, "$1") || "İçerik yok..."}
                          </p>
                        </div>

                        <div className="flex items-center justify-between pt-2 border-t border-border/40 text-[10px] text-muted-foreground font-mono">
                          <div className="flex items-center gap-1.5">
                            {isBacklink && (
                              <span
                                className="text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 px-1.5 py-0.5 rounded font-sans font-medium"
                                title="Bu nota referans veren not"
                              >
                                ← Bu nota referans verdi
                              </span>
                            )}
                            {isOutgoing && !isBacklink && (
                              <span
                                className="text-blue-600 dark:text-blue-400 bg-blue-500/10 px-1.5 py-0.5 rounded font-sans font-medium"
                                title="Bu notun bağlantı verdiği not"
                              >
                                → İçerikte bağlandı
                              </span>
                            )}
                          </div>
                        </div>
                      </Link>
                    );
                  })}
                </div>
              )}
            </div>
          </>
        )}
      </main>
      <LocationPicker open={picker} onOpenChange={setPicker} onSave={saveNewLocation} />
    </div>
  );
}
