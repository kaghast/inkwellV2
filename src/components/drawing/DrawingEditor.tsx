import React, { useState, useRef, useEffect, useCallback } from "react";
import {
  MousePointer,
  Pencil,
  Square,
  Circle,
  Diamond,
  ArrowRight,
  Minus,
  Type,
  StickyNote,
  Eraser,
  Undo2,
  Redo2,
  Trash2,
  ZoomIn,
  ZoomOut,
  Maximize2,
  Grid,
  Palette,
  Check,
} from "lucide-react";
import { Button } from "@/components/ui/button";

export interface DrawingElement {
  id: string;
  type: "pencil" | "rectangle" | "ellipse" | "diamond" | "arrow" | "line" | "text" | "sticky";
  x: number;
  y: number;
  width: number;
  height: number;
  points?: { x: number; y: number }[];
  strokeColor: string;
  fillColor?: string;
  fillStyle?: "none" | "semi" | "solid";
  strokeWidth: number;
  text?: string;
  fontSize?: number;
}

export interface DrawingData {
  version: number;
  elements: DrawingElement[];
  gridMode?: "dots" | "grid" | "plain";
}

export function parseDrawingMarkdown(content: string): DrawingData {
  if (!content) return { version: 1, elements: [], gridMode: "dots" };
  const match = content.match(/```drawing\s*([\s\S]*?)\s*```/);
  if (match && match[1]) {
    try {
      const parsed = JSON.parse(match[1]);
      return {
        version: parsed.version || 1,
        elements: Array.isArray(parsed.elements) ? parsed.elements : [],
        gridMode: parsed.gridMode || "dots",
      };
    } catch {
      // fallback
    }
  }
  return { version: 1, elements: [], gridMode: "dots" };
}

export function serializeDrawingMarkdown(data: DrawingData): string {
  return "```drawing\n" + JSON.stringify(data, null, 2) + "\n```";
}

const COLOR_PALETTE = [
  { label: "Koyu", value: "#1e293b" },
  { label: "Mavi", value: "#2563eb" },
  { label: "Mor", value: "#7c3aed" },
  { label: "Zümrüt", value: "#059669" },
  { label: "Gül Kırmızı", value: "#e11d48" },
  { label: "Turuncu", value: "#ea580c" },
  { label: "Sarı", value: "#ca8a04" },
  { label: "Açık Gri", value: "#64748b" },
];

export interface DrawingEditorProps {
  initialContent: string;
  onChange: (markdown: string) => void;
  height?: number | string;
}

