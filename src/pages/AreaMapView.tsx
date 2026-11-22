import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import {
  Archive,
  ArchiveRestore,
  ChevronDown,
  ChevronRight,
  FolderTree,
  Link2,
  Maximize2,
  MoreHorizontal,
  Network,
  PanelLeft,
  Pencil,
  Plus,
  Search,
  Trash2,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import api, { formatApiError } from "@/lib/api";
import type { Area, Note } from "@/types";
import AppMenubar from "@/components/AppMenubar";
import AreaPicker from "@/components/areas/AreaPicker";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  AREA_COLORS,
  AreaTreeNode,
  areaColor,
  areaMap,
  areaPath,
  buildAreaTree,
  fetchAreas,
  flattenTree,
  isEffectivelyArchived,
  setNoteAreas,
} from "@/lib/areas";
import { useDrawerTabs } from "@/contexts/DrawerTabsContext";

// ---------------------------------------------------------------------------
// Circle packing: areas are plain circles that touch each other, no lines.
// ---------------------------------------------------------------------------
const UNASSIGNED_ID = "__unassigned";
const MAX_RELATED = 6;

/** focus = the opened area in the middle; child = its sub-areas; related = areas sharing notes with it. */
type BubbleRole = "top" | "focus" | "child" | "related" | "match";

interface Bubble {
  id: string;
  kind: "area" | "unassigned";
  role: BubbleRole;
  label: string;
  x: number;
  y: number;
  r: number;
  color: string;
  areaId?: string;
  count: number;
  childCount: number;
  shared?: number;
}

/** Bigger circles for more notes; sqrt keeps very large areas from dominating. */
function bubbleRadius(total: number, role: BubbleRole) {
  const r = 34 + Math.sqrt(total) * 11;
  if (role === "focus") return Math.min(Math.max(r * 1.15, 86), 150);
  if (role === "related") return Math.min(r * 0.8, 80);
  return Math.min(r, 112);
}

interface Pt {
  x: number;
  y: number;
}
interface Circle extends Pt {
  r: number;
}

/** Centres of the circles of radius r that touch both a and b. */
function tangentPoints(a: Circle, b: Circle, r: number): Pt[] {
  const ra = a.r + r;
  const rb = b.r + r;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const d = Math.hypot(dx, dy);
  if (d === 0 || d > ra + rb || d < Math.abs(ra - rb)) return [];
  const l = (ra * ra - rb * rb + d * d) / (2 * d);
  const h = Math.sqrt(Math.max(0, ra * ra - l * l));
  const mx = a.x + (dx * l) / d;
  const my = a.y + (dy * l) / d;
  return [
    { x: mx - (dy * h) / d, y: my + (dx * h) / d },
    { x: mx + (dy * h) / d, y: my - (dx * h) / d },
  ];
}

/**
 * Greedy front packing: the first circle sits at the origin and every next one is
 * placed touching two already placed circles, as close to the origin as possible
 * without overlapping. Small inputs (tens of areas), so O(n³) is fine.
 */
function packCircles(radii: number[], secondAngle = 0): Pt[] {
  const placed: Circle[] = [];
  const EPS = 0.01;
  const fits = (p: Pt, r: number) => placed.every((c) => Math.hypot(c.x - p.x, c.y - p.y) >= c.r + r - EPS);
  for (const r of radii) {
    if (placed.length === 0) {
      placed.push({ x: 0, y: 0, r });
      continue;
    }
    if (placed.length === 1) {
      const a = placed[0];
      const d = a.r + r;
      placed.push({ x: a.x + Math.cos(secondAngle) * d, y: a.y + Math.sin(secondAngle) * d, r });
      continue;
    }
    let best: Pt | null = null;
    let bestD = Infinity;
    const consider = (p: Pt) => {
      const d = Math.hypot(p.x, p.y);
      if (d < bestD && fits(p, r)) {
        best = p;
        bestD = d;
      }
    };
    for (let i = 0; i < placed.length; i++) {
      for (let j = i + 1; j < placed.length; j++) tangentPoints(placed[i], placed[j], r).forEach(consider);
    }
    if (!best) {
      for (const c of placed) {
        for (let k = 0; k < 24; k++) {
          const t = (k / 24) * Math.PI * 2;
          consider({ x: c.x + Math.cos(t) * (c.r + r), y: c.y + Math.sin(t) * (c.r + r) });
        }
      }
    }
    const p = (best as Pt | null) || { x: 0, y: 0 };
    placed.push({ x: p.x, y: p.y, r });
  }
  return placed.map(({ x, y }) => ({ x, y }));
}

