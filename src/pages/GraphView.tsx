import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import api from "@/lib/api";
import type { Note, Category, ItemGroup, Tag, Person, LocationItem, NoteType, KanbanColumn } from "@/types";
import TopBar from "@/components/TopBar";
import Sidebar from "@/components/Sidebar";
import MarkdownView from "@/components/MarkdownView";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useTheme } from "@/contexts/ThemeContext";
import {
  Network,
  Search,
  ZoomIn,
  ZoomOut,
  Maximize2,
  Filter,
  Layers,
  FileText,
  Tag as TagIcon,
  User as UserIcon,
  Kanban as KanbanIcon,
  Sparkles,
  ArrowRight,
  X,
  ExternalLink,
  RefreshCw,
  Eye,
  SlidersHorizontal,
} from "lucide-react";

interface GraphNode {
  id: string;
  label: string;
  type: "note" | "tag" | "person" | "category";
  color?: string;
  radius: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  isDragging?: boolean;
  degree?: number;
  // Note specific
  noteId?: string;
  slug?: string;
  date?: string;
  content?: string;
  categoryId?: string;
  kanbanColumnId?: string;
  tags?: string[];
  people?: string[];
}

interface GraphLink {
  source: string;
  target: string;
  type: "wikilink" | "tag" | "person" | "category";
  label?: string;
}

const WIKI_RE = /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/gu;

