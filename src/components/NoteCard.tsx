import React, { useState } from "react";
import { Link } from "react-router-dom";
import {
  Pin,
  Trash2,
  Edit3,
  Calendar,
  MapPin,
  CheckSquare,
  Clock,
  MoreVertical,
  Layers,
  Boxes,
  ExternalLink,
  Check,
  X,
} from "lucide-react";
import api from "@/lib/api";
import type { Note, LocationItem, Category, NoteType } from "@/types";
import MarkdownView from "@/components/MarkdownView";
import MarkdownEditor from "@/components/MarkdownEditor";
import { CustomFieldsForm, CustomFieldsView } from "@/components/CustomFieldsRenderer";
import { formatDisplayDatetime, toDateTimeLocal } from "@/lib/datetime";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { toast } from "sonner";

interface Props {
  note: Note;
  categoryMap?: Record<string, Category>;
  categories?: Category[];
  noteTypeMap?: Record<string, NoteType>;
  noteTypes?: NoteType[];
  locationMap: Record<string, LocationItem>;
  locations: LocationItem[];
  onDelete: (id: string) => void;
  onChanged: () => void;
  onLocationsChanged?: () => void;
}

export default function NoteCard({
  note,
  categoryMap = {},
  categories = [],
  noteTypeMap = {},
  noteTypes = [],
  locationMap,
  locations,
  onDelete,
  onChanged,
  onLocationsChanged,
}: Props) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(note.title);
  const [content, setContent] = useState(note.content);
  const [date, setDate] = useState(note.date);
  const [categoryId, setCategoryId] = useState<string | null>(note.category_id || null);
  const [locationId, setLocationId] = useState<string | null>(note.location_id || null);
  const [noteTypeId, setNoteTypeId] = useState<string>(note.note_type_id || "type_plain");
  const [customFields, setCustomFields] = useState<Record<string, any>>(note.custom_fields || {});
  const [saving, setSaving] = useState(false);
  const [editingDateInline, setEditingDateInline] = useState(false);
  const [inlineDateTimeVal, setInlineDateTimeVal] = useState(toDateTimeLocal(note.date));

  const loc = note.location_id ? locationMap[note.location_id] : null;
  const cat = note.category_id ? categoryMap[note.category_id] : null;
  const currentType = (editing ? noteTypeMap[noteTypeId] : noteTypeMap[note.note_type_id || "type_plain"]) ||
    noteTypes.find((nt) => nt.type_id === (editing ? noteTypeId : (note.note_type_id || "type_plain")));

  const detailPath = `/note/${note.slug || note.note_id}`;

  async function handleTogglePin() {
    try {
      await api.patch(`/notes/${note.note_id}/pin`);
      toast.success(note.pinned ? "Sabitleme kaldırıldı" : "Not panoya sabitlendi");
      onChanged();
    } catch {
      toast.error("Sabitleme işlemi başarısız");
    }
  }

  async function handleSaveEdit() {
    if (!content.trim() && !title.trim()) {
      toast.error("Not içeriği boş olamaz");
      return;
    }
    setSaving(true);
    try {
      await api.put(`/notes/${note.note_id}`, {
        title: title.trim() || undefined,
        content,
        date,
        category_id: categoryId,
        location_id: locationId,
        note_type_id: noteTypeId !== "type_plain" ? noteTypeId : null,
        custom_fields: customFields,
      });
      toast.success("Not güncellendi");
      setEditing(false);
      onChanged();
    } catch {
      toast.error("Not güncellenirken hata oluştu");
    } finally {
      setSaving(false);
    }
  }

  async function handleSaveInlineDate() {
    if (!inlineDateTimeVal) return;
    try {
      await api.put(`/notes/${note.note_id}`, {
        date: inlineDateTimeVal,
      });
      setDate(inlineDateTimeVal);
      setEditingDateInline(false);
      toast.success("Tarih güncellendi");
      onChanged();
    } catch {
      toast.error("Tarih güncellenemedi");
    }
  }

  // Check if content has task items
  const taskTotal = (note.content.match(/(^|\n)\s*- \[[ xX]\]/g) || []).length;
  const taskDone = (note.content.match(/(^|\n)\s*- \[[xX]\]/g) || []).length;

  return (
    <article
      className={`relative group rounded-xl border transition-all duration-200 bg-card p-5 ${
        note.pinned
          ? "border-primary/40 shadow-xs ring-1 ring-primary/20"
          : "border-border/70 hover:border-border hover:shadow-2xs"
      }`}
      data-testid={`note-card-${note.note_id}`}
    >
      {/* Top Header Row */}
      <div className="flex items-start justify-between gap-3 mb-2.5">
        <div className="min-w-0 flex-1">
          {editing ? (
            <div className="space-y-2 mb-2">
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Not başlığı (isteğe bağlı)"
                className="w-full font-serif text-lg font-bold bg-transparent border-b border-border focus:border-foreground outline-none pb-1 text-foreground"
                data-testid="edit-title-input"
              />

              {/* Note Type Selector in Edit Mode */}
              {noteTypes.length > 0 && (
                <div className="flex items-center gap-1.5 pt-1">
                  <Boxes className="w-3.5 h-3.5 text-primary shrink-0" />
                  <select
                    value={noteTypeId}
                    onChange={(e) => setNoteTypeId(e.target.value)}
                    className="bg-muted/70 border border-border text-xs rounded px-2 py-0.5 text-foreground cursor-pointer font-medium"
                  >
                    <option value="type_plain">Düz Metin (Varsayılan)</option>
                    {noteTypes
                      .filter((nt) => nt.type_id !== "type_plain" && nt.type_id !== "default" && !nt.is_default)
                      .map((nt) => (
                        <option key={nt.type_id} value={nt.type_id}>
                          {nt.name}
                        </option>
                      ))}
                  </select>
                </div>
              )}
            </div>
          ) : (
            <div className="flex items-center gap-2 group/title">
              <Link
                to={detailPath}
                className="hover:underline decoration-foreground/30 font-serif text-lg font-bold text-foreground leading-snug tracking-tight flex items-center gap-1.5"
                data-testid={`note-title-link-${note.note_id}`}
              >
                <span>{note.title || "Başlıksız Not"}</span>
                <ExternalLink className="w-3 h-3 text-muted-foreground opacity-0 group-hover/title:opacity-100 transition-opacity" />
              </Link>
            </div>
          )}

          {/* Date, Category, Note Type & Location metadata */}
          <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground font-mono mt-1">
            {/* Clickable / Editable Datetime */}
            {editingDateInline ? (
              <div className="inline-flex items-center gap-1 bg-secondary border border-border rounded px-1.5 py-0.5">
                <input
                  type="datetime-local"
                  value={inlineDateTimeVal}
                  onChange={(e) => setInlineDateTimeVal(e.target.value)}
                  className="bg-transparent text-xs text-foreground font-mono outline-none cursor-pointer"
                  autoFocus
                />
                <button
                  type="button"
                  onClick={handleSaveInlineDate}
                  className="text-emerald-600 hover:text-emerald-500 p-0.5 cursor-pointer"
                  title="Tarihi Kaydet"
                >
                  <Check className="w-3 h-3" />
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setEditingDateInline(false);
                    setInlineDateTimeVal(toDateTimeLocal(note.date));
                  }}
                  className="text-muted-foreground hover:text-foreground p-0.5 cursor-pointer"
                  title="İptal"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => {
                  setInlineDateTimeVal(toDateTimeLocal(note.date));
                  setEditingDateInline(true);
                }}
                className="flex items-center gap-1 hover:text-foreground hover:bg-secondary/60 px-1.5 py-0.5 rounded transition-colors cursor-pointer"
                title="Tarih ve saati düzenlemek için tıklayın"
                data-testid={`note-datetime-btn-${note.note_id}`}
              >
                <Calendar className="w-3 h-3" />
                <span>{formatDisplayDatetime(note.date) || note.date}</span>
                <Edit3 className="w-2.5 h-2.5 opacity-40 hover:opacity-100" />
              </button>
            )}

            {/* Note Type Badge */}
            {!editing && currentType && currentType.type_id !== "type_plain" && currentType.type_id !== "default" && (
              <span
                className="inline-flex items-center gap-1 font-sans font-semibold px-2 py-0.5 rounded-full text-[11px] border"
                style={{
                  color: currentType.color || "#3b82f6",
                  borderColor: `${currentType.color || "#3b82f6"}40`,
                  backgroundColor: `${currentType.color || "#3b82f6"}10`,
                }}
              >
                <Boxes className="w-3 h-3 shrink-0" />
                {currentType.name}
              </span>
            )}

            {cat && (
              <Link
                to={`/category/${cat.category_id}`}
                className="flex items-center gap-1 font-sans font-medium px-1.5 py-0.5 rounded text-[11px] border border-border/80 hover:border-foreground transition-colors"
                style={cat.color ? { color: cat.color, borderColor: `${cat.color}40`, backgroundColor: `${cat.color}10` } : undefined}
              >
                <Layers className="w-3 h-3 shrink-0" />
                {cat.name}
              </Link>
            )}

            {loc && (
              <Link
                to={`/location/${loc.location_id}`}
                className="flex items-center gap-1 text-primary hover:underline"
              >
                <MapPin className="w-3 h-3" />
                {loc.name}
              </Link>
            )}

            {taskTotal > 0 && (
              <span className="flex items-center gap-1 text-muted-foreground">
                <CheckSquare className="w-3 h-3" />
                {taskDone}/{taskTotal}
              </span>
            )}
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center gap-1 shrink-0">
          <Button
            variant="ghost"
            size="icon"
            onClick={handleTogglePin}
            className={`h-7 w-7 rounded-md cursor-pointer ${
              note.pinned
                ? "text-primary hover:text-primary/80"
                : "text-muted-foreground hover:text-foreground opacity-60 group-hover:opacity-100"
            }`}
            data-testid={`pin-btn-${note.note_id}`}
            title={note.pinned ? "Sabitlemeyi Kaldır" : "Panoya Sabitle"}
          >
            <Pin className={`w-3.5 h-3.5 ${note.pinned ? "fill-primary" : ""}`} strokeWidth={1.5} />
          </Button>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 rounded-md text-muted-foreground hover:text-foreground opacity-60 group-hover:opacity-100 cursor-pointer"
                data-testid={`note-menu-btn-${note.note_id}`}
              >
                <MoreVertical className="w-3.5 h-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-40 bg-popover border-border p-1 shadow-lg">
              <DropdownMenuItem asChild className="text-xs cursor-pointer">
                <Link to={detailPath} data-testid={`note-detail-link-${note.note_id}`}>
                  <ExternalLink className="w-3.5 h-3.5 mr-2" />
                  Detay Sayfası
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => setEditing(!editing)}
                className="text-xs cursor-pointer"
                data-testid={`note-edit-btn-${note.note_id}`}
              >
                <Edit3 className="w-3.5 h-3.5 mr-2" />
                {editing ? "Düzenlemeyi Kapat" : "Düzenle"}
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => onDelete(note.note_id)}
                className="text-xs text-destructive hover:text-destructive cursor-pointer"
                data-testid={`note-delete-btn-${note.note_id}`}
              >
                <Trash2 className="w-3.5 h-3.5 mr-2" />
                Sil
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Dynamic Custom Fields in Read Mode */}
      {!editing && currentType && currentType.fields && currentType.fields.length > 0 && (
        <CustomFieldsView fields={currentType.fields} values={note.custom_fields} />
      )}

      {/* Content Area (Viewing or Editing) */}
      {editing ? (
        <div className="space-y-3 mt-3">
          {/* Dynamic Custom Fields Form in Edit Mode */}
          {currentType && currentType.fields && currentType.fields.length > 0 && (
            <CustomFieldsForm
              fields={currentType.fields}
              values={customFields}
              onChange={(fieldId, val) =>
                setCustomFields((prev) => ({ ...prev, [fieldId]: val }))
              }
              disabled={saving}
            />
          )}

          <MarkdownEditor
            value={content}
            onChange={setContent}
            placeholder="Not içeriğini girin..."
            autoFocus
          />

          <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-border/60">
            <div className="flex items-center gap-2 flex-wrap text-xs">
              {/* Edit Date & Time */}
              <input
                type="datetime-local"
                value={toDateTimeLocal(date)}
                onChange={(e) => setDate(e.target.value)}
                className="bg-muted/70 border border-border px-2 py-1 rounded text-xs text-foreground font-mono"
                data-testid="edit-datetime-input"
              />

              {/* Edit Category */}
              {categories.length > 0 && (
                <select
                  value={categoryId || ""}
                  onChange={(e) => setCategoryId(e.target.value || null)}
                  className="bg-muted/70 border border-border px-2 py-1 rounded text-xs text-foreground"
                >
                  <option value="">— Kategori Yok —</option>
                  {categories.map((c) => (
                    <option key={c.category_id} value={c.category_id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              )}

              {/* Edit Location */}
              {locations.length > 0 && (
                <select
                  value={locationId || ""}
                  onChange={(e) => setLocationId(e.target.value || null)}
                  className="bg-muted/70 border border-border px-2 py-1 rounded text-xs text-foreground"
                >
                  <option value="">— Konum Yok —</option>
                  {locations.map((l) => (
                    <option key={l.location_id} value={l.location_id}>
                      {l.name}
                    </option>
                  ))}
                </select>
              )}
            </div>

            <div className="flex items-center gap-1.5 ml-auto">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setEditing(false);
                  setTitle(note.title);
                  setContent(note.content);
                  setDate(note.date);
                  setCategoryId(note.category_id || null);
                  setLocationId(note.location_id || null);
                  setNoteTypeId(note.note_type_id || "type_plain");
                  setCustomFields(note.custom_fields || {});
                }}
              >
                İptal
              </Button>
              <Button size="sm" onClick={handleSaveEdit} disabled={saving}>
                {saving ? "Kaydediliyor..." : "Kaydet"}
              </Button>
            </div>
          </div>
        </div>
      ) : (
        <MarkdownView content={note.content} />
      )}

      {/* Note footer: tags & people */}
      {(note.tags?.length > 0 || note.people?.length > 0) && (
        <div className="flex flex-wrap items-center gap-1.5 mt-3 pt-2.5 border-t border-border/40">
          {note.tags?.map((t) => (
            <Link
              key={t}
              to={`/tag/${encodeURIComponent(t)}`}
              className="text-[11px] font-mono px-2 py-0.5 rounded-full bg-sky-500/10 text-sky-600 dark:text-sky-400 hover:bg-sky-500/20 transition-colors"
            >
              #{t}
            </Link>
          ))}
          {note.people?.map((p) => (
            <Link
              key={p}
              to={`/person/${encodeURIComponent(p)}`}
              className="text-[11px] font-mono px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/20 transition-colors"
            >
              @{p}
            </Link>
          ))}
        </div>
      )}
    </article>
  );
}
