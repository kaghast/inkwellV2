import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { ArrowLeftRight, Link2, Loader2, Plus, Search, Trash2, Check } from "lucide-react";
import TypeIcon from "@/components/TypeIcon";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useWorkspace } from "@/contexts/WorkspaceContext";
import { formatApiError } from "@/lib/api";
import { objectPath, wsApi, type Relation, type RelationType, type SearchHit } from "@/lib/workspaceApi";

const ORIGIN_LABEL: Record<Relation["origin"], string> = {
  wikilink: "[[ ]]",
  manual: "elle",
  template: "şablon",
  capture: "yakalama",
  ai: "öneri",
};

/**
 * Typed relations of one object: outgoing and incoming (backlinks), grouped by
 * label. Wikilink relations mirror the text and are edited there. Also hosts
 * the object's Space (Bölüm) picker.
 */
export default function ObjectRelationsPanel({ noteId, spaceId, onSpaceChange }: { noteId: string; spaceId?: string | null; onSpaceChange?: (id: string) => void }) {
  const { spaces, refreshSpaces } = useWorkspace();
  const [data, setData] = useState<{ outgoing: Relation[]; incoming: Relation[] } | null>(null);
  const [types, setTypes] = useState<RelationType[]>([]);
  const [adding, setAdding] = useState(false);
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [relType, setRelType] = useState("related_to");
  const [reverse, setReverse] = useState(false);
  const [newType, setNewType] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    wsApi.relations(noteId).then(setData).catch(() => setData({ outgoing: [], incoming: [] }));
  }, [noteId]);

  useEffect(() => {
    load();
  }, [load]);
  useEffect(() => {
    if (adding && types.length === 0) wsApi.relationTypes().then(setTypes).catch(() => undefined);
  }, [adding, types.length]);

  useEffect(() => {
    if (!adding || q.trim().length < 2) return setHits([]);
    const t = window.setTimeout(() => {
      wsApi.search(q.trim(), { limit: 8 }).then((r) => setHits(r.objects.filter((o) => o.id !== noteId))).catch(() => setHits([]));
    }, 180);
    return () => window.clearTimeout(t);
  }, [q, adding, noteId]);

  const all = useMemo(() => [...(data?.outgoing || []), ...(data?.incoming || [])], [data]);
  const groups = useMemo(() => {
    const m = new Map<string, Relation[]>();
    for (const r of all) {
      const k = r.status === "suggested" ? "Öneriler" : r.label;
      m.set(k, [...(m.get(k) || []), r]);
    }
    return Array.from(m.entries()).sort(([a], [b]) => (a === "Öneriler" ? 1 : b === "Öneriler" ? -1 : a.localeCompare(b, "tr")));
  }, [all]);
  const backlinks = data?.incoming.filter((r) => r.status === "active").length || 0;
  const selectable = types.filter((t) => t.type_key !== "links_to" && t.type_key !== "captured_on");
  const chosen = types.find((t) => t.type_key === relType);

  async function add(target: SearchHit) {
    setBusy(true);
    try {
      let key = relType;
      if (relType === "__new") {
        if (!newType.trim()) throw new Error("İlişki adı gerekli");
        const t = await wsApi.createRelationType({ label: newType.trim() });
        setTypes((ts) => [...ts, t]);
        key = t.type_key;
        setRelType(key);
        setNewType("");
      }
      await wsApi.addRelation(reverse ? { source_id: target.id, target_id: noteId, relation_type: key } : { source_id: noteId, target_id: target.id, relation_type: key });
      toast.success("İlişki eklendi");
      setQ("");
      setHits([]);
      load();
    } catch (e: any) {
      toast.error(e?.response ? formatApiError(e) : e.message);
    } finally {
      setBusy(false);
    }
  }

  async function remove(r: Relation) {
    try {
      await wsApi.removeRelation(r.relation_id);
      load();
    } catch (e) {
      toast.error(formatApiError(e));
    }
  }
  async function accept(r: Relation) {
    try {
      await wsApi.acceptRelation(r.relation_id);
      load();
    } catch (e) {
      toast.error(formatApiError(e));
    }
  }

  async function moveSpace(id: string) {
    try {
      await wsApi.moveToSpace(noteId, id);
      onSpaceChange?.(id);
      refreshSpaces();
      toast.success("Bölüm değiştirildi");
    } catch (e) {
      toast.error(formatApiError(e));
    }
  }

  return (
    <section className="mt-8 rounded-lg border border-border bg-card/60 p-4" data-testid="object-relations">
      <div className="flex flex-wrap items-center gap-2">
        <ArrowLeftRight className="w-4 h-4 text-primary" />
        <h3 className="font-serif text-base font-bold">İlişkiler</h3>
        <span className="text-xs text-muted-foreground">{all.length} ilişki · {backlinks} geri bağlantı</span>
        <div className="ml-auto flex items-center gap-2">
          {spaces.length > 0 && (
            <label className="flex items-center gap-1 text-xs text-muted-foreground">
              Bölüm
              <select
                value={spaceId || spaces.find((s) => s.is_default)?.space_id}
                onChange={(e) => moveSpace(e.target.value)}
                className="h-7 rounded-md border border-input bg-background px-1.5 text-xs text-foreground"
                data-testid="object-space-select"
              >
                {spaces.filter((s) => !s.archived || s.space_id === spaceId).map((s) => (
                  <option key={s.space_id} value={s.space_id}>{s.name}</option>
                ))}
              </select>
            </label>
          )}
          <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setAdding((a) => !a)} data-testid="add-relation-btn">
            <Plus className="w-3.5 h-3.5 mr-1" /> İlişki ekle
          </Button>
        </div>
      </div>

      {adding && (
        <div className="mt-3 space-y-2 rounded-md border border-border bg-background p-3">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="text-muted-foreground">{reverse ? "Seçilen nesne" : "Bu nesne"}</span>
            <select value={relType} onChange={(e) => setRelType(e.target.value)} className="h-7 rounded-md border border-input bg-background px-1.5 text-xs" aria-label="İlişki tipi" data-testid="relation-type-select">
              {selectable.map((t) => (
                <option key={t.type_key} value={t.type_key}>{t.label}</option>
              ))}
              <option value="__new">Yeni ilişki tipi…</option>
            </select>
            <span className="text-muted-foreground">{reverse ? "bu nesne" : "seçilen nesne"}</span>
            {chosen && !chosen.symmetric && (
              <button type="button" onClick={() => setReverse((r) => !r)} className="ml-1 inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-muted-foreground hover:bg-muted">
                <ArrowLeftRight className="w-3 h-3" /> Yönü çevir
              </button>
            )}
            {relType === "__new" && <Input value={newType} onChange={(e) => setNewType(e.target.value)} placeholder="ör. danışmanı" className="h-7 w-40 text-xs" />}
          </div>
          <div className="relative">
            <Search className="absolute left-2 top-2 w-3.5 h-3.5 text-muted-foreground" />
            <Input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Bağlanacak nesneyi ara…" className="h-8 pl-7 text-sm" data-testid="relation-search" />
          </div>
          {hits.length > 0 && (
            <ul className="max-h-56 overflow-auto rounded-md border border-border">
              {hits.map((h) => (
                <li key={h.id}>
                  <button type="button" disabled={busy} onClick={() => add(h)} className="flex w-full items-center gap-2 px-2 py-1.5 text-left text-sm hover:bg-muted">
                    {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Link2 className="w-3.5 h-3.5 text-muted-foreground" />}
                    <span className="flex-1 truncate">{h.title}</span>
                    <span className="text-[11px] text-muted-foreground">{h.type_name}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {data === null ? (
        <p className="mt-3 text-sm text-muted-foreground">Yükleniyor…</p>
      ) : all.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">Henüz ilişki yok. Metne [[Başlık]] yazarak ya da “İlişki ekle” ile bağlayabilirsin.</p>
      ) : (
        <div className="mt-3 space-y-3">
          {groups.map(([label, rels]) => (
            <div key={label}>
              <div className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</div>
              <ul className="space-y-0.5">
                {rels.map((r) => (
                  <li key={r.relation_id} className="group flex items-center gap-2 rounded-md px-1 py-1 text-sm hover:bg-muted/50">
                    <TypeIcon icon={r.object.type_icon} color={r.object.type_color} />
                    <Link to={objectPath(r.object)} className={`flex-1 truncate hover:underline ${r.object.archived ? "text-muted-foreground line-through" : ""}`}>
                      {r.object.title}
                    </Link>
                    {r.note && <span className="hidden truncate text-[11px] text-muted-foreground md:inline max-w-[40%]">{r.note}</span>}
                    <span className="text-[10px] text-muted-foreground" title="Kaynak">{ORIGIN_LABEL[r.origin]}</span>
                    {r.status === "suggested" && (
                      <button type="button" onClick={() => accept(r)} className="rounded p-1 text-emerald-600 hover:bg-muted" aria-label="Öneriyi kabul et"><Check className="w-3.5 h-3.5" /></button>
                    )}
                    {r.origin !== "wikilink" && (
                      <button type="button" onClick={() => remove(r)} className="rounded p-1 text-muted-foreground opacity-0 hover:bg-muted hover:text-destructive group-hover:opacity-100 focus:opacity-100" aria-label="İlişkiyi kaldır">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
