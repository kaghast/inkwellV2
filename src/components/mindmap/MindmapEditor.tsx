import React, { useState, useRef, useEffect, useMemo } from "react";
import {
  MindmapNode,
  parseMindmapMarkdown,
  serializeMindmapMarkdown,
  addChildNode,
  addSiblingNode,
  updateNodeText,
  updateNodeColor,
  deleteNode,
  toggleNodeCollapse,
  getRandomBranchColor,
} from "@/lib/mindmapParser";
import {
  Plus,
  Trash2,
  Edit2,
  ZoomIn,
  ZoomOut,
  Maximize2,
  Minimize2,
  Download,
  ListTree,
  Network,
  Palette,
  Check,
  ChevronRight,
  ChevronDown,
  Sparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";

interface LayoutNode {
  node: MindmapNode;
  x: number;
  y: number;
  width: number;
  height: number;
  level: number;
  color: string;
}

interface Props {
  initialContent: string;
  onChange: (markdown: string) => void;
  isFullFocus?: boolean;
  height?: number | string;
}

const COLOR_PALETTE = [
  "#3b82f6", // Blue
  "#10b981", // Emerald
  "#8b5cf6", // Purple
  "#f59e0b", // Amber
  "#ec4899", // Pink
  "#06b6d4", // Cyan
  "#f97316", // Orange
  "#6366f1", // Indigo
  "#e11d48", // Rose
  "#64748b", // Slate
];

export default function MindmapEditor({
  initialContent,
  onChange,
  isFullFocus = false,
  height = 560,
}: Props) {
  const [root, setRoot] = useState<MindmapNode>(() => parseMindmapMarkdown(initialContent));
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [editingNodeId, setEditingNodeId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState("");
  const [colorPickerNodeId, setColorPickerNodeId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<"visual" | "markdown">("visual");
  const [markdownText, setMarkdownText] = useState(() => serializeMindmapMarkdown(root));

  // Canvas Pan & Zoom
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 120, y: 220 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });

  const containerRef = useRef<HTMLDivElement | null>(null);

  // Sync back to parent
  const handleUpdateTree = (newRoot: MindmapNode) => {
    setRoot(newRoot);
    const md = serializeMindmapMarkdown(newRoot);
    setMarkdownText(md);
    onChange(md);
  };

  // Sync from markdown text editor
  const handleMarkdownChange = (newMd: string) => {
    setMarkdownText(newMd);
    const parsed = parseMindmapMarkdown(newMd);
    setRoot(parsed);
    onChange(newMd);
  };

  // Compute Layout Positions (Tree layout with dynamic spacing)
  const layout = useMemo(() => {
    const nodes: LayoutNode[] = [];
    const connections: { from: LayoutNode; to: LayoutNode; color: string }[] = [];

    const HORIZONTAL_GAP = 190;
    const VERTICAL_GAP = 46;

    // Helper to calculate subtree height
    function calculateSubtreeHeight(n: MindmapNode): number {
      if (!n.children || n.children.length === 0 || n.collapsed) {
        return VERTICAL_GAP;
      }
      let sum = 0;
      for (const child of n.children) {
        sum += calculateSubtreeHeight(child);
      }
      return Math.max(VERTICAL_GAP, sum);
    }

    function layoutSubtree(
      n: MindmapNode,
      x: number,
      startY: number,
      level: number,
      parentLayout?: LayoutNode
    ): { nodeLayout: LayoutNode; totalHeight: number } {
      const charCount = (n.text || "").length;
      const width = Math.min(240, Math.max(100, charCount * 8.5 + 42));
      const height = 36;

      const totalHeight = calculateSubtreeHeight(n);
      const y = startY + totalHeight / 2 - height / 2;

      const nodeColor = n.color || (level === 0 ? COLOR_PALETTE[0] : parentLayout?.color || COLOR_PALETTE[1]);

      const currentLayout: LayoutNode = {
        node: n,
        x,
        y,
        width,
        height,
        level,
        color: nodeColor,
      };

      nodes.push(currentLayout);

      if (parentLayout) {
        connections.push({
          from: parentLayout,
          to: currentLayout,
          color: nodeColor,
        });
      }

      if (n.children && n.children.length > 0 && !n.collapsed) {
        let currentChildY = startY;
        for (const child of n.children) {
          const childSubtreeHeight = calculateSubtreeHeight(child);
          layoutSubtree(child, x + width + HORIZONTAL_GAP - 60, currentChildY, level + 1, currentLayout);
          currentChildY += childSubtreeHeight;
        }
      }

      return { nodeLayout: currentLayout, totalHeight };
    }

    if (root) {
      layoutSubtree(root, 40, 40, 0);
    }

    return { nodes, connections };
  }, [root]);

  // Pan Handlers
  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    // Only pan if clicking canvas background
    if ((e.target as HTMLElement).closest(".mindmap-node")) return;
    setIsDragging(true);
    setDragStart({ x: e.clientX - pan.x, y: e.clientY - pan.y });
    setColorPickerNodeId(null);
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDragging) return;
    setPan({
      x: e.clientX - dragStart.x,
      y: e.clientY - dragStart.y,
    });
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  // Node Actions
  const handleAddChild = (nodeId: string) => {
    const updated = addChildNode(root, nodeId, "Yeni Fikir");
    handleUpdateTree(updated);
    toast.success("Alt dal eklendi");
  };

  const handleAddSibling = (nodeId: string) => {
    const updated = addSiblingNode(root, nodeId, "Yeni Fikir");
    handleUpdateTree(updated);
    toast.success("Kardeş dal eklendi");
  };

  const handleDelete = (nodeId: string) => {
    if (nodeId === root.id) {
      toast.error("Ana kök düğüm silinemez");
      return;
    }
    const updated = deleteNode(root, nodeId);
    handleUpdateTree(updated);
    setSelectedNodeId(null);
    toast.success("Dal silindi");
  };

  const handleStartEdit = (node: MindmapNode) => {
    setEditingNodeId(node.id);
    setEditingText(node.text);
  };

  const handleSaveEdit = () => {
    if (!editingNodeId) return;
    const updated = updateNodeText(root, editingNodeId, editingText.trim() || "Düğüm");
    handleUpdateTree(updated);
    setEditingNodeId(null);
  };

  const handleColorChange = (nodeId: string, color: string) => {
    const updated = updateNodeColor(root, nodeId, color);
    handleUpdateTree(updated);
    setColorPickerNodeId(null);
  };

  const handleToggleCollapse = (nodeId: string) => {
    const updated = toggleNodeCollapse(root, nodeId);
    handleUpdateTree(updated);
  };

  const handleDownloadSVG = () => {
    const svgEl = containerRef.current?.querySelector("svg");
    if (!svgEl) return;
    const svgData = new XMLSerializer().serializeToString(svgEl);
    const blob = new Blob([svgData], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `mindmap-${Date.now()}.svg`;
    a.click();
    toast.success("Zihin haritası SVG olarak indirildi");
  };

  return (
    <div
      className={`relative flex flex-col border border-border rounded-xl bg-card overflow-hidden shadow-2xs select-none ${
        isFullFocus ? "h-full" : ""
      }`}
      style={{ height: isFullFocus ? "100%" : height }}
    >
      {/* Top Toolbar */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border/80 bg-muted/40 backdrop-blur-md flex-wrap gap-2 z-10">
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5 font-serif font-bold text-xs text-foreground">
            <Network className="w-4 h-4 text-purple-600 dark:text-purple-400" />
            <span>Zihin Haritası (Mindmap)</span>
          </div>

          <div className="flex items-center bg-background rounded-md border border-border p-0.5 text-xs">
            <button
              type="button"
              onClick={() => setViewMode("visual")}
              className={`px-2.5 py-0.5 rounded text-[11px] font-medium transition-all cursor-pointer ${
                viewMode === "visual"
                  ? "bg-primary text-primary-foreground font-semibold shadow-xs"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Görsel Tuval
            </button>
            <button
              type="button"
              onClick={() => setViewMode("markdown")}
              className={`px-2.5 py-0.5 rounded text-[11px] font-medium transition-all cursor-pointer ${
                viewMode === "markdown"
                  ? "bg-primary text-primary-foreground font-semibold shadow-xs"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Markdown Taslak
            </button>
          </div>
        </div>

        {/* Action Controls */}
        <div className="flex items-center gap-1">
          {viewMode === "visual" && (
            <>
              <button
                type="button"
                onClick={() => setZoom((z) => Math.min(z + 0.15, 2.2))}
                className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground cursor-pointer"
                title="Yakınlaş"
              >
                <ZoomIn className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={() => setZoom((z) => Math.max(z - 0.15, 0.4))}
                className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground cursor-pointer"
                title="Uzaklaş"
              >
                <ZoomOut className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={() => {
                  setZoom(1);
                  setPan({ x: 120, y: 220 });
                }}
                className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground cursor-pointer"
                title="Merkeze Sıfırla"
              >
                <Maximize2 className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={handleDownloadSVG}
                className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground cursor-pointer"
                title="SVG İndir"
              >
                <Download className="w-3.5 h-3.5" />
              </button>
            </>
          )}
        </div>
      </div>

      {/* Main Content Area: Visual SVG Canvas OR Raw Markdown Editor */}
      {viewMode === "markdown" ? (
        <div className="flex-1 flex flex-col p-4 bg-card">
          <div className="text-[11px] text-muted-foreground font-mono mb-2 flex items-center gap-1.5">
            <ListTree className="w-3.5 h-3.5 text-primary" />
            <span>Markdown hiyerarşisi (# Başlıklar ve - Maddeler zihin haritasına otomatik dönüşür):</span>
          </div>
          <textarea
            value={markdownText}
            onChange={(e) => handleMarkdownChange(e.target.value)}
            className="flex-1 w-full p-3 font-mono text-xs leading-relaxed bg-muted/30 border border-border rounded-lg outline-none resize-none focus:ring-1 focus:ring-primary"
            placeholder="# Ana Konu\n## Fikir 1\n- Alt madde 1\n## Fikir 2"
          />
        </div>
      ) : (
        <div
          ref={containerRef}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          className="flex-1 relative overflow-hidden bg-dot-grid cursor-grab active:cursor-grabbing select-none"
          style={{
            backgroundImage: `radial-gradient(circle, currentColor 1px, transparent 1px)`,
            backgroundSize: "20px 20px",
            color: "var(--border)",
          }}
        >
          {/* Interactive SVG Canvas Layer */}
          <svg
            className="absolute inset-0 w-full h-full pointer-events-none"
            style={{
              transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
              transformOrigin: "0 0",
            }}
          >
            {/* Render Connecting Curves */}
            {layout.connections.map((conn, idx) => {
              const fromX = conn.from.x + conn.from.width;
              const fromY = conn.from.y + conn.from.height / 2;
              const toX = conn.to.x;
              const toY = conn.to.y + conn.to.height / 2;

              const dx = toX - fromX;
              const controlX1 = fromX + dx * 0.45;
              const controlX2 = toX - dx * 0.45;

              const pathD = `M ${fromX} ${fromY} C ${controlX1} ${fromY}, ${controlX2} ${toY}, ${toX} ${toY}`;

              return (
                <path
                  key={`conn-${idx}`}
                  d={pathD}
                  fill="none"
                  stroke={conn.color || "#8b5cf6"}
                  strokeWidth={conn.to.level === 1 ? 2.5 : 1.75}
                  strokeOpacity={0.8}
                  strokeLinecap="round"
                />
              );
            })}
          </svg>

          {/* Render Node DOM Elements */}
          <div
            className="absolute inset-0 pointer-events-none"
            style={{
              transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
              transformOrigin: "0 0",
            }}
          >
            {layout.nodes.map((layoutNode) => {
              const { node, x, y, width, height, level, color } = layoutNode;
              const isRoot = level === 0;
              const isSelected = selectedNodeId === node.id;
              const isEditing = editingNodeId === node.id;
              const hasChildren = node.children && node.children.length > 0;

              return (
                <div
                  key={node.id}
                  onClick={(e) => {
                    e.stopPropagation();
                    setSelectedNodeId(node.id);
                  }}
                  onDoubleClick={(e) => {
                    e.stopPropagation();
                    handleStartEdit(node);
                  }}
                  className={`mindmap-node absolute pointer-events-auto flex items-center justify-between gap-1.5 px-3 rounded-full border text-xs font-medium transition-all shadow-xs group/node ${
                    isRoot
                      ? "bg-primary text-primary-foreground font-bold text-sm shadow-md ring-2 ring-primary/30"
                      : isSelected
                      ? "bg-card text-foreground ring-2 ring-primary font-semibold shadow-md"
                      : "bg-card text-foreground hover:shadow-md"
                  }`}
                  style={{
                    left: `${x}px`,
                    top: `${y}px`,
                    minWidth: `${width}px`,
                    height: `${height}px`,
                    borderColor: color,
                    borderWidth: isRoot ? 2 : 1.5,
                  }}
                >
                  {/* Color Accent Indicator */}
                  <div
                    className="w-2.5 h-2.5 rounded-full shrink-0 cursor-pointer hover:scale-125 transition-transform"
                    style={{ backgroundColor: color }}
                    onClick={(e) => {
                      e.stopPropagation();
                      setColorPickerNodeId(colorPickerNodeId === node.id ? null : node.id);
                    }}
                    title="Rengi Değiştir"
                  />

                  {/* Node Text or Inline Editor Input */}
                  {isEditing ? (
                    <input
                      type="text"
                      value={editingText}
                      onChange={(e) => setEditingText(e.target.value)}
                      onBlur={handleSaveEdit}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") handleSaveEdit();
                        if (e.key === "Escape") setEditingNodeId(null);
                      }}
                      autoFocus
                      className="bg-transparent text-xs text-foreground font-medium outline-none w-full border-b border-primary px-1"
                    />
                  ) : (
                    <span className="truncate flex-1 max-w-[190px]">{node.text || "Düğüm"}</span>
                  )}

                  {/* Branch Collapse/Expand Toggle Indicator */}
                  {hasChildren && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleToggleCollapse(node.id);
                      }}
                      className="p-0.5 rounded-full hover:bg-muted text-muted-foreground hover:text-foreground cursor-pointer shrink-0"
                      title={node.collapsed ? "Dalı Genişlet" : "Dalı Daralt"}
                    >
                      {node.collapsed ? (
                        <ChevronRight className="w-3 h-3 text-primary font-bold" />
                      ) : (
                        <ChevronDown className="w-3 h-3" />
                      )}
                    </button>
                  )}

                  {/* Hover Quick Action Buttons */}
                  <div className="absolute -top-7 left-1/2 -translate-x-1/2 hidden group-hover/node:flex items-center gap-1 bg-background/95 backdrop-blur-md px-1.5 py-0.5 rounded-lg border border-border shadow-lg z-30 animate-in fade-in zoom-in-95 duration-100">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleAddChild(node.id);
                      }}
                      className="p-1 hover:bg-primary/10 hover:text-primary rounded text-[10px] flex items-center gap-0.5 cursor-pointer"
                      title="Alt Fikir (Çocuk) Ekle"
                    >
                      <Plus className="w-3 h-3" />
                      <span className="text-[9px]">Alt</span>
                    </button>

                    {!isRoot && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleAddSibling(node.id);
                        }}
                        className="p-1 hover:bg-emerald-500/10 hover:text-emerald-600 rounded text-[10px] flex items-center gap-0.5 cursor-pointer"
                        title="Kardeş Dal Ekle"
                      >
                        <Plus className="w-3 h-3" />
                        <span className="text-[9px]">Kardeş</span>
                      </button>
                    )}

                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleStartEdit(node);
                      }}
                      className="p-1 hover:bg-muted rounded text-muted-foreground hover:text-foreground cursor-pointer"
                      title="Metni Düzenle"
                    >
                      <Edit2 className="w-2.5 h-2.5" />
                    </button>

                    {!isRoot && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDelete(node.id);
                        }}
                        className="p-1 hover:bg-destructive/10 text-destructive rounded cursor-pointer"
                        title="Dalı Sil"
                      >
                        <Trash2 className="w-2.5 h-2.5" />
                      </button>
                    )}
                  </div>

                  {/* Color Picker Dropdown Popover */}
                  {colorPickerNodeId === node.id && (
                    <div
                      className="absolute -bottom-9 left-0 flex items-center gap-1 p-1 bg-background border border-border rounded-md shadow-xl z-40 animate-in fade-in"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {COLOR_PALETTE.map((c) => (
                        <div
                          key={c}
                          style={{ backgroundColor: c }}
                          onClick={() => handleColorChange(node.id, c)}
                          className="w-3.5 h-3.5 rounded-full cursor-pointer hover:scale-125 transition-transform"
                        />
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Quick Helper Floating Badge */}
          <div className="absolute bottom-3 left-3 text-[10px] font-mono text-muted-foreground bg-background/80 backdrop-blur-sm px-2.5 py-1 rounded-md border border-border pointer-events-none">
            Düğüme çift tıklayarak düzenleyin • Düğüm üzerine gelerek alt/kardeş ekleyin
          </div>
        </div>
      )}
    </div>
  );
}