function useMediaQuery(query: string) {
  const get = () => (typeof window !== "undefined" && window.matchMedia ? window.matchMedia(query).matches : true);
  const [matches, setMatches] = useState(get);
  useEffect(() => {
    const mql = window.matchMedia(query);
    const onChange = () => setMatches(mql.matches);
    onChange();
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, [query]);
  return matches;
}

function truncate(s: string, n: number) {
  return s.length > n ? `${s.slice(0, Math.max(1, n - 1))}…` : s;
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------
export default function AreaMapView() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { openTab, open: drawerOpen } = useDrawerTabs();

  const [areas, setAreas] = useState<Area[]>([]);
  const [notes, setNotes] = useState<Note[]>([]);
  const [loading, setLoading] = useState(true);

  /** Area opened in the middle of the canvas; null shows all main areas. */
  const [focusId, setFocusId] = useState<string | null>(null);
  /** Open rows in the left tree panel. */
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  /** Area whose edit panel is open (or UNASSIGNED_ID). */
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [treeOpenMobile, setTreeOpenMobile] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Area | null>(null);

  // ---- data -------------------------------------------------------------
  const reloadAreas = useCallback(async () => {
    try {
      setAreas(await fetchAreas());
    } catch (err) {
      toast.error(formatApiError(err));
    }
  }, []);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const [a, n] = await Promise.all([fetchAreas(), api.get<Note[]>("/notes")]);
        setAreas(a);
        setNotes(Array.isArray(n.data) ? n.data : []);
      } catch (err) {
        toast.error(formatApiError(err));
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const byId = useMemo(() => areaMap(areas), [areas]);
  const activeNotes = useMemo(() => notes.filter((n) => !n.archived), [notes]);
  const visibleAreaIds = useMemo(
    () => new Set(areas.filter((a) => !isEffectivelyArchived(a, byId)).map((a) => a.area_id)),
    [areas, byId]
  );
  const forest = useMemo(
    () => buildAreaTree(areas, activeNotes.map((n) => n.area_ids || [])),
    [areas, activeNotes]
  );
  const flat = useMemo(() => flattenTree(forest), [forest]);
  const treeById = useMemo(() => {
    const m: Record<string, AreaTreeNode> = {};
    flat.forEach((t) => (m[t.area.area_id] = t));
    return m;
  }, [flat]);

  const notesByArea = useMemo(() => {
    const m: Record<string, Note[]> = {};
    for (const n of activeNotes) {
      for (const id of n.area_ids || []) (m[id] ||= []).push(n);
    }
    Object.values(m).forEach((list) => list.sort((a, b) => (b.date || "").localeCompare(a.date || "")));
    return m;
  }, [activeNotes]);

  const unassignedNotes = useMemo(
    () => activeNotes.filter((n) => !(n.area_ids || []).some((id) => visibleAreaIds.has(id))),
    [activeNotes, visibleAreaIds]
  );

  const ancestorsOf = useCallback(
    (id: string) => {
      const out: string[] = [];
      let cur = byId[id]?.parent_id || null;
      while (cur && !out.includes(cur)) {
        out.push(cur);
        cur = byId[cur]?.parent_id || null;
      }
      return out;
    },
    [byId]
  );

  // ---- mutations --------------------------------------------------------
  const createArea = async (name: string, parentId: string | null) => {
    const clean = name.trim();
    if (!clean) return null;
    try {
      const rootCount = areas.filter((a) => !a.parent_id).length;
      const { data } = await api.post<Area>("/areas", {
        name: clean,
        parent_id: parentId,
        color: parentId ? null : AREA_COLORS[rootCount % AREA_COLORS.length],
      });
      setAreas((prev) => [...prev, data]);
      if (parentId) setExpanded((prev) => new Set(prev).add(parentId));
      toast.success(parentId ? `"${clean}" alt alanı eklendi` : `"${clean}" ana alanı oluşturuldu`);
      return data;
    } catch (err) {
      toast.error(formatApiError(err));
      return null;
    }
  };

  const updateArea = async (id: string, patch: Partial<Pick<Area, "name" | "color" | "description" | "parent_id">>) => {
    const before = areas;
    setAreas((prev) => prev.map((a) => (a.area_id === id ? { ...a, ...patch } : a)));
    try {
      const { data } = await api.put<Area>(`/areas/${id}`, patch);
      setAreas((prev) => prev.map((a) => (a.area_id === id ? data : a)));
    } catch (err) {
      setAreas(before);
      toast.error(formatApiError(err));
    }
  };

  const setArchived = async (area: Area, archived: boolean, silent = false) => {
    try {
      const hasSubAreas = areas.some((a) => a.parent_id === area.area_id && !a.archived);
      await api.patch(`/areas/${area.area_id}/archive`, { archived });
      await reloadAreas();
      if (archived && selectedId === area.area_id) setSelectedId(null);
      if (!silent) {
        if (archived) {
          toast.success(`"${area.name}" arşivlendi`, {
            description: hasSubAreas
              ? "Alt alanları da arşive taşındı. Notlarınız silinmedi."
              : "Notlarınız silinmedi; alanı Arşiv bölümünden geri alabilirsiniz.",
            duration: 8000,
            action: { label: "Geri al", onClick: () => setArchived(area, false, true) },
          });
        } else {
          toast.success(`"${area.name}" arşivden çıkarıldı`);
        }
      }
    } catch (err) {
      toast.error(formatApiError(err));
    }
  };

  const deleteArea = async (area: Area) => {
    try {
      await api.delete(`/areas/${area.area_id}`);
      setAreas((prev) =>
        prev
          .filter((a) => a.area_id !== area.area_id)
          .map((a) => (a.parent_id === area.area_id ? { ...a, parent_id: area.parent_id } : a))
      );
      setNotes((prev) =>
        prev.map((n) =>
          (n.area_ids || []).includes(area.area_id) ? { ...n, area_ids: (n.area_ids || []).filter((x) => x !== area.area_id) } : n
        )
      );
      toast.success(`"${area.name}" kalıcı olarak silindi`);
    } catch (err) {
      toast.error(formatApiError(err));
    }
  };

  const updateNoteAreas = async (note: Note, ids: string[]) => {
    const before = note.area_ids || [];
    setNotes((prev) => prev.map((n) => (n.note_id === note.note_id ? { ...n, area_ids: ids } : n)));
    try {
      const saved = await setNoteAreas(note.note_id, ids);
      setNotes((prev) => prev.map((n) => (n.note_id === note.note_id ? { ...n, area_ids: saved } : n)));
    } catch (err) {
      setNotes((prev) => prev.map((n) => (n.note_id === note.note_id ? { ...n, area_ids: before } : n)));
      toast.error(formatApiError(err));
    }
  };

  // ---- focus ------------------------------------------------------------
  // An archived or deleted focus falls back to its nearest visible parent
  useEffect(() => {
    if (!focusId || loading || visibleAreaIds.has(focusId)) return;
    const up = ancestorsOf(focusId).find((id) => visibleAreaIds.has(id)) || null;
    setFocusId(up);
  }, [focusId, loading, visibleAreaIds, ancestorsOf]);

  const focusArea = useCallback(
    (id: string | null) => {
      setFocusId(id);
      if (id) {
        const chain = ancestorsOf(id);
        setExpanded((prev) => {
          const next = new Set(prev);
          chain.forEach((c) => next.add(c));
          return next;
        });
      }
    },
    [ancestorsOf]
  );

  // ?area=<id> deep link
  useEffect(() => {
    const target = searchParams.get("area");
    if (!loading && target && byId[target]) {
      focusArea(target);
      searchParams.delete("area");
      setSearchParams(searchParams, { replace: true });
    }
  }, [loading, searchParams, byId, focusArea, setSearchParams]);

  // ---- bubbles ----------------------------------------------------------
  const q = query.trim().toLocaleLowerCase("tr");

  const related = useMemo(() => {
    if (!focusId) return [] as { id: string; shared: number }[];
    const lineage = new Set([focusId, ...ancestorsOf(focusId)]);
    const counts: Record<string, number> = {};
    for (const n of notesByArea[focusId] || []) {
      for (const id of n.area_ids || []) {
        if (lineage.has(id) || !visibleAreaIds.has(id)) continue;
        if (byId[id]?.parent_id === focusId) continue; // children are shown anyway
        if (ancestorsOf(id).includes(focusId)) continue; // deeper descendants: not "related"
        counts[id] = (counts[id] || 0) + 1;
      }
    }
    return Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, MAX_RELATED)
      .map(([id, shared]) => ({ id, shared }));
  }, [focusId, notesByArea, visibleAreaIds, byId, ancestorsOf]);

  const bubbles = useMemo<Bubble[]>(() => {
    const make = (t: AreaTreeNode, role: BubbleRole, shared?: number): Omit<Bubble, "x" | "y"> => ({
      id: t.area.area_id,
      kind: "area",
      role,
      label: t.area.name,
      r: bubbleRadius(t.totalNotes, role),
      color: areaColor(t.area, byId),
      areaId: t.area.area_id,
      count: t.totalNotes,
      childCount: t.children.length,
      shared,
    });
    let list: Omit<Bubble, "x" | "y">[] = [];
    if (q) {
      list = flat
        .filter((t) => t.area.name.toLocaleLowerCase("tr").includes(q))
        .map((t) => make(t, "match"))
        .sort((a, b) => b.r - a.r);
    } else if (focusId && treeById[focusId]) {
      const t = treeById[focusId];
      list = [
        make(t, "focus"),
        ...t.children.map((c) => make(c, "child")).sort((a, b) => b.r - a.r),
        ...related.filter((x) => treeById[x.id]).map((x) => make(treeById[x.id], "related", x.shared)),
      ];
    } else {
      list = forest.map((t) => make(t, "top")).sort((a, b) => b.r - a.r);
      if (unassignedNotes.length > 0) {
        list.push({
          id: UNASSIGNED_ID,
          kind: "unassigned",
          role: "top",
          label: "Alansız notlar",
          r: Math.min(26 + Math.sqrt(unassignedNotes.length) * 6, 64),
          color: "hsl(var(--muted-foreground))",
          count: unassignedNotes.length,
          childCount: 0,
        });
      }
    }
    // With an opened area, its sub-areas start on the left so the corner buttons on its right stay free
    const pts = packCircles(list.map((b) => b.r), !q && focusId ? Math.PI * 0.8 : 0);
    return list.map((b, i) => ({ ...b, x: pts[i].x, y: pts[i].y }));
  }, [q, flat, focusId, treeById, related, forest, unassignedNotes.length, byId]);

  // ---- view (pan / zoom / fit) -------------------------------------------
  const containerRef = useRef<HTMLDivElement | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [size, setSize] = useState({ w: 800, h: 600 });
  const [view, setView] = useState({ x: 400, y: 300, k: 1 });
  const [smooth, setSmooth] = useState(false);
  const viewRef = useRef(view);
  viewRef.current = view;

  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  // Same breakpoint as the panels' `sm:` classes: side panel vs. bottom sheet.
  const isWide = useMediaQuery("(min-width: 640px)");
  const panelOpen = Boolean(selectedId);
  const reservedRight = isWide ? (drawerOpen ? 384 : 0) + (panelOpen ? 344 : 0) : 0;
  const reservedBottom = panelOpen && !isWide ? Math.round(size.h * 0.6) : 0;

  const fitView = useCallback(
    (animate = true) => {
      if (!bubbles.length) return;
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      for (const b of bubbles) {
        minX = Math.min(minX, b.x - b.r);
        maxX = Math.max(maxX, b.x + b.r);
        minY = Math.min(minY, b.y - b.r);
        maxY = Math.max(maxY, b.y + b.r);
      }
      const top = 64; // toolbar
      const pad = 24;
      const w = Math.max(160, size.w - reservedRight - pad * 2);
      const h = Math.max(160, size.h - reservedBottom - top - pad * 2);
      const k = Math.max(0.25, Math.min(2, w / (maxX - minX), h / (maxY - minY)));
      setSmooth(animate);
      setView({
        k,
        x: pad + w / 2 - ((minX + maxX) / 2) * k,
        y: top + pad + h / 2 - ((minY + maxY) / 2) * k,
      });
    },
    [bubbles, size, reservedRight, reservedBottom]
  );

  // Re-fit whenever the set of circles or the free space changes
  const didInitialFit = useRef(false);
  const bubbleKey = bubbles.map((b) => `${b.id}:${Math.round(b.r)}`).join(",");
  useEffect(() => {
    if (loading || size.w === 0) return;
    fitView(didInitialFit.current);
    didInitialFit.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, bubbleKey, size.w, size.h, reservedRight, reservedBottom]);

  // Wheel zoom around the cursor (non-passive so the page does not scroll)
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = svg.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      setSmooth(false);
      setView((v) => {
        const k = Math.max(0.25, Math.min(3, v.k * Math.exp(-e.deltaY * 0.0015)));
        return { k, x: mx - (mx - v.x) * (k / v.k), y: my - (my - v.y) * (k / v.k) };
      });
    };
    svg.addEventListener("wheel", onWheel, { passive: false });
    return () => svg.removeEventListener("wheel", onWheel);
  }, [loading]);

  const panRef = useRef<{ x: number; y: number; vx: number; vy: number; moved: boolean } | null>(null);
  const onPointerDown = (e: React.PointerEvent) => {
    if ((e.target as Element).closest("[data-node]")) return;
    panRef.current = { x: e.clientX, y: e.clientY, vx: viewRef.current.x, vy: viewRef.current.y, moved: false };
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const p = panRef.current;
    if (!p) return;
    const dx = e.clientX - p.x;
    const dy = e.clientY - p.y;
    if (Math.abs(dx) + Math.abs(dy) > 3) p.moved = true;
    setSmooth(false);
    setView((v) => ({ ...v, x: p.vx + dx, y: p.vy + dy }));
  };
  const onPointerUp = (e: React.PointerEvent) => {
    const p = panRef.current;
    panRef.current = null;
    if (p && !p.moved && !(e.target as Element).closest("[data-node]")) setSelectedId(null);
  };
  const zoomBy = (f: number) => {
    setSmooth(true);
    setView((v) => {
      const k = Math.max(0.25, Math.min(3, v.k * f));
      const cx = (size.w - reservedRight) / 2;
      const cy = size.h / 2;
      return { k, x: cx - (cx - v.x) * (k / v.k), y: cy - (cy - v.y) * (k / v.k) };
    });
  };

  // ---- interactions -----------------------------------------------------
  const onBubbleActivate = (b: Bubble) => {
    if (b.kind === "unassigned") {
      setSelectedId(UNASSIGNED_ID);
      return;
    }
    if (!b.areaId) return;
    if (q) setQuery("");
    if (b.role === "focus") {
      // clicking the opened area steps back out to its parent
      focusArea(byId[b.areaId]?.parent_id && visibleAreaIds.has(byId[b.areaId].parent_id!) ? byId[b.areaId].parent_id! : null);
    } else {
      focusArea(b.areaId);
    }
  };
  const openNotes = (b: Bubble) => {
    if (!b.areaId) return;
    openTab({ kind: "area", value: b.areaId, label: b.label, color: b.color });
  };

  const selectedArea = selectedId && selectedId !== UNASSIGNED_ID ? byId[selectedId] : null;
  const archivedAreas = useMemo(
    () => areas.filter((a) => a.archived && !(a.parent_id && byId[a.parent_id]?.archived)),
    [areas, byId]
  );
  const trail = focusId ? [...ancestorsOf(focusId)].reverse().map((id) => byId[id]).filter(Boolean) : [];
  const focusAreaObj = focusId ? byId[focusId] : null;

  // ---- render -----------------------------------------------------------
  const treePanel = (
    <AreaTreePanel
      forest={forest}
      byId={byId}
      expanded={expanded}
      selectedId={focusId}
      archivedAreas={archivedAreas}
      onToggle={(id) =>
        setExpanded((prev) => {
          const next = new Set(prev);
          if (next.has(id)) next.delete(id);
          else next.add(id);
          return next;
        })
      }
      onSelect={(id) => {
        setQuery("");
        focusArea(id);
        setTreeOpenMobile(false);
      }}
      onCreate={createArea}
      onRename={(id, name) => updateArea(id, { name })}
      onColor={(id, color) => updateArea(id, { color })}
      onArchive={(a) => setArchived(a, true)}
      onRestore={(a) => setArchived(a, false)}
      onDelete={(a) => setDeleteTarget(a)}
    />
  );

  return (
    <div className="h-screen flex flex-col bg-background text-foreground overflow-hidden">
      <AppMenubar />
      <div className="pt-14 lg:pl-16 flex-1 flex min-h-0 overflow-hidden">
        {/* Left: area tree (desktop) */}
        <aside className="hidden md:flex w-72 shrink-0 flex-col border-r border-border bg-sidebar min-h-0">
          {treePanel}
        </aside>

        {/* Mobile tree sheet */}
        <Sheet open={treeOpenMobile} onOpenChange={setTreeOpenMobile}>
          <SheetContent side="left" className="p-0 w-80 bg-sidebar border-border flex flex-col">
            {treePanel}
          </SheetContent>
        </Sheet>

        {/* Center: packed circles */}
        <main className="flex-1 relative min-w-0 overflow-hidden bg-dot-grid">
          <div className="absolute top-3 left-3 right-3 z-20 flex flex-wrap items-center gap-2 pointer-events-none">
            <Button
              variant="outline"
              size="icon"
              className="md:hidden pointer-events-auto h-9 w-9 bg-card/90"
              onClick={() => setTreeOpenMobile(true)}
              title="Alan listesi"
            >
              <PanelLeft className="w-4 h-4" />
            </Button>
            <div className="pointer-events-auto flex items-center gap-2 bg-card/90 backdrop-blur-md px-2.5 h-9 rounded-lg border border-border shadow-sm w-full max-w-[14rem]">
              <Search className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Alan ara…"
                className="flex-1 min-w-0 bg-transparent text-sm outline-none"
                data-testid="area-map-search"
              />
              {query && (
                <button onClick={() => setQuery("")} className="text-muted-foreground hover:text-foreground">
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
            {/* Breadcrumb of the opened area */}
            <nav
              className="pointer-events-auto flex items-center gap-0.5 h-9 px-1.5 rounded-lg border border-border bg-card/90 backdrop-blur-md shadow-sm text-xs min-w-0 max-w-full overflow-x-auto no-scrollbar"
              aria-label="Alan yolu"
              data-testid="area-breadcrumb"
            >
              <button
                type="button"
                onClick={() => {
                  setQuery("");
                  focusArea(null);
                }}
                className={`inline-flex items-center gap-1 px-1.5 py-1 rounded-md shrink-0 ${
                  focusId ? "text-muted-foreground hover:text-foreground hover:bg-accent" : "font-semibold"
                }`}
              >
                <FolderTree className="w-3.5 h-3.5" /> Alanlarım
              </button>
              {trail.map((a) => (
                <React.Fragment key={a.area_id}>
                  <ChevronRight className="w-3 h-3 text-muted-foreground shrink-0" />
                  <button
                    type="button"
                    onClick={() => focusArea(a.area_id)}
                    className="px-1.5 py-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent shrink-0"
                  >
                    {a.name}
                  </button>
                </React.Fragment>
              ))}
              {focusAreaObj && (
                <>
                  <ChevronRight className="w-3 h-3 text-muted-foreground shrink-0" />
                  <span className="px-1.5 py-1 font-semibold shrink-0">{focusAreaObj.name}</span>
                </>
              )}
            </nav>
            <Link
              to="/network"
              className="pointer-events-auto ml-auto inline-flex items-center gap-1.5 h-9 px-3 rounded-lg border border-border bg-card/90 backdrop-blur-md text-xs text-muted-foreground hover:text-foreground shadow-sm"
              title="Notlar, etiketler ve kişilerle tüm bağlantı ağı"
            >
              <Network className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Ağ görünümü</span>
            </Link>
          </div>

          <div ref={containerRef} className="absolute inset-0">
            {!loading && areas.filter((a) => !a.archived).length === 0 ? (
              <EmptyState onCreate={(name) => createArea(name, null)} />
            ) : (
              <svg
                ref={svgRef}
                width={size.w}
                height={size.h}
                className="block touch-none select-none cursor-grab active:cursor-grabbing"
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                data-testid="area-circles"
              >
                <g
                  style={{
                    transform: `translate(${view.x}px, ${view.y}px) scale(${view.k})`,
                    transition: smooth ? "transform 420ms cubic-bezier(0.2, 0.8, 0.2, 1)" : "none",
                  }}
                >
                  {(["body", "buttons"] as const).map((layer) =>
                    bubbles.map((b) => (
                    <BubbleView
                      key={`${layer}:${b.id}`}
                      layer={layer}
                      bubble={b}
                      selected={selectedId === b.id}
                      dimmed={Boolean(hoveredId && hoveredId !== b.id && b.role === "related")}
                      onActivate={() => onBubbleActivate(b)}
                      onEdit={() => b.areaId && setSelectedId(b.areaId)}
                      onNotes={() => openNotes(b)}
                      onHover={(h) => setHoveredId(h ? b.id : null)}
                    />
                    ))
                  )}
                </g>
              </svg>
            )}
            {loading && (
              <div className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">
                Alanlar yükleniyor…
              </div>
            )}
            {!loading && q && bubbles.length === 0 && (
              <div className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground pointer-events-none">
                "{query}" ile eşleşen alan yok
              </div>
            )}
          </div>

          {/* zoom controls */}
          <div className="absolute bottom-4 left-4 z-20 flex flex-col gap-1 bg-card/90 backdrop-blur-md p-1 rounded-lg border border-border shadow-sm">
            <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => zoomBy(1.2)} title="Yakınlaştır">
              <ZoomIn className="w-4 h-4" />
            </Button>
            <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => zoomBy(1 / 1.2)} title="Uzaklaştır">
              <ZoomOut className="w-4 h-4" />
            </Button>
            <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => fitView()} title="Ekrana sığdır">
              <Maximize2 className="w-4 h-4" />
            </Button>
          </div>
          <div className="absolute bottom-4 left-16 z-10 hidden lg:block text-[11px] text-muted-foreground bg-card/80 backdrop-blur px-2.5 py-1 rounded-md border border-border">
            Daireye tıkla: alt ve ilişkili alanlar · Sağ üst: düzenle · Sağ alt: notlar · Daire boyutu not sayısını gösterir
          </div>

          {/* Right: edit panel */}
          {selectedArea && (
            <div
              className="contents"
              style={{ ["--panel-right" as any]: drawerOpen && isWide ? "24.75rem" : "0.75rem" }}
            >
              <AreaDetailPanel
                key={selectedArea.area_id}
                area={selectedArea}
                areas={areas}
                byId={byId}
                tree={treeById[selectedArea.area_id]}
                notes={activeNotes}
                directNotes={notesByArea[selectedArea.area_id] || []}
                onClose={() => setSelectedId(null)}
                onSelectArea={(id) => {
                  focusArea(id);
                  setSelectedId(id);
                }}
                onUpdate={(patch) => updateArea(selectedArea.area_id, patch)}
                onCreateChild={(name) => createArea(name, selectedArea.area_id)}
                onArchive={() => setArchived(selectedArea, true)}
                onLinkNote={(note, link) =>
                  updateNoteAreas(
                    note,
                    link
                      ? Array.from(new Set([...(note.area_ids || []), selectedArea.area_id]))
                      : (note.area_ids || []).filter((x) => x !== selectedArea.area_id)
                  )
                }
              />
            </div>
          )}
          {selectedId === UNASSIGNED_ID && (
            <div className="contents" style={{ ["--panel-right" as any]: drawerOpen && isWide ? "24.75rem" : "0.75rem" }}>
            <UnassignedPanel
              notes={unassignedNotes}
              areas={areas}
              onClose={() => setSelectedId(null)}
              onAssign={updateNoteAreas}
              onAreaCreated={(a) => setAreas((prev) => [...prev, a])}
            />
            </div>
          )}
        </main>
      </div>

      <AlertDialog open={Boolean(deleteTarget)} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>"{deleteTarget?.name}" kalıcı olarak silinsin mi?</AlertDialogTitle>
            <AlertDialogDescription>
              Bu işlem geri alınamaz. Notlarınız silinmez; yalnızca bu alanla bağlantıları kaldırılır. Alt alanlar bir üst
              seviyeye taşınır.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Vazgeç</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                if (deleteTarget) deleteArea(deleteTarget);
                setDeleteTarget(null);
              }}
            >
              Kalıcı olarak sil
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ---------------------------------------------------------------------------
// One circle: name + count inside, edit button top-right, notes dot bottom-right
// ---------------------------------------------------------------------------
function BubbleView({
  layer,
  bubble: b,
  selected,
  dimmed,
  onActivate,
  onEdit,
  onNotes,
  onHover,
}: {
  /** Circles are drawn first, then every circle's corner buttons on top of all circles. */
  layer: "body" | "buttons";
  bubble: Bubble;
  selected: boolean;
  dimmed: boolean;
  onActivate: () => void;
  onEdit: () => void;
  onNotes: () => void;
  onHover: (h: boolean) => void;
}) {
  const keyActivate = (fn: () => void) => (e: React.KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      e.stopPropagation();
      fn();
    }
  };
  const nodeStyle = {
    transform: `translate(${b.x}px, ${b.y}px)`,
    opacity: dimmed ? 0.45 : 1,
  } as React.CSSProperties;

  if (b.kind === "unassigned") {
    if (layer === "buttons") return null;
    return (
      <g
        data-node={b.id}
        role="button"
        tabIndex={0}
        aria-label={`Alana bağlı olmayan ${b.count} not`}
        className="area-node outline-none cursor-pointer"
        style={nodeStyle}
        onClick={(e) => {
          e.stopPropagation();
          onActivate();
        }}
        onKeyDown={keyActivate(onActivate)}
      >
        <circle r={b.r} fill="hsl(var(--card))" stroke="hsl(var(--muted-foreground))" strokeDasharray="4 4" strokeWidth={1.5} className="area-circle" />
        <text textAnchor="middle" y={-2} fontSize={Math.max(12, b.r / 3)} fontWeight={700} fill="hsl(var(--muted-foreground))">
          {b.count}
        </text>
        <text textAnchor="middle" y={Math.max(12, b.r / 3) - 2} fontSize={10} fill="hsl(var(--muted-foreground))">
          alansız not
        </text>
      </g>
    );
  }

  const isRelated = b.role === "related";
  const isFocus = b.role === "focus";
  const fs = Math.max(11, Math.min(isFocus ? 20 : 17, b.r / 4.2));
  const maxChars = Math.max(4, Math.floor((b.r * 1.6) / (fs * 0.56)));
  const textFill = isRelated ? "hsl(var(--foreground))" : "#fff";
  const btn = Math.max(10, Math.min(15, b.r * 0.17));
  const corner = b.r * Math.SQRT1_2; // 45° on the rim
  const subFs = Math.max(9.5, fs * 0.62);
  const subMax = Math.max(6, Math.floor((b.r * 1.7) / (subFs * 0.55)));
  const sub = isRelated
    ? `${b.shared} ortak not`
    : `${b.count} not${b.childCount ? ` · ${b.childCount} alt alan` : ""}`;

  if (layer === "body") return (
    <g
      data-node={b.id}
      role="button"
      tabIndex={0}
      aria-label={`${b.label}, ${sub}${isFocus ? ", açık" : ""}`}
      className="area-node outline-none cursor-pointer"
      style={nodeStyle}
      onClick={(e) => {
        e.stopPropagation();
        onActivate();
      }}
      onKeyDown={keyActivate(onActivate)}
      onMouseEnter={() => onHover(true)}
      onMouseLeave={() => onHover(false)}
      data-role={b.role}
    >
      <title>
        {isFocus ? `${b.label} — üst seviyeye dönmek için tıkla` : `${b.label} — alt ve ilişkili alanları göster`}
      </title>
      <circle
        r={b.r}
        fill={b.color}
        fillOpacity={isRelated ? 0.22 : isFocus ? 0.95 : 0.85}
        stroke={selected ? "hsl(var(--foreground))" : "hsl(var(--background))"}
        strokeWidth={selected ? 3 : 2}
        className="area-circle"
      />
      {isRelated && (
        <circle r={b.r - 4} fill="none" stroke={b.color} strokeWidth={1.5} strokeDasharray="3 4" opacity={0.8} pointerEvents="none" />
      )}
      <text
        textAnchor="middle"
        y={-fs * 0.15}
        fontSize={fs}
        fontWeight={700}
        fill={textFill}
        pointerEvents="none"
      >
        {truncate(b.label, maxChars)}
      </text>
      <text
        textAnchor="middle"
        y={fs * 0.95}
        fontSize={subFs}
        fill={textFill}
        opacity={0.85}
        pointerEvents="none"
      >
        {truncate(sub, subMax)}
      </text>
    </g>
  );

  return (
    <g data-node={`${b.id}:buttons`} className="area-node" style={nodeStyle}>
      {/* edit (top-right) */}
      <g
        role="button"
        tabIndex={0}
        aria-label={`${b.label} alanını düzenle`}
        className="area-btn outline-none"
        style={{ transform: `translate(${corner}px, ${-corner}px)` }}
        onClick={(e) => {
          e.stopPropagation();
          onEdit();
        }}
        onKeyDown={keyActivate(onEdit)}
        data-testid={`area-edit-${b.id}`}
      >
        <title>Düzenle</title>
        <circle r={btn} fill="hsl(var(--card))" stroke={b.color} strokeWidth={1.5} />
        <Pencil x={-btn * 0.5} y={-btn * 0.5} width={btn} height={btn} color={b.color} strokeWidth={2.25} />
      </g>

      {/* notes (bottom-right) */}
      <g
        role="button"
        tabIndex={0}
        aria-label={`${b.label} alanının notlarını panelde aç`}
        className="area-btn outline-none"
        style={{ transform: `translate(${corner}px, ${corner}px)` }}
        onClick={(e) => {
          e.stopPropagation();
          onNotes();
        }}
        onKeyDown={keyActivate(onNotes)}
        data-testid={`area-notes-${b.id}`}
      >
        <title>Notları panelde aç</title>
        <circle r={btn} fill="hsl(var(--foreground))" stroke="hsl(var(--background))" strokeWidth={2} />
        <text textAnchor="middle" dy="0.35em" fontSize={btn * (b.count > 99 ? 0.7 : 0.95)} fontWeight={700} fill="hsl(var(--background))">
          {b.count > 99 ? "99+" : b.count}
        </text>
      </g>
    </g>
  );
}

