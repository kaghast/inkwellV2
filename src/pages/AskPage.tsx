import React, { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { AlertTriangle, ArrowUp, BookOpen, Loader2, Sparkles, X } from "lucide-react";
import PageShell, { Empty } from "@/components/PageShell";
import { Button } from "@/components/ui/button";
import { useWorkspace } from "@/contexts/WorkspaceContext";
import { formatApiError } from "@/lib/api";
import { aiApi, objectPath, type AskFilters, type AskResult } from "@/lib/workspaceApi";

/** Render an answer: [n] markers become links to the cited note; "- " lines become list items. */
export function CitedText({ text, citations }: { text: string; citations: AskResult["citations"] }) {
  const byN = new Map(citations.map((c) => [c.n, c]));
  const renderInline = (line: string, key: string) => {
    const parts: React.ReactNode[] = [];
    const re = /\[(\d{1,3}(?:\s*,\s*\d{1,3})*)\]|\*\*([^*]+)\*\*/g;
    let last = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(line)) !== null) {
      if (m.index > last) parts.push(line.slice(last, m.index));
      if (m[2]) parts.push(<strong key={`${key}-b${m.index}`}>{m[2]}</strong>);
      else
        m[1].split(",").forEach((x) => {
          const n = Number(x.trim());
          const c = byN.get(n);
          parts.push(
            c ? (
              <Link
                key={`${key}-c${m!.index}-${n}`}
                to={objectPath(c)}
                title={`${c.title}: ${c.snippet}`}
                className="mx-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded bg-primary/15 px-1 align-super text-[10px] font-bold text-primary hover:bg-primary hover:text-primary-foreground"
                data-testid={`citation-${n}`}
              >
                {n}
              </Link>
            ) : null
          );
        });
      last = m.index + m[0].length;
    }
    if (last < line.length) parts.push(line.slice(last));
    return parts;
  };
  const lines = text.split("\n");
  const blocks: React.ReactNode[] = [];
  let list: React.ReactNode[] = [];
  const flush = () => {
    if (list.length) blocks.push(<ul key={`ul-${blocks.length}`} className="ml-5 list-disc space-y-1">{list}</ul>);
    list = [];
  };
  lines.forEach((l, i) => {
    const li = l.match(/^\s*[-*]\s+(.*)$/);
    if (li) list.push(<li key={i}>{renderInline(li[1], `l${i}`)}</li>);
    else {
      flush();
      if (l.trim()) blocks.push(<p key={i}>{renderInline(l.replace(/^#+\s*/, ""), `p${i}`)}</p>);
    }
  });
  flush();
  return <div className="space-y-2 leading-relaxed">{blocks}</div>;
}

function SignalBadges({ s }: { s: AskResult["sources"][number]["signals"] }) {
  const items = [s.text > 0 && "metin", s.semantic >= 0.55 && "anlam", s.relation > 0 && "ilişki"].filter(Boolean) as string[];
  return (
    <span className="flex gap-1">
      {items.map((i) => (
        <span key={i} className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">{i}</span>
      ))}
    </span>
  );
}

export default function AskPage() {
  const [params, setParams] = useSearchParams();
  const { noteTypes, spaces } = useWorkspace();
  const [q, setQ] = useState(params.get("q") || "");
  const [filters, setFilters] = useState<AskFilters>({});
  const [busy, setBusy] = useState(false);
  const [history, setHistory] = useState<AskResult[]>([]);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  async function submit(question = q) {
    const text = question.trim();
    if (text.length < 2 || busy) return;
    setBusy(true);
    try {
      const r = await aiApi.ask(text, filters);
      setHistory((h) => [r, ...h]);
      setQ("");
    } catch (e) {
      toast.error(formatApiError(e));
    } finally {
      setBusy(false);
      inputRef.current?.focus();
    }
  }

  // ?q= from the command palette asks immediately
  useEffect(() => {
    const pre = params.get("q");
    if (pre) {
      setParams({}, { replace: true });
      submit(pre);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const activeFilters = Object.entries(filters).filter(([, v]) => v);
  const sel = "h-8 rounded-md border border-input bg-background px-2 text-xs";

  return (
    <PageShell title="Ask Inkwell" subtitle="Notlarına sor. Her yanıt, dayandığı notları kaynak olarak gösterir." wide>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
        className="rounded-xl border border-border bg-card p-3 shadow-xs"
      >
        <div className="flex items-end gap-2">
          <Sparkles className="mb-2 w-5 h-5 shrink-0 text-primary" aria-hidden />
          <textarea
            ref={inputRef}
            autoFocus
            rows={Math.min(5, Math.max(1, q.split("\n").length))}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
            placeholder="Örn. Proje Atlas'ta hangi kararları aldık?"
            aria-label="Soru"
            className="flex-1 resize-none bg-transparent py-1.5 text-base outline-none placeholder:text-muted-foreground"
            data-testid="ask-input"
          />
          <Button type="submit" size="icon" disabled={busy || q.trim().length < 2} aria-label="Sor" data-testid="ask-submit">
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowUp className="w-4 h-4" />}
          </Button>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-border/60 pt-2 text-xs text-muted-foreground">
          <span>Kapsam:</span>
          <select className={sel} value={filters.type_id || ""} onChange={(e) => setFilters({ ...filters, type_id: e.target.value || undefined })} aria-label="Nesne tipi">
            <option value="">Tüm tipler</option>
            {noteTypes.map((t) => (
              <option key={t.type_id} value={t.type_id}>{t.name}</option>
            ))}
          </select>
          {spaces.length > 1 && (
            <select className={sel} value={filters.space_id || ""} onChange={(e) => setFilters({ ...filters, space_id: e.target.value || undefined })} aria-label="Bölüm">
              <option value="">Tüm bölümler</option>
              {spaces.map((s) => (
                <option key={s.space_id} value={s.space_id}>{s.name}</option>
              ))}
            </select>
          )}
          <label className="flex items-center gap-1">
            Başlangıç
            <input type="date" className={sel} value={filters.date_from || ""} onChange={(e) => setFilters({ ...filters, date_from: e.target.value || undefined })} />
          </label>
          <label className="flex items-center gap-1">
            Bitiş
            <input type="date" className={sel} value={filters.date_to || ""} onChange={(e) => setFilters({ ...filters, date_to: e.target.value || undefined })} />
          </label>
          <input
            className={`${sel} w-28`}
            placeholder="#etiket"
            value={filters.tag || ""}
            onChange={(e) => setFilters({ ...filters, tag: e.target.value.replace(/^#/, "") || undefined })}
            aria-label="Etiket"
          />
          {activeFilters.length > 0 && (
            <button type="button" onClick={() => setFilters({})} className="inline-flex items-center gap-1 hover:text-foreground">
              <X className="w-3 h-3" /> Temizle
            </button>
          )}
        </div>
      </form>

      {history.length === 0 && !busy && (
        <Empty>
          <span className="block mt-4">
            Inkwell yalnızca senin notlarından yanıt verir ve kaynağı olmayan bir şey söylemez. Yapay zeka kapalıysa soruyla ilgili notları listeler.
          </span>
        </Empty>
      )}

      <div className="mt-5 space-y-6" data-testid="ask-results">
        {history.map((r, idx) => (
          <article key={`${idx}-${r.question}`} className="rounded-lg border border-border bg-card">
            <header className="border-b border-border/70 px-4 py-3">
              <h2 className="font-serif text-lg font-semibold">{r.question}</h2>
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                {r.provider ? `${r.provider} · ` : ""}
                {r.sources.length} kaynak · {r.semantic ? "anlamsal + metin araması" : "metin araması"}
              </p>
            </header>
            <div className="px-4 py-3 text-sm">
              {r.warning && (
                <div className="mb-3 flex gap-2 rounded-md bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
                  <AlertTriangle className="w-4 h-4 shrink-0" /> {r.warning}
                </div>
              )}
              {r.answer ? <CitedText text={r.answer} citations={r.citations} /> : r.mode === "sources_only" && <p className="text-muted-foreground">İlgili notlar aşağıda.</p>}
            </div>
            {r.sources.length > 0 && (
              <footer className="border-t border-border/70 px-4 py-3">
                <h3 className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  <BookOpen className="w-3.5 h-3.5" /> Kaynaklar
                </h3>
                <ol className="space-y-2">
                  {r.sources.map((s) => {
                    const cited = r.citations.some((c) => c.n === s.n);
                    return (
                      <li key={s.n} className={`flex gap-2 text-sm ${cited || r.mode !== "answer" ? "" : "opacity-60"}`}>
                        <span className="mt-0.5 inline-flex h-5 min-w-5 items-center justify-center rounded bg-muted text-[11px] font-bold">{s.n}</span>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <Link to={objectPath(s)} className="font-medium hover:underline">{s.title}</Link>
                            <span className="text-[11px] text-muted-foreground">{s.type_name} · {s.date.slice(0, 10)}</span>
                            <SignalBadges s={s.signals} />
                          </div>
                          <p className="line-clamp-2 text-xs text-muted-foreground">{s.snippet}</p>
                        </div>
                      </li>
                    );
                  })}
                </ol>
              </footer>
            )}
          </article>
        ))}
      </div>
    </PageShell>
  );
}
