import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { Check, CheckCheck, FileText, Link2, Loader2, Paperclip, Pencil, RotateCw, Save, X, AlertTriangle, Inbox as InboxIcon } from "lucide-react";
import PageShell from "@/components/PageShell";
import TypeIcon from "@/components/TypeIcon";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useWorkspace } from "@/contexts/WorkspaceContext";
import { formatApiError } from "@/lib/api";
import { INBOX_CHANGED, notifyInboxChanged, objectPath, wsApi, type Capture } from "@/lib/workspaceApi";
import { isJournalPageType } from "@/lib/objectTypes";

const STATUS: Record<Capture["status"], { label: string; cls: string }> = {
  new: { label: "Yeni", cls: "bg-muted text-muted-foreground" },
  processing: { label: "İşleniyor", cls: "bg-primary/15 text-primary animate-pulse" },
  ready: { label: "İncelemeye hazır", cls: "bg-amber-500/15 text-amber-600 dark:text-amber-400" },
  processed: { label: "İşlendi", cls: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400" },
  failed: { label: "Hata", cls: "bg-destructive/15 text-destructive" },
};

const FILE_TEXT_METHOD: Record<string, string> = { text: "metin dosyası", docx: "Word", pptx: "PowerPoint", xlsx: "Excel", ocr: "OCR" };
const RESOLUTION: Record<string, string> = { accepted: "Kabul edildi", saved_raw: "Yapay zekasız kaydedildi", rejected: "Reddedildi" };

function isEditable(el: EventTarget | null) {
  const t = el as HTMLElement | null;
  return !!t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable);
}

const csv = (s: string) => s.split(",").map((x) => x.trim()).filter(Boolean);