// ---------------------------------------------------------------------------
// Empty state
// ---------------------------------------------------------------------------
const SUGGESTIONS = ["İş", "Kişisel", "Projeler", "Öğrenme", "Sağlık", "Finans"];

function EmptyState({ onCreate }: { onCreate: (name: string) => void }) {
  const [name, setName] = useState("");
  return (
    <div className="absolute inset-0 flex items-center justify-center p-6">
      <div className="max-w-md w-full bg-card border border-border rounded-2xl shadow-sm p-6 text-center space-y-4">
        <FolderTree className="w-9 h-9 mx-auto text-muted-foreground" strokeWidth={1.25} />
        <div className="space-y-1">
          <h2 className="text-lg font-semibold">Alanlarınızı oluşturun</h2>
          <p className="text-sm text-muted-foreground">
            Alanlar notlarınızı konulara göre gruplar. Ana alanların altında alt alanlar açabilir, notları birden çok alana
            bağlayabilirsiniz.
          </p>
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (name.trim()) {
              onCreate(name);
              setName("");
            }
          }}
          className="flex gap-2"
        >
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="İlk ana alanınızın adı…"
            className="flex-1 bg-background border border-border rounded-md px-3 py-2 text-sm outline-none focus:border-primary"
            data-testid="area-empty-input"
          />
          <Button type="submit" disabled={!name.trim()}>
            <Plus className="w-4 h-4 mr-1" /> Oluştur
          </Button>
        </form>
        <div className="flex flex-wrap justify-center gap-1.5">
          {SUGGESTIONS.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => onCreate(s)}
              className="text-xs px-2.5 py-1 rounded-full border border-border hover:bg-accent"
            >
              + {s}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Left tree panel (management)
