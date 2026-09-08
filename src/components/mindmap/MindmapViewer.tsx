import React, { useMemo, useState, useRef } from "react";
import {
  MindmapNode,
  parseMindmapMarkdown,
  toggleNodeCollapse,
} from "@/lib/mindmapParser";
import {
  Network,
  ZoomIn,
  ZoomOut,
  Maximize2,
  Download,
  ChevronRight,
  ChevronDown,
  Pencil,
} from "lucide-react";
import { toast } from "sonner";

interface Props {
  content: string;
  onEdit?: () => void;
  height?: number | string;
}

interface LayoutNode {
  node: MindmapNode;
  x: number;
  y: number;
  width: number;
  height: number;
  level: number;
  color: string;
}

export default function MindmapViewer({ content, onEdit, height = 440 }: Props) {
  const [root, setRoot] = useState<MindmapNode>(() => parseMindmapMarkdown(content));
  const [zoom, setZoom] = useState(0.95);
  const [pan, setPan] = useState({ x: 80, y: 180 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });

  const containerRef = useRef<HTMLDivElement | null>(null);

  React.useEffect(() => {
    setRoot(parseMindmapMarkdown(content));
  }, [content]);

  // Compute Layout Positions
  const layout = useMemo(() => {
    const nodes: LayoutNode[] = [];
    const connections: { from: LayoutNode; to: LayoutNode; color: string }[] = [];

    const HORIZONTAL_GAP = 180;
    const VERTICAL_GAP = 42;

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
      const width = Math.min(220, Math.max(90, charCount * 8.2 + 36));
      const height = 34;

      const totalHeight = calculateSubtreeHeight(n);
      const y = startY + totalHeight / 2 - height / 2;
      const nodeColor = n.color || (level === 0 ? "#3b82f6" : parentLayout?.color || "#10b981");

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
      layoutSubtree(root, 30, 30, 0);
    }

    return { nodes, connections };
  }, [root]);

  // Pan Handlers
  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    setIsDragging(true);
    setDragStart({ x: e.clientX - pan.x, y: e.clientY - pan.y });
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

  const handleToggleCollapse = (nodeId: string) => {
    setRoot((prev) => toggleNodeCollapse(prev, nodeId));
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
      ref={containerRef}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      className="relative border border-border rounded-xl bg-card overflow-hidden shadow-2xs select-none group"
      style={{ height }}
    >
      {/* Interactive SVG Canvas Layer */}
      <svg
        className="absolute inset-0 w-full h-full pointer-events-none"
        style={{
          transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
          transformOrigin: "0 0",
        }}
      >
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
              stroke={conn.color}
              strokeWidth={conn.to.level === 1 ? 2.5 : 1.75}
              strokeOpacity={0.8}
              strokeLinecap="round"
            />
          );
        })}
      </svg>

      {/* Nodes DOM Layer */}
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
          const hasChildren = node.children && node.children.length > 0;

          return (
            <div
              key={node.id}
              style={{
                left: `${x}px`,
                top: `${y}px`,
                minWidth: `${width}px`,
                height: `${height}px`,
                borderColor: color,
                borderWidth: isRoot ? 2 : 1.5,
              }}
              className={`absolute pointer-events-auto flex items-center justify-between gap-1.5 px-3 rounded-full border text-xs font-medium transition-all shadow-xs ${
                isRoot
                  ? "bg-primary text-primary-foreground font-bold text-sm shadow-md"
                  : "bg-card text-foreground hover:shadow-md"
              }`}
            >
              <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: color }} />
              <span className="truncate flex-1 max-w-[180px]">{node.text}</span>

              {hasChildren && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleToggleCollapse(node.id);
                  }}
                  className="p-0.5 rounded-full hover:bg-muted text-muted-foreground hover:text-foreground cursor-pointer shrink-0"
                  title={node.collapsed ? "Genişlet" : "Daralt"}
                >
                  {node.collapsed ? (
                    <ChevronRight className="w-3 h-3 text-primary font-bold" />
                  ) : (
                    <ChevronDown className="w-3 h-3" />
                  )}
                </button>
              )}
            </div>
          );
        })}
      </div>

      {/* Floating Action Controls */}
      <div className="absolute top-3 right-3 flex items-center gap-1.5 bg-background/90 backdrop-blur-md px-2 py-1.5 rounded-lg border border-border shadow-md opacity-85 group-hover:opacity-100 transition-opacity z-20">
        {onEdit && (
          <button
            type="button"
            onClick={onEdit}
            className="flex items-center gap-1 text-xs px-2.5 py-1 bg-primary text-primary-foreground font-medium rounded-md hover:opacity-90 transition-opacity cursor-pointer shadow-2xs"
          >
            <Pencil className="w-3 h-3" /> Düzenle
          </button>
        )}

        <button
          type="button"
          onClick={() => setZoom((z) => Math.min(z + 0.15, 2.2))}
          className="p-1 text-muted-foreground hover:text-foreground hover:bg-muted rounded cursor-pointer"
          title="Yakınlaş"
        >
          <ZoomIn className="w-3.5 h-3.5" />
        </button>
        <button
          type="button"
          onClick={() => setZoom((z) => Math.max(z - 0.15, 0.4))}
          className="p-1 text-muted-foreground hover:text-foreground hover:bg-muted rounded cursor-pointer"
          title="Uzaklaş"
        >
          <ZoomOut className="w-3.5 h-3.5" />
        </button>
        <button
          type="button"
          onClick={() => {
            setZoom(0.95);
            setPan({ x: 80, y: 180 });
          }}
          className="p-1 text-muted-foreground hover:text-foreground hover:bg-muted rounded cursor-pointer"
          title="Sıfırla"
        >
          <Maximize2 className="w-3.5 h-3.5" />
        </button>
        <button
          type="button"
          onClick={handleDownloadSVG}
          className="p-1 text-muted-foreground hover:text-foreground hover:bg-muted rounded cursor-pointer"
          title="SVG İndir"
        >
          <Download className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}
