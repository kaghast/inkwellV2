import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { AtSign, Check, Hash, Kanban, Loader2, Search, X } from "lucide-react";
import PageShell, { Empty } from "@/components/PageShell";
import BulletGlyph from "@/components/journal/BulletGlyph";
import { taskToCard } from "@/components/journal/taskToCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import api, { formatApiError } from "@/lib/api";
import { taskPatchBody } from "@/lib/tasks";
import { JOURNAL_CHANGED, journalApi, notifyJournalChanged, objectPath, type BulletHit, type BulletSearch } from "@/lib/workspaceApi";

const FILTERS: Array<{ key: string; label: string; f: BulletSearch }> = [
  { key: "open", label: "Açık görevler", f: { state: "open" } },
  { key: "priority", label: "Öncelikli !", f: { signifier: "priority" } },
  { key: "explore", label: "Araştırılacak ?", f: { signifier: "explore" } },
  { key: "moved", label: "Taşınan ve planlanan", f: { state: "migrated,scheduled" } },
  { key: "done", label: "Yapılanlar", f: { state: "done" } },
  { key: "cancelled", label: "İptaller", f: { state: "cancelled" } },
  { key: "event", label: "Etkinlikler", f: { kind: "event" } },
  { key: "note", label: "Notlar", f: { kind: "note" } },
  { key: "all", label: "Tümü", f: {} },
];

/** A task that already points to another page (a card, a migration target). */
const LINKED = /→\s*\[\[[^\]]+\]\]\s*$/;