// ---------------------------------------------------------------------------
interface AreaTreePanelProps {
  forest: AreaTreeNode[];
  byId: Record<string, Area>;
  expanded: Set<string>;
  selectedId: string | null;
  archivedAreas: Area[];
  onToggle: (id: string) => void;
  onSelect: (id: string) => void;
  onCreate: (name: string, parentId: string | null) => Promise<Area | null>;
  onRename: (id: string, name: string) => void;
  onColor: (id: string, color: string) => void;
  onArchive: (a: Area) => void;
  onRestore: (a: Area) => void;
  onDelete: (a: Area) => void;
}

function AreaTreePanel(props: AreaTreePanelProps) {
  const { forest, byId, archivedAreas, onCreate, onRestore, onDelete } = props;
  const [newRoot, setNewRoot] = useState<string | null>(null);
  const [archiveOpen, setArchiveOpen] = useState(false);

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex items-center justify-between px-4 h-12 border-b border-border shrink-0">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <FolderTree className="w-4 h-4" strokeWidth={1.5} /> Alanlar
        </div>
        <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setNewRoot("")} data-testid="area-add-root">
          <Plus className="w-3.5 h-3.5 mr-1" /> Ana alan
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto py-2 min-h-0">
        {newRoot !== null && (
          <InlineNameForm
            placeholder="Yeni ana alan adı"
            depth={0}
            onCancel={() => setNewRoot(null)}
            onSubmit={async (name) => {
              await onCreate(name, null);
              setNewRoot(null);
            }}
          />
        )}
        {forest.length === 0 && newRoot === null && (
          <p className="px-4 py-6 text-xs text-muted-foreground text-center">
            Henüz alan yok. "Ana alan" ile başlayın.
          </p>
        )}
        {forest.map((t) => (
          <AreaTreeRow key={t.area.area_id} node={t} {...props} />
        ))}
      </div>

      {archivedAreas.length > 0 && (
        <div className="border-t border-border shrink-0 max-h-[40%] flex flex-col min-h-0">
          <button
            type="button"
            onClick={() => setArchiveOpen((v) => !v)}
            className="flex items-center gap-2 px-4 h-10 text-xs text-muted-foreground hover:text-foreground shrink-0"
            data-testid="area-archive-toggle"
          >
            {archiveOpen ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
            <Archive className="w-3.5 h-3.5" /> Arşiv ({archivedAreas.length})
          </button>
          {archiveOpen && (
            <div className="overflow-y-auto pb-2">
              {archivedAreas.map((a) => (
                <div key={a.area_id} className="group flex items-center gap-2 px-4 py-1.5 text-xs hover:bg-accent/50">
                  <span className="w-2 h-2 rounded-full shrink-0 opacity-50" style={{ background: areaColor(a, byId) }} />
                  <span className="flex-1 truncate text-muted-foreground" title={areaPath(a, byId)}>
                    {areaPath(a, byId)}
                  </span>
                  <button
                    type="button"
                    onClick={() => onRestore(a)}
                    className="p-1 rounded hover:bg-background text-muted-foreground hover:text-foreground"
                    title="Arşivden çıkar"
                  >
                    <ArchiveRestore className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => onDelete(a)}
                    className="p-1 rounded hover:bg-background text-muted-foreground hover:text-destructive"
                    title="Kalıcı olarak sil"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function AreaTreeRow(props: AreaTreePanelProps & { node: AreaTreeNode }) {
  const { node, byId, expanded, selectedId, onToggle, onSelect, onCreate, onRename, onColor, onArchive } = props;
  const a = node.area;
  const [renaming, setRenaming] = useState(false);
  const [addingChild, setAddingChild] = useState(false);
  const isOpen = expanded.has(a.area_id);
  const color = areaColor(a, byId);
  const hasKids = node.children.length > 0;

  return (
    <div>
      <div
        className={`group flex items-center gap-1 pr-2 h-8 text-sm transition-colors ${
          selectedId === a.area_id ? "bg-accent" : "hover:bg-accent/50"
        }`}
        style={{ paddingLeft: 8 + node.depth * 16 }}
      >
        <button
          type="button"
          onClick={() => hasKids && onToggle(a.area_id)}
          className={`p-0.5 rounded text-muted-foreground ${hasKids ? "hover:text-foreground" : "opacity-0 pointer-events-none"}`}
          aria-label={isOpen ? "Daralt" : "Genişlet"}
        >
          {isOpen ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
        </button>
        <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: color }} />
        {renaming ? (
          <input
            autoFocus
            defaultValue={a.name}
            onBlur={(e) => {
              const v = e.target.value.trim();
              if (v && v !== a.name) onRename(a.area_id, v);
              setRenaming(false);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
              if (e.key === "Escape") setRenaming(false);
            }}
            className="flex-1 min-w-0 bg-background border border-border rounded px-1.5 py-0.5 text-sm outline-none focus:border-primary"
          />
        ) : (
          <button
            type="button"
            onClick={() => onSelect(a.area_id)}
            onDoubleClick={() => setRenaming(true)}
            className="flex-1 min-w-0 text-left truncate pl-1"
            data-testid={`area-row-${a.area_id}`}
          >
            {a.name}
          </button>
        )}
        {node.totalNotes > 0 && !renaming && (
          <span className="text-[10px] font-mono text-muted-foreground group-hover:hidden">{node.totalNotes}</span>
        )}
        <button
          type="button"
          onClick={() => setAddingChild(true)}
          className="hidden group-hover:inline-flex p-1 rounded text-muted-foreground hover:text-foreground hover:bg-background"
          title="Alt alan ekle"
        >
          <Plus className="w-3.5 h-3.5" />
        </button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="hidden group-hover:inline-flex data-[state=open]:inline-flex p-1 rounded text-muted-foreground hover:text-foreground hover:bg-background"
              title="Diğer işlemler"
            >
              <MoreHorizontal className="w-3.5 h-3.5" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            <DropdownMenuItem onSelect={() => setRenaming(true)}>
              <Pencil className="w-3.5 h-3.5 mr-2" /> Yeniden adlandır
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setAddingChild(true)}>
              <Plus className="w-3.5 h-3.5 mr-2" /> Alt alan ekle
            </DropdownMenuItem>
            <div className="flex flex-wrap gap-1 px-2 py-1.5">
              {AREA_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => onColor(a.area_id, c)}
                  className="w-4 h-4 rounded-full border border-background ring-offset-1"
                  style={{ background: c, boxShadow: a.color === c ? `0 0 0 2px ${c}` : undefined }}
                  title="Renk"
                />
              ))}
            </div>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => onArchive(a)}>
              <Archive className="w-3.5 h-3.5 mr-2" /> Arşivle
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {addingChild && (
        <InlineNameForm
          placeholder={`${a.name} › alt alan adı`}
          depth={node.depth + 1}
          onCancel={() => setAddingChild(false)}
          onSubmit={async (name) => {
            await onCreate(name, a.area_id);
            setAddingChild(false);
          }}
        />
      )}
      {isOpen && node.children.map((c) => <AreaTreeRow key={c.area.area_id} {...props} node={c} />)}
    </div>
  );
}

function InlineNameForm({
  placeholder,
  depth,
  onSubmit,
  onCancel,
}: {
  placeholder: string;
  depth: number;
  onSubmit: (name: string) => Promise<void> | void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState("");
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        if (value.trim()) await onSubmit(value);
      }}
      className="flex items-center gap-1.5 pr-2 py-1"
      style={{ paddingLeft: 28 + depth * 16 }}
    >
      <input
        autoFocus
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => e.key === "Escape" && onCancel()}
        onBlur={() => !value.trim() && onCancel()}
        placeholder={placeholder}
        className="flex-1 min-w-0 bg-background border border-border rounded px-2 py-1 text-sm outline-none focus:border-primary"
        data-testid="area-inline-input"
      />
      <Button type="submit" size="sm" className="h-7 px-2 text-xs" disabled={!value.trim()}>
        Ekle
      </Button>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Right detail panel
