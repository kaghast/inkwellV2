import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Scissors, X, CheckSquare, Square, Code2, Table2, Quote, Minus } from "lucide-react";
import { toast } from "sonner";
import api, { formatApiError } from "@/lib/api";
import type { Note } from "@/types";
import { Button } from "@/components/ui/button";
import { extractCommentsFromContent, embedCommentsIntoContent } from "@/lib/comments";
import { groupUnits, joinUnits, splitIntoUnits, titleForPart, type SplitUnit } from "@/lib/noteSplitMerge";

/** Content modes whose body is not line-based markdown and cannot be cut by lines. */
export function canSplitNote(note: Note): boolean {
  if (note.archived || note.is_encrypted) return false;
  const mode = note.custom_fields?.content_mode;
  if (mode === "mindmap" || mode === "drawing" || mode === "outline") return false;
  const body = extractCommentsFromContent(note.content || "").mainContent;
  if (/```(mindmap|drawing)\s/.test(body)) return false;
  return splitIntoUnits(body).length >= 2;
}

interface Props {
  note: Note;
  onCancel: () => void;
  /** Called after the split: the updated original note and the notes created from the other parts. */
  onDone: (updated: Note, created: Note[]) => void;
  compact?: boolean;
}

const PART_COLORS = ["#64748b", "#f59e0b", "#0ea5e9", "#10b981", "#ec4899", "#8b5cf6", "#ef4444", "#14b8a6"];

function UnitPreview({ unit, compact }: { unit: SplitUnit; compact?: boolean }) {
  const muted = "text-muted-foreground";
  switch (unit.kind) {
    case "heading":
      return (
        <span
          className={`font-serif font-bold text-foreground ${
            unit.level === 1 ? (compact ? "text-base" : "text-lg") : unit.level === 2 ? "text-[15px]" : "text-sm"
          }`}
        >
          {unit.preview || "Başlık"}
        </span>
      );
    case "task":
      return (
        <span className="inline-flex items-start gap-1.5">
          {unit.checked ? (
            <CheckSquare className="w-3.5 h-3.5 mt-0.5 text-emerald-500 shrink-0" />
          ) : (
            <Square className={`w-3.5 h-3.5 mt-0.5 shrink-0 ${muted}`} />
          )}
          <span className={unit.checked ? `line-through ${muted}` : ""}>{unit.preview}</span>
        </span>
      );
    case "list":
      return (
        <span className="inline-flex items-start gap-1.5">
          <span className={`mt-[7px] w-1 h-1 rounded-full bg-current shrink-0 ${muted}`} />
          <span>{unit.preview}</span>
        </span>
      );
    case "quote":
      return (
        <span className={`inline-flex items-start gap-1.5 italic ${muted}`}>
          <Quote className="w-3 h-3 mt-1 shrink-0" />
          {unit.preview}
        </span>
      );
    case "code":
      return (
        <span className={`inline-flex items-center gap-1.5 font-mono text-[11px] ${muted}`}>
          <Code2 className="w-3.5 h-3.5" /> {unit.preview} · {Math.max(0, unit.raw.trimEnd().split("\n").length - 2)} satır
        </span>
      );
    case "table":
      return (
        <span className={`inline-flex items-center gap-1.5 text-[11px] ${muted}`}>
          <Table2 className="w-3.5 h-3.5" /> {unit.preview}
        </span>
      );
    case "hr":
      return (
        <span className={`inline-flex items-center gap-1.5 text-[11px] ${muted}`}>
          <Minus className="w-3.5 h-3.5" /> ayırıcı çizgi
        </span>
      );
    default:
      return <span>{unit.preview}</span>;
  }
}

/**
 * Inline "Notu Böl" mode for a note card: every line (code blocks and tables as a
 * whole) is listed, and clicking a line starts a new note from that line. Several
 * cuts can be placed; saving turns each part after a cut into a new note.
 */
export default function NoteSplitView({ note, onCancel, onDone, compact }: Props) {
  const navigate = useNavigate();
  const { mainContent, comments } = useMemo(() => extractCommentsFromContent(note.content || ""), [note.content]);
  const units = useMemo(() => splitIntoUnits(mainContent), [mainContent]);
  const [cuts, setCuts] = useState<number[]>([]);
  const [busy, setBusy] = useState(false);

  const parts = useMemo(() => groupUnits(units, cuts), [units, cuts]);
  const partStart = useMemo(() => {
    // unit index -> part number (0-based)
    const map: number[] = [];
    let p = 0;
    const set = new Set(cuts);
    units.forEach((_u, idx) => {
      if (idx > 0 && set.has(idx)) p++;
      map[idx] = p;
    });
    return map;
  }, [units, cuts]);
  const titles = useMemo(
    () => parts.map((p, idx) => (idx === 0 ? note.title || "Başlıksız Not" : titleForPart(p, note.title, idx + 1))),
    [parts, note.title]
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onCancel]);

  const toggleCut = (idx: number) => {
    if (idx <= 0 || busy) return;
    setCuts((prev) => (prev.includes(idx) ? prev.filter((c) => c !== idx) : [...prev, idx].sort((a, b) => a - b)));
  };

  async function apply() {
    if (parts.length < 2 || busy) return;
    setBusy(true);
    const created: Note[] = [];
    try {
      // Create the new notes first; the original is only changed once all of them exist.
      for (let i = 1; i < parts.length; i++) {
        const { data } = await api.post<Note>("/notes", {
          title: titles[i],
          content: joinUnits(parts[i]),
          date: note.date,
          location_id: note.location_id || null,
          category_id: note.category_id || null,
          note_type_id: note.note_type_id || null,
          custom_fields: note.custom_fields || {},
          area_ids: note.area_ids || [],
        });
        created.push(data);
      }
      const { data: updated } = await api.put<Note>(`/notes/${note.note_id}`, {
        content: embedCommentsIntoContent(joinUnits(parts[0]), comments),
        change_summary: `Not ${parts.length} parçaya bölündü`,
      });
      onDone(updated, created);
      const first = created[0];
      toast.success(`Not ${parts.length} nota bölündü`, {
        description: created.map((n) => n.title).join(", "),
        action: first
          ? { label: "Yeni notu aç", onClick: () => navigate(`/note/${first.slug || first.note_id}`) }
          : undefined,
      });
    } catch (err) {
      // Roll back the notes created so far so a failure never leaves duplicates behind.
      await Promise.all(created.map((n) => api.delete(`/notes/${n.note_id}`).catch(() => undefined)));
      toast.error(formatApiError(err) || "Not bölünemedi");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-3 rounded-lg border border-amber-500/40 bg-amber-500/[0.03]" data-testid={`note-split-view-${note.note_id}`}>
      <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 border-b border-amber-500/30 bg-amber-500/10 rounded-t-lg">
        <div className="flex items-center gap-2 text-xs text-amber-800 dark:text-amber-300 min-w-0">
          <Scissors className="w-3.5 h-3.5 shrink-0" />
          <span className="font-semibold">Notu böl</span>
          <span className="hidden sm:inline text-amber-800/80 dark:text-amber-300/80 truncate">
            Yeni notun başlayacağı satıra tıkla
          </span>
        </div>
        <div className="flex items-center gap-1.5 ml-auto">
          <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={onCancel} disabled={busy}>
            İptal
          </Button>
          <Button
            size="sm"
            className="h-7 text-xs bg-amber-500 text-amber-950 hover:bg-amber-400"
            onClick={apply}
            disabled={parts.length < 2 || busy}
            data-testid="note-split-apply"
          >
            {busy ? "Bölünüyor..." : parts.length < 2 ? "Kesim seç" : `${parts.length} nota böl`}
          </Button>
        </div>
      </div>

      <ol className="py-1.5" aria-label="Not satırları">
        {units.map((unit, idx) => {
          const isCut = idx > 0 && cuts.includes(idx);
          const part = partStart[idx];
          const color = PART_COLORS[part % PART_COLORS.length];
          return (
            <li key={idx}>
              {isCut && (
                <div className="flex items-center gap-2 px-2 pt-2 pb-1" data-testid={`note-split-cut-${idx}`}>
                  <div className="flex-1 border-t-2 border-dashed" style={{ borderColor: color }} />
                  <span
                    className="inline-flex items-center gap-1 max-w-[70%] rounded-full px-2 py-0.5 text-[11px] font-medium text-white"
                    style={{ background: color }}
                  >
                    <Scissors className="w-3 h-3 shrink-0" />
                    <span className="truncate">Yeni not: {titles[part]}</span>
                    <button
                      type="button"
                      onClick={() => toggleCut(idx)}
                      className="ml-0.5 rounded-full hover:bg-white/25 p-0.5"
                      title="Bu kesimi kaldır"
                      aria-label="Bu kesimi kaldır"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </span>
                  <div className="w-3 border-t-2 border-dashed" style={{ borderColor: color }} />
                </div>
              )}
              <button
                type="button"
                onClick={() => toggleCut(idx)}
                disabled={idx === 0 || busy}
                className={`group/line relative w-full text-left flex items-start gap-2 pl-3 pr-2 py-1 text-sm leading-relaxed text-foreground/90 border-l-[3px] transition-colors ${
                  idx === 0 ? "cursor-default" : "cursor-pointer hover:bg-amber-500/10"
                }`}
                style={{ borderLeftColor: `${color}${part === 0 ? "55" : "cc"}` }}
                title={idx === 0 ? undefined : isCut ? "Kesimi kaldır" : "Yeni not bu satırdan başlasın"}
                data-testid={`note-split-line-${idx}`}
              >
                {idx > 0 && !isCut && (
                  <span className="pointer-events-none absolute left-0 right-0 -top-px border-t border-dashed border-amber-500 opacity-0 group-hover/line:opacity-100 group-focus-visible/line:opacity-100" />
                )}
                <span className="min-w-0 flex-1 break-words">
                  <UnitPreview unit={unit} compact={compact} />
                </span>
                {idx > 0 && !isCut && (
                  <span className="shrink-0 inline-flex items-center gap-1 text-[10px] text-amber-700 dark:text-amber-300 opacity-0 group-hover/line:opacity-100 group-focus-visible/line:opacity-100">
                    <Scissors className="w-3 h-3" />
                    <span className="hidden sm:inline">Buradan kes</span>
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ol>

      <div className="px-3 py-2 border-t border-amber-500/20 text-[11px] text-muted-foreground">
        {parts.length < 2
          ? "Birden fazla kesim ekleyebilirsin. Yorumlar bu notta kalır; yeni notlar tarih, konum, tür ve alanları devralır."
          : `Bu not ilk parçayı tutar; ${parts.length - 1} yeni not oluşturulur. Yorumlar bu notta kalır.`}
      </div>
    </div>
  );
}
