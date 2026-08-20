import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  GripVertical,
  Plus,
  Trash2,
  ChevronRight,
  ChevronDown,
  CheckCircle2,
  Circle,
  Clock,
  Dot,
  CornerDownRight,
  ArrowUp,
  ArrowDown,
  Indent,
  Outdent,
} from "lucide-react";
import { Button } from "@/components/ui/button";

export interface OutlineNode {
  id: string;
  text: string;
  level: number; // 0 = root, 1 = sub, 2 = sub-sub...
  status: "none" | "todo" | "done" | "in_progress";
  collapsed?: boolean;
}

export function parseOutlineMarkdown(markdown: string): OutlineNode[] {
  if (!markdown.trim()) {
    return [{ id: "node_1", text: "İlk ana madde...", level: 0, status: "todo" }];
  }

  const lines = markdown.split("\n");
  const nodes: OutlineNode[] = [];

  lines.forEach((line, idx) => {
    // Determine indentation level (2 or 4 spaces or tabs)
    const leadingSpacesMatch = line.match(/^([ \t]*)/);
    const leadingSpaces = leadingSpacesMatch ? leadingSpacesMatch[1] : "";
    const spaceCount = leadingSpaces.replace(/\t/g, "  ").length;
    const level = Math.floor(spaceCount / 2);

    const trimmed = line.trim();
    if (!trimmed) return;

    let status: OutlineNode["status"] = "none";
    let text = trimmed;

    if (/^[-*+]\s+\[x\]\s+/i.test(trimmed)) {
      status = "done";
      text = trimmed.replace(/^[-*+]\s+\[x\]\s+/i, "");
    } else if (/^[-*+]\s+\[-\]\s+/i.test(trimmed)) {
      status = "in_progress";
      text = trimmed.replace(/^[-*+]\s+\[-\]\s+/i, "");
    } else if (/^[-*+]\s+\[ \]\s+/i.test(trimmed)) {
      status = "todo";
      text = trimmed.replace(/^[-*+]\s+\[ \]\s+/i, "");
    } else if (/^[-*+]\s+/.test(trimmed)) {
      status = "none";
      text = trimmed.replace(/^[-*+]\s+/, "");
    } else if (/^\d+\.\s+/.test(trimmed)) {
      status = "none";
      text = trimmed.replace(/^\d+\.\s+/, "");
    }

    nodes.push({
      id: "node_" + idx + "_" + Math.random().toString(36).substring(2, 6),
      text,
      level,
      status,
    });
  });

  return nodes.length > 0
    ? nodes
    : [{ id: "node_1", text: "İlk ana madde...", level: 0, status: "todo" }];
}

export function serializeOutlineMarkdown(nodes: OutlineNode[]): string {
  return nodes
    .map((node) => {
      const indent = "  ".repeat(Math.max(0, node.level));
      let prefix = "- ";
      if (node.status === "todo") prefix = "- [ ] ";
      else if (node.status === "done") prefix = "- [x] ";
      else if (node.status === "in_progress") prefix = "- [-] ";

      return `${indent}${prefix}${node.text}`;
    })
    .join("\n");
}

export interface OutlineEditorProps {
  initialContent: string;
  onChange: (markdown: string) => void;
}