/** Plain reading of a bullet's text: wikilinks and markdown links show their label. */
const plain = (t: string) =>
  t
    .replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_m, a, b) => b || a)
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[*_`]/g, "");

/**
 * Bullets across all notes by kind, task state and signifier (Phase 2.5f):
 * every open task, every "!" item, what was carried forward. Rows link to
 * their page; open tasks can be ticked or turned into a Kanban card.
 */
export default function BulletsPage() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const filterKey = FILTERS.some((x) => x.key === params.get("f")) ? (params.get("f") as string) : "open";
  const [q, setQ] = useState(params.get("q") || "");
  const [tag, setTag] = useState(params.get("tag") || "");
  const [person, setPerson] = useState(params.get("person") || "");
  const [from, setFrom] = useState(params.get("from") || "");
  const [to, setTo] = useState(params.get("to") || "");
  const [data, setData] = useState<{ items: BulletHit[]; truncated: boolean } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const query = useMemo<BulletSearch>(() => {
    const base = FILTERS.find((x) => x.key === filterKey)!.f;
    return {
      ...base,
      q: params.get("q") || undefined,
      tag: params.get("tag") || undefined,
      person: params.get("person") || undefined,
      from: params.get("from") || undefined,
      to: params.get("to") || undefined,
    };
  }, [filterKey, params]);

  const load = useCallback(() => {
    journalApi
      .bullets(query)
      .then(setData)
      .catch((e) => toast.error(formatApiError(e)));
  }, [query]);

  useEffect(() => {
    setData(null);
    load();
  }, [load]);
  useEffect(() => {
    window.addEventListener(JOURNAL_CHANGED, load);
    return () => window.removeEventListener(JOURNAL_CHANGED, load);
  }, [load]);

  function setParam(next: Record<string, string>) {
    const p = new URLSearchParams(params);
    for (const [k, v] of Object.entries(next)) v ? p.set(k, v) : p.delete(k);
    setParams(p, { replace: true });
  }

  const groups = useMemo(() => {
    const out: Array<{ key: string; title: string; date: string; note: BulletHit; items: BulletHit[] }> = [];
    for (const it of data?.items || []) {
      const last = out[out.length - 1];
      if (last && last.key === it.note_id) last.items.push(it);
      else out.push({ key: it.note_id, title: it.title, date: it.date, note: it, items: [it] });
    }
    return out;
  }, [data]);

  async function tick(it: BulletHit) {
    if (it.taskIndex == null) return;
    setBusy(`${it.note_id}:${it.line}`);
    try {
      await api.patch(`/notes/${it.note_id}/tasks`, taskPatchBody(it.taskIndex, true));
      notifyJournalChanged();
    } catch (e) {
      toast.error(formatApiError(e));
    } finally {
      setBusy(null);
    }
  }

  async function card(it: BulletHit) {
    if (it.taskIndex == null) return;
    setBusy(`${it.note_id}:${it.line}`);
    await taskToCard(it.note_id, it.taskIndex, undefined, navigate);
    setBusy(null);
    load();
  }

  return (
    <PageShell title="Kayıtlar" subtitle="Bütün notlardaki satırlar: türe, duruma, işarete, #etikete ve @kişiye göre" wide>
      <div className="space-y-4" data-testid="bullets-page">
        <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Kayıt filtresi">
          {FILTERS.map((x) => (
            <button
              key={x.key}
              type="button"
              role="tab"
              aria-selected={x.key === filterKey}
              onClick={() => setParam({ f: x.key === "open" ? "" : x.key })}
              className={`rounded-full border px-3 py-1 text-xs transition-colors ${
                x.key === filterKey ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card hover:border-primary/40"
              }`}
              data-testid={`bullets-filter-${x.key}`}
            >
              {x.label}
            </button>
          ))}
        </div>

        <form
          className="flex flex-wrap items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            setParam({ q: q.trim(), tag: tag.trim().replace(/^#/, ""), person: person.trim().replace(/^@/, ""), from, to });
          }}
        >
          <div className="relative min-w-[12rem] flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Metinde ara" className="h-8 pl-8 text-sm" data-testid="bullets-q" />
          </div>
          <div className="relative w-32">
            <Hash className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-sky-500" />
            <Input value={tag} onChange={(e) => setTag(e.target.value)} placeholder="etiket" className="h-8 pl-7 text-sm" aria-label="Etiket" data-testid="bullets-tag" />
          </div>
          <div className="relative w-32">
            <AtSign className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-emerald-500" />
            <Input value={person} onChange={(e) => setPerson(e.target.value)} placeholder="kişi" className="h-8 pl-7 text-sm" aria-label="Kişi" data-testid="bullets-person" />
          </div>
          <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="h-8 w-auto text-xs" aria-label="Başlangıç tarihi" />
          <span className="text-xs text-muted-foreground">–</span>
          <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="h-8 w-auto text-xs" aria-label="Bitiş tarihi" />
          <Button type="submit" size="sm" variant="outline" className="h-8">
            Uygula
          </Button>
          {(params.get("tag") || params.get("person")) && (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-8 text-xs"
              onClick={() => {
                setTag("");
                setPerson("");
                setParam({ tag: "", person: "" });
              }}
            >
              <X className="mr-1 h-3.5 w-3.5" /> Etiket/kişi filtresini kaldır
            </Button>
          )}
        </form>

        {!data ? (
          <div className="text-sm text-muted-foreground">Yükleniyor…</div>
        ) : data.items.length === 0 ? (
          <Empty>Bu filtreye uyan kayıt yok.</Empty>
        ) : (
          <div className="space-y-3" data-testid="bullets-results">
            <p className="text-xs text-muted-foreground">
              {data.items.length} kayıt{data.truncated ? " (ilk 300; filtreyi daralt)" : ""}
            </p>
            {groups.map((g) => (
              <section key={g.key} className="rounded-lg border border-border bg-card">
                <Link
                  to={objectPath({ note_id: g.note.note_id, slug: g.note.slug })}
                  className="flex items-baseline gap-2 border-b border-border/60 px-3 py-2 hover:bg-muted/40"
                >
                  <span className="truncate text-sm font-medium">{g.title}</span>
                  <span className="ml-auto shrink-0 text-[11px] text-muted-foreground">{g.date}</span>
                </Link>
                <ul className="divide-y divide-border/40">
                  {g.items.map((it) => {
                    const id = `${it.note_id}:${it.line}`;
                    const open = it.kind === "task" && it.state === "open";
                    return (
                      <li key={id} className="group flex items-start gap-2.5 px-3 py-1.5 text-sm" data-testid="bullet-row">
                        <span className="mt-1">
                          {it.plain ? <span className="inline-block w-3.5 text-center text-muted-foreground">¶</span> : <BulletGlyph kind={it.kind} state={it.state} signifier={it.signifier} />}
                        </span>
                        <span
                          className={`min-w-0 flex-1 break-words [overflow-wrap:anywhere] ${
                            it.state === "cancelled" ? "line-through text-muted-foreground" : it.state && it.state !== "open" ? "text-muted-foreground" : ""
                          }`}
                        >
                          {plain(it.text)}
                        </span>
                        {busy === id ? (
                          <Loader2 className="mt-1 h-3.5 w-3.5 animate-spin text-muted-foreground" />
                        ) : (
                          open && (
                            <span className="flex shrink-0 gap-1 opacity-70 group-hover:opacity-100">
                              <Button size="sm" variant="ghost" className="h-6 px-1.5 text-[11px]" onClick={() => tick(it)} title="Tamamlandı" data-testid="bullet-done">
                                <Check className="h-3.5 w-3.5" />
                              </Button>
                              {!LINKED.test(it.text) && (
                                <Button size="sm" variant="ghost" className="h-6 px-1.5 text-[11px]" onClick={() => card(it)} title="Kanban kartı yap" data-testid="bullet-card">
                                  <Kanban className="h-3.5 w-3.5" />
                                </Button>
                              )}
                            </span>
                          )
                        )}
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))}
          </div>
        )}
      </div>
    </PageShell>
  );
}