export default function InboxPage() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const { noteTypes, typeById, refreshInbox } = useWorkspace();
  const [scope, setScope] = useState<"open" | "processed">("open");
  const [items, setItems] = useState<Capture[] | null>(null);
  const [selected, setSelected] = useState<string | null>(params.get("focus"));
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [draft, setDraft] = useState({ title: "", type_id: "", tags: "", people: "", tasks: [] as string[], related: [] as string[] });

  const load = useCallback(() => {
    wsApi
      .inbox(scope)
      .then((r) => {
        setItems(r.items);
        setSelected((cur) => (cur && r.items.some((i) => i.capture_id === cur) ? cur : r.items[0]?.capture_id || null));
      })
      .catch((e) => toast.error(formatApiError(e)));
  }, [scope]);

  useEffect(() => {
    load();
    window.addEventListener(INBOX_CHANGED, load);
    return () => window.removeEventListener(INBOX_CHANGED, load);
  }, [load]);

  // Poll while something is still being processed
  useEffect(() => {
    if (!items?.some((i) => i.status === "new" || i.status === "processing")) return;
    const t = window.setTimeout(load, 1500);
    return () => window.clearTimeout(t);
  }, [items, load]);

  const current = useMemo(() => items?.find((i) => i.capture_id === selected) || null, [items, selected]);

  useEffect(() => {
    setEditing(false);
    if (!current) return;
    const s = current.suggestion || {};
    setDraft({
      title: s.title || "",
      type_id: s.type_id || "type_plain",
      tags: (s.tags || []).join(", "),
      people: (s.people || []).join(", "),
      tasks: s.tasks || [],
      related: (s.related || []).map((r) => r.object_id),
    });
    if (params.get("focus")) setParams({}, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.capture_id, current?.status]);

  const after = (msg: string, objectId?: string, slug?: string) => {
    toast.success(msg, objectId ? { action: { label: "Aç", onClick: () => navigate(objectPath({ slug, note_id: objectId })) } } : undefined);
    notifyInboxChanged();
    refreshInbox();
    load();
  };

  async function run(id: string, fn: () => Promise<any>, msg: string) {
    setBusy(id);
    try {
      const r = await fn();
      after(msg, r?.object_id, r?.slug);
    } catch (e) {
      toast.error(formatApiError(e));
    } finally {
      setBusy(null);
    }
  }

  const accept = (c: Capture) =>
    run(
      c.capture_id,
      () =>
        wsApi.accept(
          c.capture_id,
          editing
            ? { title: draft.title, type_id: draft.type_id, tags: csv(draft.tags), people: csv(draft.people), tasks: draft.tasks, related_ids: draft.related }
            : {}
        ),
      "Nesne oluşturuldu"
    );
  const saveRaw = (c: Capture) => run(c.capture_id, () => wsApi.saveRaw(c.capture_id), "Yapay zekasız kaydedildi");
  const reject = (c: Capture) => run(c.capture_id, () => wsApi.reject(c.capture_id), "Reddedildi; ham metin saklandı");
  const retry = (c: Capture) => run(c.capture_id, () => wsApi.retry(c.capture_id), "Yeniden işleniyor");

  async function acceptChecked() {
    const ids = Array.from(checked);
    setBusy("batch");
    try {
      const r = await wsApi.acceptBatch(ids);
      const ok = r.results.filter((x) => x.ok).length;
      setChecked(new Set());
      after(`${ok}/${ids.length} öğe kabul edildi`);
    } catch (e) {
      toast.error(formatApiError(e));
    } finally {
      setBusy(null);
    }
  }

  // Keyboard review: j/k move, a accept, e edit, s save raw, r reject
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || isEditable(e.target) || !items?.length) return;
      const idx = items.findIndex((i) => i.capture_id === selected);
      if (e.key === "j" || e.key === "ArrowDown") setSelected(items[Math.min(items.length - 1, idx + 1)]?.capture_id);
      else if (e.key === "k" || e.key === "ArrowUp") setSelected(items[Math.max(0, idx - 1)]?.capture_id);
      else if (!current || busy) return;
      else if (e.key === "a" && current.status === "ready") accept(current);
      else if (e.key === "e" && current.status === "ready") setEditing(true);
      else if (e.key === "s" && current.status !== "processed") saveRaw(current);
      else if (e.key === "r" && current.status !== "processed") reject(current);
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const readyIds = items?.filter((i) => i.status === "ready").map((i) => i.capture_id) || [];

  return (
    <PageShell
      title="Gelen kutusu"
      subtitle="Önce yakala, sonra düzenle. Önerileri kabul et, düzenle ya da ham haliyle kaydet."
      wide
      actions={
        <div className="flex rounded-md border border-border p-0.5 text-xs">
          {(["open", "processed"] as const).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setScope(s)}
              className={`rounded px-2.5 py-1 ${scope === s ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
            >
              {s === "open" ? "Bekleyenler" : "İşlenenler"}
            </button>
          ))}
        </div>
      }
    >
      {items === null ? (
        <div className="text-sm text-muted-foreground">Yükleniyor…</div>
      ) : items.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border p-10 text-center">
          <InboxIcon className="mx-auto mb-2 w-6 h-6 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            {scope === "open" ? "Bekleyen bir şey yok. Üstteki “Aklında ne var?” alanına yazdığın her şey buraya gelir." : "Henüz işlenen yakalama yok."}
          </p>
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
          <div className="min-w-0 rounded-lg border border-border bg-card">
            {scope === "open" && readyIds.length > 0 && (
              <div className="flex items-center gap-2 border-b border-border/70 px-3 py-2 text-xs">
                <input
                  type="checkbox"
                  aria-label="Hazır olanların hepsini seç"
                  checked={readyIds.every((id) => checked.has(id))}
                  onChange={(e) => setChecked(e.target.checked ? new Set(readyIds) : new Set())}
                />
                <span className="text-muted-foreground">{checked.size ? `${checked.size} seçili` : "Hazır olanları seç"}</span>
                {checked.size > 0 && (
                  <Button size="sm" className="ml-auto h-7 text-xs" onClick={acceptChecked} disabled={busy === "batch"} data-testid="inbox-accept-batch">
                    <CheckCheck className="w-3.5 h-3.5 mr-1" /> Seçilenleri kabul et
                  </Button>
                )}
              </div>
            )}
            <ul className="divide-y divide-border/60" role="listbox" aria-label="Yakalamalar">
              {items.map((c) => {
                const s = c.suggestion || {};
                const t = typeById(s.type_id);
                return (
                  <li
                    key={c.capture_id}
                    role="option"
                    aria-selected={c.capture_id === selected}
                    onClick={() => setSelected(c.capture_id)}
                    className={`flex cursor-pointer gap-2.5 px-3 py-2.5 ${c.capture_id === selected ? "bg-primary/5" : "hover:bg-muted/40"}`}
                    data-testid={`inbox-item-${c.capture_id}`}
                  >
                    {scope === "open" && (
                      <input
                        type="checkbox"
                        className="mt-1"
                        aria-label="Seç"
                        disabled={c.status !== "ready"}
                        checked={checked.has(c.capture_id)}
                        onClick={(e) => e.stopPropagation()}
                        onChange={(e) => {
                          const n = new Set(checked);
                          e.target.checked ? n.add(c.capture_id) : n.delete(c.capture_id);
                          setChecked(n);
                        }}
                      />
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        {s.type_id ? <TypeIcon icon={t?.icon} color={t?.color} /> : c.file_id ? <Paperclip className="w-3.5 h-3.5" /> : c.raw_url ? <Link2 className="w-3.5 h-3.5" /> : <FileText className="w-3.5 h-3.5 text-muted-foreground" />}
                        <span className="truncate text-sm font-medium">{s.title || c.raw_text.split("\n")[0] || c.raw_url || "Dosya"}</span>
                      </div>
                      <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{c.raw_text || c.raw_url}</p>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1">
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${STATUS[c.status].cls}`}>
                        {c.status === "processed" && c.resolution ? RESOLUTION[c.resolution] : STATUS[c.status].label}
                      </span>
                      <span className="text-[10px] text-muted-foreground">{new Date(c.created_at).toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" })}</span>
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>

          {current && (
            <aside className="min-w-0 rounded-lg border border-border bg-card p-4 lg:sticky lg:top-20 self-start" aria-label="İnceleme" data-testid="inbox-review">
              <div className="mb-3 flex items-center justify-between gap-2">
                <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${STATUS[current.status].cls}`}>{STATUS[current.status].label}</span>
                {current.provider && (
                  <span className="text-[11px] text-muted-foreground" title="Önerileri üreten yöntem">
                    {current.provider === "Kural tabanlı" ? "Kural tabanlı öneriler" : `${current.provider} önerileri`}
                  </span>
                )}
              </div>

              {current.error && (
                <div className="mb-3 flex gap-2 rounded-md bg-destructive/10 px-2.5 py-2 text-xs text-destructive">
                  <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" /> {current.error}
                </div>
              )}

              {(current.status === "new" || current.status === "processing") && (
                <div className="mb-3 flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="w-4 h-4 animate-spin" /> Tip, başlık, etiketler ve bağlantılar çıkarılıyor…
                </div>
              )}

              {current.status === "ready" && (
                <div className="space-y-3 text-sm">
                  <Field label="Başlık">
                    {editing ? <Input value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} className="h-8" /> : <b>{draft.title}</b>}
                  </Field>
                  <Field label="Tip">
                    {editing ? (
                      <select
                        value={draft.type_id}
                        onChange={(e) => setDraft({ ...draft, type_id: e.target.value })}
                        className="h-8 w-full rounded-md border border-input bg-background px-2 text-sm"
                        aria-label="Nesne tipi"
                      >
                        {noteTypes.filter((t) => !isJournalPageType(t.type_id)).map((t) => (
                          <option key={t.type_id} value={t.type_id}>{t.name}</option>
                        ))}
                      </select>
                    ) : (
                      <span className="inline-flex items-center gap-1.5">
                        <TypeIcon icon={typeById(draft.type_id)?.icon} color={typeById(draft.type_id)?.color} />
                        {typeById(draft.type_id)?.name || "Düz Metin"}
                        {typeof current.suggestion.type_confidence === "number" && (
                          <span className="text-[11px] text-muted-foreground">· güven %{Math.round(current.suggestion.type_confidence * 100)}</span>
                        )}
                      </span>
                    )}
                  </Field>
                  {current.suggestion.summary && <Field label="Özet"><span className="text-muted-foreground">{current.suggestion.summary}</span></Field>}
                  {current.suggestion.site && <Field label="Kaynak">{current.suggestion.site}{current.suggestion.author ? ` · ${current.suggestion.author}` : ""}</Field>}
                  <Field label="Etiketler">
                    {editing ? <Input value={draft.tags} onChange={(e) => setDraft({ ...draft, tags: e.target.value })} className="h-8" placeholder="virgülle ayır" /> : <Chips items={csv(draft.tags).map((t) => `#${t}`)} />}
                  </Field>
                  <Field label="Kişiler">
                    {editing ? <Input value={draft.people} onChange={(e) => setDraft({ ...draft, people: e.target.value })} className="h-8" placeholder="virgülle ayır" /> : <Chips items={csv(draft.people).map((p) => `@${p}`)} />}
                  </Field>
                  {(current.suggestion.dates || []).length > 0 && <Field label="Tarihler"><Chips items={current.suggestion.dates!} /></Field>}
                  {(current.suggestion.tasks || []).length > 0 && (
                    <Field label="Görevler">
                      <ul className="space-y-1">
                        {current.suggestion.tasks!.map((t) => (
                          <li key={t}>
                            <label className="flex items-center gap-2">
                              <input
                                type="checkbox"
                                disabled={!editing}
                                checked={draft.tasks.includes(t)}
                                onChange={(e) => setDraft({ ...draft, tasks: e.target.checked ? [...draft.tasks, t] : draft.tasks.filter((x) => x !== t) })}
                              />
                              {t}
                            </label>
                          </li>
                        ))}
                      </ul>
                    </Field>
                  )}
                  {(current.suggestion.related || []).length > 0 && (
                    <Field label="Bağlantılar">
                      <ul className="space-y-1.5">
                        {current.suggestion.related!.map((r) => (
                          <li key={r.object_id}>
                            <label className="flex items-start gap-2">
                              <input
                                type="checkbox"
                                className="mt-1"
                                disabled={!editing}
                                checked={draft.related.includes(r.object_id)}
                                onChange={(e) => setDraft({ ...draft, related: e.target.checked ? [...draft.related, r.object_id] : draft.related.filter((x) => x !== r.object_id) })}
                              />
                              <span>
                                <Link to={`/note/${r.object_id}`} className="hover:underline">{r.title}</Link>
                                <span className="block text-xs text-muted-foreground">{r.reason}</span>
                              </span>
                            </label>
                          </li>
                        ))}
                      </ul>
                    </Field>
                  )}
                </div>
              )}

              {current.file_id && (current.file_text || current.suggestion.file_text_note) && (
                <details className="mt-3 text-xs" data-testid="inbox-file-text">
                  <summary className="cursor-pointer text-muted-foreground">
                    Dosyadaki metin
                    {current.file_text
                      ? ` · ${FILE_TEXT_METHOD[current.file_text_method || "none"] || ""} · ${(current.file_text_length || 0).toLocaleString("tr-TR")} karakter`
                      : " · okunamadı"}
                  </summary>
                  {current.file_text ? (
                    <>
                      <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap rounded bg-muted/50 p-2 font-mono text-[11px]">{current.file_text}</pre>
                      <p className="mt-1 text-muted-foreground">Kaydedince metnin tamamı nesnenin “Dosyadaki metin” bölümüne eklenir.</p>
                    </>
                  ) : (
                    <p className="mt-1 text-muted-foreground">{current.suggestion.file_text_note}</p>
                  )}
                </details>
              )}

              <details className="mt-3 text-xs">
                <summary className="cursor-pointer text-muted-foreground">Ham içerik</summary>
                <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap rounded bg-muted/50 p-2 font-mono text-[11px]">{current.raw_text || current.raw_url}</pre>
                {current.file_id && <a className="text-primary hover:underline" href={`/api/files/${current.file_id}`} target="_blank" rel="noreferrer">Ekli dosyayı aç</a>}
              </details>

              {current.status === "processed" ? (
                current.object_id && (
                  <Button asChild size="sm" variant="outline" className="mt-4">
                    <Link to={`/note/${current.object_id}`}>Oluşan nesneyi aç</Link>
                  </Button>
                )
              ) : (
                <div className="mt-4 flex flex-wrap gap-2">
                  {current.status === "ready" && (
                    <Button size="sm" onClick={() => accept(current)} disabled={!!busy} data-testid="inbox-accept">
                      <Check className="w-3.5 h-3.5 mr-1" /> {editing ? "Düzenlemeyle kaydet" : "Tümünü kabul et"}
                    </Button>
                  )}
                  {current.status === "ready" && !editing && (
                    <Button size="sm" variant="outline" onClick={() => setEditing(true)} data-testid="inbox-edit">
                      <Pencil className="w-3.5 h-3.5 mr-1" /> Düzenle
                    </Button>
                  )}
                  <Button size="sm" variant="outline" onClick={() => saveRaw(current)} disabled={!!busy} data-testid="inbox-save-raw">
                    <Save className="w-3.5 h-3.5 mr-1" /> Yapay zekasız kaydet
                  </Button>
                  {(current.status === "failed" || current.status === "ready") && (
                    <Button size="sm" variant="ghost" onClick={() => retry(current)} disabled={!!busy}>
                      <RotateCw className="w-3.5 h-3.5 mr-1" /> Tekrar işle
                    </Button>
                  )}
                  <Button size="sm" variant="ghost" className="text-destructive" onClick={() => reject(current)} disabled={!!busy} data-testid="inbox-reject">
                    <X className="w-3.5 h-3.5 mr-1" /> Reddet
                  </Button>
                </div>
              )}
              <p className="mt-3 text-[11px] text-muted-foreground">Kısayollar: J/K gez · A kabul · E düzenle · S ham kaydet · R reddet</p>
            </aside>
          )}
        </div>
      )}
    </PageShell>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[84px_1fr] items-start gap-2">
      <span className="pt-0.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</span>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

function Chips({ items }: { items: string[] }) {
  if (!items.length) return <span className="text-muted-foreground">—</span>;
  return (
    <div className="flex flex-wrap gap-1">
      {items.map((i) => (
        <span key={i} className="rounded bg-muted px-1.5 py-0.5 text-xs">{i}</span>
      ))}
    </div>
  );
}
