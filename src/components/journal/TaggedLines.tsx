import React, { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import BulletGlyph from "@/components/journal/BulletGlyph";
import { JOURNAL_CHANGED, journalApi, objectPath, type BulletHit } from "@/lib/workspaceApi";

const SHOWN = 12;

const plain = (t: string) =>
  t
    .replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_m, a, b) => b || a)
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[*_`]/g, "");

/**
 * The lines (not whole notes) that carry a "#tag" or mention an "@person",
 * across every note. Shown on the tag and person views above the notes.
 */
export default function TaggedLines({ tag, person }: { tag?: string; person?: string }) {
  const [items, setItems] = useState<BulletHit[] | null>(null);
  const [truncated, setTruncated] = useState(false);

  useEffect(() => {
    let alive = true;
    const load = () =>
      journalApi
        .bullets({ tag, person })
        .then((r) => {
          if (!alive) return;
          setItems(r.items);
          setTruncated(r.truncated);
        })
        .catch(() => alive && setItems([]));
    setItems(null);
    load();
    window.addEventListener(JOURNAL_CHANGED, load);
    return () => {
      alive = false;
      window.removeEventListener(JOURNAL_CHANGED, load);
    };
  }, [tag, person]);

  const shown = useMemo(() => (items || []).slice(0, SHOWN), [items]);
  if (!items || items.length === 0) return null;
  const label = tag ? `#${tag}` : `@${person}`;
  const all = `/journal/bullets?f=all&${tag ? `tag=${encodeURIComponent(tag)}` : `person=${encodeURIComponent(person || "")}`}`;

  return (
    <section className="mb-6 rounded-lg border border-border bg-card" data-testid="tagged-lines">
      <div className="flex items-baseline gap-2 border-b border-border/60 px-3 py-2">
        <span className="text-sm font-medium">{label} geçen satırlar</span>
        <span className="text-[11px] text-muted-foreground">
          {items.length}
          {truncated ? "+" : ""}
        </span>
        <Link to={all} className="ml-auto inline-flex items-center gap-1 text-xs text-primary hover:underline">
          Tümü <ArrowRight className="h-3 w-3" />
        </Link>
      </div>
      <ul className="divide-y divide-border/40">
        {shown.map((it) => (
          <li key={`${it.note_id}:${it.line}`} className="flex items-start gap-2.5 px-3 py-1.5 text-sm" data-testid="tagged-line">
            <span className="mt-1">
              {it.plain ? <span className="inline-block w-3.5 text-center text-muted-foreground">¶</span> : <BulletGlyph kind={it.kind} state={it.state} signifier={it.signifier} />}
            </span>
            <span className={`min-w-0 flex-1 break-words ${it.state && it.state !== "open" ? "text-muted-foreground" : ""} ${it.state === "cancelled" ? "line-through" : ""}`}>
              {plain(it.text)}
            </span>
            <Link to={objectPath({ note_id: it.note_id, slug: it.slug })} className="shrink-0 truncate text-[11px] text-muted-foreground hover:text-foreground max-w-[40%]" title={it.title}>
              {it.title} · {it.date}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
