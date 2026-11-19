import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import {
  Archive,
  ArchiveRestore,
  ChevronDown,
  ChevronRight,
  FolderTree,
  Link2,
  List,
  Maximize2,
  MoreHorizontal,
  Network,
  PanelLeft,
  Pencil,
  Plus,
  Search,
  Share2,
  StickyNote,
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

// ---------------------------------------------------------------------------
// Mindmap layout
// ---------------------------------------------------------------------------
const ROOT_ID = "__root";
const UNASSIGNED_ID = "__unassigned";
const ROOT_R = 36;
const MAX_NOTE_LEAVES = 6;
const COL_FIRST = 250; // distance root → main areas
const COL_STEP = 220; // distance between deeper levels
const NOTE_OFFSET = 175; // distance area → note leaves
const NOTE_ROW = 26;
const GAP = 14;

type MapNodeKind = "root" | "area" | "note" | "more" | "unassigned";

interface MapNode {
  id: string;
  kind: MapNodeKind;
  label: string;
  x: number;
  y: number;
  r: number;
  side: 1 | -1;
  color: string;
  parentId: string | null;
  areaId?: string;
  note?: Note;
  count?: number;
  hasChildren?: boolean;
  expanded?: boolean;
  archived?: boolean;
}

interface MapEdge {
  id: string;
  from: MapNode;
  to: MapNode;
  color: string;
  width: number;
}

/** Bigger areas for more notes; sqrt keeps very large areas from dominating. */
function areaRadius(total: number, depth: number) {
  const base = depth === 0 ? 22 : 15;
  return Math.min(base + Math.sqrt(total) * 8, depth === 0 ? 74 : 56);
}

interface LayoutInput {
  forest: AreaTreeNode[];
  expanded: Set<string>;
  showNotes: boolean;
  notesByArea: Record<string, Note[]>;
  unassignedCount: number;
  byId: Record<string, Area>;
}

function computeLayout({ forest, expanded, showNotes, notesByArea, unassignedCount, byId }: LayoutInput) {
  const nodes: MapNode[] = [];
  const edges: MapEdge[] = [];

  type Block =
    | { kind: "area"; tree: AreaTreeNode; children: Block[]; h: number; r: number }
    | { kind: "note"; note: Note; h: number }
    | { kind: "more"; areaId: string; extra: number; h: number };

  const measure = (tree: AreaTreeNode): Block => {
    const r = areaRadius(tree.totalNotes, tree.depth);
    const children: Block[] = [];
    if (expanded.has(tree.area.area_id)) {
      tree.children.forEach((c) => children.push(measure(c)));
      if (showNotes) {
        const list = notesByArea[tree.area.area_id] || [];
        list.slice(0, MAX_NOTE_LEAVES).forEach((n) => children.push({ kind: "note", note: n, h: NOTE_ROW }));
        if (list.length > MAX_NOTE_LEAVES) {
          children.push({ kind: "more", areaId: tree.area.area_id, extra: list.length - MAX_NOTE_LEAVES, h: NOTE_ROW });
        }
      }
    }
    const own = r * 2 + 30; // circle + label below it
    const kids = children.reduce((s, c) => s + c.h, 0) + Math.max(0, children.length - 1) * GAP;
    return { kind: "area", tree, children, h: Math.max(own, kids), r };
  };

  const root: MapNode = {
    id: ROOT_ID,
    kind: "root",
    label: "Alanlarım",
    x: 0,
    y: 0,
    r: ROOT_R,
    side: 1,
    color: "hsl(var(--foreground))",
    parentId: null,
  };
  nodes.push(root);

  // Balance main areas between the right and left side, like a classic mindmap.
  // Sides are decided from the *collapsed* size only, so expanding a branch never
  // makes other areas jump to the opposite side.
  const blocks = forest.map(measure);
  const order = blocks
    .map((b, i) => ({ b, i, base: areaRadius(forest[i].totalNotes, 0) * 2 + 30 }))
    .sort((a, z) => z.base - a.base || a.i - z.i);
  const sides: Record<1 | -1, { b: Block; i: number }[]> = { 1: [], [-1]: [] } as any;
  let rightH = 0;
  let leftH = 0;
  for (const item of order) {
    if (rightH <= leftH) {
      sides[1].push(item);
      rightH += item.base + GAP * 2;
    } else {
      sides[-1].push(item);
      leftH += item.base + GAP * 2;
    }
  }

  const place = (block: Block, parent: MapNode, depth: number, top: number, side: 1 | -1, parentColor: string) => {
    const cy = top + block.h / 2;
    if (block.kind === "area") {
      const a = block.tree.area;
      const color = areaColor(a, byId);
      const x = depth === 1 ? side * COL_FIRST : parent.x + side * COL_STEP;
      const node: MapNode = {
        id: a.area_id,
        kind: "area",
        label: a.name,
        x,
        y: cy,
        r: block.r,
        side,
        color,
        parentId: parent.id,
        areaId: a.area_id,
        count: block.tree.totalNotes,
        hasChildren: block.tree.children.length > 0 || (notesByArea[a.area_id] || []).length > 0,
        expanded: expanded.has(a.area_id),
        archived: a.archived,
      };
      nodes.push(node);
      edges.push({ id: `${parent.id}->${node.id}`, from: parent, to: node, color, width: 1.5 + Math.min(block.tree.totalNotes, 30) / 6 });
      const kidsH = block.children.reduce((s, c) => s + c.h, 0) + Math.max(0, block.children.length - 1) * GAP;
      let y = top + (block.h - kidsH) / 2;
      for (const c of block.children) {
        place(c, node, depth + 1, y, side, color);
        y += c.h + GAP;
      }
    } else if (block.kind === "note") {
      const node: MapNode = {
        id: `note:${parent.id}:${block.note.note_id}`,
        kind: "note",
        label: block.note.title || "Başlıksız Not",
        x: parent.x + side * NOTE_OFFSET,
        y: cy,
        r: 5,
        side,
        color: parentColor,
        parentId: parent.id,
        note: block.note,
      };
      nodes.push(node);
      edges.push({ id: `${parent.id}->${node.id}`, from: parent, to: node, color: parentColor, width: 1 });
    } else {
      const node: MapNode = {
        id: `more:${block.areaId}`,
        kind: "more",
        label: `+${block.extra} not daha`,
        x: parent.x + side * NOTE_OFFSET,
        y: cy,
        r: 5,
        side,
        color: parentColor,
        parentId: parent.id,
        areaId: block.areaId,
      };
      nodes.push(node);
      edges.push({ id: `${parent.id}->${node.id}`, from: parent, to: node, color: parentColor, width: 1 });
    }
  };

  ([1, -1] as const).forEach((side) => {
    const list = sides[side].sort((a, z) => a.i - z.i).map((x) => x.b);
    const total = list.reduce((s, b) => s + b.h, 0) + Math.max(0, list.length - 1) * GAP * 2;
    let y = -total / 2;
    for (const b of list) {
      place(b, root, 1, y, side, "hsl(var(--foreground))");
      y += b.h + GAP * 2;
    }
  });

  if (unassignedCount > 0) {
    const node: MapNode = {
      id: UNASSIGNED_ID,
      kind: "unassigned",
      label: `Alana bağlı olmayan ${unassignedCount} not`,
      x: 0,
      y: ROOT_R + 92,
      r: 14,
      side: 1,
      color: "hsl(var(--muted-foreground))",
      parentId: ROOT_ID,
      count: unassignedCount,
    };
    nodes.push(node);
  }

  return { nodes, edges };
}

function edgePath(e: MapEdge) {
  const { from, to } = e;
  const side = to.side;
  const x1 = from.kind === "root" ? from.x + side * from.r : from.x + side * from.r;
  const y1 = from.y;
  const x2 = to.x - side * to.r;
  const y2 = to.y;
  const mx = (x1 + x2) / 2;
  return `M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}`;
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
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------
export default function AreaMapView() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const [areas, setAreas] = useState<Area[]>([]);
  const [notes, setNotes] = useState<Note[]>([]);
  const [loading, setLoading] = useState(true);

  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [showNotes, setShowNotes] = useState(true);
  const [showRelations, setShowRelations] = useState(true);
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

  // ---- layout + view ----------------------------------------------------
  const layout = useMemo(
    () =>
      computeLayout({
        forest,
        expanded,
        showNotes,
        notesByArea,
        unassignedCount: unassignedNotes.length,
        byId,
      }),
    [forest, expanded, showNotes, notesByArea, unassignedNotes.length, byId]
  );
  const nodeById = useMemo(() => {
    const m: Record<string, MapNode> = {};
    layout.nodes.forEach((n) => (m[n.id] = n));
    return m;
  }, [layout]);

  // Relations: dashed links between visible areas that share notes
  const relations = useMemo(() => {
    if (!showRelations) return [];
    const visibleAreas = layout.nodes.filter((n) => n.kind === "area");
    const visibleSet = new Set(visibleAreas.map((n) => n.id));
    const isLineage = (a: string, b: string) => {
      const up = (id: string) => {
        const out: string[] = [];
        let cur = byId[id]?.parent_id;
        while (cur && !out.includes(cur)) {
          out.push(cur);
          cur = byId[cur]?.parent_id;
        }
        return out;
      };
      return up(a).includes(b) || up(b).includes(a);
    };
    const pairs: Record<string, number> = {};
    for (const n of activeNotes) {
      const ids = (n.area_ids || []).filter((id) => visibleSet.has(id));
      for (let i = 0; i < ids.length; i++) {
        for (let j = i + 1; j < ids.length; j++) {
          if (isLineage(ids[i], ids[j])) continue;
          const key = [ids[i], ids[j]].sort().join("|");
          pairs[key] = (pairs[key] || 0) + 1;
        }
      }
    }
    return Object.entries(pairs).map(([key, count]) => {
      const [a, b] = key.split("|");
      return { key, a: nodeById[a], b: nodeById[b], count };
    }).filter((r) => r.a && r.b);
  }, [showRelations, layout, activeNotes, byId, nodeById]);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [size, setSize] = useState({ w: 800, h: 600 });
  const [view, setView] = useState({ x: 400, y: 300, k: 1 });
  const viewRef = useRef(view);
  viewRef.current = view;
  const didInitialFit = useRef(false);
  const anchorRef = useRef<{ id: string; x: number; y: number } | null>(null);

  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  const fitView = useCallback(() => {
    const ns = layout.nodes;
    if (!ns.length) return;
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const n of ns) {
      const labelW = n.kind === "note" || n.kind === "more" ? 190 : 70;
      const left = n.side === -1 && (n.kind === "note" || n.kind === "more") ? labelW : n.r + 60;
      const right = n.side === 1 && (n.kind === "note" || n.kind === "more") ? labelW : n.r + 60;
      minX = Math.min(minX, n.x - left);
      maxX = Math.max(maxX, n.x + right);
      minY = Math.min(minY, n.y - n.r - 10);
      maxY = Math.max(maxY, n.y + n.r + 30);
    }
    const pad = 40;
    const k = Math.max(0.3, Math.min(1.3, (size.w - pad * 2) / (maxX - minX), (size.h - pad * 2) / (maxY - minY)));
    setView({ k, x: size.w / 2 - ((minX + maxX) / 2) * k, y: size.h / 2 - ((minY + maxY) / 2) * k });
  }, [layout, size]);

  useEffect(() => {
    if (!loading && !didInitialFit.current && size.w > 0) {
      didInitialFit.current = true;
      fitView();
    }
  }, [loading, size, fitView]);

  // Space on the right covered by the detail panel (desktop layout only).
  const panelOpen = Boolean(selectedId);
  // Same breakpoint as the panel's `sm:` classes: side panel vs. bottom sheet.
  const isWide = useMediaQuery("(min-width: 640px)");
  const reservedRight = panelOpen && isWide ? 344 : 0;
  const reservedBottom = panelOpen && !isWide ? Math.round(size.h * 0.6) : 0;
  const revealRef = useRef<string | null>(null);

  // After a re-layout: keep the clicked node visually still, then pan just enough
  // that a freshly opened branch is fully visible (not hidden under the panel).
  useLayoutEffect(() => {
    const anchor = anchorRef.current;
    const revealId = revealRef.current;
    anchorRef.current = null;
    revealRef.current = null;
    if (!anchor && !revealId) return;

    setView((v0) => {
      let v = v0;
      if (anchor) {
        const n = nodeById[anchor.id];
        if (n) v = { ...v, x: v.x - (n.x - anchor.x) * v.k, y: v.y - (n.y - anchor.y) * v.k };
      }
      const target = revealId ? nodeById[revealId] : null;
      if (!target) return v;

      // the target plus everything hanging below it
      const inSubtree = (n: MapNode): boolean => {
        let cur: MapNode | undefined = n;
        while (cur) {
          if (cur.id === target.id) return true;
          cur = cur.parentId ? nodeById[cur.parentId] : undefined;
        }
        return false;
      };
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      for (const n of layout.nodes) {
        if (!inSubtree(n)) continue;
        const isLeaf = n.kind === "note" || n.kind === "more";
        const l = isLeaf && n.side === -1 ? 190 : n.r + 50;
        const r = isLeaf && n.side === 1 ? 190 : n.r + 50;
        minX = Math.min(minX, (n.x - l) * v.k + v.x);
        maxX = Math.max(maxX, (n.x + r) * v.k + v.x);
        minY = Math.min(minY, (n.y - n.r - 10) * v.k + v.y);
        maxY = Math.max(maxY, (n.y + n.r + 30) * v.k + v.y);
      }
      const box = { l: 16, t: isWide ? 64 : 150, r: size.w - reservedRight - 16, b: size.h - reservedBottom - 16 };
      const fit = (lo: number, hi: number, bl: number, bh: number, preferLow: boolean) => {
        if (hi - lo > bh - bl) return preferLow ? bl - lo : bh - hi; // too big: keep the root-facing edge in view
        if (lo < bl) return bl - lo;
        if (hi > bh) return bh - hi;
        return 0;
      };
      const dx = fit(minX, maxX, box.l, box.r, target.side === 1);
      const dy = fit(minY, maxY, box.t, box.b, true);
      return dx || dy ? { ...v, x: v.x + dx, y: v.y + dy } : v;
    });
  }, [nodeById]);

  const centerOn = useCallback((id: string) => {
    const n = nodeById[id];
    if (!n) return;
    const visibleW = size.w - reservedRight;
    const visibleH = size.h - reservedBottom;
    setView((v) => ({ ...v, x: visibleW / 2 - n.x * v.k, y: visibleH / 2 - n.y * v.k }));
  }, [nodeById, size, reservedRight, reservedBottom]);

  const toggleExpand = (id: string) => {
    const n = nodeById[id];
    if (n) anchorRef.current = { id, x: n.x, y: n.y };
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        // collapsing also collapses the whole subtree, so re-opening starts tidy
        next.delete(id);
        const t = treeById[id];
        if (t) flattenTree(t.children).forEach((c) => next.delete(c.area.area_id));
      } else {
        next.add(id);
        revealRef.current = id;
      }
      return next;
    });
  };

  const pendingCenter = useRef<string | null>(null);
  const revealArea = useCallback((id: string) => {
    const chain: string[] = [];
    let cur = byId[id]?.parent_id || null;
    while (cur && !chain.includes(cur)) {
      chain.push(cur);
      cur = byId[cur]?.parent_id || null;
    }
    setExpanded((prev) => {
      const next = new Set(prev);
      chain.forEach((c) => next.add(c));
      return next;
    });
    setSelectedId(id);
    pendingCenter.current = id; // centred after the re-layout below
  }, [byId]);
  useEffect(() => {
    if (pendingCenter.current && nodeById[pendingCenter.current]) {
      centerOn(pendingCenter.current);
      pendingCenter.current = null;
    }
  });

  // ?area=<id> deep link (used by the area chips on notes)
  useEffect(() => {
    const target = searchParams.get("area");
    if (!loading && target && byId[target]) {
      revealArea(target);
      searchParams.delete("area");
      setSearchParams(searchParams, { replace: true });
    }
  }, [loading, searchParams, byId, revealArea, setSearchParams]);

  // Wheel zoom around the cursor (non-passive so the page does not scroll)
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = svg.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      setView((v) => {
        const k = Math.max(0.25, Math.min(2.5, v.k * Math.exp(-e.deltaY * 0.0015)));
        return { k, x: mx - (mx - v.x) * (k / v.k), y: my - (my - v.y) * (k / v.k) };
      });
    };
    svg.addEventListener("wheel", onWheel, { passive: false });
    return () => svg.removeEventListener("wheel", onWheel);
  }, []);

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
    setView((v) => ({ ...v, x: p.vx + dx, y: p.vy + dy }));
  };
  const onPointerUp = (e: React.PointerEvent) => {
    const p = panRef.current;
    panRef.current = null;
    if (p && !p.moved && !(e.target as Element).closest("[data-node]")) setSelectedId(null);
  };
  const zoomBy = (f: number) =>
    setView((v) => {
      const k = Math.max(0.25, Math.min(2.5, v.k * f));
      const cx = size.w / 2;
      const cy = size.h / 2;
      return { k, x: cx - (cx - v.x) * (k / v.k), y: cy - (cy - v.y) * (k / v.k) };
    });

  // Search highlights matching areas and opens their branches
  const q = query.trim().toLocaleLowerCase("tr");
  const matchIds = useMemo(
    () => (q ? new Set(flat.filter((t) => t.area.name.toLocaleLowerCase("tr").includes(q)).map((t) => t.area.area_id)) : null),
    [q, flat]
  );
  useEffect(() => {
    if (!matchIds || matchIds.size === 0) return;
    setExpanded((prev) => {
      const next = new Set(prev);
      matchIds.forEach((id) => {
        let cur = byId[id]?.parent_id || null;
        const seen = new Set<string>();
        while (cur && !seen.has(cur)) {
          next.add(cur);
          seen.add(cur);
          cur = byId[cur]?.parent_id || null;
        }
      });
      return next;
    });
  }, [matchIds, byId]);

  const onNodeActivate = (n: MapNode) => {
    if (n.kind === "area") {
      setSelectedId(n.id);
      if (n.hasChildren) {
        toggleExpand(n.id);
      } else {
        // nothing to open: just make sure the panel does not cover the node
        const sx = n.x * view.k + view.x;
        const sy = n.y * view.k + view.y;
        if (isWide ? sx + n.r * view.k > size.w - 344 - 16 : sy + n.r * view.k > size.h * 0.4 - 16) centerOn(n.id);
      }
    } else if (n.kind === "note" && n.note) {
      navigate(`/note/${n.note.slug || n.note.note_id}`);
    } else if (n.kind === "more" && n.areaId) {
      setSelectedId(n.areaId);
    } else if (n.kind === "unassigned") {
      setSelectedId(UNASSIGNED_ID);
    } else if (n.kind === "root") {
      fitView();
    }
  };

  const focusId = hoveredId || selectedId;
  const isDimmed = (n: MapNode) => {
    if (matchIds) return n.kind === "area" ? !matchIds.has(n.id) : n.kind !== "root";
    return false;
  };

  const selectedArea = selectedId && selectedId !== UNASSIGNED_ID ? byId[selectedId] : null;
  const archivedAreas = useMemo(
    () => areas.filter((a) => a.archived && !(a.parent_id && byId[a.parent_id]?.archived)),
    [areas, byId]
  );

  // ---- render -----------------------------------------------------------
  const treePanel = (
    <AreaTreePanel
      forest={forest}
      byId={byId}
      expanded={expanded}
      selectedId={selectedId}
      archivedAreas={archivedAreas}
      onToggle={toggleExpand}
      onSelect={(id) => {
        revealArea(id);
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

        {/* Center: mindmap */}
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
            <div className="pointer-events-auto flex items-center gap-2 bg-card/90 backdrop-blur-md px-2.5 h-9 rounded-lg border border-border shadow-sm w-full max-w-xs">
              <Search className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Alan ara…"
                className="flex-1 bg-transparent text-sm outline-none"
                data-testid="area-map-search"
              />
              {query && (
                <button onClick={() => setQuery("")} className="text-muted-foreground hover:text-foreground">
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
            <div className="pointer-events-auto flex items-center gap-1 bg-card/90 backdrop-blur-md p-1 rounded-lg border border-border shadow-sm text-xs">
              <ToggleChip active={showNotes} onClick={() => setShowNotes((v) => !v)} icon={<StickyNote className="w-3.5 h-3.5" />} label="Notlar" />
              <ToggleChip active={showRelations} onClick={() => setShowRelations((v) => !v)} icon={<Share2 className="w-3.5 h-3.5" />} label="İlişkiler" />
            </div>
            <Link
              to="/network"
              className="pointer-events-auto ml-auto inline-flex items-center gap-1.5 h-9 px-3 rounded-lg border border-border bg-card/90 backdrop-blur-md text-xs text-muted-foreground hover:text-foreground shadow-sm"
              title="Notlar, etiketler ve kişilerle tüm bağlantı ağı"
            >
              <Network className="w-3.5 h-3.5" />
              Ağ görünümü
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
                data-testid="area-mindmap"
              >
                <g transform={`translate(${view.x},${view.y}) scale(${view.k})`}>
                  {/* hierarchy edges */}
                  {layout.edges.map((e) => {
                    const active = focusId && (e.to.id === focusId || e.from.id === focusId);
                    return (
                      <path
                        key={e.id}
                        d={edgePath(e)}
                        fill="none"
                        stroke={e.color}
                        strokeWidth={e.width}
                        strokeLinecap="round"
                        opacity={matchIds ? 0.15 : active ? 0.9 : 0.45}
                        className="area-edge"
                      />
                    );
                  })}

                  {/* cross-area relations (shared notes) */}
                  {relations.map((r) => {
                    const active = focusId && (r.a.id === focusId || r.b.id === focusId);
                    const mx = (r.a.x + r.b.x) / 2;
                    const my = (r.a.y + r.b.y) / 2;
                    // bow the curve away from the root so it does not cut through the tree
                    const cx = mx * 1.25;
                    const cy = my * 1.25 + (r.a.side === r.b.side ? 0 : -80);
                    return (
                      <g key={r.key} opacity={focusId ? (active ? 0.85 : 0.08) : 0.3}>
                        <path
                          d={`M ${r.a.x} ${r.a.y} Q ${cx} ${cy} ${r.b.x} ${r.b.y}`}
                          fill="none"
                          stroke="hsl(var(--foreground))"
                          strokeWidth={1 + Math.log2(1 + r.count)}
                          strokeDasharray="5 6"
                        />
                        {active && (
                          <text x={cx} y={cy} textAnchor="middle" fontSize={10} fill="hsl(var(--muted-foreground))">
                            {r.count} ortak not
                          </text>
                        )}
                      </g>
                    );
                  })}

                  {layout.nodes.map((n) => (
                    <MapNodeView
                      key={n.id}
                      node={n}
                      selected={selectedId === n.id}
                      dimmed={isDimmed(n)}
                      onActivate={() => onNodeActivate(n)}
                      onHover={(h) => setHoveredId(h ? n.id : null)}
                    />
                  ))}
                </g>
              </svg>
            )}
            {loading && (
              <div className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">
                Alanlar yükleniyor…
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
            <Button size="icon" variant="ghost" className="h-8 w-8" onClick={fitView} title="Ekrana sığdır">
              <Maximize2 className="w-4 h-4" />
            </Button>
          </div>
          <div className="absolute bottom-4 right-4 z-10 hidden sm:block text-[11px] text-muted-foreground bg-card/80 backdrop-blur px-2.5 py-1 rounded-md border border-border">
            Bir alana tıklayınca alt alanları açılır · Daire boyutu not sayısını gösterir
          </div>

          {/* Right: detail panel */}
          {selectedArea && (
            <AreaDetailPanel
              key={selectedArea.area_id}
              area={selectedArea}
              areas={areas}
              byId={byId}
              tree={treeById[selectedArea.area_id]}
              notes={activeNotes}
              directNotes={notesByArea[selectedArea.area_id] || []}
              onClose={() => setSelectedId(null)}
              onSelectArea={revealArea}
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
          )}
          {selectedId === UNASSIGNED_ID && (
            <UnassignedPanel
              notes={unassignedNotes}
              areas={areas}
              onClose={() => setSelectedId(null)}
              onAssign={updateNoteAreas}
              onAreaCreated={(a) => setAreas((prev) => [...prev, a])}
            />
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
// Mindmap node
// ---------------------------------------------------------------------------
function MapNodeView({
  node: n,
  selected,
  dimmed,
  onActivate,
  onHover,
}: {
  node: MapNode;
  selected: boolean;
  dimmed: boolean;
  onActivate: () => void;
  onHover: (h: boolean) => void;
}) {
  const common = {
    "data-node": n.id,
    role: "button",
    tabIndex: 0,
    onClick: (e: React.MouseEvent) => {
      e.stopPropagation();
      onActivate();
    },
    onKeyDown: (e: React.KeyboardEvent) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        onActivate();
      }
    },
    onMouseEnter: () => onHover(true),
    onMouseLeave: () => onHover(false),
    className: "area-node outline-none cursor-pointer",
    style: { transform: `translate(${n.x}px, ${n.y}px)`, opacity: dimmed ? 0.25 : 1 } as React.CSSProperties,
  };

  if (n.kind === "root") {
    return (
      <g {...common} aria-label="Tüm alanları göster">
        <circle r={n.r} fill="hsl(var(--foreground))" />
        <FolderTree x={-9} y={-15} width={18} height={18} color="hsl(var(--background))" strokeWidth={1.75} />
        <text y={14} textAnchor="middle" fontSize={10} fontWeight={600} fill="hsl(var(--background))">
          Alanlarım
        </text>
      </g>
    );
  }

  if (n.kind === "unassigned") {
    return (
      <g {...common} aria-label={n.label}>
        <circle r={n.r} fill="hsl(var(--card))" stroke="hsl(var(--muted-foreground))" strokeDasharray="3 3" strokeWidth={1.5} />
        <text textAnchor="middle" dy="0.35em" fontSize={10} fontWeight={700} fill="hsl(var(--muted-foreground))">
          {n.count}
        </text>
        <text y={n.r + 15} textAnchor="middle" fontSize={11} fill="hsl(var(--muted-foreground))">
          {n.label}
        </text>
      </g>
    );
  }

  if (n.kind === "note" || n.kind === "more") {
    const anchor = n.side === 1 ? "start" : "end";
    return (
      <g {...common} aria-label={n.kind === "note" ? `Not: ${n.label}` : n.label}>
        <circle r={n.kind === "note" ? 4.5 : 3.5} fill={n.kind === "note" ? n.color : "hsl(var(--card))"} stroke={n.color} strokeWidth={1.5} />
        <text
          x={n.side * 10}
          dy="0.35em"
          textAnchor={anchor}
          fontSize={11.5}
          fill={n.kind === "note" ? "hsl(var(--foreground))" : "hsl(var(--muted-foreground))"}
          fontStyle={n.kind === "more" ? "italic" : undefined}
        >
          {truncate(n.label, 30)}
        </text>
      </g>
    );
  }

  // area
  const showCount = n.r >= 20;
  return (
    <g {...common} aria-label={`${n.label}, ${n.count} not${n.hasChildren ? (n.expanded ? ", açık" : ", kapalı") : ""}`} aria-expanded={n.hasChildren ? n.expanded : undefined}>
      {selected && <circle r={n.r + 6} fill="none" stroke={n.color} strokeWidth={2} opacity={0.6} />}
      <circle
        r={n.r}
        fill={n.color}
        fillOpacity={n.expanded ? 0.95 : 0.8}
        stroke="hsl(var(--background))"
        strokeWidth={2.5}
        className="area-circle"
      />
      {showCount && (
        <text textAnchor="middle" dy="0.35em" fontSize={Math.min(16, 9 + n.r / 6)} fontWeight={700} fill="#fff">
          {n.count}
        </text>
      )}
      <text
        y={n.r + 15}
        textAnchor="middle"
        fontSize={12.5}
        fontWeight={600}
        fill="hsl(var(--foreground))"
        paintOrder="stroke"
        stroke="hsl(var(--background))"
        strokeWidth={4}
        strokeLinejoin="round"
      >
        {truncate(n.label, 24)}
        {!showCount && n.count ? ` · ${n.count}` : ""}
      </text>
      {n.hasChildren && (
        <g style={{ transform: `translate(${n.side * n.r}px, 0px)` }}>
          <circle r={8} fill="hsl(var(--card))" stroke={n.color} strokeWidth={1.5} />
          <text textAnchor="middle" dy="0.35em" fontSize={12} fontWeight={700} fill={n.color}>
            {n.expanded ? "−" : "+"}
          </text>
        </g>
      )}
    </g>
  );
}

function ToggleChip({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`inline-flex items-center gap-1.5 h-7 px-2 rounded-md transition-colors ${
        active ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground hover:bg-accent"
      }`}
    >
      {icon}
      {label}
    </button>
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
        <Link
          to={`/all-notes?area=${encodeURIComponent(a.area_id)}`}
          className="hidden group-hover:inline-flex p-1 rounded text-muted-foreground hover:text-foreground hover:bg-background"
          title="Bütün Notlar'da bu alanı listele"
          data-testid={`area-row-list-${a.area_id}`}
        >
          <List className="w-3.5 h-3.5" />
        </Link>
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
                 sm:inset-x-auto sm:right-3 sm:top-16 sm:bottom-3 sm:w-80 sm:h-auto sm:rounded-xl
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
        <Link
          to={`/all-notes?area=${encodeURIComponent(area.area_id)}`}
          className="inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:underline"
          data-testid="area-detail-list-notes"
        >
          <List className="w-3.5 h-3.5" />
          Bütün Notlar'da listele
        </Link>
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