// ---------------------------------------------------------------------------
function PanelShell({ children, onClose, testId }: { children: React.ReactNode; onClose: () => void; testId: string }) {
  return (
    <aside
      className="absolute z-30 bg-card border border-border shadow-xl flex flex-col min-h-0
                 inset-x-0 bottom-0 h-[60%] rounded-t-2xl
                 sm:inset-x-auto sm:right-[var(--panel-right,0.75rem)] sm:top-16 sm:bottom-3 sm:w-80 sm:h-auto sm:rounded-xl
                 animate-in fade-in slide-in-from-right-4"
      data-testid={testId}
    >
      <button
        type="button"
        onClick={onClose}
        className="absolute right-2.5 top-2.5 p-1 rounded-full text-muted-foreground hover:text-foreground hover:bg-accent z-10"
        title="Kapat"
      >
        <X className="w-4 h-4" />
      </button>
      {children}
    </aside>
  );
}

interface AreaDetailPanelProps {
  area: Area;
  areas: Area[];
  byId: Record<string, Area>;
  tree?: AreaTreeNode;
  notes: Note[];
  directNotes: Note[];
  onClose: () => void;
  onSelectArea: (id: string) => void;
  onUpdate: (patch: Partial<Pick<Area, "name" | "color" | "description" | "parent_id">>) => void;
  onCreateChild: (name: string) => Promise<Area | null>;
  onArchive: () => void;
  onLinkNote: (note: Note, link: boolean) => void;
}

