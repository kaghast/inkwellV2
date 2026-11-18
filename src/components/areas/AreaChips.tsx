import React, { useMemo } from "react";
import { Link } from "react-router-dom";
import { X } from "lucide-react";
import type { Area } from "@/types";
import { areaColor, areaMap, areaPath } from "@/lib/areas";

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
              <Link
                to={`/all-notes?area=${encodeURIComponent(a.area_id)}`}
                className="truncate hover:underline"
                title="Bu alandaki notları listele"
              >
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
