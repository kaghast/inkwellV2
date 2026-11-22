import React, { useEffect, useMemo, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { AtSign, ExternalLink, FolderTree, Hash, Layers, Lock, MapPin, RefreshCw, X, type LucideIcon } from "lucide-react";
import api, { formatApiError } from "@/lib/api";
import type { Note } from "@/types";
import { useAreas } from "@/components/areas/useAreas";
import { areaColor, areaMap } from "@/lib/areas";
import { formatDisplayDatetime } from "@/lib/datetime";
import { DrawerKind, DrawerTab, useDrawerTabs } from "@/contexts/DrawerTabsContext";

export const DRAWER_ICONS: Record<DrawerKind, LucideIcon> = {
  area: FolderTree,
  tag: Hash,
  person: AtSign,
  location: MapPin,
  category: Layers,
};

const KIND_LABEL: Record<DrawerKind, string> = {
  area: "Alan",
  tag: "Etiket",
  person: "Kişi",
  location: "Konum",
  category: "Kategori",
};

/** Full page for the same list, for "Sayfada aç". */
function pagePath(tab: DrawerTab) {
  const v = encodeURIComponent(tab.value);
  switch (tab.kind) {
    case "area":
      return `/areas?area=${v}`;
    case "tag":
      return `/tag/${v}`;
    case "person":
      return `/person/${v}`;
    case "location":
      return `/location/${v}`;
    case "category":
      return `/category/${v}`;
  }
}

function queryFor(tab: DrawerTab): Record<string, string> {
  switch (tab.kind) {
    case "area":
      return {}; // filtered client-side so sub-areas can be included
    case "tag":
      return { tags: tab.value };
    case "person":
      return { people: tab.value };
    case "location":
      return { location_ids: tab.value };
    case "category":
      return { category_id: tab.value };
  }
}

function snippet(md: string) {
  return md
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[#>*_`~|-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 140);
}

/**
 * Right-side drawer that lists the notes of the active header tab.
 * Mounted once (in App); pages open tabs through `useDrawerTabs().openTab`.
 */
export default function NoteDrawer() {
  const { tabs, activeId, open, setOpen, openTab, closeTab } = useDrawerTabs();
  const tab = tabs.find((t) => t.id === activeId) || null;
  const [areas] = useAreas();
  const byId = useMemo(() => areaMap(areas), [areas]);
  const [notes, setNotes] = useState<Note[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [withSubAreas, setWithSubAreas] = useState(true);
  const [reload, setReload] = useState(0);
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    if (!open || !tab) return;
    let cancelled = false;
    setNotes(null);
    setError(null);
    api
      .get<Note[]>("/notes", { params: queryFor(tab) })
      .then(({ data }) => !cancelled && setNotes(Array.isArray(data) ? data : []))
      .catch((err) => !cancelled && setError(formatApiError(err)));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, tab?.id, reload]);

  // Escape hides the drawer (the tab stays in the header)
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !document.querySelector("[role=dialog]")) setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, setOpen]);

  const areaIds = useMemo(() => {
    if (!tab || tab.kind !== "area") return null;
    const ids = new Set([tab.value]);
    if (withSubAreas) {
      let grew = true;
      while (grew) {
        grew = false;
        for (const a of areas) {
          if (a.parent_id && ids.has(a.parent_id) && !ids.has(a.area_id)) {
            ids.add(a.area_id);
            grew = true;
          }
        }
      }
    }
    return ids;
  }, [tab, areas, withSubAreas]);

  const list = useMemo(() => {
    if (!notes) return null;
    let out = notes.filter((n) => !n.archived);
    if (areaIds) out = out.filter((n) => (n.area_ids || []).some((id) => areaIds.has(id)));
    return out.sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  }, [notes, areaIds]);

  if (!open || !tab) return null;
  const Icon = DRAWER_ICONS[tab.kind];
  const area = tab.kind === "area" ? byId[tab.value] : undefined;
  const color = area ? areaColor(area, byId) : tab.color;
  const hasSubAreas = tab.kind === "area" && areas.some((a) => a.parent_id === tab.value);

  const goToNote = (n: Note) => {
    navigate(`/note/${n.slug || n.note_id}`);
    if (window.innerWidth < 640) setOpen(false);
  };

  return (
    <aside
      className="fixed top-14 right-0 bottom-0 z-40 w-full sm:w-[24rem] bg-card border-l border-border shadow-2xl flex flex-col min-h-0 animate-in slide-in-from-right-8 fade-in duration-200"
      data-testid="note-drawer"
      aria-label={`${KIND_LABEL[tab.kind]}: ${tab.label}`}
    >
      <div className="px-4 pt-3 pb-3 border-b border-border shrink-0">
        <div className="flex items-center gap-2">
          <span
            className="w-7 h-7 rounded-full flex items-center justify-center shrink-0"
            style={{ background: color ? `${color}22` : "hsl(var(--muted))", color: color || undefined }}
          >
            <Icon className="w-3.5 h-3.5" strokeWidth={2} />
          </span>
          <div className="flex-1 min-w-0">
            <div className="text-[10px] uppercase tracking-[0.15em] text-muted-foreground">{KIND_LABEL[tab.kind]}</div>
            <h2 className="font-semibold truncate leading-tight" title={tab.label}>
              {tab.label}
            </h2>
          </div>
          <button
            type="button"
            onClick={() => setReload((r) => r + 1)}
            className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent"
            title="Yenile"
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
          {location.pathname + location.search !== pagePath(tab) && (
            <Link
              to={pagePath(tab)}
              className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent"
              title="Sayfada aç"
            >
              <ExternalLink className="w-3.5 h-3.5" />
            </Link>
          )}
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent"
            title="Paneli gizle (sekme açık kalır)"
            data-testid="note-drawer-hide"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="flex items-center gap-3 mt-2 text-xs text-muted-foreground">
          <span>{list ? `${list.length} not` : "Yükleniyor…"}</span>
          {hasSubAreas && (
            <label className="inline-flex items-center gap-1.5 cursor-pointer select-none">
              <input type="checkbox" checked={withSubAreas} onChange={(e) => setWithSubAreas(e.target.checked)} />
              Alt alanlar dahil
            </label>
          )}
          <button type="button" onClick={() => closeTab(tab.id)} className="ml-auto hover:text-foreground hover:underline">
            Sekmeyi kapat
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto min-h-0" data-testid="note-drawer-list">
        {error && <p className="p-4 text-sm text-destructive">{error}</p>}
        {list && list.length === 0 && (
          <p className="p-6 text-sm text-muted-foreground text-center">Bu {KIND_LABEL[tab.kind].toLocaleLowerCase("tr")} ile ilişkili not yok.</p>
        )}
        <ul className="divide-y divide-border/60">
          {(list || []).map((n) => (
            <li key={n.note_id} className="px-4 py-3 hover:bg-accent/40 transition-colors">
              <button type="button" onClick={() => goToNote(n)} className="block w-full text-left">
                <div className="flex items-center gap-1.5">
                  {n.is_encrypted && <Lock className="w-3 h-3 text-amber-500 shrink-0" />}
                  <span className="font-medium text-sm truncate">{n.title || "Başlıksız Not"}</span>
                </div>
                <div className="text-[10px] font-mono text-muted-foreground mt-0.5">
                  {formatDisplayDatetime(n.date)}
                </div>
                {!n.is_encrypted && n.content && (
                  <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{snippet(n.content)}</p>
                )}
              </button>
              {(n.tags?.length > 0 || n.people?.length > 0) && (
                <div className="flex flex-wrap gap-1 mt-1.5">
                  {n.tags.slice(0, 6).map((t) => (
                    <button
                      key={`t-${t}`}
                      type="button"
                      onClick={() => openTab({ kind: "tag", value: t, label: `#${t}` })}
                      className="text-[10px] font-mono px-1.5 py-0.5 rounded-full bg-sky-500/10 text-sky-600 dark:text-sky-400 hover:bg-sky-500/20"
                    >
                      #{t}
                    </button>
                  ))}
                  {n.people.slice(0, 4).map((p) => (
                    <button
                      key={`p-${p}`}
                      type="button"
                      onClick={() => openTab({ kind: "person", value: p, label: `@${p}` })}
                      className="text-[10px] font-mono px-1.5 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/20"
                    >
                      @{p}
                    </button>
                  ))}
                </div>
              )}
            </li>
          ))}
        </ul>
      </div>
    </aside>
  );
}

