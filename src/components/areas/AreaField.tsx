import React, { useMemo } from "react";
import { FolderTree, Plus } from "lucide-react";
import type { Area } from "@/types";
import AreaPicker from "@/components/areas/AreaPicker";
import { AreaChips } from "@/components/areas/AreaChips";
import { useAreas } from "@/components/areas/useAreas";
import { areaColor, areaMap, getRecentAreaIds, isEffectivelyArchived } from "@/lib/areas";

interface Props {
  value: string[];
  onChange: (ids: string[]) => void;
  /** "composer": labelled row with recent-area suggestions; "card": compact chips for note cards. */
  variant?: "composer" | "card";
  disabled?: boolean;
}

/**
 * Area chips + picker. In the composer it also offers the last used areas as
 * one-click suggestions, so linking a new note usually takes a single click.
 */
export default function AreaField({ value, onChange, variant = "composer", disabled }: Props) {
  const [areas, addArea] = useAreas();
  const byId = useMemo(() => areaMap(areas), [areas]);

  const suggestions = useMemo(() => {
    if (variant !== "composer") return [];
    return getRecentAreaIds()
      .map((id) => byId[id])
      .filter((a): a is Area => Boolean(a) && !value.includes(a.area_id) && !isEffectivelyArchived(a, byId))
      .slice(0, 3);
    // value changes re-evaluate which suggestions are still open
  }, [byId, value, variant]);

  const remove = disabled ? undefined : (id: string) => onChange(value.filter((x) => x !== id));
  const isCard = variant === "card";

  return (
    <div
      className={`flex flex-wrap items-center gap-1.5 ${isCard ? "" : "min-h-7"}`}
      data-testid={isCard ? "card-areas" : "composer-areas"}
    >
      {!isCard && (
        <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground mr-0.5">
          <FolderTree className="w-3.5 h-3.5" strokeWidth={1.5} />
          Alan
        </span>
      )}

      <AreaChips areas={areas} value={value} onRemove={remove} />

      {!disabled && (
        <AreaPicker
          areas={areas}
          value={value}
          onChange={onChange}
          onAreaCreated={addArea}
          trigger={
            <button
              type="button"
              className={`inline-flex items-center gap-1 rounded-full border border-dashed px-2 py-0.5 text-xs transition-colors ${
                isCard
                  ? `border-border/70 text-muted-foreground/80 hover:text-foreground hover:border-foreground/40 ${
                      value.length === 0 ? "opacity-60 group-hover:opacity-100 focus-visible:opacity-100" : ""
                    }`
                  : "border-border text-muted-foreground hover:text-foreground hover:border-foreground/40"
              }`}
              data-testid={isCard ? "card-areas-add" : "composer-areas-add"}
              title="Alan seç veya yeni alan oluştur"
            >
              <Plus className="w-3 h-3" />
              {value.length === 0 ? (isCard ? "Alan" : "Alana bağla") : "Ekle"}
            </button>
          }
        />
      )}

      {!disabled &&
        suggestions.map((a) => {
          const color = areaColor(a, byId);
          return (
            <button
              key={a.area_id}
              type="button"
              onClick={() => onChange([...value, a.area_id])}
              className="inline-flex items-center gap-1 max-w-[12rem] rounded-full px-2 py-0.5 text-xs text-muted-foreground hover:text-foreground bg-muted/50 hover:bg-muted transition-colors"
              title={`Son kullanılan: ${a.name}`}
              data-testid={`composer-area-suggestion-${a.area_id}`}
            >
              <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: color }} />
              <span className="truncate">{a.name}</span>
            </button>
          );
        })}
    </div>
  );
}
