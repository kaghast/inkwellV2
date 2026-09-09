import React, { useState, useEffect } from "react";
import { useNavigate, Link } from "react-router-dom";
import api, { formatApiError } from "@/lib/api";
import AppMenubar from "@/components/AppMenubar";
import MarkdownEditor from "@/components/MarkdownEditor";
import DrawingEditor from "@/components/drawing/DrawingEditor";
import OutlineEditor from "@/components/outline/OutlineEditor";
import MindmapEditor from "@/components/mindmap/MindmapEditor";
import LocationPicker from "@/components/LocationPicker";
import { CustomFieldsForm } from "@/components/CustomFieldsRenderer";
import EncryptNoteDialog from "@/components/EncryptNoteDialog";
import { toDateTimeLocal } from "@/lib/datetime";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  ArrowLeft,
  Save,
  X,
  FileText,
  PenTool,
  ListTree,
  Network,
  MapPin,
  Calendar,
  Layers,
  Boxes,
  Lock,
  Maximize2,
  Minimize2,
  Sparkles,
} from "lucide-react";
import { toast } from "sonner";
import type { Note, LocationItem, NoteType, Category } from "@/types";

export type ContentMode = "markdown" | "drawing" | "outline" | "mindmap";

export default function NewNotePage() {
  const navigate = useNavigate();

  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [contentMode, setContentMode] = useState<ContentMode>("markdown");
  const [dateTime, setDateTime] = useState(() => toDateTimeLocal(new Date().toISOString()));
  const [locationId, setLocationId] = useState<string | null>(null);
  const [loc, setLoc] = useState<LocationItem | null>(null);
  const [locations, setLocations] = useState<LocationItem[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [noteTypes, setNoteTypes] = useState<NoteType[]>([]);
  const [noteTypeId, setNoteTypeId] = useState<string>("type_plain");
  const [customFields, setCustomFields] = useState<Record<string, any>>({});
  const [picker, setPicker] = useState(false);
  const [saving, setSaving] = useState(false);
  const [fullFocus, setFullFocus] = useState(false);
  const [encryptOpen, setEncryptOpen] = useState(false);
  const [isEncrypted, setIsEncrypted] = useState(false);
  const [passwordHash, setPasswordHash] = useState<string | null>(null);

  const [savedNoteId, setSavedNoteId] = useState<string | null>(null);
  const [savedNoteSlug, setSavedNoteSlug] = useState<string | null>(null);

  useEffect(() => {
    async function loadAux() {
      try {
        const [lRes, cRes, ntRes] = await Promise.all([
          api.get<LocationItem[]>("/locations"),
          api.get<Category[]>("/categories"),
          api.get<NoteType[]>("/note-types"),
        ]);
        setLocations(Array.isArray(lRes.data) ? lRes.data : []);
        setCategories(Array.isArray(cRes.data) ? cRes.data : []);
        setNoteTypes(Array.isArray(ntRes.data) ? ntRes.data : []);
      } catch (err) {
        console.warn("Failed loading aux data:", err);
      }
    }
    loadAux();
  }, []);

  // Keyboard shortcut: Esc to exit full focus, Ctrl+S to save and continue editing, Ctrl+Enter to save & exit
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && fullFocus) {
        setFullFocus(false);
      }
      if ((e.ctrlKey || e.metaKey) && (e.key === "s" || e.key === "S")) {
        e.preventDefault();
        handleSave(true);
      } else if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
        e.preventDefault();
        handleSave(false);
      }
    };
    window.addEventListener("keydown", handleKey, true);
    return () => window.removeEventListener("keydown", handleKey, true);
  }, [fullFocus, title, content, dateTime, locationId, categoryId, noteTypeId, customFields, contentMode, isEncrypted, passwordHash, savedNoteId]);

  const currentType = noteTypes.find((t) => t.type_id === noteTypeId);

  const handleSave = async (keepAdding = false) => {
    if (!title.trim() && !content.trim()) {
      toast.error("Lütfen bir başlık veya içerik giriniz");
      return;
    }

    setSaving(true);
    try {
      const payload: any = {
        title: title.trim() || "Başlıksız Not",
        content,
        date: dateTime ? new Date(dateTime).toISOString() : new Date().toISOString(),
        location_id: locationId || null,
        category_id: categoryId || null,
        note_type_id: noteTypeId === "type_plain" ? null : noteTypeId,
        custom_fields: {
          ...customFields,
          content_mode: contentMode,
        },
        is_encrypted: isEncrypted,
        password_hash: passwordHash,
      };

      if (savedNoteId) {
        const res = await api.put<Note>(`/notes/${savedNoteId}`, payload);
        const targetSlug = res.data.slug || res.data.note_id;
        setSavedNoteSlug(targetSlug);
        toast.success(keepAdding ? "Değişiklikler kaydedildi" : "Not kaydedildi");
        if (!keepAdding) {
          navigate(`/note/${targetSlug}`);
        }
      } else {
        const res = await api.post<Note>("/notes", payload);
        const createdId = res.data.note_id;
        const targetSlug = res.data.slug || res.data.note_id;
        setSavedNoteId(createdId);
        setSavedNoteSlug(targetSlug);
        toast.success(keepAdding ? "Not kaydedildi (Ekleme/Düzenleme devam ediyor)" : "Yeni not başarıyla oluşturuldu");
        if (keepAdding) {
          window.history.replaceState(null, "", `/note/${targetSlug}?edit=true`);
        } else {
          navigate(`/note/${targetSlug}`);
        }
      }
    } catch (err) {
      toast.error(formatApiError(err) || "Not kaydedilirken bir hata oluştu");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-background paper">
      <AppMenubar />

      {/* Main Container with desktop left padding for menubar */}
      <div className="pt-14 lg:pl-16 flex-1 flex flex-col min-w-0">
        <main
          className={`min-w-0 w-full mx-auto p-4 sm:p-6 lg:p-10 transition-all ${
            fullFocus ? "fixed inset-0 z-50 bg-background overflow-y-auto p-6 lg:p-12" : "max-w-4xl"
          }`}
        >
          {/* Top Bar / Navigation Header */}
          <div className="flex items-center justify-between pb-4 mb-6 border-b border-border/80 flex-wrap gap-3">
            <div className="flex items-center gap-3">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => navigate(-1)}
                className="rounded-lg h-9 px-2 text-muted-foreground hover:text-foreground cursor-pointer"
                data-testid="new-note-back-btn"
              >
                <ArrowLeft className="w-4 h-4 mr-1" />
                <span className="text-xs">Geri</span>
              </Button>

              <div className="h-4 w-px bg-border hidden sm:block" />

              <span className="font-serif font-bold text-lg sm:text-xl text-foreground flex items-center gap-2">
                <span>Yeni Not Ekle</span>
                <span className="text-[11px] font-mono font-normal px-2 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/20">
                  Taslak
                </span>
              </span>
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              {/* Encrypt Button */}
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setEncryptOpen(true)}
                className={`h-8 text-xs rounded-lg ${
                  isEncrypted
                    ? "border-amber-500/50 bg-amber-500/10 text-amber-600 font-semibold"
                    : "text-muted-foreground"
                }`}
              >
                <Lock className="w-3.5 h-3.5 mr-1" />
                <span>{isEncrypted ? "Şifrelendi" : "Şifrele"}</span>
              </Button>

              {/* Full Focus Button */}
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setFullFocus(!fullFocus)}
                className="h-8 text-xs rounded-lg text-muted-foreground hover:text-foreground cursor-pointer"
                title="Tam Odaklanma Modu (Esc)"
              >
                {fullFocus ? <Minimize2 className="w-3.5 h-3.5 mr-1" /> : <Maximize2 className="w-3.5 h-3.5 mr-1" />}
                <span>{fullFocus ? "Normal Görünüm" : "Full Focus"}</span>
              </Button>

              {/* Save Button */}
              <Button
                onClick={() => handleSave(false)}
                disabled={saving}
                className="h-8 px-4 text-xs font-semibold rounded-lg bg-primary text-primary-foreground shadow-xs hover:opacity-90 transition-opacity cursor-pointer"
                data-testid="new-note-save-btn"
              >
                <Save className="w-3.5 h-3.5 mr-1.5" />
                <span>{saving ? "Kaydediliyor..." : "Notu Kaydet"}</span>
              </Button>
            </div>
          </div>

          {/* Form Fields & Editor */}
          <div className="space-y-5">
            {/* Title Input */}
            <div>
              <Input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Not Başlığı..."
                autoFocus
                className="font-serif text-2xl sm:text-3xl font-bold border-none px-0 h-auto rounded-none focus-visible:ring-0 placeholder:text-muted-foreground/50 bg-transparent"
                data-testid="new-note-title-input"
              />
            </div>

            {/* Note Metadata Row: Date, Category, Note Type */}
            <div className="flex items-center flex-wrap gap-2.5 p-3 rounded-xl bg-secondary/40 border border-border/70 text-xs">
              {/* Date & Time */}
              <div className="flex items-center gap-1.5 bg-background px-2.5 py-1.5 rounded-lg border border-border">
                <Calendar className="w-3.5 h-3.5 text-muted-foreground" />
                <input
                  type="datetime-local"
                  value={dateTime}
                  onChange={(e) => setDateTime(e.target.value)}
                  className="bg-transparent border-none text-xs text-foreground font-mono outline-none cursor-pointer"
                />
              </div>

              {/* Note Type Selector */}
              {noteTypes.length > 0 && (
                <div className="flex items-center gap-1.5 bg-background px-2.5 py-1.5 rounded-lg border border-border">
                  <Boxes className="w-3.5 h-3.5 text-muted-foreground" />
                  <select
                    value={noteTypeId}
                    onChange={(e) => setNoteTypeId(e.target.value)}
                    className="bg-transparent border-none text-xs text-foreground font-medium outline-none cursor-pointer"
                  >
                    <option value="type_plain">Düz Metin (Standart)</option>
                    {noteTypes
                      .filter((t) => t.type_id !== "type_plain")
                      .map((t) => (
                        <option key={t.type_id} value={t.type_id}>
                          {t.name}
                        </option>
                      ))}
                  </select>
                </div>
              )}

              {/* Category Selector */}
              {categories.length > 0 && (
                <div className="flex items-center gap-1.5 bg-background px-2.5 py-1.5 rounded-lg border border-border">
                  <Layers className="w-3.5 h-3.5 text-muted-foreground" />
                  <select
                    value={categoryId || ""}
                    onChange={(e) => setCategoryId(e.target.value || null)}
                    className="bg-transparent border-none text-xs text-foreground font-medium outline-none cursor-pointer"
                  >
                    <option value="">Kategorisiz</option>
                    {categories.map((c) => (
                      <option key={c.category_id} value={c.category_id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {/* Location Selector */}
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setPicker(true)}
                className="h-8 text-xs bg-background rounded-lg border-border cursor-pointer text-muted-foreground hover:text-foreground"
              >
                <MapPin className="w-3.5 h-3.5 mr-1 text-muted-foreground" />
                <span>{loc ? loc.name : "Konum Ekle"}</span>
              </Button>
            </div>

            {/* Custom Fields if Note Type has fields */}
            {currentType && currentType.fields && currentType.fields.length > 0 && (
              <div className="p-3 bg-secondary/30 border border-border/70 rounded-xl">
                <CustomFieldsForm
                  fields={currentType.fields}
                  values={customFields}
                  onChange={(fieldId, val) =>
                    setCustomFields((prev) => ({ ...prev, [fieldId]: val }))
                  }
                  disabled={saving}
                />
              </div>
            )}

            {/* 4 Content Mode Tabs */}
            <div className="flex items-center justify-between gap-2 p-1.5 rounded-xl bg-secondary/60 border border-border/80 flex-wrap">
              <span className="text-xs font-semibold text-foreground px-2">
                İçerik Düzenleme Modu:
              </span>

              <div className="flex items-center gap-1 bg-background p-0.5 rounded-lg border border-border flex-wrap">
                {/* 1. Markdown Metin */}
                <button
                  type="button"
                  onClick={() => {
                    setContentMode("markdown");
                    setCustomFields((prev) => ({ ...prev, content_mode: "markdown" }));
                  }}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all cursor-pointer ${
                    contentMode === "markdown"
                      ? "bg-primary text-primary-foreground font-bold shadow-xs"
                      : "hover:bg-muted text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <FileText className="w-3.5 h-3.5" /> Metin
                </button>

                {/* 2. Drawing Canvas */}
                <button
                  type="button"
                  onClick={() => {
                    setContentMode("drawing");
                    setCustomFields((prev) => ({ ...prev, content_mode: "drawing" }));
                    if (!/\`\`\`drawing/.test(content)) {
                      setContent(
                        '```drawing\n{\n  "version": 1,\n  "elements": [],\n  "gridMode": "dots"\n}\n```'
                      );
                    }
                  }}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all cursor-pointer ${
                    contentMode === "drawing"
                      ? "bg-primary text-primary-foreground font-bold shadow-xs"
                      : "hover:bg-muted text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <PenTool className="w-3.5 h-3.5" /> Çizim
                </button>

                {/* 3. Outline */}
                <button
                  type="button"
                  onClick={() => {
                    setContentMode("outline");
                    setCustomFields((prev) => ({ ...prev, content_mode: "outline" }));
                    if (!content.trim() || /\`\`\`drawing/.test(content)) {
                      setContent("- [ ] İlk ana madde\n  - [ ] Alt görev veya not\n- [ ] İkinci ana madde");
                    }
                  }}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all cursor-pointer ${
                    contentMode === "outline"
                      ? "bg-primary text-primary-foreground font-bold shadow-xs"
                      : "hover:bg-muted text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <ListTree className="w-3.5 h-3.5" /> Outline
                </button>

                {/* 4. Mindmap */}
                <button
                  type="button"
                  onClick={() => {
                    setContentMode("mindmap");
                    setCustomFields((prev) => ({ ...prev, content_mode: "mindmap" }));
                    if (!content.trim() || /\`\`\`drawing/.test(content)) {
                      setContent("# " + (title || "Ana Konu") + "\n## Fikir 1\n- Alt madde 1\n- Alt madde 2\n## Fikir 2\n- Alt madde 3");
                    }
                  }}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all cursor-pointer ${
                    contentMode === "mindmap"
                      ? "bg-primary text-primary-foreground font-bold shadow-xs"
                      : "hover:bg-muted text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <Network className="w-3.5 h-3.5" /> Zihin Haritası
                </button>
              </div>
            </div>

            {/* Active Content Editor */}
            {contentMode === "drawing" ? (
              <DrawingEditor initialContent={content} onChange={setContent} height={540} />
            ) : contentMode === "outline" ? (
              <OutlineEditor initialContent={content} onChange={setContent} />
            ) : contentMode === "mindmap" ? (
              <MindmapEditor initialContent={content} onChange={setContent} height={540} isFullFocus={fullFocus} />
            ) : (
              <MarkdownEditor
                value={content}
                onChange={setContent}
                title={title}
                onTitleChange={setTitle}
                onSubmit={() => handleSave(true)}
              />
            )}
          </div>
        </main>
      </div>

      {/* Location Picker Dialog */}
      <LocationPicker
        open={picker}
        onOpenChange={setPicker}
        onSave={async (newLoc) => {
          try {
            const { data } = await api.post("/locations", newLoc);
            setLocationId(data.location_id);
            setLoc(data);
            setLocations((prev) => [data, ...prev]);
            setPicker(false);
            toast.success("Konum eklendi");
          } catch (err: any) {
            toast.error(formatApiError(err) || "Konum eklenemedi");
          }
        }}
      />

      {/* Encrypt Dialog */}
      <EncryptNoteDialog
        open={encryptOpen}
        onOpenChange={setEncryptOpen}
        note={{
          note_id: "draft",
          user_id: "",
          title: title || "Yeni Not",
          content: content,
          date: dateTime,
          tags: [],
          people: [],
          pinned: false,
          archived: false,
          is_encrypted: isEncrypted,
          password_hash: passwordHash,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }}
        onSuccess={(updated) => {
          setIsEncrypted(Boolean(updated.is_encrypted));
          setPasswordHash(updated.password_hash || null);
          setEncryptOpen(false);
          toast.success(updated.is_encrypted ? "Not şifrelendi" : "Şifre kaldırıldı");
        }}
      />
    </div>
  );
}
