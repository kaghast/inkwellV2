import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { AlertTriangle, Check, Copy, Link2, Loader2, Plus, Search, Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import MarkdownView from "@/components/MarkdownView";
import { CitedText } from "@/pages/AskPage";
import { formatApiError } from "@/lib/api";
import { aiApi, objectPath, wsApi, type AiActionKey, type AiActionResult, type SearchHit } from "@/lib/workspaceApi";

const GROUPS: Array<{ title: string; actions: Array<[AiActionKey, string]> }> = [
  { title: "Yaz", actions: [["summarize", "Özetle"], ["rewrite", "Yeniden yaz"], ["translate", "Çevir"], ["explain", "Açıkla"], ["outline", "Taslak"]] },
  { title: "Çıkar", actions: [["extract_tasks", "Görevler"], ["generate_tags", "Etiketler"], ["research_questions", "Araştırma soruları"], ["research_insights", "İçgörüler"]] },
  { title: "Biçimlendir", actions: [["meeting_notes", "Toplantı notu"], ["project_summary", "Proje özeti"]] },
  { title: "Bağla", actions: [["find_related", "İlgili notlar"], ["find_connections", "Bağlantılar"], ["contradictions", "Çelişkiler"], ["compare", "Karşılaştır…"]] },
];

const LANGS = ["English", "Türkçe", "Deutsch", "Français", "Español", "العربية"];

/**
 * AI actions for one object. Results are suggestions: they are only written to
 * the note when the user appends them (which creates a new version).
 */
export default function NoteAiPanel({
  noteId,
  locked,
  archived,
  onAppended,
}: {
  noteId: string;
  locked?: boolean;
  archived?: boolean;
  onAppended: (content: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<AiActionKey | null>(null);
  const [result, setResult] = useState<AiActionResult | null>(null);
  const [language, setLanguage] = useState("English");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [comparing, setComparing] = useState(false);
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);

  useEffect(() => {
    if (!comparing || q.trim().length < 2) return setHits([]);
    const t = window.setTimeout(() => {
      wsApi.search(q.trim(), { limit: 6 }).then((r) => setHits(r.objects.filter((o) => o.id !== noteId))).catch(() => setHits([]));
    }, 180);
    return () => window.clearTimeout(t);
  }, [q, comparing, noteId]);

  async function run(action: AiActionKey, other_id?: string) {
    if (action === "compare" && !other_id) {
      setComparing(true);
      return;
    }
    setComparing(false);
    setBusy(action);
    setResult(null);
    try {
      const r = await aiApi.action(noteId, action, { language: action === "translate" ? language : undefined, other_id });
      setResult(r);
      setPicked(new Set(r.items || []));
    } catch (e) {
      toast.error(formatApiError(e));
    } finally {
      setBusy(null);
    }
  }

  async function append(text: string, summary: string) {
    try {
      const r = await aiApi.append(noteId, text, summary);
      onAppended(r.content);
      toast.success("Nota eklendi (yeni sürüm)");
      setResult(null);
    } catch (e) {
      toast.error(formatApiError(e));
    }
  }

  async function relate(targetId: string, why: string) {
    try {
      await wsApi.addRelation({ source_id: noteId, target_id: targetId, relation_type: "related_to", note: why || undefined });
      toast.success("İlişki kuruldu");
    } catch (e) {
      toast.error(formatApiError(e));
    }
  }

  if (locked) return null;

  return (
    <section className="mt-6 rounded-lg border border-border bg-card/60" data-testid="note-ai-panel">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 px-4 py-3 text-left"
        aria-expanded={open}
        data-testid="note-ai-toggle"
      >
        <Sparkles className="w-4 h-4 text-primary" />
        <span className="font-serif text-base font-bold">Yapay zeka</span>
        <span className="text-xs text-muted-foreground">özetle, çevir, görev ve etiket çıkar, bağlantı bul</span>
        <span className="ml-auto text-xs text-muted-foreground">{open ? "Gizle" : "Göster"}</span>
      </button>
      {open && (
        <div className="space-y-3 border-t border-border/70 px-4 py-3">
          {GROUPS.map((g) => (
            <div key={g.title} className="flex flex-wrap items-center gap-1.5">
              <span className="w-20 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{g.title}</span>
              {g.actions.map(([key, label]) => (
                <React.Fragment key={key}>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs"
                    disabled={busy !== null}
                    onClick={() => run(key)}
                    data-testid={`ai-action-${key}`}
                  >
                    {busy === key && <Loader2 className="w-3 h-3 mr-1 animate-spin" />}
                    {label}
                  </Button>
                  {key === "translate" && (
                    <select value={language} onChange={(e) => setLanguage(e.target.value)} className="h-7 rounded-md border border-input bg-background px-1.5 text-xs" aria-label="Hedef dil">
                      {LANGS.map((l) => (
                        <option key={l}>{l}</option>
                      ))}
                    </select>
                  )}
                </React.Fragment>
              ))}
            </div>
          ))}

          {comparing && (
            <div className="rounded-md border border-border bg-background p-2">
              <div className="relative">
                <Search className="absolute left-2 top-2 w-3.5 h-3.5 text-muted-foreground" />
                <Input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Karşılaştırılacak notu ara…" className="h-8 pl-7 text-sm" />
              </div>
              {hits.map((h) => (
                <button key={h.id} type="button" onClick={() => run("compare", h.id)} className="mt-1 flex w-full items-center gap-2 rounded px-2 py-1 text-left text-sm hover:bg-muted">
                  <span className="flex-1 truncate">{h.title}</span>
                  <span className="text-[11px] text-muted-foreground">{h.type_name}</span>
                </button>
              ))}
            </div>
          )}

          {result && (
            <div className="rounded-md border border-primary/30 bg-background p-3" data-testid="ai-result">
              <div className="mb-2 flex items-center gap-2 text-xs text-muted-foreground">
                <span className="font-semibold text-foreground">{result.label}</span>
                {result.provider && <span>· {result.provider}</span>}
                <button type="button" onClick={() => setResult(null)} className="ml-auto rounded p-1 hover:bg-muted" aria-label="Kapat">
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
              {result.warning && (
                <div className="mb-2 flex gap-2 rounded bg-amber-500/10 px-2 py-1.5 text-xs text-amber-700 dark:text-amber-300">
                  <AlertTriangle className="w-3.5 h-3.5 shrink-0" /> {result.warning}
                </div>
              )}

              {result.output === "text" && result.text && (
                <>
                  <div className="prose-sm max-w-none text-sm">
                    {result.citations && result.citations.length > 0 ? (
                      <CitedText text={result.text} citations={result.citations.map((c) => ({ ...c, snippet: "" }))} />
                    ) : (
                      <MarkdownView content={result.text} />
                    )}
                  </div>
                  <div className="mt-3 flex gap-2">
                    {!archived && (
                      <Button size="sm" className="h-7 text-xs" onClick={() => append(`## ${result.label}\n\n${result.text}`, `Yapay zeka: ${result.label}`)} data-testid="ai-append">
                        <Plus className="w-3.5 h-3.5 mr-1" /> Nota ekle
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 text-xs"
                      onClick={() => navigator.clipboard.writeText(result.text || "").then(() => toast.success("Kopyalandı"))}
                    >
                      <Copy className="w-3.5 h-3.5 mr-1" /> Kopyala
                    </Button>
                  </div>
                </>
              )}

              {(result.output === "tasks" || result.output === "tags") && (
                <>
                  {(result.items || []).length === 0 ? (
                    <p className="text-sm text-muted-foreground">Öneri yok.</p>
                  ) : (
                    <ul className="space-y-1">
                      {result.items!.map((it) => (
                        <li key={it}>
                          <label className="flex items-center gap-2 text-sm">
                            <input
                              type="checkbox"
                              checked={picked.has(it)}
                              onChange={(e) => {
                                const n = new Set(picked);
                                e.target.checked ? n.add(it) : n.delete(it);
                                setPicked(n);
                              }}
                            />
                            {result.output === "tags" ? `#${it}` : it}
                          </label>
                        </li>
                      ))}
                    </ul>
                  )}
                  {!archived && picked.size > 0 && (
                    <Button
                      size="sm"
                      className="mt-2 h-7 text-xs"
                      onClick={() =>
                        append(
                          result.output === "tags"
                            ? Array.from(picked).map((t) => `#${t}`).join(" ")
                            : `## ${result.label}\n${Array.from(picked).map((t) => `- [ ] ${t}`).join("\n")}`,
                          `Yapay zeka: ${result.label}`
                        )
                      }
                      data-testid="ai-append-items"
                    >
                      <Check className="w-3.5 h-3.5 mr-1" /> Seçilenleri nota ekle
                    </Button>
                  )}
                </>
              )}

              {result.output === "related" && (
                <ul className="space-y-2">
                  {(result.related || []).map((r) => (
                    <li key={r.note_id} className="flex items-start gap-2 text-sm">
                      <div className="min-w-0 flex-1">
                        <Link to={objectPath(r)} className="font-medium hover:underline">{r.title}</Link>
                        <span className="ml-2 text-[11px] text-muted-foreground">{r.type_name}{r.why ? ` · ${r.why}` : ""}</span>
                        <p className="line-clamp-2 text-xs text-muted-foreground">{r.snippet}</p>
                      </div>
                      <Button size="sm" variant="outline" className="h-7 shrink-0 text-xs" onClick={() => relate(r.note_id, r.why)}>
                        <Link2 className="w-3.5 h-3.5 mr-1" /> İlişki kur
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
