import React, { useEffect, useState } from "react";
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
} from "lucide-react";
import { toast } from "sonner";
import type { Note, LocationItem, NoteType, Category } from "@/types";
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

export default function NoteDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [note, setNote] = useState<Note | null>(null);
  const [loc, setLoc] = useState<LocationItem | null>(null);
  const [cat, setCat] = useState<Category | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [noteTypes, setNoteTypes] = useState<NoteType[]>([]);
  const [editing, setEditing] = useState(searchParams.get("edit") === "true");
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [dateTime, setDateTime] = useState("");
  const [slug, setSlug] = useState("");
  const [locationId, setLocationId] = useState<string | null>(null);
  const [categoryId, setCategoryId] = useState<string | null>(null);
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
        const [noteRes, locsRes, typesRes, catsRes] = await Promise.all([
          api.get<Note>(`/notes/${id}`),
          api.get<LocationItem[]>("/locations"),
          api.get<NoteType[]>("/note-types"),
          api.get<Category[]>("/categories"),
        ]);
        const data = noteRes.data;
        setNote(data);
        setTitle(data.title || "");
        setContent(data.content || "");
        setDateTime(toDateTimeLocal(data.date));
        setInlineDateVal(toDateTimeLocal(data.date));
        setSlug(data.slug || "");
        setLocationId(data.location_id || null);
        setCategoryId(data.category_id || null);
        setNoteTypeId(data.note_type_id || "type_plain");
        setCustomFields(data.custom_fields || {});
        setLocations(locsRes.data || []);
        setNoteTypes(typesRes.data || []);
        setCategories(catsRes.data || []);

        if (data.location_id) {
          const found = (locsRes.data || []).find((l) => l.location_id === data.location_id);
          setLoc(found || null);
        }
        if (data.category_id) {
          const foundCat = (catsRes.data || []).find((c) => c.category_id === data.category_id);
          setCat(foundCat || null);
        }
      } catch {
        toast.error("Not bulunamadı");
        navigate("/");
      }
    })();
  }, [id, navigate]);

  const currentType = noteTypes.find(
    (nt) => nt.type_id === (editing ? noteTypeId : note?.note_type_id || "type_plain")
  );

  async function save() {
    if (!note) return;
    setBusy(true);
    try {
      const { data } = await api.put<Note>(`/notes/${note.note_id}`, {
        title,
        content,
        date: dateTime,
        slug: slug.trim() || undefined,
        category_id: categoryId,
        location_id: locationId,
        note_type_id: noteTypeId !== "type_plain" ? noteTypeId : null,
        custom_fields: customFields,
      });
      setNote(data);
      setDateTime(toDateTimeLocal(data.date));
      setInlineDateVal(toDateTimeLocal(data.date));
      setSlug(data.slug || "");
      setEditing(false);
      setLoc(locations.find((l) => l.location_id === data.location_id) || null);
      setCat(categories.find((c) => c.category_id === data.category_id) || null);
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
                setInlineDateVal(toDateTimeLocal(note.date));
                setEditingDateInline(true);
              }}
              className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground font-mono hover:bg-secondary/60 px-2 py-1 rounded transition-colors cursor-pointer"
              title="Tarih ve saati düzenlemek için tıklayın"
              data-testid="detail-datetime-btn"
            >
              <Calendar className="w-3.5 h-3.5 text-muted-foreground" />
              <span>{formattedDate}</span>
              <Pencil className="w-2.5 h-2.5 opacity-40 hover:opacity-100" />
            </button>
          )}

          <div className="flex items-center gap-2">
            {/* Category Badge */}
            {cat && (
              <Link
                to={`/category/${cat.category_id}`}
                className="inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded border"
                style={
                  cat.color
                    ? {
                        color: cat.color,
                        borderColor: `${cat.color}40`,
                        backgroundColor: `${cat.color}15`,
                      }
                    : undefined
                }
              >
                <Layers className="w-3 h-3" />
                <span>{cat.name}</span>
              </Link>
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
            {/* Note Type, Category & Date Selectors in Edit Mode */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 p-2.5 rounded-md bg-secondary/50 border border-border/80 text-xs">
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
                        nt.type_id !== "default" &&
                        !nt.is_default
                    )
                    .map((nt) => (
                      <option key={nt.type_id} value={nt.type_id}>
                        {nt.name}
                      </option>
                    ))}
                </select>
              </div>

              {/* Category */}
              <div className="flex items-center gap-1.5">
                <Layers className="w-4 h-4 text-indigo-500 shrink-0" />
                <select
                  value={categoryId || ""}
                  onChange={(e) => setCategoryId(e.target.value || null)}
                  className="w-full bg-background border border-border text-xs rounded px-2 py-1 text-foreground cursor-pointer"
                >
                  <option value="">— Kategori Yok —</option>
                  {categories.map((c) => (
                    <option key={c.category_id} value={c.category_id}>
                      {c.name}
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

            <MarkdownEditor value={content} onChange={setContent} />

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
                    setDateTime(toDateTimeLocal(note.date));
                    setSlug(note.slug || "");
                    setNoteTypeId(note.note_type_id || "type_plain");
                    setCategoryId(note.category_id || null);
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
                } catch {
                  toast.error("Güncellenemedi");
                }
              }}
            />

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
          </>
        )}
      </main>
      <LocationPicker open={picker} onOpenChange={setPicker} onSave={saveNewLocation} />
    </div>
  );
}
