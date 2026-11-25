import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import api from "@/lib/api";
import type { Note, Category, ItemGroup, Tag, Person, LocationItem, NoteType, KanbanColumn } from "@/types";
import AppMenubar from "@/components/AppMenubar";
import { useWorkspace } from "@/contexts/WorkspaceContext";
import { aiApi, wsApi, type GraphRelation, type RelationType, type UnexpectedPair, type AiActionResult } from "@/lib/workspaceApi";
import { formatApiError } from "@/lib/api";
import { toast } from "sonner";
import Sidebar from "@/components/Sidebar";
import MarkdownView from "@/components/MarkdownView";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent } from "@/components/ui/sheet";
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
  Lightbulb,
  Link2,
  Loader2,
  Box,
} from "lucide-react";
import { depthAlpha, project, rotateBy, type Rotation } from "@/lib/graph3d";

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
  /** Depth in the 3D view (0 in 2D). */
  z?: number;
  vz?: number;
  /** Position and size on screen (world units) after the 3D projection; set every frame. */
  px?: number;
  py?: number;
  pr?: number;
  depth?: number;
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
  noteTypeId?: string;
  spaceId?: string | null;
}

interface GraphLink {
  source: string;
  target: string;
  type: "wikilink" | "tag" | "person" | "category" | "relation";
  label?: string;
  relationType?: string;
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
  const [locations, setLocations] = useState<LocationItem[]>([]);
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
  // Graph 2.0: typed relations and filters
  const { noteTypes, spaces, typeById } = useWorkspace();
  const [relations, setRelations] = useState<GraphRelation[]>([]);
  const [relationTypes, setRelationTypes] = useState<RelationType[]>([]);
  const [showRelations, setShowRelations] = useState(true);
  const [typeFilter, setTypeFilter] = useState("all");
  const [spaceFilter, setSpaceFilter] = useState("all");
  const [relTypeFilter, setRelTypeFilter] = useState("all");
  const [sinceFilter, setSinceFilter] = useState("all");
  const [personFilter, setPersonFilter] = useState("");
  const [unexpectedOpen, setUnexpectedOpen] = useState(searchParams.get("panel") === "unexpected");
  const [unexpected, setUnexpected] = useState<{ available: boolean; reason: string | null; pairs: UnexpectedPair[]; provider?: string } | null>(null);
  const [unexpectedBusy, setUnexpectedBusy] = useState(false);
  const [related, setRelated] = useState<AiActionResult | null>(null);
  const [relatedBusy, setRelatedBusy] = useState(false);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const transformRef = useRef({ x: 0, y: 0, scale: 1 });
  const isDraggingCanvasRef = useRef(false);
  const lastMousePosRef = useRef({ x: 0, y: 0 });
  const draggedNodeRef = useRef<GraphNode | null>(null);
  const animFrameIdRef = useRef<number | null>(null);
  const simNodesRef = useRef<GraphNode[]>([]);
  // 2D or 3D view (?view=3d); in 3D, dragging the background rotates the scene
  const [is3d, setIs3d] = useState(searchParams.get("view") === "3d");
  const rotationRef = useRef<Rotation>({ yaw: 0.5, pitch: -0.3 });

  // Fetch graph data
  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [notesRes, catRes, grpRes, tagRes, pplRes, colRes, locRes] = await Promise.all([
        api.get<Note[]>("/notes"),
        api.get<Category[]>("/categories"),
        api.get<ItemGroup[]>("/groups"),
        api.get<Tag[]>("/tags"),
        api.get<Person[]>("/people"),
        api.get<KanbanColumn[]>("/kanban/columns"),
        api.get<LocationItem[]>("/locations"),
      ]);

      setNotes(Array.isArray(notesRes.data) ? notesRes.data : []);
      setCategories(Array.isArray(catRes.data) ? catRes.data : []);
      setGroups(Array.isArray(grpRes.data) ? grpRes.data : []);
      setTags(Array.isArray(tagRes.data) ? tagRes.data : []);
      setPeople(Array.isArray(pplRes.data) ? pplRes.data : []);
      setColumns(Array.isArray(colRes.data) ? colRes.data : []);
      setLocations(Array.isArray(locRes.data) ? locRes.data : []);
      try {
        const g = await aiApi.graphRelations();
        setRelations(g.relations);
        setRelationTypes(g.relation_types);
      } catch {
        setRelations([]);
      }
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
        noteTypeId: n.note_type_id || "type_plain",
        spaceId: n.space_id || null,
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

