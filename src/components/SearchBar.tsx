import React, { useEffect, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import {
  Search,
  X,
  Hash,
  AtSign,
  MapPin,
  Filter,
  CheckSquare,
  Check,
  BellRing,
  Pin,
  Image as ImageIcon,
  SlidersHorizontal,
  Layers,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import type { FilterType } from "@/contexts/FilterContext";
import { NoteDefaultFilter, useSettings } from "@/contexts/SettingsContext";

export interface FilterChip {
  id?: string;
  type: FilterType;
  value: string;
  label: string;
  locked?: boolean;
}

interface Props {
  q: string;
  onQChange: (v: string) => void;
  chips: FilterChip[];
  onRemoveChip: (chip: FilterChip) => void;
  activeFilter?: NoteDefaultFilter;
  onFilterChange?: (filter: NoteDefaultFilter) => void;
  placeholder?: string;
  totalResults?: number;
}

const FILTER_ITEMS: { id: NoteDefaultFilter; label: string; icon: any }[] = [
  { id: "all", label: "Tüm Notlar", icon: SlidersHorizontal },
  { id: "incomplete_tasks", label: "Tamamlanmamış Görevler", icon: CheckSquare },
  { id: "completed_tasks", label: "Tamamlanmış Görevler", icon: Check },
  { id: "with_reminders", label: "Hatırlatmalı Notlar", icon: BellRing },
  { id: "pinned_only", label: "Sabitlenmiş Notlar", icon: Pin },
  { id: "with_images", label: "Görsel İçeren Notlar", icon: ImageIcon },
];

export default function SearchBar({
  q,
  onQChange,
  chips,
  onRemoveChip,
  activeFilter = "all",
  onFilterChange,
  placeholder,
  totalResults,
}: Props) {
  const { settings, updateSettings } = useSettings();
  const currentFilter = activeFilter || settings.defaultFilter || "all";

  // Debounced local value to avoid spamming the server on each keystroke.
  const [local, setLocal] = useState(q);
  const debounceRef = useRef<number | null>(null);

  useEffect(() => {
    setLocal(q);
  }, [q]);

  function onLocalChange(v: string) {
    setLocal(v);
    if (debounceRef.current) window.clearTimeout(debounceRef.current);
    debounceRef.current = window.setTimeout(() => onQChange(v), 220);
  }

  const handleSelectFilter = (f: NoteDefaultFilter) => {
    if (onFilterChange) onFilterChange(f);
    updateSettings({ defaultFilter: f });
  };

  const activeFilterItem = FILTER_ITEMS.find((item) => item.id === currentFilter);
  const isFilterActive = currentFilter !== "all";

  return (
    <div className="mb-6 space-y-2.5" data-testid="search-bar">
      {/* Search Input and Filter Dropdown Row */}
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search
            className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none"
            strokeWidth={1.75}
          />
          <Input
            value={local}
            onChange={(e: any) => onLocalChange(e.target.value)}
            placeholder={placeholder || "Tüm notlarda genel arama yapın… (#etiket, @kişi, içerik)"}
            data-testid="search-input"
            className="pl-10 pr-9 h-11 rounded-lg bg-card/90 border-border focus-visible:ring-1 focus-visible:ring-foreground/30 text-sm shadow-2xs"
          />
          {local && (
            <button
              onClick={() => {
                setLocal("");
                onQChange("");
              }}
              className="absolute right-3 top-1/2 -translate-y-1/2 p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors cursor-pointer"
              data-testid="search-clear-btn"
              aria-label="Temizle"
            >
              <X className="w-3.5 h-3.5" strokeWidth={1.75} />
            </button>
          )}
        </div>

        {/* Quick Filter Menu Dropdown */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="outline"
              className={`h-11 px-3.5 rounded-lg border flex items-center gap-2 transition-all cursor-pointer ${
                isFilterActive
                  ? "bg-primary/10 border-primary text-primary font-medium ring-1 ring-primary/30"
                  : "border-border hover:bg-muted text-muted-foreground hover:text-foreground"
              }`}
              data-testid="search-filter-dropdown-btn"
            >
              <Filter className="w-4 h-4" strokeWidth={1.75} />
              <span className="hidden sm:inline text-xs truncate max-w-[130px]">
                {activeFilterItem?.label || "Filtrele"}
              </span>
              {isFilterActive && (
                <span className="w-2 h-2 rounded-full bg-primary animate-pulse" />
              )}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-64 bg-popover border-border p-1 shadow-xl">
            <DropdownMenuLabel className="text-[10px] tracking-[0.2em] uppercase text-muted-foreground px-2 py-1.5 font-mono">
              Not Filtresi
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            {FILTER_ITEMS.map((item) => {
              const Icon = item.icon;
              const isSelected = currentFilter === item.id;
              return (
                <DropdownMenuItem
                  key={item.id}
                  onClick={() => handleSelectFilter(item.id)}
                  className={`flex items-center justify-between text-xs py-2 px-2.5 rounded-md cursor-pointer ${
                    isSelected ? "bg-accent text-foreground font-semibold" : "text-muted-foreground hover:text-foreground"
                  }`}
                  data-testid={`filter-item-${item.id}`}
                >
                  <div className="flex items-center gap-2.5 truncate">
                    <Icon className={`w-3.5 h-3.5 shrink-0 ${isSelected ? "text-primary" : ""}`} />
                    <span className="truncate">{item.label}</span>
                  </div>
                  {isSelected && <Check className="w-3.5 h-3.5 text-primary shrink-0" />}
                </DropdownMenuItem>
              );
            })}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Filter and Tag Chips Row */}
      {(chips.length > 0 || isFilterActive || totalResults !== undefined) && (
        <div className="flex flex-wrap items-center justify-between gap-2 pt-0.5">
          <div className="flex flex-wrap items-center gap-1.5" data-testid="filter-chips">
            {/* Active Filter Pill if not 'all' */}
            {isFilterActive && activeFilterItem && (
              <span
                className="inline-flex items-center gap-1.5 pl-2.5 pr-1.5 py-0.5 rounded-full border border-primary/40 bg-primary/10 text-primary text-xs font-medium"
                data-testid="active-filter-pill"
              >
                <Filter className="w-3 h-3" />
                {activeFilterItem.label}
                <button
                  type="button"
                  onClick={() => handleSelectFilter("all")}
                  className="ml-0.5 p-0.5 rounded-full hover:bg-primary/20 cursor-pointer"
                  title="Filtreyi kaldır"
                >
                  <X className="w-3 h-3" />
                </button>
              </span>
            )}

            {/* Categories / Tags / Mentions / Locations Chips */}
            {chips.map((c, idx) => {
              const Icon =
                c.type === "category"
                  ? Layers
                  : c.type === "tag"
                  ? Hash
                  : c.type === "person"
                  ? AtSign
                  : MapPin;
              const accent =
                c.type === "category"
                  ? "bg-indigo-500/15 text-indigo-600 dark:text-indigo-400 border-indigo-500/30"
                  : c.type === "tag"
                  ? "bg-sky-500/15 text-sky-600 dark:text-sky-400 border-sky-500/30"
                  : c.type === "person"
                  ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30"
                  : "bg-muted text-foreground border-border";
              return (
                <span
                  key={`${c.type}-${c.value}-${idx}`}
                  className={`inline-flex items-center gap-1.5 pl-2 pr-1 py-0.5 rounded-full border text-xs font-mono ${accent}`}
                  data-testid={`chip-${c.type}-${c.value}`}
                >
                  <Icon className="w-3 h-3" strokeWidth={1.75} />
                  {c.label}
                  {!c.locked && (
                    <button
                      onClick={() => onRemoveChip(c)}
                      className="ml-0.5 p-0.5 rounded-full hover:bg-foreground/10 cursor-pointer"
                      data-testid={`chip-remove-${c.type}-${c.value}`}
                      aria-label="Filtreyi kaldır"
                    >
                      <X className="w-3 h-3" strokeWidth={2} />
                    </button>
                  )}
                </span>
              );
            })}
          </div>

          {totalResults !== undefined && (
            <span className="text-[11px] font-mono text-muted-foreground shrink-0">
              {totalResults} {totalResults === 1 ? "not" : "not"}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
