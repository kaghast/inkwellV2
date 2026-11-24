import React, { useEffect, useState } from "react";
import { toast } from "sonner";
import { Eye, EyeOff, LayoutTemplate, Loader2, Pencil, Plus, RotateCcw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useWorkspace } from "@/contexts/WorkspaceContext";
import { formatApiError } from "@/lib/api";
import { wsApi, type TemplateBody, type TemplateInfo } from "@/lib/workspaceApi";
import { isJournalPageType } from "@/lib/objectTypes";

const EMPTY: TemplateBody = { name: "", description: "", note_type_id: null, title_template: "", content_template: "" };

/**
 * Settings > Şablonlar. Built-in templates create connected objects; their
 * title/content text can be edited, hidden or reset. Own templates create one
 * object of the chosen type and can be added, edited and deleted.
 */
export default function TemplatesSettings() {
  const { noteTypes, refreshTemplates } = useWorkspace();
  const [list, setList] = useState<TemplateInfo[] | null>(null);
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const [draft, setDraft] = useState<TemplateBody>(EMPTY);
  const [busy, setBusy] = useState(false);

  const load = () =>
    wsApi
      .templates(true)
      .then(setList)
      .catch((e) => toast.error(formatApiError(e)));
  useEffect(() => {
    load();
  }, []);

  const changed = () => {
    load();
    refreshTemplates();
  };

  function startEdit(t: TemplateInfo | null) {
    if (!t) {
      setDraft(EMPTY);
      setEditing("new");
      return;
    }
    setDraft({ name: t.name, description: t.description, note_type_id: t.note_type_id, title_template: t.title_template, content_template: t.content_template });
    setEditing(t.id);
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const builtin = list?.find((t) => t.id === editing)?.kind === "builtin";
      const body: TemplateBody = builtin ? { title_template: draft.title_template, content_template: draft.content_template } : draft;
      if (editing === "new") await wsApi.createTemplate(body);
      else await wsApi.updateTemplate(editing!, body);
      toast.success("Şablon kaydedildi");
      setEditing(null);
      changed();
    } catch (err) {
      toast.error(formatApiError(err));
    } finally {
      setBusy(false);
    }
  }

  async function toggleHidden(t: TemplateInfo) {
    try {
      await wsApi.updateTemplate(t.id, { hidden: !t.hidden });
      changed();
    } catch (err) {
      toast.error(formatApiError(err));
    }
  }

  async function remove(t: TemplateInfo) {
    const msg = t.kind === "builtin" ? `"${t.name}" şablonu varsayılan haline dönsün mü?` : `"${t.name}" şablonu silinsin mi? Bu şablondan oluşturulmuş notlar silinmez.`;
    if (!window.confirm(msg)) return;
    try {
      await wsApi.deleteTemplate(t.id);
      toast.success(t.kind === "builtin" ? "Varsayılana döndürüldü" : "Şablon silindi");
      if (editing === t.id) setEditing(null);
      changed();
    } catch (err) {
      toast.error(formatApiError(err));
    }
  }

  const editingBuiltin = list?.find((t) => t.id === editing)?.kind === "builtin";
  const label = "text-xs font-medium text-foreground";

  const form = (
    <form onSubmit={save} className="space-y-3 rounded-lg border border-primary/30 bg-background p-4" data-testid="template-form">
      {!editingBuiltin && (
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <label className={label} htmlFor="tpl-name">Ad</label>
            <Input id="tpl-name" value={draft.name || ""} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="ör. Kitap özeti" autoFocus data-testid="template-name" />
          </div>
          <div className="space-y-1">
            <label className={label} htmlFor="tpl-type">Nesne tipi</label>
            <select
              id="tpl-type"
              value={draft.note_type_id || "type_plain"}
              onChange={(e) => setDraft({ ...draft, note_type_id: e.target.value })}
              className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
            >
              {noteTypes.filter((t) => !isJournalPageType(t.type_id)).map((t) => (
                <option key={t.type_id} value={t.type_id}>{t.name}</option>
              ))}
            </select>
          </div>
          <div className="space-y-1 sm:col-span-2">
            <label className={label} htmlFor="tpl-desc">Açıklama</label>
            <Input id="tpl-desc" value={draft.description || ""} onChange={(e) => setDraft({ ...draft, description: e.target.value })} />
          </div>
        </div>
      )}
      <div className="space-y-1">
        <label className={label} htmlFor="tpl-title">Başlık</label>
        <Input id="tpl-title" value={draft.title_template || ""} onChange={(e) => setDraft({ ...draft, title_template: e.target.value })} placeholder="ör. {{başlık}} · {{tarih}}" />
      </div>
      <div className="space-y-1">
        <label className={label} htmlFor="tpl-content">İçerik (Markdown)</label>
        <Textarea id="tpl-content" rows={10} className="font-mono text-xs" value={draft.content_template || ""} onChange={(e) => setDraft({ ...draft, content_template: e.target.value })} data-testid="template-content" />
        <p className="text-[11px] text-muted-foreground">
          Yer tutucular: <code>{"{{tarih}}"}</code> oluşturma tarihi, <code>{"{{başlık}}"}</code> şablonu kullanırken girilen başlık. #etiket, @kişi, [[bağlantı]] ve görev kutuları normal notlardaki gibi çalışır.
          {editingBuiltin && " Bu şablonun bağlı nesneleri (kişiler, görevler, makaleler) değişmez; yalnızca ana nesnenin başlık ve içeriği düzenlenir."}
        </p>
      </div>
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={busy || (!editingBuiltin && !draft.name?.trim())} data-testid="template-save">
          {busy && <Loader2 className="w-4 h-4 mr-1 animate-spin" />} Kaydet
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(null)}>Vazgeç</Button>
      </div>
    </form>
  );

  return (
    <div className="space-y-5 max-w-3xl" data-testid="templates-settings">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="font-serif text-xl font-bold flex items-center gap-2">
            <LayoutTemplate className="w-5 h-5 text-primary" /> Şablonlar
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Şablonlar komut paletinde (Ctrl/⌘ K) ve Bugün sayfasında görünür. Yerleşik şablonlar bağlı nesneler oluşturur; kendi şablonların seçtiğin tipte tek bir nesne oluşturur.
          </p>
        </div>
        <Button size="sm" onClick={() => startEdit(null)} disabled={editing === "new"} data-testid="template-new">
          <Plus className="w-4 h-4 mr-1" /> Yeni şablon
        </Button>
      </div>

      {editing === "new" && form}

      {list === null ? (
        <div className="text-sm text-muted-foreground">Yükleniyor…</div>
      ) : (
        <ul className="space-y-2">
          {list.map((t) => (
            <li key={t.id} className={`rounded-lg border border-border bg-card p-3 ${t.hidden ? "opacity-60" : ""}`} data-testid={`template-item-${t.id}`}>
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{t.name}</span>
                <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">{t.kind === "builtin" ? "Yerleşik · bağlı nesneler" : noteTypes.find((n) => n.type_id === (t.note_type_id || "type_plain"))?.name || "Düz Metin"}</span>
                {t.customized && t.kind === "builtin" && <span className="text-[10px] text-primary">düzenlendi</span>}
                {t.hidden && <span className="text-[10px] text-muted-foreground">gizli</span>}
                <span className="ml-auto flex gap-1">
                  <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => startEdit(t)} aria-label="Düzenle">
                    <Pencil className="w-3.5 h-3.5" />
                  </Button>
                  <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => toggleHidden(t)} aria-label={t.hidden ? "Göster" : "Gizle"} title={t.hidden ? "Göster" : "Paletten gizle"}>
                    {t.hidden ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
                  </Button>
                  {(t.kind === "custom" || t.customized) && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 px-2 text-destructive"
                      onClick={() => remove(t)}
                      aria-label={t.kind === "builtin" ? "Varsayılana döndür" : "Sil"}
                      title={t.kind === "builtin" ? "Varsayılana döndür" : "Sil"}
                      data-testid={`template-delete-${t.id}`}
                    >
                      {t.kind === "builtin" ? <RotateCcw className="w-3.5 h-3.5" /> : <Trash2 className="w-3.5 h-3.5" />}
                    </Button>
                  )}
                </span>
              </div>
              {t.description && <p className="mt-1 text-xs text-muted-foreground">{t.description}</p>}
              {editing === t.id && <div className="mt-3">{form}</div>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