    // 2b. Typed relations (person works on project, meeting attended by...)
    for (const rel of relations) {
      if (rel.origin === "wikilink") continue;
      if (!nodesMap.has(rel.source_id) || !nodesMap.has(rel.target_id)) continue;
      links.push({ source: rel.source_id, target: rel.target_id, type: "relation", label: rel.label, relationType: rel.relation_type });
    }

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
  }, [notes, relations, showTags, showPeople, colorByKanban, categoryMap, columnMap, isDark]);

  // Filter nodes & links based on user controls
  const { filteredNodes, filteredLinks } = useMemo(() => {
    let nodes = [...rawNodes];

    // Category filter
    if (selectedCategoryId !== "all") {
      nodes = nodes.filter(
        (n) => n.type !== "note" || n.categoryId === selectedCategoryId
      );
    }

    // Graph 2.0 filters (type, space, date, person) apply to note nodes
    const cutoff = sinceFilter === "all" ? null : new Date(Date.now() - Number(sinceFilter) * 86400000).toISOString().slice(0, 10);
    const person = personFilter.trim().toLowerCase().replace(/^@/, "");
    nodes = nodes.filter((n) => {
      if (n.type !== "note") return true;
      if (typeFilter !== "all" && (n.noteTypeId || "type_plain") !== typeFilter) return false;
      if (spaceFilter !== "all" && n.spaceId !== spaceFilter) return false;
      if (cutoff && (n.date || "").slice(0, 10) < cutoff) return false;
      if (person && !(n.people || []).some((p) => p.includes(person))) return false;
      return true;
    });

    // Orphan filter (hide notes with 0 connections)
    if (!showOrphans) {
      nodes = nodes.filter((n) => (n.degree || 0) > 0);
    }

    const nodeIds = new Set(nodes.map((n) => n.id));
    const links = rawLinks.filter(
      (l) =>
        nodeIds.has(l.source) &&
        nodeIds.has(l.target) &&
        (l.type !== "relation" || (showRelations && (relTypeFilter === "all" || l.relationType === relTypeFilter)))
    );

    return { filteredNodes: nodes, filteredLinks: links };
  }, [rawNodes, rawLinks, selectedCategoryId, showOrphans, typeFilter, spaceFilter, sinceFilter, personFilter, showRelations, relTypeFilter]);

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
          z: existing.z ?? 0,
          vz: existing.vz ?? 0,
        };
      }
      return { ...n, z: (Math.random() - 0.5) * 200, vz: 0 };
    });
  }, [filteredNodes]);

  useEffect(() => setRelated(null), [selectedNodeId]);

  async function findUnexpected() {
    setUnexpectedBusy(true);
    try {
      setUnexpected(await aiApi.unexpected());
    } catch (e) {
      toast.error(formatApiError(e));
    } finally {
      setUnexpectedBusy(false);
    }
  }

  async function connectPair(pair: UnexpectedPair) {
    try {
      await wsApi.addRelation({ source_id: pair.a.note_id, target_id: pair.b.note_id, relation_type: "related_to", note: pair.explanation.slice(0, 480) });
      toast.success("İlişki kuruldu");
      const g = await aiApi.graphRelations();
      setRelations(g.relations);
      setUnexpected((u) => (u ? { ...u, pairs: u.pairs.filter((p) => p !== pair) } : u));
    } catch (e) {
      toast.error(formatApiError(e));
    }
  }

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
          const dz = is3d ? (n2.z || 0) - (n1.z || 0) : 0;
          const distSq = dx * dx + dy * dy + dz * dz || 1;
          const dist = Math.sqrt(distSq);

          if (dist < 400) {
            const force = repulsion / distSq;
            const fx = (dx / dist) * force;
            const fy = (dy / dist) * force;
            const fz = (dz / dist) * force;

            if (!n1.isDragging) {
              n1.vx -= fx;
              n1.vy -= fy;
              n1.vz = (n1.vz || 0) - fz;
            }
            if (!n2.isDragging) {
              n2.vx += fx;
              n2.vy += fy;
              n2.vz = (n2.vz || 0) + fz;
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
        const dz = is3d ? (target.z || 0) - (source.z || 0) : 0;
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
        const idealDist = link.type === "wikilink" ? 90 : 60;
        const displacement = dist - idealDist;
        const force = displacement * k;
        const fx = (dx / dist) * force;
        const fy = (dy / dist) * force;
        const fz = (dz / dist) * force;

        if (!source.isDragging) {
          source.vx += fx;
          source.vy += fy;
          source.vz = (source.vz || 0) + fz;
        }
        if (!target.isDragging) {
          target.vx -= fx;
          target.vy -= fy;
          target.vz = (target.vz || 0) - fz;
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
          if (is3d) {
            node.vz = ((node.vz || 0) - (node.z || 0) * centerGravity) * 0.88;
            node.z = (node.z || 0) + node.vz;
          }
        }
      }

      // Screen positions: the 3D projection, or the plain 2D position
      const rot = rotationRef.current;
      for (const node of simNodes) {
        if (is3d) {
          const p = project(node.x, node.y, node.z || 0, rot);
          node.px = p.x;
          node.py = p.y;
          node.pr = Math.max(2, node.radius * p.scale);
          node.depth = p.depth;
        } else {
          node.px = node.x;
          node.py = node.y;
          node.pr = node.radius;
          node.depth = 0;
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
        ctx.moveTo(source.px!, source.py!);
        ctx.lineTo(target.px!, target.py!);

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
        } else if (link.type === "relation") {
          ctx.strokeStyle = isHighlighted ? "#f59e0b" : isDimmed ? "rgba(245, 158, 11, 0.12)" : isDark ? "rgba(245, 158, 11, 0.55)" : "rgba(217, 119, 6, 0.5)";
          ctx.lineWidth = isHighlighted ? 2.5 : 1.6;
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
        if (link.type === "relation" && isHighlighted && link.label) {
          ctx.save();
          ctx.setLineDash([]);
          ctx.font = "11px Manrope, sans-serif";
          ctx.textAlign = "center";
          ctx.fillStyle = isDark ? "#fbbf24" : "#b45309";
          ctx.fillText(link.label, (source.px! + target.px!) / 2, (source.py! + target.py!) / 2 - 4);
          ctx.restore();
        }
        ctx.setLineDash([]);
      }

      // DRAW NODES (in 3D, far ones first so near ones cover them)
      const drawOrder = is3d ? [...simNodes].sort((a, b) => (b.depth || 0) - (a.depth || 0)) : simNodes;
      for (const node of drawOrder) {
        const isSelected = node.id === selectedNodeId;
        const isHovered = node.id === hoveredNodeId;
        const isNeighbor = activeNodeId && connectedNeighbors.has(node.id);
        const isDimmed = activeNodeId && !isNeighbor;
        const matchesSearch =
          searchQuery.trim().length > 0 &&
          node.label.toLowerCase().includes(searchQuery.toLowerCase().trim());

        ctx.save();
        ctx.globalAlpha = (isDimmed ? 0.22 : 1) * (is3d && !isSelected && !isHovered ? depthAlpha(node.depth || 0) : 1);

        // Glow ring for selected or search matched node
        if (isSelected || matchesSearch) {
          ctx.beginPath();
          ctx.arc(node.px!, node.py!, node.pr! + 6, 0, 2 * Math.PI);
          ctx.fillStyle = isDark ? "rgba(96, 165, 250, 0.3)" : "rgba(59, 130, 246, 0.25)";
          ctx.fill();
        }

        // Node circle
        ctx.beginPath();
        ctx.arc(node.px!, node.py!, node.pr!, 0, 2 * Math.PI);
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
          ctx.fillText(node.label, node.px!, node.py! + node.pr! + 4);
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
    is3d,
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
    // Hit-test against where the node is drawn; in 3D the nearest one wins
    let best: GraphNode | null = null;
    for (const node of simNodesRef.current) {
      const r = (node.pr ?? node.radius) + 5;
      const dx = worldX - (node.px ?? node.x);
      const dy = worldY - (node.py ?? node.y);
      if (dx * dx + dy * dy <= r * r && (!best || (node.depth || 0) <= (best.depth || 0))) best = node;
    }
    return best;
  }

  // Mouse / Pointer Event Handlers
  function onMouseDown(e: React.MouseEvent<HTMLCanvasElement>) {
    const world = screenToWorld(e.clientX, e.clientY);
    const hitNode = findNodeAt(world.x, world.y);

    if (hitNode && is3d) {
      // In 3D a click selects; nodes are not dragged (their depth is not on screen)
      setSelectedNodeId(hitNode.id);
    } else if (hitNode) {
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
      if (is3d && !e.shiftKey) {
        rotationRef.current = rotateBy(rotationRef.current, dx, dy);
      } else {
        transformRef.current.x += dx;
        transformRef.current.y += dy;
      }
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
    rotationRef.current = { yaw: 0.5, pitch: -0.3 };
  }

  function toggle3d() {
    const next = !is3d;
    setIs3d(next);
    if (next) {
      // Spread nodes in depth so the layout opens up instead of starting flat
      for (const n of simNodesRef.current) {
        n.z = (Math.random() - 0.5) * 240;
        n.vz = 0;
      }
    } else {
      for (const n of simNodesRef.current) n.z = n.vz = 0;
    }
    const p = new URLSearchParams(window.location.search);
    if (next) p.set("view", "3d");
    else p.delete("view");
    const qs = p.toString();
    window.history.replaceState(window.history.state, "", `${window.location.pathname}${qs ? `?${qs}` : ""}`);
  }

  // Node count stats
  const noteNodesCount = filteredNodes.filter((n) => n.type === "note").length;
  const tagNodesCount = filteredNodes.filter((n) => n.type === "tag").length;
  const personNodesCount = filteredNodes.filter((n) => n.type === "person").length;
  const wikilinkCount = filteredLinks.filter((l) => l.type === "wikilink").length;

  return (
    <div className="min-h-screen flex flex-col bg-background text-foreground overflow-hidden">
      <AppMenubar />

      <div className="pt-14 lg:pl-16 flex-1 flex flex-col min-w-0 overflow-hidden">
        <div className="flex-1 flex overflow-hidden relative">
          {/* Mobile Left Sidebar */}
          <Sheet open={leftOpen} onOpenChange={setLeftOpen}>
          <SheetContent side="left" className="p-0 w-80 bg-sidebar border-border">
            <div className="p-4 h-full overflow-y-auto">
              <Sidebar
                categories={categories}
                groups={groups}
                tags={tags}
                people={people}
                locations={locations}
                onChange={fetchData}
                onNavigate={() => setLeftOpen(false)}
              />
            </div>
          </SheetContent>
        </Sheet>

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
                onClick={() => setUnexpectedOpen((o) => !o)}
                className="bg-card/90 backdrop-blur-md h-9 gap-1.5 text-xs font-medium shadow-sm border-border"
                data-testid="graph-unexpected-btn"
              >
                <Lightbulb className="w-3.5 h-3.5 text-amber-500" />
                <span className="hidden sm:inline">Beklenmedik bağlantılar</span>
              </Button>
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
            data-testid="graph-canvas"
            data-view={is3d ? "3d" : "2d"}
          />
          {is3d && (
            <div className="pointer-events-none absolute bottom-6 left-20 z-10 max-w-[calc(100%-6rem)] rounded-md bg-card/80 px-2 py-1 text-[11px] text-muted-foreground backdrop-blur">
              3B · sürükle: döndür · Shift + sürükle: kaydır · tekerlek: yakınlaştır
            </div>
          )}

          {/* Floating Zoom & Action Controls */}
          <div className="absolute bottom-6 left-6 z-20 flex flex-col gap-1.5 bg-card/90 backdrop-blur-md p-1 rounded-lg border border-border shadow-md">
            <Button
              size="icon"
              variant={is3d ? "secondary" : "ghost"}
              onClick={toggle3d}
              className="h-8 w-8 hover:bg-accent text-foreground"
              title={is3d ? "2B görünüme geç" : "3B görünüme geç"}
              aria-pressed={is3d}
              data-testid="graph-3d-toggle"
            >
              <Box className="w-4 h-4" />
            </Button>
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

                {/* Typed relations */}
                <label className="flex items-center justify-between cursor-pointer">
                  <div className="flex items-center gap-2">
                    <Link2 className="w-3.5 h-3.5 text-amber-500" />
                    <span>Tipli ilişkileri göster</span>
                  </div>
                  <input
                    type="checkbox"
                    checked={showRelations}
                    onChange={(e) => setShowRelations(e.target.checked)}
                    className="rounded border-border text-primary focus:ring-primary h-4 w-4"
                  />
                </label>

                <div className="pt-2 border-t border-border grid grid-cols-2 gap-2">
                  <label className="space-y-1">
                    <span className="block text-muted-foreground font-medium">Nesne tipi</span>
                    <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} className="w-full h-8 px-2 rounded-md border border-border bg-background text-xs" data-testid="graph-type-filter">
                      <option value="all">Tümü</option>
                      {noteTypes.map((t) => (
                        <option key={t.type_id} value={t.type_id}>{t.name}</option>
                      ))}
                    </select>
                  </label>
                  <label className="space-y-1">
                    <span className="block text-muted-foreground font-medium">İlişki tipi</span>
                    <select value={relTypeFilter} onChange={(e) => setRelTypeFilter(e.target.value)} className="w-full h-8 px-2 rounded-md border border-border bg-background text-xs">
                      <option value="all">Tümü</option>
                      {relationTypes.filter((t) => t.type_key !== "links_to").map((t) => (
                        <option key={t.type_key} value={t.type_key}>{t.label}</option>
                      ))}
                    </select>
                  </label>
                  <label className="space-y-1">
                    <span className="block text-muted-foreground font-medium">Tarih</span>
                    <select value={sinceFilter} onChange={(e) => setSinceFilter(e.target.value)} className="w-full h-8 px-2 rounded-md border border-border bg-background text-xs">
                      <option value="all">Tüm zamanlar</option>
                      <option value="7">Son 7 gün</option>
                      <option value="30">Son 30 gün</option>
                      <option value="90">Son 3 ay</option>
                      <option value="365">Son 1 yıl</option>
                    </select>
                  </label>
                  {spaces.length > 1 ? (
                    <label className="space-y-1">
                      <span className="block text-muted-foreground font-medium">Bölüm</span>
                      <select value={spaceFilter} onChange={(e) => setSpaceFilter(e.target.value)} className="w-full h-8 px-2 rounded-md border border-border bg-background text-xs">
                        <option value="all">Tümü</option>
                        {spaces.map((sp) => (
                          <option key={sp.space_id} value={sp.space_id}>{sp.name}</option>
                        ))}
                      </select>
                    </label>
                  ) : (
                    <span />
                  )}
                  <label className="space-y-1 col-span-2">
                    <span className="block text-muted-foreground font-medium">Kişi</span>
                    <Input value={personFilter} onChange={(e) => setPersonFilter(e.target.value)} placeholder="@kişi" className="h-8 text-xs" />
                  </label>
                </div>

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

          {/* Unexpected connections */}
          {unexpectedOpen && (
            <div className="absolute top-16 left-4 z-30 w-[min(26rem,calc(100%-2rem))] max-h-[calc(100vh-160px)] overflow-y-auto bg-card/95 backdrop-blur-xl border border-border rounded-xl shadow-2xl p-4 space-y-3" data-testid="graph-unexpected-panel">
              <div className="flex items-center gap-2">
                <Lightbulb className="w-4 h-4 text-amber-500" />
                <span className="font-semibold text-sm">Beklenmedik bağlantılar</span>
                <button onClick={() => setUnexpectedOpen(false)} className="ml-auto p-1 hover:bg-accent rounded-full text-muted-foreground" aria-label="Kapat">
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
              <p className="text-xs text-muted-foreground">
                Birbirine benzeyen ama henüz bağlı olmayan notları bulur. Yalnızca yapay zekanın iki nottan alıntıyla açıklayabildiği somut bağlantılar gösterilir; sırf benzerlik bağlantı sayılmaz.
              </p>
              <Button size="sm" onClick={findUnexpected} disabled={unexpectedBusy} className="h-8 text-xs" data-testid="graph-unexpected-run">
                {unexpectedBusy ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : <Sparkles className="w-3.5 h-3.5 mr-1" />} Bağlantıları bul
              </Button>
              {unexpected?.reason && <p className="text-xs text-muted-foreground">{unexpected.reason}</p>}
              {unexpected?.pairs.map((pair) => (
                <div key={`${pair.a.note_id}-${pair.b.note_id}`} className="rounded-lg border border-border p-3 text-xs space-y-2">
                  <div className="flex flex-wrap items-center gap-1 font-medium">
                    <button onClick={() => setSelectedNodeId(pair.a.note_id)} className="hover:underline">[1] {pair.a.title}</button>
                    <span className="text-muted-foreground">↔</span>
                    <button onClick={() => setSelectedNodeId(pair.b.note_id)} className="hover:underline">[2] {pair.b.title}</button>
                  </div>
                  <p className="text-sm leading-snug">{pair.explanation}</p>
                  <details className="text-muted-foreground">
                    <summary className="cursor-pointer">Alıntılar · {pair.basis === "semantic" ? "anlam benzerliği" : `ortak terimler: ${pair.shared_terms.join(", ")}`}</summary>
                    <p className="mt-1"><b>[1]</b> {pair.a.passage}</p>
                    <p className="mt-1"><b>[2]</b> {pair.b.passage}</p>
                  </details>
                  <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => connectPair(pair)}>
                    <Link2 className="w-3.5 h-3.5 mr-1" /> İlişki kur
                  </Button>
                </div>
              ))}
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
                {/* Object type + typed relations */}
                <div className="flex flex-wrap items-center gap-1.5 text-xs">
                  <Badge variant="secondary" className="text-[10px]">{typeById(selectedNote.note_type_id)?.name || "Düz Metin"}</Badge>
                  {selectedNote.updated_at && <span className="text-muted-foreground">güncellendi {selectedNote.updated_at.slice(0, 10)}</span>}
                </div>
                {(() => {
                  const mine = relations.filter((r) => r.origin !== "wikilink" && (r.source_id === selectedNote.note_id || r.target_id === selectedNote.note_id));
                  if (mine.length === 0) return null;
                  const titleOf = (id: string) => notes.find((n) => n.note_id === id)?.title || "Adsız";
                  return (
                    <div className="space-y-1">
                      <span className="text-xs font-semibold text-muted-foreground">Tipli ilişkiler ({mine.length})</span>
                      {mine.map((r) => {
                        const out = r.source_id === selectedNote.note_id;
                        const other = out ? r.target_id : r.source_id;
                        const t = relationTypes.find((x) => x.type_key === r.relation_type);
                        const label = out || t?.symmetric ? r.label : t?.inverse_label || r.label;
                        return (
                          <button key={r.relation_id} onClick={() => setSelectedNodeId(other)} className="w-full text-left p-2 rounded-md hover:bg-accent flex items-center gap-2 text-xs border border-border/40">
                            <span className="text-amber-600 dark:text-amber-400 shrink-0">{label}</span>
                            <span className="font-medium truncate">{titleOf(other)}</span>
                          </button>
                        );
                      })}
                    </div>
                  );
                })()}

                <div className="flex flex-wrap gap-1.5">
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs"
                    disabled={relatedBusy}
                    onClick={async () => {
                      setRelatedBusy(true);
                      try {
                        setRelated(await aiApi.action(selectedNote.note_id, "find_related"));
                      } catch (e) {
                        toast.error(formatApiError(e));
                      } finally {
                        setRelatedBusy(false);
                      }
                    }}
                  >
                    {relatedBusy ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <Sparkles className="w-3 h-3 mr-1" />} İlgili notları bul
                  </Button>
                  <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => navigate(`/ask?q=${encodeURIComponent(`${selectedNote.title} hakkında neler biliyorum?`)}`)}>
                    Ask Inkwell
                  </Button>
                </div>
                {related && related.related && (
                  <div className="space-y-1">
                    {related.warning && <p className="text-[11px] text-muted-foreground">{related.warning}</p>}
                    {related.related.map((rn) => (
                      <button key={rn.note_id} onClick={() => setSelectedNodeId(rn.note_id)} className="w-full text-left p-2 rounded-md hover:bg-accent text-xs border border-border/40">
                        <span className="font-medium">{rn.title}</span>
                        {rn.why && <span className="ml-1 text-[10px] text-muted-foreground">· {rn.why}</span>}
                      </button>
                    ))}
                  </div>
                )}

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
    </div>
  );
}
