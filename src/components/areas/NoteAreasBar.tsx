import React, { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { FolderTree, Plus, X } from "lucide-react";
import { toast } from "sonner";
import { formatApiError } from "@/lib/api";
import type { Area } from "@/types";
import AreaPicker from "@/components/areas/AreaPicker";
import { areaColor, areaMap, areaPath, fetchAreas, setNoteAreas } from "@/lib/areas";

interface AreaChipsProps {
  areas: Area[];
  value: string[];
  onRemove?: (id: string) => void;
}

/** Coloured chips showing the full "Ana › Alt" path of each linked area. */
export function AreaChips({ areas, value, onRemove }: AreaChipsProps) {
  const byId = useMemo(() => areaMap(areas), [areas]);
  return (
    <>
      {value
        .map((id) => byId[id])
        .filter(Boolean)
        .map((a) => {
          const color = areaColor(a, byId);
          return (
            <span
              key={a.area_id}
              className="inline-flex items-center gap-1 max-w-[16rem] rounded-full border pl-2 pr-1 py-0.5 text-xs"
              style={{ borderColor: `${color}66`, background: `${color}14` }}
              title={areaPath(a, byId)}
            >
              <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: color }} />
              <Link to={`/graph?area=${a.area_id}`} className="truncate hover:underline">
                {areaPath(a, byId)}
              </Link>
              {a.archived && <span className="text-[9px] uppercase text-muted-foreground">arşiv</span>}
              {onRemove && (
                <button
                  type="button"
                  onClick={() => onRemove(a.area_id)}
                  className="p-0.5 rounded-full text-muted-foreground hover:text-foreground hover:bg-background"
                  title="Bu alandan çıkar"
                >
                  <X className="w-3 h-3" />
                </button>
              )}
            </span>
          );
        })}
    </>
  );
}

interface NoteAreasBarProps {
  noteId: string;
  value: string[];
  onChange: (ids: string[]) => void;
}

/**
 * Read-mode bar on a note: shows linked areas and lets the user add/remove them.
 * Changes are saved immediately (no edit mode, no new note version).
 */
export default function NoteAreasBar({ noteId, value, onChange }: NoteAreasBarProps) {
  const [areas, setAreas] = useState<Area[]>([]);

  useEffect(() => {
    fetchAreas().then(setAreas).catch(() => setAreas([]));
  }, []);

  const save = async (ids: string[]) => {
    const previous = value;
    onChange(ids); // optimistic
    try {
      const saved = await setNoteAreas(noteId, ids);
      onChange(saved);
    } catch (err) {
      onChange(previous);
      toast.error(formatApiError(err));
    }
  };

  return (
    <div className="mb-5 flex flex-wrap items-center gap-1.5" data-testid="note-areas-bar">
      <span className="inline-flex items-center gap-1 text-[11px] uppercase tracking-[0.15em] text-muted-foreground mr-1">
        <FolderTree className="w-3 h-3" strokeWidth={1.5} /> Alanlar
      </span>
      <AreaChips areas={areas} value={value} onRemove={(id) => save(value.filter((x) => x !== id))} />
      <AreaPicker
        areas={areas}
        value={value}
        onChange={save}
        onAreaCreated={(a) => setAreas((prev) => [...prev, a])}
        trigger={
          <button
            type="button"
            className="inline-flex items-center gap-1 rounded-full border border-dashed border-border px-2 py-0.5 text-xs text-muted-foreground hover:text-foreground hover:border-foreground/40 transition-colors"
            data-testid="note-areas-add"
          >
            <Plus className="w-3 h-3" />
            {value.length === 0 ? "Alana bağla" : "Ekle"}
          </button>
        }
      />
    </div>
  );
}