export default function GraphView() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { theme } = useTheme();
  const isDark = theme === "dark";

  // Data state
  const [notes, setNotes] = useState<Note[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [groups, setGroups] = useState<ItemGroup[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [people, setPeople] = useState<Person[]>([]);
  const [columns, setColumns] = useState<KanbanColumn[]>([]);
  const [loading, setLoading] = useState(true);

  // Layout & UI states
  const [leftOpen, setLeftOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
  const [filterPanelOpen, setFilterPanelOpen] = useState(false);

  // Graph display toggles
  const [showTags, setShowTags] = useState(true);
  const [showPeople, setShowPeople] = useState(true);
  const [showOrphans, setShowOrphans] = useState(true);
  const [colorByKanban, setColorByKanban] = useState(false);
  const [selectedCategoryId, setSelectedCategoryId] = useState<string>("all");

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const transformRef = useRef({ x: 0, y: 0, scale: 1 });
  const isDraggingCanvasRef = useRef(false);
  const lastMousePosRef = useRef({ x: 0, y: 0 });
  const draggedNodeRef = useRef<GraphNode | null>(null);
  const animFrameIdRef = useRef<number | null>(null);
  const simNodesRef = useRef<GraphNode[]>([]);

  // Fetch graph data
  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [notesRes, catRes, grpRes, tagRes, pplRes, colRes] = await Promise.all([
        api.get<Note[]>("/notes"),
        api.get<Category[]>("/categories"),
        api.get<ItemGroup[]>("/groups"),
        api.get<Tag[]>("/tags"),
        api.get<Person[]>("/people"),
        api.get<KanbanColumn[]>("/kanban/columns"),
      ]);

      setNotes(Array.isArray(notesRes.data) ? notesRes.data : []);
      setCategories(Array.isArray(catRes.data) ? catRes.data : []);
      setGroups(Array.isArray(grpRes.data) ? grpRes.data : []);
      setTags(Array.isArray(tagRes.data) ? tagRes.data : []);
      setPeople(Array.isArray(pplRes.data) ? pplRes.data : []);
      setColumns(Array.isArray(colRes.data) ? colRes.data : []);
    } catch (err) {
      console.warn("Failed loading graph view data:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Maps for fast lookup
  const categoryMap = useMemo(() => {
    const m: Record<string, Category> = {};
    (Array.isArray(categories) ? categories : []).forEach((c) => {
      if (c && c.category_id) m[c.category_id] = c;
    });
    return m;
  }, [categories]);

  const columnMap = useMemo(() => {
    const m: Record<string, KanbanColumn> = {};
    (Array.isArray(columns) ? columns : []).forEach((col) => {
      if (col && col.column_id) m[col.column_id] = col;
    });
    return m;
  }, [columns]);

  // Build Graph Nodes & Edges from Notes & Wiki-links
  const { rawNodes, rawLinks } = useMemo(() => {
    const noteList = Array.isArray(notes) ? notes : [];
    const nodesMap: Map<string, GraphNode> = new Map();
    const links: GraphLink[] = [];

    // Title / Slug / NoteId to Note mapping for fast wikilink matching
    const noteTitleMap = new Map<string, Note>();
    const noteSlugMap = new Map<string, Note>();
    const noteIdMap = new Map<string, Note>();

    noteList.forEach((n) => {
      if (!n || !n.note_id) return;
      noteIdMap.set(n.note_id, n);
      if (n.title) {
        noteTitleMap.set(n.title.trim().toLowerCase(), n);
      }
      if (n.slug) {
        noteSlugMap.set(n.slug.toLowerCase(), n);
      }
    });

    // 1. Add Note Nodes
    noteList.forEach((n, idx) => {
      const customCol = (n.custom_fields as any)?.kanban_column_id;
      const colInfo = customCol ? columnMap[customCol] : undefined;
      const catInfo = n.category_id ? categoryMap[n.category_id] : undefined;

      let nodeColor = isDark ? "#60a5fa" : "#3b82f6"; // primary blue
      if (colorByKanban && colInfo) {
        nodeColor = colInfo.color || "#8b5cf6";
      } else if (catInfo && catInfo.color) {
        nodeColor = catInfo.color;
      }

      // Initial circular distributed layout
      const angle = (idx / Math.max(noteList.length, 1)) * 2 * Math.PI;
      const dist = 120 + Math.random() * 200;

      nodesMap.set(n.note_id, {
        id: n.note_id,
        label: n.title || "İsimsiz Not",
        type: "note",
        noteId: n.note_id,
        slug: n.slug,
        date: n.date,
        content: n.content,
        categoryId: n.category_id || undefined,
        kanbanColumnId: customCol,
        tags: n.tags || [],
        people: n.people || [],
        color: nodeColor,
        radius: 8,
        x: Math.cos(angle) * dist,
        y: Math.sin(angle) * dist,
        vx: 0,
        vy: 0,
      });
    });

    // 2. Parse [[wikilinks]] inside note content
    noteList.forEach((n) => {
      if (!n || !n.content) return;
      const re = new RegExp(WIKI_RE.source, "gu");
      let match: RegExpExecArray | null;

      while ((match = re.exec(n.content)) !== null) {
        const targetRaw = match[1].trim();
        const targetLower = targetRaw.toLowerCase();

        // Match by title, slug, or ID
        const targetNote =
          noteTitleMap.get(targetLower) ||
          noteSlugMap.get(targetLower) ||
          noteIdMap.get(targetRaw);

        if (targetNote && targetNote.note_id !== n.note_id) {
          links.push({
            source: n.note_id,
            target: targetNote.note_id,
            type: "wikilink",
            label: "bağlantı",
          });
        }
      }
    });

    // 3. Add Tag Nodes & Links
    if (showTags) {
      const addedTags = new Set<string>();
      noteList.forEach((n) => {
        (n.tags || []).forEach((t) => {
          const tName = t.toLowerCase();
          const tagId = `tag-${tName}`;

          if (!addedTags.has(tagId)) {
            addedTags.add(tagId);
            const angle = Math.random() * 2 * Math.PI;
            const dist = 180 + Math.random() * 150;
            nodesMap.set(tagId, {
              id: tagId,
              label: `#${tName}`,
              type: "tag",
              color: isDark ? "#34d399" : "#10b981", // green
              radius: 6,
              x: Math.cos(angle) * dist,
              y: Math.sin(angle) * dist,
              vx: 0,
              vy: 0,
            });
          }

          links.push({
            source: n.note_id,
            target: tagId,
            type: "tag",
          });
        });
      });
    }

    // 4. Add People / Mention Nodes & Links
    if (showPeople) {
      const addedPeople = new Set<string>();
      noteList.forEach((n) => {
        (n.people || []).forEach((p) => {
          const pName = p.toLowerCase();
          const personId = `person-${pName}`;

          if (!addedPeople.has(personId)) {
            addedPeople.add(personId);
            const angle = Math.random() * 2 * Math.PI;
            const dist = 180 + Math.random() * 150;
            nodesMap.set(personId, {
              id: personId,
              label: `@${pName}`,
              type: "person",
              color: isDark ? "#f472b6" : "#ec4899", // pink
              radius: 6,
              x: Math.cos(angle) * dist,
              y: Math.sin(angle) * dist,
              vx: 0,
              vy: 0,
            });
          }

          links.push({
            source: n.note_id,
            target: personId,
            type: "person",
          });
        });
      });
    }

    // Calculate node degrees (connections count)
    const degreeMap = new Map<string, number>();
    links.forEach((l) => {
      degreeMap.set(l.source, (degreeMap.get(l.source) || 0) + 1);
      degreeMap.set(l.target, (degreeMap.get(l.target) || 0) + 1);
    });

    nodesMap.forEach((node) => {
      const deg = degreeMap.get(node.id) || 0;
      node.degree = deg;
      // Adjust node radius based on connection count
      if (node.type === "note") {
        node.radius = Math.min(18, Math.max(7, 7 + deg * 1.5));
      }
    });

    return {
      rawNodes: Array.from(nodesMap.values()),
      rawLinks: links,
    };
  }, [notes, showTags, showPeople, colorByKanban, categoryMap, columnMap, isDark]);

  // Filter nodes & links based on user controls
  const { filteredNodes, filteredLinks } = useMemo(() => {
    let nodes = [...rawNodes];

    // Category filter
    if (selectedCategoryId !== "all") {
      nodes = nodes.filter(
        (n) => n.type !== "note" || n.categoryId === selectedCategoryId
      );
    }

    // Orphan filter (hide notes with 0 connections)
    if (!showOrphans) {
      nodes = nodes.filter((n) => (n.degree || 0) > 0);
    }

    const nodeIds = new Set(nodes.map((n) => n.id));
    const links = rawLinks.filter(
      (l) => nodeIds.has(l.source) && nodeIds.has(l.target)
    );

    return { filteredNodes: nodes, filteredLinks: links };
  }, [rawNodes, rawLinks, selectedCategoryId, showOrphans]);

  // Initialize and sync physics simulation nodes
  useEffect(() => {
    const existingMap = new Map(simNodesRef.current.map((n) => [n.id, n]));
    simNodesRef.current = filteredNodes.map((n) => {
      const existing = existingMap.get(n.id);
      if (existing) {
        return {
          ...n,
          x: existing.x,
          y: existing.y,
          vx: existing.vx,
          vy: existing.vy,
        };
      }
      return { ...n };
    });
  }, [filteredNodes]);

  // Find selected note object if a note is selected
  const selectedNote = useMemo(() => {
    if (!selectedNodeId) return null;
    return (Array.isArray(notes) ? notes : []).find((n) => n.note_id === selectedNodeId) || null;
  }, [selectedNodeId, notes]);

  // Backlinks (notes linking to this selected note) and Outlinks
  const { backlinks, outlinks } = useMemo(() => {
    if (!selectedNodeId) return { backlinks: [], outlinks: [] };

    const inList: Note[] = [];
    const outList: Note[] = [];
    const noteMap = new Map((Array.isArray(notes) ? notes : []).map((n) => [n.note_id, n]));

    filteredLinks.forEach((link) => {
      if (link.type === "wikilink") {
        if (link.target === selectedNodeId && noteMap.has(link.source)) {
          inList.push(noteMap.get(link.source)!);
        }
        if (link.source === selectedNodeId && noteMap.has(link.target)) {
          outList.push(noteMap.get(link.target)!);
        }
      }
    });

    return { backlinks: inList, outlinks: outList };
  }, [selectedNodeId, filteredLinks, notes]);

  // Physics simulation step & Canvas Rendering
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let isRunning = true;

    function resize() {
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
    }

    resize();
    window.addEventListener("resize", resize);

    // Connected neighbors set for hover or selection highlight
    const activeNodeId = hoveredNodeId || selectedNodeId;
    const connectedNeighbors = new Set<string>();
    if (activeNodeId) {
      connectedNeighbors.add(activeNodeId);
      filteredLinks.forEach((l) => {
        if (l.source === activeNodeId) connectedNeighbors.add(l.target);
        if (l.target === activeNodeId) connectedNeighbors.add(l.source);
      });
    }

    function render() {
      if (!canvas || !ctx || !isRunning) return;

      const dpr = window.devicePixelRatio || 1;
      const width = canvas.width / dpr;
      const height = canvas.height / dpr;

      ctx.save();
      ctx.scale(dpr, dpr);
      ctx.clearRect(0, 0, width, height);

      // Apply transform
      const { x: panX, y: panY, scale } = transformRef.current;
      const centerX = width / 2 + panX;
      const centerY = height / 2 + panY;

      ctx.save();
      ctx.translate(centerX, centerY);
      ctx.scale(scale, scale);

      const simNodes = simNodesRef.current;
      const nodeMap = new Map(simNodes.map((n) => [n.id, n]));

      // Physics computation (Force Directed step)
      const k = 0.05; // Spring force
      const repulsion = 1200; // Coulomb repulsion
      const centerGravity = 0.008;

      // 1. Repulsion between all nodes
      for (let i = 0; i < simNodes.length; i++) {
        const n1 = simNodes[i];
        for (let j = i + 1; j < simNodes.length; j++) {
          const n2 = simNodes[j];
          const dx = n2.x - n1.x;
          const dy = n2.y - n1.y;
          const distSq = dx * dx + dy * dy || 1;
          const dist = Math.sqrt(distSq);

          if (dist < 400) {
            const force = repulsion / distSq;
            const fx = (dx / dist) * force;
            const fy = (dy / dist) * force;

            if (!n1.isDragging) {
              n1.vx -= fx;
              n1.vy -= fy;
            }
            if (!n2.isDragging) {
              n2.vx += fx;
              n2.vy += fy;
            }
          }
        }
      }

      // 2. Spring attraction along links
      for (const link of filteredLinks) {
        const source = nodeMap.get(link.source);
        const target = nodeMap.get(link.target);
        if (!source || !target) continue;

        const dx = target.x - source.x;
        const dy = target.y - source.y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;
        const idealDist = link.type === "wikilink" ? 90 : 60;
        const displacement = dist - idealDist;
        const force = displacement * k;
        const fx = (dx / dist) * force;
        const fy = (dy / dist) * force;

        if (!source.isDragging) {
          source.vx += fx;
          source.vy += fy;
        }
        if (!target.isDragging) {
          target.vx -= fx;
          target.vy -= fy;
        }
      }

      // 3. Center gravity & velocity dampening
      for (const node of simNodes) {
        if (!node.isDragging) {
          node.vx -= node.x * centerGravity;
          node.vy -= node.y * centerGravity;

          node.vx *= 0.88; // damping
          node.vy *= 0.88;

          node.x += node.vx;
          node.y += node.vy;
        }
      }

      // DRAW LINKS
      for (const link of filteredLinks) {
        const source = nodeMap.get(link.source);
        const target = nodeMap.get(link.target);
        if (!source || !target) continue;

        const isHighlighted =
          activeNodeId &&
          (link.source === activeNodeId || link.target === activeNodeId);
        const isDimmed = activeNodeId && !isHighlighted;

        ctx.beginPath();
        ctx.moveTo(source.x, source.y);
        ctx.lineTo(target.x, target.y);

        if (link.type === "wikilink") {
          ctx.strokeStyle = isHighlighted
            ? isDark
              ? "#60a5fa"
              : "#2563eb"
            : isDimmed
            ? isDark
              ? "rgba(100, 116, 139, 0.12)"
              : "rgba(203, 213, 225, 0.25)"
            : isDark
            ? "rgba(148, 163, 184, 0.45)"
            : "rgba(100, 116, 139, 0.35)";
          ctx.lineWidth = isHighlighted ? 2.5 : 1.2;
          ctx.setLineDash([]);
        } else if (link.type === "tag") {
          ctx.strokeStyle = isHighlighted
            ? "#10b981"
            : isDimmed
            ? isDark
              ? "rgba(16, 185, 129, 0.1)"
              : "rgba(16, 185, 129, 0.15)"
            : isDark
            ? "rgba(16, 185, 129, 0.3)"
            : "rgba(16, 185, 129, 0.25)";
          ctx.lineWidth = 1;
          ctx.setLineDash([3, 3]);
        } else {
          ctx.strokeStyle = isHighlighted
            ? "#ec4899"
            : isDimmed
            ? isDark
              ? "rgba(236, 72, 153, 0.1)"
              : "rgba(236, 72, 153, 0.15)"
            : isDark
            ? "rgba(236, 72, 153, 0.3)"
            : "rgba(236, 72, 153, 0.25)";
          ctx.lineWidth = 1;
          ctx.setLineDash([2, 2]);
        }

        ctx.stroke();
        ctx.setLineDash([]);
      }

      // DRAW NODES
      for (const node of simNodes) {
        const isSelected = node.id === selectedNodeId;
        const isHovered = node.id === hoveredNodeId;
        const isNeighbor = activeNodeId && connectedNeighbors.has(node.id);
        const isDimmed = activeNodeId && !isNeighbor;
        const matchesSearch =
          searchQuery.trim().length > 0 &&
          node.label.toLowerCase().includes(searchQuery.toLowerCase().trim());

        ctx.save();
        ctx.globalAlpha = isDimmed ? 0.22 : 1;

        // Glow ring for selected or search matched node
        if (isSelected || matchesSearch) {
          ctx.beginPath();
          ctx.arc(node.x, node.y, node.radius + 6, 0, 2 * Math.PI);
          ctx.fillStyle = isDark ? "rgba(96, 165, 250, 0.3)" : "rgba(59, 130, 246, 0.25)";
          ctx.fill();
        }

        // Node circle
        ctx.beginPath();
        ctx.arc(node.x, node.y, node.radius, 0, 2 * Math.PI);
        ctx.fillStyle = node.color || (isDark ? "#60a5fa" : "#3b82f6");
        ctx.fill();

        // Node border
        ctx.lineWidth = isSelected || isHovered ? 2.5 : 1.5;
        ctx.strokeStyle = isSelected
          ? isDark
            ? "#ffffff"
            : "#0f172a"
          : isDark
          ? "#1e293b"
          : "#ffffff";
        ctx.stroke();

        // Node Labels
        const shouldShowLabel =
          scale > 0.65 || isHovered || isSelected || isNeighbor || matchesSearch || (node.degree || 0) > 2;

        if (shouldShowLabel) {
          ctx.font = `${isSelected || isHovered ? "bold 12px" : "11px"} -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;
          ctx.fillStyle = isDark
            ? isSelected || isHovered
              ? "#f8fafc"
              : "#cbd5e1"
            : isSelected || isHovered
            ? "#0f172a"
            : "#334155";
          ctx.textAlign = "center";
          ctx.textBaseline = "top";
          ctx.fillText(node.label, node.x, node.y + node.radius + 4);
        }

        ctx.restore();
      }

      ctx.restore(); // restore transform
      ctx.restore(); // restore dpr scale

      animFrameIdRef.current = requestAnimationFrame(render);
    }

    animFrameIdRef.current = requestAnimationFrame(render);

    return () => {
      isRunning = false;
      window.removeEventListener("resize", resize);
      if (animFrameIdRef.current) cancelAnimationFrame(animFrameIdRef.current);
    };
  }, [
    filteredLinks,
    hoveredNodeId,
    selectedNodeId,
    searchQuery,
    isDark,
  ]);

  // Coordinate helper: Canvas screen coords to World graph coords
  function screenToWorld(clientX: number, clientY: number) {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    const { x: panX, y: panY, scale } = transformRef.current;
    const centerX = rect.width / 2 + panX;
    const centerY = rect.height / 2 + panY;
    return {
      x: (x - centerX) / scale,
      y: (y - centerY) / scale,
    };
  }

  // Find node under mouse cursor
  function findNodeAt(worldX: number, worldY: number): GraphNode | null {
    const simNodes = simNodesRef.current;
    for (let i = simNodes.length - 1; i >= 0; i--) {
      const node = simNodes[i];
      const dx = worldX - node.x;
      const dy = worldY - node.y;
      if (dx * dx + dy * dy <= (node.radius + 5) * (node.radius + 5)) {
        return node;
      }
    }
    return null;
  }

  // Mouse / Pointer Event Handlers
  function onMouseDown(e: React.MouseEvent<HTMLCanvasElement>) {
    const world = screenToWorld(e.clientX, e.clientY);
    const hitNode = findNodeAt(world.x, world.y);

    if (hitNode) {
      draggedNodeRef.current = hitNode;
      hitNode.isDragging = true;
      setSelectedNodeId(hitNode.id);
    } else {
      isDraggingCanvasRef.current = true;
      lastMousePosRef.current = { x: e.clientX, y: e.clientY };
    }
  }

  function onMouseMove(e: React.MouseEvent<HTMLCanvasElement>) {
    const world = screenToWorld(e.clientX, e.clientY);

    if (draggedNodeRef.current) {
      draggedNodeRef.current.x = world.x;
      draggedNodeRef.current.y = world.y;
      draggedNodeRef.current.vx = 0;
      draggedNodeRef.current.vy = 0;
    } else if (isDraggingCanvasRef.current) {
      const dx = e.clientX - lastMousePosRef.current.x;
      const dy = e.clientY - lastMousePosRef.current.y;
      transformRef.current.x += dx;
      transformRef.current.y += dy;
      lastMousePosRef.current = { x: e.clientX, y: e.clientY };
    } else {
      const hit = findNodeAt(world.x, world.y);
      setHoveredNodeId(hit ? hit.id : null);
    }
  }

  function onMouseUp() {
    if (draggedNodeRef.current) {
      draggedNodeRef.current.isDragging = false;
      draggedNodeRef.current = null;
    }
    isDraggingCanvasRef.current = false;
  }

  function onWheel(e: React.WheelEvent<HTMLCanvasElement>) {
    e.preventDefault();
    const zoomFactor = e.deltaY < 0 ? 1.12 : 0.88;
    const newScale = Math.min(3.5, Math.max(0.2, transformRef.current.scale * zoomFactor));
    transformRef.current.scale = newScale;
  }

  function zoomIn() {
    transformRef.current.scale = Math.min(3.5, transformRef.current.scale * 1.25);
  }

  function zoomOut() {
    transformRef.current.scale = Math.max(0.2, transformRef.current.scale * 0.8);
  }

  function resetView() {
    transformRef.current = { x: 0, y: 0, scale: 1 };
  }

  // Node count stats
  const noteNodesCount = filteredNodes.filter((n) => n.type === "note").length;
  const tagNodesCount = filteredNodes.filter((n) => n.type === "tag").length;
  const personNodesCount = filteredNodes.filter((n) => n.type === "person").length;
  const wikilinkCount = filteredLinks.filter((l) => l.type === "wikilink").length;

  return (
    <div className="min-h-screen flex flex-col bg-background text-foreground overflow-hidden">
      <TopBar onLeftMenu={() => setLeftOpen(true)} />

      <div className="flex-1 flex overflow-hidden relative">
        <Sidebar open={leftOpen} onClose={() => setLeftOpen(false)} />

        {/* Main Canvas Area */}
        <main className="flex-1 relative flex flex-col overflow-hidden bg-dot-grid">
          {/* Header Controls Bar */}
          <div className="absolute top-4 left-4 right-4 z-20 flex items-center justify-between pointer-events-none gap-2">
            {/* Left: Search & Quick Filters */}
            <div className="flex items-center gap-2 pointer-events-auto bg-card/90 backdrop-blur-md p-1.5 rounded-xl border border-border shadow-md max-w-md w-full">
              <Search className="w-4 h-4 text-muted-foreground ml-1.5 shrink-0" />
              <Input
                placeholder="Ağda ara... (Not başlığı, etiket, kişi)"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="h-8 border-0 bg-transparent focus-visible:ring-0 text-sm shadow-none p-0"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery("")}
                  className="p-1 hover:bg-accent rounded-full text-muted-foreground"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            {/* Right: Controls & Stats Button */}
            <div className="flex items-center gap-2 pointer-events-auto">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setFilterPanelOpen(!filterPanelOpen)}
                className="bg-card/90 backdrop-blur-md h-9 gap-1.5 text-xs font-medium shadow-sm border-border"
              >
                <SlidersHorizontal className="w-3.5 h-3.5 text-primary" />
                <span>Filtreler</span>
                {(showTags || showPeople || colorByKanban || selectedCategoryId !== "all") && (
                  <Badge variant="secondary" className="ml-1 h-4 px-1 text-[10px] bg-primary/15 text-primary">
                    Aktif
                  </Badge>
                )}
              </Button>
            </div>
          </div>

          {/* Canvas Component */}
          <canvas
            ref={canvasRef}
            onMouseDown={onMouseDown}
            onMouseMove={onMouseMove}
            onMouseUp={onMouseUp}
            onMouseLeave={onMouseUp}
            onWheel={onWheel}
            className="flex-1 w-full h-full cursor-grab active:cursor-grabbing block"
          />

          {/* Floating Zoom & Action Controls */}
          <div className="absolute bottom-6 left-6 z-20 flex flex-col gap-1.5 bg-card/90 backdrop-blur-md p-1 rounded-lg border border-border shadow-md">
            <Button
              size="icon"
              variant="ghost"
              onClick={zoomIn}
              className="h-8 w-8 hover:bg-accent text-foreground"
              title="Yakınlaştır"
            >
              <ZoomIn className="w-4 h-4" />
            </Button>
            <Button
              size="icon"
              variant="ghost"
              onClick={zoomOut}
              className="h-8 w-8 hover:bg-accent text-foreground"
              title="Uzaklaştır"
            >
              <ZoomOut className="w-4 h-4" />
            </Button>
            <Button
              size="icon"
              variant="ghost"
              onClick={resetView}
              className="h-8 w-8 hover:bg-accent text-foreground"
              title="Görünümü Sıfırla"
            >
              <Maximize2 className="w-4 h-4" />
            </Button>
          </div>

          {/* Floating Stats Summary */}
          <div className="absolute bottom-6 right-6 z-20 pointer-events-auto bg-card/85 backdrop-blur-md px-3 py-1.5 rounded-lg border border-border shadow-sm text-xs flex items-center gap-3 text-muted-foreground">
            <div className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-blue-500" />
              <span>{noteNodesCount} Not</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-emerald-500" />
              <span>{wikilinkCount} [[Wiki]] Bağlantı</span>
            </div>
            {showTags && (
              <div className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-teal-500" />
                <span>{tagNodesCount} Etiket</span>
              </div>
            )}
            {showPeople && (
              <div className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-pink-500" />
                <span>{personNodesCount} Kişi</span>
              </div>
            )}
          </div>

          {/* Filter Settings Panel Modal/Popover */}
          {filterPanelOpen && (
            <div className="absolute top-16 right-4 z-30 w-80 bg-card border border-border rounded-xl shadow-2xl p-4 animate-in fade-in slide-in-from-top-2">
              <div className="flex items-center justify-between pb-3 border-b border-border mb-3">
                <div className="flex items-center gap-2">
                  <SlidersHorizontal className="w-4 h-4 text-primary" />
                  <span className="font-semibold text-sm">Graf Görünüm Ayarları</span>
                </div>
                <button
                  onClick={() => setFilterPanelOpen(false)}
                  className="p-1 hover:bg-accent rounded-full text-muted-foreground"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>

              <div className="space-y-3.5 text-xs">
                {/* Toggle Tags */}
                <label className="flex items-center justify-between cursor-pointer">
                  <div className="flex items-center gap-2">
                    <TagIcon className="w-3.5 h-3.5 text-emerald-500" />
                    <span>#Etiket Düğümlerini Göster</span>
                  </div>
                  <input
                    type="checkbox"
                    checked={showTags}
                    onChange={(e) => setShowTags(e.target.checked)}
                    className="rounded border-border text-primary focus:ring-primary h-4 w-4"
                  />
                </label>

                {/* Toggle People */}
                <label className="flex items-center justify-between cursor-pointer">
                  <div className="flex items-center gap-2">
                    <UserIcon className="w-3.5 h-3.5 text-pink-500" />
                    <span>@Kişi Düğümlerini Göster</span>
                  </div>
                  <input
                    type="checkbox"
                    checked={showPeople}
                    onChange={(e) => setShowPeople(e.target.checked)}
                    className="rounded border-border text-primary focus:ring-primary h-4 w-4"
                  />
                </label>

                {/* Toggle Orphans */}
                <label className="flex items-center justify-between cursor-pointer">
                  <div className="flex items-center gap-2">
                    <FileText className="w-3.5 h-3.5 text-blue-500" />
                    <span>Bağlantısız Notları Göster</span>
                  </div>
                  <input
                    type="checkbox"
                    checked={showOrphans}
                    onChange={(e) => setShowOrphans(e.target.checked)}
                    className="rounded border-border text-primary focus:ring-primary h-4 w-4"
                  />
                </label>

                {/* Color by Kanban Status */}
                <label className="flex items-center justify-between cursor-pointer">
                  <div className="flex items-center gap-2">
                    <KanbanIcon className="w-3.5 h-3.5 text-purple-500" />
                    <span>Kanban Sütununa Göre Renklendir</span>
                  </div>
                  <input
                    type="checkbox"
                    checked={colorByKanban}
                    onChange={(e) => setColorByKanban(e.target.checked)}
                    className="rounded border-border text-primary focus:ring-primary h-4 w-4"
                  />
                </label>

                {/* Category Filter */}
                <div className="pt-2 border-t border-border">
                  <span className="block text-muted-foreground font-medium mb-1.5">Kategori Filtresi</span>
                  <select
                    value={selectedCategoryId}
                    onChange={(e) => setSelectedCategoryId(e.target.value)}
                    className="w-full h-8 px-2 rounded-md border border-border bg-background text-foreground text-xs focus:ring-1 focus:ring-primary outline-none"
                  >
                    <option value="all">Tüm Kategoriler</option>
                    {(Array.isArray(categories) ? categories : []).map((cat) => (
                      <option key={cat.category_id} value={cat.category_id}>
                        {cat.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </div>
          )}

          {/* Selected Note Drawer / Info Card */}
          {selectedNote && (
            <div className="absolute top-20 right-4 z-30 w-84 sm:w-96 max-h-[calc(100vh-140px)] bg-card/95 backdrop-blur-xl border border-border rounded-xl shadow-2xl flex flex-col overflow-hidden animate-in fade-in slide-in-from-right-3">
              {/* Card Header */}
              <div className="p-4 border-b border-border flex items-start justify-between gap-3 bg-muted/20">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4 border-primary/30 text-primary">
                      Not Detayı
                    </Badge>
                    {selectedNote.date && (
                      <span className="text-[11px] text-muted-foreground font-mono">
                        {selectedNote.date.slice(0, 10)}
                      </span>
                    )}
                  </div>
                  <h3 className="font-serif font-bold text-base text-foreground truncate">
                    {selectedNote.title || "İsimsiz Not"}
                  </h3>
                </div>
                <div className="flex items-center gap-1">
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={() => navigate(`/note/${selectedNote.slug || selectedNote.note_id}`)}
                    className="h-7 w-7 text-muted-foreground hover:text-foreground"
                    title="Notu Aç"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={() => setSelectedNodeId(null)}
                    className="h-7 w-7 text-muted-foreground hover:text-foreground"
                  >
                    <X className="w-3.5 h-3.5" />
                  </Button>
                </div>
              </div>

              {/* Card Body */}
              <div className="p-4 overflow-y-auto space-y-4 flex-1 text-sm">
                {/* Note Content Preview */}
                <div className="max-h-48 overflow-y-auto p-3 rounded-lg bg-background/60 border border-border/60 text-xs leading-relaxed">
                  <MarkdownView content={selectedNote.content} />
                </div>

                {/* Backlinks (Bu notu referans gösterenler) */}
                {backlinks.length > 0 && (
                  <div className="space-y-1.5">
                    <span className="text-xs font-semibold text-muted-foreground flex items-center gap-1.5">
                      <ArrowRight className="w-3.5 h-3.5 text-primary rotate-180" />
                      <span>Bu Notu Bağlayanlar ({backlinks.length})</span>
                    </span>
                    <div className="space-y-1">
                      {backlinks.map((bn) => (
                        <button
                          key={bn.note_id}
                          onClick={() => setSelectedNodeId(bn.note_id)}
                          className="w-full text-left p-2 rounded-md hover:bg-accent flex items-center justify-between gap-2 text-xs border border-border/40 transition-colors"
                        >
                          <span className="font-medium text-foreground truncate">{bn.title || "İsimsiz Not"}</span>
                          <span className="text-[10px] text-muted-foreground shrink-0 font-mono">
                            {bn.date ? bn.date.slice(0, 10) : ""}
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Outlinks (Bu notun bağlandığı notlar) */}
                {outlinks.length > 0 && (
                  <div className="space-y-1.5">
                    <span className="text-xs font-semibold text-muted-foreground flex items-center gap-1.5">
                      <ArrowRight className="w-3.5 h-3.5 text-primary" />
                      <span>Bağlanılan Notlar ({outlinks.length})</span>
                    </span>
                    <div className="space-y-1">
                      {outlinks.map((on) => (
                        <button
                          key={on.note_id}
                          onClick={() => setSelectedNodeId(on.note_id)}
                          className="w-full text-left p-2 rounded-md hover:bg-accent flex items-center justify-between gap-2 text-xs border border-border/40 transition-colors"
                        >
                          <span className="font-medium text-foreground truncate">{on.title || "İsimsiz Not"}</span>
                          <span className="text-[10px] text-muted-foreground shrink-0 font-mono">
                            {on.date ? on.date.slice(0, 10) : ""}
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Tags & People */}
                {(selectedNote.tags?.length || selectedNote.people?.length) ? (
                  <div className="flex flex-wrap gap-1.5 pt-2 border-t border-border">
                    {selectedNote.tags?.map((t) => (
                      <Badge key={t} variant="secondary" className="text-[10px] bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                        #{t}
                      </Badge>
                    ))}
                    {selectedNote.people?.map((p) => (
                      <Badge key={p} variant="secondary" className="text-[10px] bg-pink-500/10 text-pink-600 dark:text-pink-400">
                        @{p}
                      </Badge>
                    ))}
                  </div>
                ) : null}
              </div>

              {/* Card Footer */}
              <div className="p-3 border-t border-border bg-muted/20 flex justify-end">
                <Button
                  size="sm"
                  onClick={() => navigate(`/note/${selectedNote.slug || selectedNote.note_id}`)}
                  className="gap-1.5 text-xs h-8"
                >
                  <span>Tam Notu Aç</span>
                  <ExternalLink className="w-3.5 h-3.5" />
                </Button>
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