/** Header strip of open drawer tabs; renders nothing when no tab is open. */
export function DrawerTabsBar() {
  const { tabs, activeId, open, activate, closeTab, setOpen } = useDrawerTabs();
  const [areas] = useAreas();
  const byId = useMemo(() => areaMap(areas), [areas]);
  if (tabs.length === 0) return null;
  return (
    <div
      className="flex items-center gap-1 min-w-0 overflow-x-auto no-scrollbar py-1"
      role="tablist"
      aria-label="Açık paneller"
      data-testid="drawer-tabs"
    >
      {tabs.map((t) => {
        const Icon = DRAWER_ICONS[t.kind];
        const active = t.id === activeId && open;
        const area = t.kind === "area" ? byId[t.value] : undefined;
        const color = area ? areaColor(area, byId) : t.color;
        return (
          <div
            key={t.id}
            className={`group shrink-0 flex items-center h-8 rounded-lg border text-xs transition-colors ${
              active
                ? "bg-primary/10 border-primary/30 text-foreground"
                : "border-border/70 text-muted-foreground hover:text-foreground hover:bg-muted/60"
            }`}
          >
            <button
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => (active ? setOpen(false) : activate(t.id))}
              className="flex items-center gap-1.5 pl-2 pr-1 h-full max-w-[11rem]"
              aria-label={t.label}
              title={active ? "Paneli gizle" : t.label}
              data-testid={`drawer-tab-${t.id}`}
            >
              <Icon className="w-3.5 h-3.5 shrink-0" strokeWidth={1.75} />
              {color && <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: color }} />}
              <span className="truncate">{t.label}</span>
            </button>
            <button
              type="button"
              onClick={() => closeTab(t.id)}
              className="mr-1 p-0.5 rounded text-muted-foreground hover:text-foreground hover:bg-background"
              title="Sekmeyi kapat"
              aria-label={`${t.label} sekmesini kapat`}
            >
              <X className="w-3 h-3" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
