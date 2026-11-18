import React, { useMemo, useState } from "react";
import { Check, ChevronRight, CornerDownRight, FolderTree, Plus, Search } from "lucide-react";
import { toast } from "sonner";
import api, { formatApiError } from "@/lib/api";
import type { Area } from "@/types";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { AREA_COLORS, areaColor, areaMap, areaPath, buildAreaTree, flattenTree } from "@/lib/areas";

interface AreaPickerProps {
  areas: Area[];
  value: string[];
  onChange: (ids: string[]) => void;
  /** Called after a new area was created so the caller can refresh its list. */
  onAreaCreated?: (area: Area) => void;
  trigger: React.ReactNode;
  align?: "start" | "center" | "end";
}

/**
 * Popover for linking a note to areas: search, tick areas in the tree, or create
 * a new main area / sub-area on the spot without leaving the note.
 */
export default function AreaPicker({ areas, value, onChange, onAreaCreated, trigger, align = "start" }: AreaPickerProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [creatingUnder, setCreatingUnder] = useState<string | null>(null);
  const [childName, setChildName] = useState("");
  const [busy, setBusy] = useState(false);

  const byId = useMemo(() => areaMap(areas), [areas]);
  const flat = useMemo(() => flattenTree(buildAreaTree(areas)), [areas]);
  const selected = useMemo(() => new Set(value), [value]);

  const q = query.trim().toLocaleLowerCase("tr");
  const rows = q
    ? flat.filter((n) => areaPath(n.area, byId).toLocaleLowerCase("tr").includes(q))
    : flat;
  const exactMatch = q && flat.some((n) => n.area.name.toLocaleLowerCase("tr") === q);

  const toggle = (id: string) => {
    onChange(selected.has(id) ? value.filter((x) => x !== id) : [...value, id]);
  };

  const create = async (name: string, parentId: string | null) => {
    const clean = name.trim();
    if (!clean || busy) return;
    setBusy(true);
    try {
      const parent = parentId ? byId[parentId] : null;
      const rootCount = areas.filter((a) => !a.parent_id).length;
      const { data } = await api.post<Area>("/areas", {
        name: clean,
        parent_id: parentId,
        // main areas get the next palette colour; sub-areas inherit from their parent
        color: parent ? null : AREA_COLORS[rootCount % AREA_COLORS.length],
      });
      onAreaCreated?.(data);
      onChange([...value, data.area_id]);
      toast.success(parent ? `"${clean}" alt alanı "${parent.name}" altına eklendi` : `"${clean}" alanı oluşturuldu`);
      setQuery("");
      setChildName("");
      setCreatingUnder(null);
    } catch (err) {
      toast.error(formatApiError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) {
          setQuery("");
          setCreatingUnder(null);
        }
      }}
    >
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent align={align} className="w-80 p-0 overflow-hidden" data-testid="area-picker">
        <div className="flex items-center gap-2 px-3 py-2 border-b border-border">
          <Search className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && q) {
                e.preventDefault();
                if (rows.length === 1) toggle(rows[0].area.area_id);
                else if (!exactMatch) create(query, null);
              }
            }}
            placeholder="Alan ara veya yeni alan yaz…"
            className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            data-testid="area-picker-search"
          />
        </div>

        <div className="max-h-72 overflow-y-auto py-1">
          {rows.length === 0 && !q && (
            <div className="px-4 py-6 text-center text-xs text-muted-foreground space-y-1">
              <FolderTree className="w-5 h-5 mx-auto opacity-60" />
              <p>Henüz alan yok.</p>
              <p>Yukarıya bir ad yazıp Enter'a basarak ilk alanınızı oluşturun.</p>
            </div>
          )}

          {rows.map((n) => {
            const a = n.area;
            const isOn = selected.has(a.area_id);
            const color = areaColor(a, byId);
            return (
              <div key={a.area_id}>
                <div
                  className="group flex items-center gap-1.5 pr-2 hover:bg-accent/60 transition-colors"
                  style={{ paddingLeft: q ? 10 : 10 + n.depth * 16 }}
                >
                  <button
                    type="button"
                    onClick={() => toggle(a.area_id)}
                    className="flex-1 flex items-center gap-2 py-1.5 text-left min-w-0"
                    data-testid={`area-option-${a.area_id}`}
                  >
                    <span
                      className="w-4 h-4 rounded border flex items-center justify-center shrink-0 transition-colors"
                      style={{ borderColor: color, background: isOn ? color : "transparent" }}
                    >
                      {isOn && <Check className="w-3 h-3 text-white" strokeWidth={3} />}
                    </span>
                    {n.depth > 0 && !q && <CornerDownRight className="w-3 h-3 text-muted-foreground/60 shrink-0" />}
                    <span className="text-sm truncate">{q ? areaPath(a, byId) : a.name}</span>
                    {n.totalNotes > 0 && (
                      <span className="ml-auto text-[10px] font-mono text-muted-foreground">{n.totalNotes}</span>
                    )}
                  </button>
                  <button
                    type="button"
                    title={`"${a.name}" altına alt alan ekle`}
                    onClick={() => {
                      setCreatingUnder(creatingUnder === a.area_id ? null : a.area_id);
                      setChildName("");
                    }}
                    className="p-1 rounded text-muted-foreground opacity-0 group-hover:opacity-100 focus:opacity-100 hover:text-foreground hover:bg-background transition-opacity"
                  >
                    <Plus className="w-3.5 h-3.5" />
                  </button>
                </div>
                {creatingUnder === a.area_id && (
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      create(childName, a.area_id);
                    }}
                    className="flex items-center gap-1.5 py-1.5 pr-2"
                    style={{ paddingLeft: 26 + n.depth * 16 }}
                  >
                    <ChevronRight className="w-3 h-3 text-muted-foreground shrink-0" />
                    <input
                      autoFocus
                      value={childName}
                      onChange={(e) => setChildName(e.target.value)}
                      onKeyDown={(e) => e.key === "Escape" && (e.stopPropagation(), setCreatingUnder(null))}
                      placeholder={`${a.name} › yeni alt alan`}
                      className="flex-1 min-w-0 text-xs bg-background border border-border rounded px-2 py-1 outline-none focus:border-primary"
                    />
                    <button
                      type="submit"
                      disabled={!childName.trim() || busy}
                      className="text-xs px-2 py-1 rounded bg-primary text-primary-foreground disabled:opacity-40"
                    >
                      Ekle
                    </button>
                  </form>
                )}
              </div>
            );
          })}
        </div>

        {q && !exactMatch && (
          <button
            type="button"
            onClick={() => create(query, null)}
            disabled={busy}
            className="w-full flex items-center gap-2 px-3 py-2 border-t border-border text-sm hover:bg-accent/60 text-left"
            data-testid="area-picker-create"
          >
            <Plus className="w-3.5 h-3.5 text-primary" />
            <span className="truncate">
              "<b>{query.trim()}</b>" ana alanını oluştur
            </span>
          </button>
        )}
        <div className="px-3 py-1.5 border-t border-border text-[10px] text-muted-foreground bg-muted/30">
          Alt alan eklemek için bir alanın üzerine gelip <Plus className="inline w-2.5 h-2.5" /> simgesine tıklayın.
        </div>
      </PopoverContent>
    </Popover>
  );
}
