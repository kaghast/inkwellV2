import React from "react";
import { FolderTree, Plus } from "lucide-react";
import { toast } from "sonner";
import { formatApiError } from "@/lib/api";
import AreaPicker from "@/components/areas/AreaPicker";
import AreaField from "@/components/areas/AreaField";
import { AreaChips } from "@/components/areas/AreaChips";
import { useAreas } from "@/components/areas/useAreas";
import { rememberRecentAreas, setNoteAreas } from "@/lib/areas";

export { AreaChips };

interface NoteAreasBarProps {
  noteId: string;
  value: string[];
  onChange: (ids: string[]) => void;
  /** "bar": labelled row on the note page; "card": compact chips in a note card footer. */
  variant?: "bar" | "card";
  disabled?: boolean;
}

/**
 * Read-mode bar on a note: shows linked areas and lets the user add/remove them.
 * Changes are saved immediately (no edit mode, no new note version).
 */
export default function NoteAreasBar({ noteId, value, onChange, variant = "bar", disabled }: NoteAreasBarProps) {
  const [areas, addArea] = useAreas();

  const save = async (ids: string[]) => {
    const previous = value;
    onChange(ids); // optimistic
    try {
      const saved = await setNoteAreas(noteId, ids);
      onChange(saved);
      rememberRecentAreas(saved.filter((id) => !previous.includes(id)));
    } catch (err) {
      onChange(previous);
      toast.error(formatApiError(err));
    }
  };

  if (variant === "card") {
    return <AreaField variant="card" value={value} onChange={save} disabled={disabled} />;
  }

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
        onAreaCreated={addArea}
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