function AreaDetailPanel({
  area,
  areas,
  byId,
  tree,
  notes,
  directNotes,
  onClose,
  onSelectArea,
  onUpdate,
  onCreateChild,
  onArchive,
  onLinkNote,
}: AreaDetailPanelProps) {
  const [name, setName] = useState(area.name);
  const [desc, setDesc] = useState(area.description || "");
  const [child, setChild] = useState("");
  const [noteQuery, setNoteQuery] = useState("");
  const color = areaColor(area, byId);

  // ancestors for breadcrumb
  const trail: Area[] = [];
  let cur = area.parent_id ? byId[area.parent_id] : undefined;
  while (cur && !trail.includes(cur)) {
    trail.unshift(cur);
    cur = cur.parent_id ? byId[cur.parent_id] : undefined;
  }

  // valid new parents: anything that is not this area or one of its descendants
  const descendantIds = new Set(tree ? flattenTree(tree.children).map((t) => t.area.area_id) : []);
  const parentOptions = areas
    .filter((a) => a.area_id !== area.area_id && !descendantIds.has(a.area_id) && !isEffectivelyArchived(a, byId))
    .sort((x, y) => areaPath(x, byId).localeCompare(areaPath(y, byId), "tr"));

  const linkedIds = new Set(directNotes.map((n) => n.note_id));
  const nq = noteQuery.trim().toLocaleLowerCase("tr");
  const candidates = nq
    ? notes
        .filter((n) => !linkedIds.has(n.note_id) && (n.title || "").toLocaleLowerCase("tr").includes(nq))
        .slice(0, 8)
    : [];

  return (
    <PanelShell onClose={onClose} testId="area-detail-panel">
      <div className="p-4 pb-3 border-b border-border space-y-2 shrink-0">
        {trail.length > 0 && (
          <div className="flex flex-wrap items-center gap-1 text-[11px] text-muted-foreground pr-6">
            {trail.map((t) => (
              <React.Fragment key={t.area_id}>
                <button type="button" onClick={() => onSelectArea(t.area_id)} className="hover:text-foreground hover:underline">
                  {t.name}
                </button>
                <ChevronRight className="w-3 h-3" />
              </React.Fragment>
            ))}
          </div>
        )}
        <div className="flex items-center gap-2 pr-6">
          <span className="w-3.5 h-3.5 rounded-full shrink-0" style={{ background: color }} />
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={() => {
              const v = name.trim();
              if (v && v !== area.name) onUpdate({ name: v });
              else setName(area.name);
            }}
            onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
            className="flex-1 min-w-0 bg-transparent text-base font-semibold outline-none border-b border-transparent hover:border-border focus:border-primary"
            aria-label="Alan adı"
            data-testid="area-detail-name"
          />
        </div>
        <p className="text-xs text-muted-foreground">
          {directNotes.length} not doğrudan bağlı
          {tree && tree.totalNotes !== directNotes.length ? ` · alt alanlarla ${tree.totalNotes}` : ""}
          {tree && tree.children.length > 0 ? ` · ${tree.children.length} alt alan` : ""}
        </p>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-5 min-h-0 text-sm">
        <section className="space-y-2">
          <div className="flex flex-wrap gap-1.5">
            {AREA_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => onUpdate({ color: c })}
                className="w-5 h-5 rounded-full transition-transform hover:scale-110"
                style={{ background: c, boxShadow: color === c ? `0 0 0 2px hsl(var(--card)), 0 0 0 4px ${c}` : undefined }}
                title="Renk"
              />
            ))}
          </div>
          <label className="block text-[11px] uppercase tracking-wider text-muted-foreground">Üst alan</label>
          <select
            value={area.parent_id || ""}
            onChange={(e) => onUpdate({ parent_id: e.target.value || null })}
            className="w-full bg-background border border-border rounded-md px-2 py-1.5 text-sm"
            data-testid="area-detail-parent"
          >
            <option value="">— Ana alan —</option>
            {parentOptions.map((a) => (
              <option key={a.area_id} value={a.area_id}>
                {areaPath(a, byId)}
              </option>
            ))}
          </select>
          <textarea
            value={desc}
            onChange={(e) => setDesc(e.target.value)}
            onBlur={() => desc !== (area.description || "") && onUpdate({ description: desc })}
            placeholder="Açıklama (isteğe bağlı)"
            rows={2}
            className="w-full bg-background border border-border rounded-md px-2 py-1.5 text-sm resize-none outline-none focus:border-primary"
          />
        </section>

        <section className="space-y-2">
          <h4 className="text-[11px] uppercase tracking-wider text-muted-foreground">Alt alanlar</h4>
          <div className="flex flex-wrap gap-1.5">
            {(tree?.children || []).map((c) => (
              <button
                key={c.area.area_id}
                type="button"
                onClick={() => onSelectArea(c.area.area_id)}
                className="inline-flex items-center gap-1.5 text-xs px-2 py-1 rounded-full border border-border hover:bg-accent"
              >
                <span className="w-1.5 h-1.5 rounded-full" style={{ background: areaColor(c.area, byId) }} />
                {c.area.name}
                {c.totalNotes > 0 && <span className="font-mono text-muted-foreground">{c.totalNotes}</span>}
              </button>
            ))}
          </div>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              if (!child.trim()) return;
              await onCreateChild(child);
              setChild("");
            }}
            className="flex gap-1.5"
          >
            <input
              value={child}
              onChange={(e) => setChild(e.target.value)}
              placeholder="Yeni alt alan adı"
              className="flex-1 min-w-0 bg-background border border-border rounded-md px-2 py-1.5 text-sm outline-none focus:border-primary"
              data-testid="area-detail-child-input"
            />
            <Button type="submit" size="sm" variant="outline" disabled={!child.trim()}>
              <Plus className="w-3.5 h-3.5" />
            </Button>
          </form>
        </section>

        <section className="space-y-2">
          <h4 className="text-[11px] uppercase tracking-wider text-muted-foreground">Notlar</h4>
          <div className="relative">
            <Link2 className="w-3.5 h-3.5 absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              value={noteQuery}
              onChange={(e) => setNoteQuery(e.target.value)}
              placeholder="Not ara ve bu alana bağla…"
              className="w-full bg-background border border-border rounded-md pl-7 pr-2 py-1.5 text-sm outline-none focus:border-primary"
              data-testid="area-detail-note-search"
            />
            {candidates.length > 0 && (
              <div className="absolute left-0 right-0 top-full mt-1 z-10 bg-popover border border-border rounded-md shadow-lg py-1 max-h-56 overflow-y-auto">
                {candidates.map((n) => (
                  <button
                    key={n.note_id}
                    type="button"
                    onClick={() => {
                      onLinkNote(n, true);
                      setNoteQuery("");
                    }}
                    className="w-full flex items-center gap-2 px-2.5 py-1.5 text-left text-sm hover:bg-accent"
                  >
                    <Plus className="w-3 h-3 text-primary shrink-0" />
                    <span className="truncate">{n.title || "Başlıksız Not"}</span>
                  </button>
                ))}
              </div>
            )}
            {nq && candidates.length === 0 && (
              <p className="text-xs text-muted-foreground mt-1">Eşleşen, henüz bağlanmamış not yok.</p>
            )}
          </div>
          {directNotes.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              Bu alana bağlı not yok. Yukarıdan arayarak ya da not sayfasındaki "Alana bağla" ile ekleyebilirsiniz.
            </p>
          ) : (
            <ul className="divide-y divide-border/60 -mx-1">
              {directNotes.map((n) => (
                <li key={n.note_id} className="group flex items-center gap-2 px-1 py-1.5">
                  <Link to={`/note/${n.slug || n.note_id}`} className="flex-1 min-w-0">
                    <div className="truncate hover:underline">{n.title || "Başlıksız Not"}</div>
                    <div className="text-[10px] font-mono text-muted-foreground">{(n.date || "").slice(0, 10)}</div>
                  </Link>
                  <button
                    type="button"
                    onClick={() => onLinkNote(n, false)}
                    className="p-1 rounded text-muted-foreground opacity-0 group-hover:opacity-100 focus:opacity-100 hover:text-foreground hover:bg-accent"
                    title="Bu alandan çıkar (not silinmez)"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <div className="p-3 border-t border-border shrink-0">
        <Button variant="outline" size="sm" className="w-full text-xs" onClick={onArchive} data-testid="area-detail-archive">
          <Archive className="w-3.5 h-3.5 mr-1.5" /> Alanı arşivle
        </Button>
      </div>
    </PanelShell>
  );
}

function UnassignedPanel({
  notes,
  areas,
  onClose,
  onAssign,
  onAreaCreated,
}: {
  notes: Note[];
  areas: Area[];
  onClose: () => void;
  onAssign: (note: Note, ids: string[]) => void;
  onAreaCreated: (a: Area) => void;
}) {
  return (
    <PanelShell onClose={onClose} testId="area-unassigned-panel">
      <div className="p-4 pb-3 border-b border-border shrink-0 pr-10">
        <h3 className="font-semibold">Alana bağlı olmayan notlar</h3>
        <p className="text-xs text-muted-foreground mt-0.5">{notes.length} not. Her birini hızlıca bir alana bağlayın.</p>
      </div>
      <ul className="flex-1 overflow-y-auto divide-y divide-border/60 min-h-0">
        {notes.map((n) => (
          <li key={n.note_id} className="flex items-center gap-2 px-4 py-2">
            <Link to={`/note/${n.slug || n.note_id}`} className="flex-1 min-w-0 text-sm truncate hover:underline">
              {n.title || "Başlıksız Not"}
            </Link>
            <AreaPicker
              areas={areas}
              value={n.area_ids || []}
              onChange={(ids) => onAssign(n, ids)}
              onAreaCreated={onAreaCreated}
              align="end"
              trigger={
                <button
                  type="button"
                  className="shrink-0 inline-flex items-center gap-1 text-xs px-2 py-1 rounded-full border border-dashed border-border text-muted-foreground hover:text-foreground"
                >
                  <Plus className="w-3 h-3" /> Alan
                </button>
              }
            />
          </li>
        ))}
      </ul>
    </PanelShell>
  );
}
