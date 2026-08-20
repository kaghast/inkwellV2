import React, { useState } from "react";
import {
  parseOutlineMarkdown,
  serializeOutlineMarkdown,
  OutlineNode,
} from "./OutlineEditor";
import {
  CheckCircle2,
  Circle,
  Clock,
  Dot,
  ChevronRight,
  ChevronDown,
  Pencil,
  ListTree,
  ChevronsUpDown,
} from "lucide-react";
import { Progress } from "@/components/ui/progress";

export interface OutlineViewerProps {
  content: string;
  onUpdateContent?: (newMarkdown: string) => void;
  onEdit?: () => void;
}

export default function OutlineViewer({ content, onUpdateContent, onEdit }: OutlineViewerProps) {
  const [nodes, setNodes] = useState<OutlineNode[]>(() => parseOutlineMarkdown(content));
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(new Set());

  // Keep in sync with external content updates
  React.useEffect(() => {
    setNodes(parseOutlineMarkdown(content));
  }, [content]);

  // Calculate task statistics
  const taskNodes = nodes.filter((n) => n.status !== "none");
  const doneNodes = nodes.filter((n) => n.status === "done");
  const progressPercent = taskNodes.length > 0 ? Math.round((doneNodes.length / taskNodes.length) * 100) : 0;

  const handleToggleTask = (id: string) => {
    const updated = nodes.map((n) => {
      if (n.id === id) {
        let nextStatus: OutlineNode["status"] = "done";
        if (n.status === "done") nextStatus = "todo";
        else if (n.status === "todo") nextStatus = "done";
        else if (n.status === "in_progress") nextStatus = "done";
        return { ...n, status: nextStatus };
      }
      return n;
    });

    setNodes(updated);
    if (onUpdateContent) {
      onUpdateContent(serializeOutlineMarkdown(updated));
    }
  };

  const toggleCollapse = (id: string) => {
    setCollapsedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // Determine if a node has children
  const hasChildren = (index: number) => {
    if (index >= nodes.length - 1) return false;
    return nodes[index + 1].level > nodes[index].level;
  };

  // Check if a node is currently hidden by an ancestor's collapsed state
  const isNodeHidden = (index: number) => {
    const current = nodes[index];
    for (let i = index - 1; i >= 0; i--) {
      const ancestor = nodes[i];
      if (ancestor.level < current.level) {
        if (collapsedIds.has(ancestor.id)) return true;
      }
      if (ancestor.level === 0 && current.level > 0) {
        if (collapsedIds.has(ancestor.id)) return true;
        break;
      }
    }
    return false;
  };

  const toggleAllCollapse = () => {
    if (collapsedIds.size > 0) {
      setCollapsedIds(new Set());
    } else {
      const allParentIds = new Set(
        nodes.filter((_, idx) => hasChildren(idx)).map((n) => n.id)
      );
      setCollapsedIds(allParentIds);
    }
  };

  return (
    <div className="border border-border rounded-xl bg-card overflow-hidden shadow-2xs space-y-3 p-4">
      {/* Top Header with Progress & Actions */}
      <div className="flex items-center justify-between pb-3 border-b border-border/70 flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <ListTree className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
          <h3 className="font-serif font-bold text-sm text-foreground">Hiyerarşik Outline</h3>
          {taskNodes.length > 0 && (
            <span className="text-[11px] font-mono font-medium px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
              {doneNodes.length}/{taskNodes.length} Tamamlandı (%{progressPercent})
            </span>
          )}
        </div>

        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={toggleAllCollapse}
            className="flex items-center gap-1 text-[11px] px-2 py-1 bg-muted hover:bg-muted/80 text-muted-foreground hover:text-foreground font-medium rounded-md transition-colors cursor-pointer"
            title="Tüm dalları daralt veya genişlet"
          >
            <ChevronsUpDown className="w-3 h-3" /> {collapsedIds.size > 0 ? "Tümünü Aç" : "Tümünü Daralt"}
          </button>

          {onEdit && (
            <button
              type="button"
              onClick={onEdit}
              className="flex items-center gap-1 text-[11px] px-2.5 py-1 bg-primary text-primary-foreground font-medium rounded-md hover:opacity-90 transition-opacity cursor-pointer shadow-2xs"
            >
              <Pencil className="w-3 h-3" /> Düzenle
            </button>
          )}
        </div>
      </div>

      {/* Progress Bar */}
      {taskNodes.length > 0 && (
        <div className="w-full">
          <Progress value={progressPercent} className="h-1.5 bg-muted" />
        </div>
      )}

      {/* Hierarchical Tree Render */}
      <div className="space-y-1 pt-1">
        {nodes.map((node, index) => {
          if (isNodeHidden(index)) return null;
          const isParent = hasChildren(index);
          const isCollapsed = collapsedIds.has(node.id);

          return (
            <div
              key={node.id}
              style={{ paddingLeft: `${node.level * 22}px` }}
              className="flex items-start gap-1.5 py-1 px-1.5 rounded-md hover:bg-muted/30 transition-colors group"
            >
              {/* Branch Collapse/Expand Toggle */}
              <div className="w-4 h-4 flex items-center justify-center shrink-0 mt-0.5">
                {isParent ? (
                  <button
                    type="button"
                    onClick={() => toggleCollapse(node.id)}
                    className="p-0.5 text-muted-foreground hover:text-foreground cursor-pointer rounded"
                  >
                    {isCollapsed ? (
                      <ChevronRight className="w-3.5 h-3.5" />
                    ) : (
                      <ChevronDown className="w-3.5 h-3.5" />
                    )}
                  </button>
                ) : (
                  <span className="w-1.5 h-1.5 rounded-full bg-border" />
                )}
              </div>

              {/* Checkbox / Status Icon */}
              {node.status !== "none" ? (
                <button
                  type="button"
                  onClick={() => handleToggleTask(node.id)}
                  className="mt-0.5 text-muted-foreground hover:text-primary shrink-0 cursor-pointer transition-colors"
                >
                  {node.status === "done" && (
                    <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                  )}
                  {node.status === "in_progress" && (
                    <Clock className="w-4 h-4 text-amber-600 dark:text-amber-400" />
                  )}
                  {node.status === "todo" && (
                    <Circle className="w-4 h-4 text-muted-foreground/60 hover:text-primary" />
                  )}
                </button>
              ) : (
                <div className="mt-1 w-1.5 h-1.5 rounded-full bg-primary/70 shrink-0 mx-1" />
              )}

              {/* Node Text */}
              <div
                className={`text-xs leading-relaxed font-medium transition-all ${
                  node.status === "done"
                    ? "line-through text-muted-foreground/70"
                    : node.level === 0
                    ? "text-foreground font-semibold text-sm"
                    : "text-foreground"
                }`}
              >
                {node.text}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
