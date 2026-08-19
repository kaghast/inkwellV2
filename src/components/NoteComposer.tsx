import React, { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MapPin, Plus, X, Layers, Boxes, Calendar } from "lucide-react";
import MarkdownEditor from "@/components/MarkdownEditor";
import LocationPicker from "@/components/LocationPicker";
import { CustomFieldsForm } from "@/components/CustomFieldsRenderer";
import api, { formatApiError } from "@/lib/api";
import { toDateTimeLocal } from "@/lib/datetime";
import { toast } from "sonner";
import type { Note, LocationItem, Category, NoteType } from "@/types";

interface Props {
  defaultDate: string;
  defaultLocationId?: string;
  locations: LocationItem[];
  categories?: Category[];
  noteTypes?: NoteType[];
  onCreated: (n: Note) => void;
  onLocationsChanged?: () => void;
}

export default function NoteComposer({
  defaultDate,
  defaultLocationId,
  locations,
  categories = [],
  noteTypes: initialNoteTypes,
  onCreated,
  onLocationsChanged,
}: Props) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [noteDateTime, setNoteDateTime] = useState(toDateTimeLocal(defaultDate));
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [locationId, setLocationId] = useState<string | null>(defaultLocationId || null);
  const [noteTypes, setNoteTypes] = useState<NoteType[]>(initialNoteTypes || []);
  const [noteTypeId, setNoteTypeId] = useState<string>("type_plain");
  const [customFields, setCustomFields] = useState<Record<string, any>>({});
  const [locationDialog, setLocationDialog] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setNoteDateTime(toDateTimeLocal(defaultDate));
  }, [defaultDate]);

  useEffect(() => {
    if (initialNoteTypes && initialNoteTypes.length > 0) {
      setNoteTypes(initialNoteTypes);
    } else {
      (async () => {
        try {
          const { data } = await api.get<NoteType[]>("/note-types");
          setNoteTypes(data);
        } catch (e) {
          console.warn("Could not load note types", e);
        }
      })();
    }
  }, [initialNoteTypes]);

  function reset() {
    setTitle("");
    setContent("");
    setCategoryId(null);
    setLocationId(null);
    setNoteTypeId("type_plain");
    setCustomFields({});
    setOpen(false);
  }

  const selectedType = noteTypes.find((nt) => nt.type_id === noteTypeId);

  const handleCustomFieldChange = (fieldId: string, value: any) => {
    setCustomFields((prev) => ({
      ...prev,
      [fieldId]: value,
    }));
  };

  async function save() {
    if (!content.trim() && !title.trim()) {
      toast.error("Boş not kaydedilemez");
      return;
    }
    setBusy(true);
    try {
      const { data } = await api.post<Note>("/notes", {
        title,
        content,
        date: noteDateTime || defaultDate,
        category_id: categoryId,
        location_id: locationId,
        note_type_id: noteTypeId !== "type_plain" ? noteTypeId : null,
        custom_fields: customFields,
      });
      onCreated(data);
      reset();
      toast.success("Not eklendi");
    } catch (err: any) {
      toast.error(formatApiError(err) || "Kayıt başarısız");
    } finally {
      setBusy(false);
    }
  }

  async function saveNewLocation({ name, lat, lng }: { name: string; lat: number; lng: number }) {
    try {
      const { data } = await api.post<LocationItem>("/locations", { name, lat, lng });
      setLocationId(data.location_id);
      onLocationsChanged && onLocationsChanged();
      toast.success("Konum eklendi");
    } catch (err: any) {
      toast.error(formatApiError(err) || "Konum kaydedilemedi");
    }
  }

  const selectedLoc = locations.find((l) => l.location_id === locationId);

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        data-testid="open-composer-btn"
        className="w-full text-left border border-dashed border-border rounded-sm px-5 py-4 text-muted-foreground hover:border-foreground/40 hover:text-foreground transition-colors flex items-center gap-2"
      >
        <Plus className="w-4 h-4" strokeWidth={1.25} />
        <span className="font-serif text-lg tracking-tight">Bugüne bir şeyler yaz...</span>
      </button>
    );
  }

  return (
    <div className="border border-border rounded-sm p-5 bg-card space-y-3" data-testid="note-composer">
      {/* Note Type, Category & DateTime Top Selectors */}
      <div className="flex items-center justify-between flex-wrap gap-2 pb-1 border-b border-border/40">
        <div className="flex items-center gap-2 flex-wrap">
          {/* Note Type Selector */}
          <div className="flex items-center gap-1 bg-secondary/80 border border-border text-xs rounded-sm px-2 py-1">
            <Boxes className="w-3.5 h-3.5 text-primary shrink-0" />
            <select
              value={noteTypeId}
              onChange={(e) => {
                const newTypeId = e.target.value;
                setNoteTypeId(newTypeId);
              }}
              className="bg-transparent text-foreground text-xs outline-none cursor-pointer font-medium"
              data-testid="composer-note-type-select"
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

          {/* Category Selector */}
          {categories.length > 0 && (
            <div className="flex items-center gap-1 bg-secondary/70 border border-border text-xs rounded-sm px-2 py-1">
              <Layers className="w-3.5 h-3.5 text-indigo-500 shrink-0" />
              <select
                value={categoryId || ""}
                onChange={(e) => setCategoryId(e.target.value || null)}
                className="bg-transparent text-foreground text-xs outline-none cursor-pointer"
                data-testid="composer-category-select"
              >
                <option value="">— Kategori Seçin —</option>
                {categories.map((c) => (
                  <option key={c.category_id} value={c.category_id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* DateTime Picker */}
          <div className="flex items-center gap-1 bg-secondary/70 border border-border text-xs rounded-sm px-2 py-1">
            <Calendar className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
            <input
              type="datetime-local"
              value={noteDateTime}
              onChange={(e) => setNoteDateTime(e.target.value)}
              className="bg-transparent text-foreground text-xs outline-none cursor-pointer font-mono"
              data-testid="composer-datetime-input"
            />
          </div>
        </div>
      </div>

      <Input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Başlık (opsiyonel)"
        className="font-serif text-xl border-0 px-0 focus-visible:ring-0 shadow-none"
        data-testid="composer-title-input"
      />

      {/* Dynamic Custom Fields If Note Type is selected */}
      {selectedType && selectedType.fields && selectedType.fields.length > 0 && (
        <CustomFieldsForm
          fields={selectedType.fields}
          values={customFields}
          onChange={handleCustomFieldChange}
          disabled={busy}
        />
      )}

      <MarkdownEditor
        value={content}
        onChange={setContent}
        placeholder="Markdown destekli. #etiket veya @kişi yazarak otomatik tamamlama..."
        autoFocus
        onSubmit={save}
      />

      <div className="flex items-center justify-between flex-wrap gap-2 pt-1">
        <div className="flex items-center gap-2 flex-wrap">
          {/* Location Picker */}
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => setLocationDialog(true)}
            data-testid="composer-add-location-btn"
            className="rounded-sm text-xs h-7"
          >
            <MapPin className="w-3.5 h-3.5 mr-1 text-rose-500" strokeWidth={1.25} />
            <span className="truncate max-w-[120px]">{selectedLoc ? selectedLoc.name : "Konum ekle"}</span>
          </Button>

          {locations.length > 0 && (
            <select
              value={locationId || ""}
              onChange={(e) => setLocationId(e.target.value || null)}
              className="bg-secondary/70 border border-border text-xs rounded-sm px-2 py-1 font-mono"
              data-testid="composer-location-select"
            >
              <option value="">— önceki konum —</option>
              {locations.map((l) => (
                <option key={l.location_id} value={l.location_id}>
                  {l.name}
                </option>
              ))}
            </select>
          )}

          {selectedLoc && (
            <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setLocationId(null)}>
              <X className="w-3.5 h-3.5" strokeWidth={1.25} />
            </Button>
          )}
        </div>

        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={reset} data-testid="composer-cancel-btn">
            İptal
          </Button>
          <Button
            size="sm"
            onClick={save}
            disabled={busy}
            data-testid="composer-save-btn"
            className="bg-foreground text-background hover:bg-foreground/90 rounded-sm cursor-pointer"
          >
            {busy ? "Kaydediliyor..." : "Kaydet"}
          </Button>
        </div>
      </div>
      <LocationPicker open={locationDialog} onOpenChange={setLocationDialog} onSave={saveNewLocation} />
    </div>
  );
}