export default function DrawingEditor({ initialContent, onChange, height = 540 }: DrawingEditorProps) {
  const [data, setData] = useState<DrawingData>(() => parseDrawingMarkdown(initialContent));
  const [history, setHistory] = useState<DrawingElement[][]>([data.elements]);
  const [historyIndex, setHistoryIndex] = useState(0);

  // Active Tool & Settings
  const [activeTool, setActiveTool] = useState<DrawingElement["type"] | "select" | "eraser">("pencil");
  const [strokeColor, setStrokeColor] = useState("#2563eb");
  const [strokeWidth, setStrokeWidth] = useState(2.5);
  const [fillStyle, setFillStyle] = useState<"none" | "semi" | "solid">("semi");
  const [gridMode, setGridMode] = useState<"dots" | "grid" | "plain">(data.gridMode || "dots");

  // Canvas Viewport Transformation
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const lastPanPos = useRef({ x: 0, y: 0 });

  // Drawing in progress
  const [currentElement, setCurrentElement] = useState<DrawingElement | null>(null);
  const [selectedElementId, setSelectedElementId] = useState<string | null>(null);
  const [isDraggingElement, setIsDraggingElement] = useState(false);
  const dragStartPos = useRef({ x: 0, y: 0 });
  const elementStartPos = useRef({ x: 0, y: 0 });

  // Text Editing Input
  const [editingTextId, setEditingTextId] = useState<string | null>(null);
  const [textInputVal, setTextInputVal] = useState("");
  const [textInputPos, setTextInputPos] = useState({ x: 0, y: 0 });

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  // Propagate changes to parent
  const commitElements = useCallback(
    (newElements: DrawingElement[]) => {
      const updated: DrawingData = { version: 1, elements: newElements, gridMode };
      setData(updated);
      const newHistory = history.slice(0, historyIndex + 1);
      newHistory.push(newElements);
      setHistory(newHistory);
      setHistoryIndex(newHistory.length - 1);
      onChange(serializeDrawingMarkdown(updated));
    },
    [gridMode, history, historyIndex, onChange]
  );

  const handleUndo = () => {
    if (historyIndex > 0) {
      const newIndex = historyIndex - 1;
      const elements = history[newIndex];
      setHistoryIndex(newIndex);
      setData((prev) => ({ ...prev, elements }));
      onChange(serializeDrawingMarkdown({ ...data, elements }));
    }
  };

  const handleRedo = () => {
    if (historyIndex < history.length - 1) {
      const newIndex = historyIndex + 1;
      const elements = history[newIndex];
      setHistoryIndex(newIndex);
      setData((prev) => ({ ...prev, elements }));
      onChange(serializeDrawingMarkdown({ ...data, elements }));
    }
  };

  const handleClear = () => {
    if (confirm("Tüm çizimi temizlemek istediğinize emin misiniz?")) {
      commitElements([]);
    }
  };

  // Convert screen coordinates to canvas world coordinates
  const getCanvasCoords = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const screenX = e.clientX - rect.left;
    const screenY = e.clientY - rect.top;
    return {
      x: (screenX - pan.x) / zoom,
      y: (screenY - pan.y) / zoom,
    };
  };

  // Render canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Resize canvas to match display size
    const width = canvas.parentElement?.clientWidth || 800;
    const heightNum = typeof height === "number" ? height : 540;
    canvas.width = width * window.devicePixelRatio;
    canvas.height = heightNum * window.devicePixelRatio;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${heightNum}px`;

    ctx.scale(window.devicePixelRatio, window.devicePixelRatio);

    const isDark = document.documentElement.classList.contains("dark");
    ctx.fillStyle = isDark ? "#0f172a" : "#fdfbf7";
    ctx.fillRect(0, 0, width, heightNum);

    // Save initial state before pan & zoom
    ctx.save();
    ctx.translate(pan.x, pan.y);
    ctx.scale(zoom, zoom);

    // Draw grid background
    if (gridMode === "dots") {
      ctx.fillStyle = isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.08)";
      const gridSize = 24;
      const startX = Math.floor(-pan.x / zoom / gridSize) * gridSize - gridSize;
      const endX = startX + (width / zoom) + gridSize * 2;
      const startY = Math.floor(-pan.y / zoom / gridSize) * gridSize - gridSize;
      const endY = startY + (heightNum / zoom) + gridSize * 2;
      for (let x = startX; x < endX; x += gridSize) {
        for (let y = startY; y < endY; y += gridSize) {
          ctx.beginPath();
          ctx.arc(x, y, 1.2, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    } else if (gridMode === "grid") {
      ctx.strokeStyle = isDark ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.05)";
      ctx.lineWidth = 1;
      const gridSize = 24;
      const startX = Math.floor(-pan.x / zoom / gridSize) * gridSize - gridSize;
      const endX = startX + (width / zoom) + gridSize * 2;
      const startY = Math.floor(-pan.y / zoom / gridSize) * gridSize - gridSize;
      const endY = startY + (heightNum / zoom) + gridSize * 2;
      ctx.beginPath();
      for (let x = startX; x < endX; x += gridSize) {
        ctx.moveTo(x, startY);
        ctx.lineTo(x, endY);
      }
      for (let y = startY; y < endY; y += gridSize) {
        ctx.moveTo(startX, y);
        ctx.lineTo(endX, y);
      }
      ctx.stroke();
    }

    // Render all elements
    const allElements = currentElement ? [...data.elements, currentElement] : data.elements;

    allElements.forEach((el) => {
      ctx.save();
      ctx.strokeStyle = el.strokeColor;
      ctx.lineWidth = el.strokeWidth;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";

      let fill = "transparent";
      if (el.fillStyle === "solid") {
        fill = el.strokeColor;
      } else if (el.fillStyle === "semi") {
        fill = el.strokeColor + "22";
      }

      ctx.fillStyle = fill;

      if (el.type === "pencil" && el.points && el.points.length > 0) {
        ctx.beginPath();
        ctx.moveTo(el.points[0].x, el.points[0].y);
        for (let i = 1; i < el.points.length; i++) {
          ctx.lineTo(el.points[i].x, el.points[i].y);
        }
        ctx.stroke();
      } else if (el.type === "rectangle") {
        ctx.beginPath();
        ctx.roundRect(el.x, el.y, el.width, el.height, 6);
        if (el.fillStyle !== "none") ctx.fill();
        ctx.stroke();
      } else if (el.type === "ellipse") {
        ctx.beginPath();
        const rx = Math.abs(el.width / 2);
        const ry = Math.abs(el.height / 2);
        const cx = el.x + el.width / 2;
        const cy = el.y + el.height / 2;
        ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
        if (el.fillStyle !== "none") ctx.fill();
        ctx.stroke();
      } else if (el.type === "diamond") {
        ctx.beginPath();
        const cx = el.x + el.width / 2;
        const cy = el.y + el.height / 2;
        ctx.moveTo(cx, el.y);
        ctx.lineTo(el.x + el.width, cy);
        ctx.lineTo(cx, el.y + el.height);
        ctx.lineTo(el.x, cy);
        ctx.closePath();
        if (el.fillStyle !== "none") ctx.fill();
        ctx.stroke();
      } else if (el.type === "line") {
        ctx.beginPath();
        ctx.moveTo(el.x, el.y);
        ctx.lineTo(el.x + el.width, el.y + el.height);
        ctx.stroke();
      } else if (el.type === "arrow") {
        const fromX = el.x;
        const fromY = el.y;
        const toX = el.x + el.width;
        const toY = el.y + el.height;
        const headLen = 14;
        const angle = Math.atan2(toY - fromY, toX - fromX);

        ctx.beginPath();
        ctx.moveTo(fromX, fromY);
        ctx.lineTo(toX, toY);
        ctx.stroke();

        ctx.beginPath();
        ctx.moveTo(toX, toY);
        ctx.lineTo(toX - headLen * Math.cos(angle - Math.PI / 6), toY - headLen * Math.sin(angle - Math.PI / 6));
        ctx.lineTo(toX - headLen * Math.cos(angle + Math.PI / 6), toY - headLen * Math.sin(angle + Math.PI / 6));
        ctx.closePath();
        ctx.fillStyle = el.strokeColor;
        ctx.fill();
      } else if (el.type === "text") {
        ctx.fillStyle = el.strokeColor;
        ctx.font = `${el.fontSize || 16}px system-ui, -apple-system, sans-serif`;
        ctx.textBaseline = "top";
        ctx.fillText(el.text || "Metin", el.x, el.y);
      } else if (el.type === "sticky") {
        // Sticky Note
        ctx.fillStyle = isDark ? "#334155" : "#fef08a";
        ctx.strokeStyle = isDark ? "#475569" : "#fde047";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.roundRect(el.x, el.y, el.width, el.height, 8);
        ctx.fill();
        ctx.stroke();

        // Text inside sticky note
        ctx.fillStyle = isDark ? "#f8fafc" : "#1e293b";
        ctx.font = "14px system-ui, sans-serif";
        ctx.textBaseline = "top";
        ctx.fillText(el.text || "Not...", el.x + 12, el.y + 12, el.width - 24);
      }

      // Selection indicator
      if (el.id === selectedElementId) {
        ctx.strokeStyle = "#3b82f6";
        ctx.lineWidth = 1.5;
        ctx.setLineDash([4, 4]);
        ctx.strokeRect(el.x - 4, el.y - 4, (el.width || 40) + 8, (el.height || 40) + 8);
        ctx.setLineDash([]);
      }

      ctx.restore();
    });

    ctx.restore();
  }, [data.elements, currentElement, selectedElementId, pan, zoom, gridMode, height]);

  // Mouse Handlers
  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (e.button === 1 || e.altKey) {
      // Middle click or Alt -> Pan
      setIsPanning(true);
      lastPanPos.current = { x: e.clientX, y: e.clientY };
      return;
    }

    const coords = getCanvasCoords(e);

    if (activeTool === "select") {
      // Find element clicked
      const clicked = [...data.elements].reverse().find((el) => {
        return (
          coords.x >= el.x &&
          coords.x <= el.x + el.width &&
          coords.y >= el.y &&
          coords.y <= el.y + el.height
        );
      });

      if (clicked) {
        setSelectedElementId(clicked.id);
        setIsDraggingElement(true);
        dragStartPos.current = { x: coords.x, y: coords.y };
        elementStartPos.current = { x: clicked.x, y: clicked.y };
      } else {
        setSelectedElementId(null);
      }
      return;
    }

    if (activeTool === "eraser") {
      const remaining = data.elements.filter((el) => {
        const hit =
          coords.x >= el.x - 10 &&
          coords.x <= el.x + el.width + 10 &&
          coords.y >= el.y - 10 &&
          coords.y <= el.y + el.height + 10;
        return !hit;
      });
      if (remaining.length !== data.elements.length) {
        commitElements(remaining);
      }
      return;
    }

    if (activeTool === "text") {
      const newId = "el_" + Date.now();
      setEditingTextId(newId);
      setTextInputVal("");
      setTextInputPos({ x: coords.x, y: coords.y });
      return;
    }

    if (activeTool === "sticky") {
      const newEl: DrawingElement = {
        id: "el_" + Date.now(),
        type: "sticky",
        x: coords.x,
        y: coords.y,
        width: 140,
        height: 100,
        strokeColor,
        strokeWidth: 1,
        text: "Yeni Not",
      };
      commitElements([...data.elements, newEl]);
      setActiveTool("select");
      return;
    }

    // Creating a shape or pencil stroke
    const id = "el_" + Date.now();
    const newEl: DrawingElement = {
      id,
      type: activeTool,
      x: coords.x,
      y: coords.y,
      width: 0,
      height: 0,
      points: activeTool === "pencil" ? [{ x: coords.x, y: coords.y }] : undefined,
      strokeColor,
      fillStyle,
      strokeWidth,
    };
    setCurrentElement(newEl);
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (isPanning) {
      const dx = e.clientX - lastPanPos.current.x;
      const dy = e.clientY - lastPanPos.current.y;
      setPan((p) => ({ x: p.x + dx, y: p.y + dy }));
      lastPanPos.current = { x: e.clientX, y: e.clientY };
      return;
    }

    const coords = getCanvasCoords(e);

    if (isDraggingElement && selectedElementId) {
      const dx = coords.x - dragStartPos.current.x;
      const dy = coords.y - dragStartPos.current.y;
      setData((prev) => ({
        ...prev,
        elements: prev.elements.map((el) => {
          if (el.id === selectedElementId) {
            return {
              ...el,
              x: elementStartPos.current.x + dx,
              y: elementStartPos.current.y + dy,
            };
          }
          return el;
        }),
      }));
      return;
    }

    if (!currentElement) return;

    if (currentElement.type === "pencil") {
      setCurrentElement((prev) =>
        prev
          ? {
              ...prev,
              points: [...(prev.points || []), { x: coords.x, y: coords.y }],
              width: Math.max(prev.width, coords.x - prev.x),
              height: Math.max(prev.height, coords.y - prev.y),
            }
          : null
      );
    } else {
      setCurrentElement((prev) =>
        prev
          ? {
              ...prev,
              width: coords.x - prev.x,
              height: coords.y - prev.y,
            }
          : null
      );
    }
  };

  const handleMouseUp = () => {
    if (isPanning) {
      setIsPanning(false);
      return;
    }
    if (isDraggingElement) {
      setIsDraggingElement(false);
      onChange(serializeDrawingMarkdown(data));
      return;
    }
    if (currentElement) {
      // Normalize width and height for negative drags
      let el = { ...currentElement };
      if (el.type !== "pencil" && el.type !== "line" && el.type !== "arrow") {
        if (el.width < 0) {
          el.x += el.width;
          el.width = Math.abs(el.width);
        }
        if (el.height < 0) {
          el.y += el.height;
          el.height = Math.abs(el.height);
        }
      }

      if (
        (el.type === "pencil" && el.points && el.points.length > 1) ||
        (el.type !== "pencil" && (Math.abs(el.width) > 3 || Math.abs(el.height) > 3))
      ) {
        commitElements([...data.elements, el]);
      }
      setCurrentElement(null);
    }
  };

  const handleTextSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (textInputVal.trim()) {
      const newEl: DrawingElement = {
        id: editingTextId || "el_" + Date.now(),
        type: "text",
        x: textInputPos.x,
        y: textInputPos.y,
        width: textInputVal.length * 10,
        height: 24,
        strokeColor,
        strokeWidth: 1,
        text: textInputVal.trim(),
        fontSize: 16,
      };
      commitElements([...data.elements, newEl]);
    }
    setEditingTextId(null);
    setTextInputVal("");
    setActiveTool("select");
  };

  return (
    <div
      ref={containerRef}
      className="flex flex-col border border-border rounded-xl bg-card overflow-hidden shadow-sm select-none"
    >
      {/* Top Drawing Toolbar */}
      <div className="flex items-center justify-between p-2 border-b border-border bg-muted/40 flex-wrap gap-2 text-xs">
        {/* Tool Selector Buttons */}
        <div className="flex items-center gap-1 bg-background p-1 rounded-lg border border-border">
          <button
            type="button"
            onClick={() => setActiveTool("select")}
            className={`p-1.5 rounded-md cursor-pointer transition-colors ${
              activeTool === "select" ? "bg-primary text-primary-foreground font-bold shadow-xs" : "hover:bg-muted text-muted-foreground"
            }`}
            title="Seç / Taşı"
          >
            <MousePointer className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={() => setActiveTool("pencil")}
            className={`p-1.5 rounded-md cursor-pointer transition-colors ${
              activeTool === "pencil" ? "bg-primary text-primary-foreground font-bold shadow-xs" : "hover:bg-muted text-muted-foreground"
            }`}
            title="Serbest Çizim (Kalem)"
          >
            <Pencil className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={() => setActiveTool("rectangle")}
            className={`p-1.5 rounded-md cursor-pointer transition-colors ${
              activeTool === "rectangle" ? "bg-primary text-primary-foreground font-bold shadow-xs" : "hover:bg-muted text-muted-foreground"
            }`}
            title="Dikdörtgen"
          >
            <Square className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={() => setActiveTool("ellipse")}
            className={`p-1.5 rounded-md cursor-pointer transition-colors ${
              activeTool === "ellipse" ? "bg-primary text-primary-foreground font-bold shadow-xs" : "hover:bg-muted text-muted-foreground"
            }`}
            title="Daire / Elips"
          >
            <Circle className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={() => setActiveTool("diamond")}
            className={`p-1.5 rounded-md cursor-pointer transition-colors ${
              activeTool === "diamond" ? "bg-primary text-primary-foreground font-bold shadow-xs" : "hover:bg-muted text-muted-foreground"
            }`}
            title="Baklava (Akış Şeması)"
          >
            <Diamond className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={() => setActiveTool("arrow")}
            className={`p-1.5 rounded-md cursor-pointer transition-colors ${
              activeTool === "arrow" ? "bg-primary text-primary-foreground font-bold shadow-xs" : "hover:bg-muted text-muted-foreground"
            }`}
            title="Ok"
          >
            <ArrowRight className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={() => setActiveTool("line")}
            className={`p-1.5 rounded-md cursor-pointer transition-colors ${
              activeTool === "line" ? "bg-primary text-primary-foreground font-bold shadow-xs" : "hover:bg-muted text-muted-foreground"
            }`}
            title="Düz Çizgi"
          >
            <Minus className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={() => setActiveTool("text")}
            className={`p-1.5 rounded-md cursor-pointer transition-colors ${
              activeTool === "text" ? "bg-primary text-primary-foreground font-bold shadow-xs" : "hover:bg-muted text-muted-foreground"
            }`}
            title="Metin Ekle"
          >
            <Type className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={() => setActiveTool("sticky")}
            className={`p-1.5 rounded-md cursor-pointer transition-colors ${
              activeTool === "sticky" ? "bg-primary text-primary-foreground font-bold shadow-xs" : "hover:bg-muted text-muted-foreground"
            }`}
            title="Yapışkan Not (Sticky Note)"
          >
            <StickyNote className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={() => setActiveTool("eraser")}
            className={`p-1.5 rounded-md cursor-pointer transition-colors ${
              activeTool === "eraser" ? "bg-destructive text-destructive-foreground font-bold shadow-xs" : "hover:bg-muted text-muted-foreground"
            }`}
            title="Silgi"
          >
            <Eraser className="w-4 h-4" />
          </button>
        </div>

        {/* Color Palette & Stroke Style */}
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1 bg-background px-2 py-1 rounded-lg border border-border">
            {COLOR_PALETTE.map((c) => (
              <button
                key={c.value}
                type="button"
                onClick={() => setStrokeColor(c.value)}
                style={{ backgroundColor: c.value }}
                className={`w-4 h-4 rounded-full transition-transform cursor-pointer ${
                  strokeColor === c.value ? "scale-125 ring-2 ring-primary ring-offset-1" : "hover:scale-110 opacity-80 hover:opacity-100"
                }`}
                title={c.label}
              />
            ))}
          </div>

          <div className="flex items-center gap-1 bg-background px-2 py-1 rounded-lg border border-border">
            <button
              type="button"
              onClick={() => setStrokeWidth(1.5)}
              className={`px-1.5 py-0.5 rounded text-[10px] cursor-pointer ${
                strokeWidth === 1.5 ? "bg-primary/20 text-primary font-bold" : "text-muted-foreground"
              }`}
            >
              İnce
            </button>
            <button
              type="button"
              onClick={() => setStrokeWidth(2.5)}
              className={`px-1.5 py-0.5 rounded text-[10px] cursor-pointer ${
                strokeWidth === 2.5 ? "bg-primary/20 text-primary font-bold" : "text-muted-foreground"
              }`}
            >
              Orta
            </button>
            <button
              type="button"
              onClick={() => setStrokeWidth(4.5)}
              className={`px-1.5 py-0.5 rounded text-[10px] cursor-pointer ${
                strokeWidth === 4.5 ? "bg-primary/20 text-primary font-bold" : "text-muted-foreground"
              }`}
            >
              Kalın
            </button>
          </div>

          <div className="flex items-center gap-1 bg-background px-2 py-1 rounded-lg border border-border">
            <button
              type="button"
              onClick={() => setFillStyle("none")}
              className={`px-1.5 py-0.5 rounded text-[10px] cursor-pointer ${
                fillStyle === "none" ? "bg-primary/20 text-primary font-bold" : "text-muted-foreground"
              }`}
              title="Dolgu Yok"
            >
              Boş
            </button>
            <button
              type="button"
              onClick={() => setFillStyle("semi")}
              className={`px-1.5 py-0.5 rounded text-[10px] cursor-pointer ${
                fillStyle === "semi" ? "bg-primary/20 text-primary font-bold" : "text-muted-foreground"
              }`}
              title="Yarı Saydam Dolgu"
            >
              Yarı
            </button>
            <button
              type="button"
              onClick={() => setFillStyle("solid")}
              className={`px-1.5 py-0.5 rounded text-[10px] cursor-pointer ${
                fillStyle === "solid" ? "bg-primary/20 text-primary font-bold" : "text-muted-foreground"
              }`}
              title="Tam Dolgu"
            >
              Dolu
            </button>
          </div>
        </div>

        {/* History, Grid & Zoom Controls */}
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={handleUndo}
            disabled={historyIndex <= 0}
            className="p-1.5 hover:bg-muted text-muted-foreground hover:text-foreground rounded cursor-pointer disabled:opacity-30"
            title="Geri Al (Ctrl+Z)"
          >
            <Undo2 className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={handleRedo}
            disabled={historyIndex >= history.length - 1}
            className="p-1.5 hover:bg-muted text-muted-foreground hover:text-foreground rounded cursor-pointer disabled:opacity-30"
            title="İleri Al (Ctrl+Y)"
          >
            <Redo2 className="w-3.5 h-3.5" />
          </button>

          <div className="h-4 w-px bg-border/80 mx-1" />

          <button
            type="button"
            onClick={() => {
              const nextMode = gridMode === "dots" ? "grid" : gridMode === "grid" ? "plain" : "dots";
              setGridMode(nextMode);
            }}
            className="p-1.5 hover:bg-muted text-muted-foreground hover:text-foreground rounded cursor-pointer"
            title={`Izgara: ${gridMode}`}
          >
            <Grid className="w-3.5 h-3.5" />
          </button>

          <button
            type="button"
            onClick={() => setZoom((z) => Math.min(z + 0.2, 3))}
            className="p-1.5 hover:bg-muted text-muted-foreground hover:text-foreground rounded cursor-pointer"
            title="Yakınlaş"
          >
            <ZoomIn className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={() => setZoom((z) => Math.max(z - 0.2, 0.4))}
            className="p-1.5 hover:bg-muted text-muted-foreground hover:text-foreground rounded cursor-pointer"
            title="Uzaklaş"
          >
            <ZoomOut className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={() => {
              setZoom(1);
              setPan({ x: 0, y: 0 });
            }}
            className="p-1.5 hover:bg-muted text-muted-foreground hover:text-foreground rounded cursor-pointer"
            title="Görünümü Sıfırla"
          >
            <Maximize2 className="w-3.5 h-3.5" />
          </button>

          <div className="h-4 w-px bg-border/80 mx-1" />

          <button
            type="button"
            onClick={handleClear}
            className="p-1.5 hover:bg-destructive/10 text-muted-foreground hover:text-destructive rounded cursor-pointer"
            title="Çizimi Temizle"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Canvas Drawing Surface */}
      <div className="relative w-full overflow-hidden" style={{ height }}>
        <canvas
          ref={canvasRef}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
          className="cursor-crosshair w-full h-full touch-none"
        />

        {/* Inline Text Input Overlay */}
        {editingTextId && (
          <form
            onSubmit={handleTextSubmit}
            style={{
              position: "absolute",
              left: textInputPos.x * zoom + pan.x,
              top: textInputPos.y * zoom + pan.y,
            }}
            className="z-20 flex items-center gap-1 bg-background border border-primary p-1 rounded shadow-lg"
          >
            <input
              type="text"
              value={textInputVal}
              onChange={(e) => setTextInputVal(e.target.value)}
              placeholder="Metin yazın..."
              className="px-2 py-1 text-xs bg-transparent border-none outline-none font-medium text-foreground w-40"
              autoFocus
            />
            <button
              type="submit"
              className="p-1 bg-primary text-primary-foreground rounded text-xs cursor-pointer"
            >
              <Check className="w-3 h-3" />
            </button>
          </form>
        )}

        {/* Zoom badge */}
        <div className="absolute bottom-2 right-2 bg-background/80 backdrop-blur-xs px-2 py-0.5 rounded text-[10px] font-mono text-muted-foreground border border-border pointer-events-none">
          {Math.round(zoom * 100)}% • {data.elements.length} Öğe
        </div>
      </div>
    </div>
  );
}
