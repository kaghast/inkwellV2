import React, { useRef, useEffect, useState } from "react";
import { parseDrawingMarkdown, DrawingElement, DrawingData } from "./DrawingEditor";
import { ZoomIn, ZoomOut, Maximize2, Download, Copy, Pencil } from "lucide-react";
import { toast } from "sonner";

export interface DrawingViewerProps {
  content: string;
  onEdit?: () => void;
  height?: number | string;
}

export default function DrawingViewer({ content, onEdit, height = 480 }: DrawingViewerProps) {
  const data = parseDrawingMarkdown(content);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });

  // Render static vector drawing on high-DPI canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const width = canvas.parentElement?.clientWidth || 800;
    const heightNum = typeof height === "number" ? height : 480;
    canvas.width = width * window.devicePixelRatio;
    canvas.height = heightNum * window.devicePixelRatio;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${heightNum}px`;

    ctx.scale(window.devicePixelRatio, window.devicePixelRatio);

    const isDark = document.documentElement.classList.contains("dark");
    ctx.fillStyle = isDark ? "#0f172a" : "#fdfbf7";
    ctx.fillRect(0, 0, width, heightNum);

    ctx.save();
    ctx.translate(pan.x, pan.y);
    ctx.scale(zoom, zoom);

    // Draw background dots
    if (data.gridMode !== "plain") {
      ctx.fillStyle = isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.06)";
      const gridSize = 24;
      const startX = Math.floor(-pan.x / zoom / gridSize) * gridSize - gridSize;
      const endX = startX + (width / zoom) + gridSize * 2;
      const startY = Math.floor(-pan.y / zoom / gridSize) * gridSize - gridSize;
      const endY = startY + (heightNum / zoom) + gridSize * 2;
      for (let x = startX; x < endX; x += gridSize) {
        for (let y = startY; y < endY; y += gridSize) {
          ctx.beginPath();
          ctx.arc(x, y, 1, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }

    // Render elements
    data.elements.forEach((el) => {
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
        ctx.fillText(el.text || "", el.x, el.y);
      } else if (el.type === "sticky") {
        ctx.fillStyle = isDark ? "#334155" : "#fef08a";
        ctx.strokeStyle = isDark ? "#475569" : "#fde047";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.roundRect(el.x, el.y, el.width, el.height, 8);
        ctx.fill();
        ctx.stroke();

        ctx.fillStyle = isDark ? "#f8fafc" : "#1e293b";
        ctx.font = "14px system-ui, sans-serif";
        ctx.textBaseline = "top";
        ctx.fillText(el.text || "Not...", el.x + 12, el.y + 12, el.width - 24);
      }

      ctx.restore();
    });

    ctx.restore();
  }, [data, pan, zoom, height]);

  const handleDownloadPNG = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const url = canvas.toDataURL("image/png");
    const a = document.createElement("a");
    a.href = url;
    a.download = `cizim-${Date.now()}.png`;
    a.click();
    toast.success("Çizim PNG olarak indirildi");
  };

  return (
    <div className="relative border border-border rounded-xl bg-card overflow-hidden shadow-2xs group">
      <canvas ref={canvasRef} className="w-full h-full" style={{ height }} />

      {/* Floating Action Controls */}
      <div className="absolute top-3 right-3 flex items-center gap-1.5 bg-background/90 backdrop-blur-md px-2 py-1.5 rounded-lg border border-border shadow-md opacity-80 group-hover:opacity-100 transition-opacity">
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
          onClick={() => setZoom((z) => Math.min(z + 0.2, 2.5))}
          className="p-1 text-muted-foreground hover:text-foreground hover:bg-muted rounded cursor-pointer"
          title="Yakınlaş"
        >
          <ZoomIn className="w-3.5 h-3.5" />
        </button>
        <button
          type="button"
          onClick={() => setZoom((z) => Math.max(z - 0.2, 0.5))}
          className="p-1 text-muted-foreground hover:text-foreground hover:bg-muted rounded cursor-pointer"
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
          className="p-1 text-muted-foreground hover:text-foreground hover:bg-muted rounded cursor-pointer"
          title="Görünümü Sıfırla"
        >
          <Maximize2 className="w-3.5 h-3.5" />
        </button>
        <button
          type="button"
          onClick={handleDownloadPNG}
          className="p-1 text-muted-foreground hover:text-foreground hover:bg-muted rounded cursor-pointer"
          title="PNG Olarak İndir"
        >
          <Download className="w-3.5 h-3.5" />
        </button>
      </div>

      {data.elements.length === 0 && (
        <div className="absolute inset-0 flex flex-col items-center justify-center p-6 text-center text-muted-foreground pointer-events-none space-y-2">
          <p className="text-sm font-medium">Bu çizim notunda henüz bir öğe yok</p>
          {onEdit && (
            <p className="text-xs text-primary underline pointer-events-auto cursor-pointer" onClick={onEdit}>
              Düzenleyerek çizmeye başlayın
            </p>
          )}
        </div>
      )}
    </div>
  );
}