export default function OutlineEditor({ initialContent, onChange }: OutlineEditorProps) {
  const [nodes, setNodes] = useState<OutlineNode[]>(() => parseOutlineMarkdown(initialContent));
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const itemInputRefs = useRef<Record<string, HTMLInputElement | null>>({});

  const commitNodes = useCallback(
    (newNodes: OutlineNode[]) => {
      setNodes(newNodes);
      onChange(serializeOutlineMarkdown(newNodes));
    },
    [onChange]
  );

  const handleTextChange = (id: string, text: string) => {
    const updated = nodes.map((n) => (n.id === id ? { ...n, text } : n));
    commitNodes(updated);
  };

  const handleStatusCycle = (id: string) => {
    const cycleMap: Record<OutlineNode["status"], OutlineNode["status"]> = {
      none: "todo",
      todo: "in_progress",
      in_progress: "done",
      done: "none",
    };
    const updated = nodes.map((n) => (n.id === id ? { ...n, status: cycleMap[n.status] } : n));
    commitNodes(updated);
  };

  const handleIndent = (index: number) => {
    if (index === 0) return;
    const prevLevel = nodes[index - 1].level;
    const current = nodes[index];
    if (current.level <= prevLevel) {
      const updated = [...nodes];
      updated[index] = { ...current, level: current.level + 1 };
      commitNodes(updated);
    }
  };

  const handleOutdent = (index: number) => {
    const current = nodes[index];
    if (current.level > 0) {
      const updated = [...nodes];
      updated[index] = { ...current, level: current.level - 1 };
      commitNodes(updated);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>, index: number) => {
    const current = nodes[index];

    if (e.key === "Enter") {
      e.preventDefault();
      const newId = "node_" + Date.now();
      const newNode: OutlineNode = {
        id: newId,
        text: "",
        level: current.level,
        status: current.status === "none" ? "none" : "todo",
      };
      const updated = [...nodes.slice(0, index + 1), newNode, ...nodes.slice(index + 1)];
      commitNodes(updated);

      setTimeout(() => {
        itemInputRefs.current[newId]?.focus();
      }, 50);
    } else if (e.key === "Tab") {
      e.preventDefault();
      if (e.shiftKey) {
        handleOutdent(index);
      } else {
        handleIndent(index);
      }
    } else if (e.key === "Backspace" && current.text === "" && nodes.length > 1) {
      e.preventDefault();
      const prevNode = nodes[index - 1];
      const updated = nodes.filter((_, i) => i !== index);
      commitNodes(updated);
      if (prevNode) {
        setTimeout(() => {
          itemInputRefs.current[prevNode.id]?.focus();
        }, 50);
      }
    } else if (e.key === "ArrowUp" && index > 0) {
      e.preventDefault();
      itemInputRefs.current[nodes[index - 1].id]?.focus();
    } else if (e.key === "ArrowDown" && index < nodes.length - 1) {
      e.preventDefault();
      itemInputRefs.current[nodes[index + 1].id]?.focus();
    }
  };

  const handleAddChild = (index: number) => {
    const parent = nodes[index];
    const newId = "node_" + Date.now();
    const newNode: OutlineNode = {
      id: newId,
      text: "",
      level: parent.level + 1,
      status: "todo",
    };
    const updated = [...nodes.slice(0, index + 1), newNode, ...nodes.slice(index + 1)];
    commitNodes(updated);
    setTimeout(() => {
      itemInputRefs.current[newId]?.focus();
    }, 50);
  };

  const handleDelete = (index: number) => {
    if (nodes.length <= 1) return;
    const updated = nodes.filter((_, i) => i !== index);
    commitNodes(updated);
  };

  // Drag & Drop Handlers
  const handleDragStart = (index: number) => {
    setDraggedIndex(index);
  };

  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    setDragOverIndex(index);
  };

  const handleDrop = (targetIndex: number) => {
    if (draggedIndex === null || draggedIndex === targetIndex) {
      setDraggedIndex(null);
      setDragOverIndex(null);
      return;
    }

    const updated = [...nodes];
    const [draggedItem] = updated.splice(draggedIndex, 1);
    updated.splice(targetIndex, 0, draggedItem);

    commitNodes(updated);
    setDraggedIndex(null);
    setDragOverIndex(null);
  };

  return (
    <div className="flex flex-col border border-border rounded-xl bg-card overflow-hidden shadow-sm">
      {/* Outline Top Toolbar */}
      <div className="flex items-center justify-between p-3 border-b border-border bg-muted/40 text-xs">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-foreground">Hiyerarşik Outline Düzenleyici</span>
          <span className="text-[10px] font-mono text-muted-foreground bg-background px-2 py-0.5 rounded border border-border">
            {nodes.length} Madde
          </span>
        </div>

        <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <span className="hidden sm:inline">
            <kbd className="px-1 py-0.5 bg-background border rounded text-[10px]">Enter</kbd> Yeni Madde
          </span>
          <span className="hidden sm:inline">•</span>
          <span className="hidden sm:inline">
            <kbd className="px-1 py-0.5 bg-background border rounded text-[10px]">Tab</kbd> Alt Madde
          </span>
          <span className="hidden sm:inline">•</span>
          <span className="hidden sm:inline">
            <kbd className="px-1 py-0.5 bg-background border rounded text-[10px]">Shift+Tab</kbd> Üst Seviye
          </span>
        </div>
      </div>

      {/* Outline Item Nodes List */}
      <div className="p-3 space-y-1.5 max-h-[600px] overflow-y-auto">
        {nodes.map((node, index) => {
          const isDragTarget = dragOverIndex === index;

          return (
            <div
              key={node.id}
              draggable
              onDragStart={() => handleDragStart(index)}
              onDragOver={(e) => handleDragOver(e, index)}
              onDrop={() => handleDrop(index)}
              style={{ paddingLeft: `${node.level * 24}px` }}
              className={`flex items-center gap-1.5 group py-1 px-2 rounded-lg transition-all ${
                isDragTarget
                  ? "border-t-2 border-primary bg-primary/5"
                  : "hover:bg-muted/40 border border-transparent"
              }`}
            >
              {/* Drag Handle */}
              <div
                className="cursor-grab active:cursor-grabbing text-muted-foreground/40 hover:text-muted-foreground shrink-0"
                title="Sürükleyip Yeniden Sırala"
              >
                <GripVertical className="w-4 h-4" />
              </div>

              {/* Status Toggle Button */}
              <button
                type="button"
                onClick={() => handleStatusCycle(node.id)}
                className="p-1 rounded hover:bg-background shrink-0 cursor-pointer transition-colors"
                title="Durumu Değiştir"
              >
                {node.status === "done" && (
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                )}
                {node.status === "in_progress" && (
                  <Clock className="w-4 h-4 text-amber-600 dark:text-amber-400" />
                )}
                {node.status === "todo" && (
                  <Circle className="w-4 h-4 text-muted-foreground hover:text-primary" />
                )}
                {node.status === "none" && (
                  <Dot className="w-5 h-5 text-muted-foreground" />
                )}
              </button>

              {/* Text Input */}
              <input
                ref={(el) => (itemInputRefs.current[node.id] = el)}
                type="text"
                value={node.text}
                onChange={(e) => handleTextChange(node.id, e.target.value)}
                onKeyDown={(e) => handleKeyDown(e, index)}
                placeholder="Madde içeriği..."
                className={`flex-1 px-2 py-1 text-xs bg-transparent border-none outline-none font-sans focus:bg-background focus:ring-1 focus:ring-primary/30 rounded ${
                  node.status === "done"
                    ? "line-through text-muted-foreground"
                    : "text-foreground font-medium"
                }`}
              />

              {/* Hover Quick Action Buttons */}
              <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                <button
                  type="button"
                  onClick={() => handleIndent(index)}
                  className="p-1 text-muted-foreground hover:text-foreground hover:bg-background rounded cursor-pointer"
                  title="Alt Madde Yap (Tab)"
                >
                  <Indent className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => handleOutdent(index)}
                  className="p-1 text-muted-foreground hover:text-foreground hover:bg-background rounded cursor-pointer"
                  title="Üst Seviyeye Taşı (Shift+Tab)"
                >
                  <Outdent className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => handleAddChild(index)}
                  className="p-1 text-muted-foreground hover:text-primary hover:bg-background rounded cursor-pointer"
                  title="Alt Madde Ekle"
                >
                  <Plus className="w-3.5 h-3.5" />
                </button>
                {nodes.length > 1 && (
                  <button
                    type="button"
                    onClick={() => handleDelete(index)}
                    className="p-1 text-muted-foreground hover:text-destructive hover:bg-destructive/10 rounded cursor-pointer"
                    title="Maddeyi Sil"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Add New Root Item Button */}
      <div className="p-2 border-t border-border bg-muted/20">
        <button
          type="button"
          onClick={() => {
            const newId = "node_" + Date.now();
            const newNode: OutlineNode = {
              id: newId,
              text: "",
              level: 0,
              status: "todo",
            };
            commitNodes([...nodes, newNode]);
            setTimeout(() => {
              itemInputRefs.current[newId]?.focus();
            }, 50);
          }}
          className="flex items-center gap-1.5 text-xs text-primary hover:underline font-semibold px-3 py-1 cursor-pointer"
        >
          <Plus className="w-3.5 h-3.5" /> Yeni Ana Madde Ekle
        </button>
      </div>
    </div>
  );
}
