import React, { useState } from "react";
import {
  MessageSquare,
  Send,
  Trash2,
  Edit2,
  Check,
  X,
  Plus,
  Bold,
  Italic,
  Link as LinkIcon,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  extractCommentsFromContent,
  addCommentToNote,
  updateCommentInNote,
  deleteCommentFromNote,
  NoteComment,
} from "@/lib/comments";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";

interface Props {
  noteId?: string;
  content: string;
  onContentChange: (newContent: string, changeSummary?: string) => Promise<void> | void;
  disabled?: boolean;
  defaultExpanded?: boolean;
}

function CommentMarkdownRenderer({ text }: { text: string }) {
  if (!text) return null;
  const paragraphs = text.split(/\n\n+/);

  const renderFormattedLine = (line: string, lineIdx: number) => {
    const regex = /(\[([^\]]+)\]\(([^\)]+)\)|\*\*([^*]+)\*\*|\*([^*]+)\*)/g;
    const elements: React.ReactNode[] = [];
    let lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = regex.exec(line)) !== null) {
      if (match.index > lastIndex) {
        elements.push(line.substring(lastIndex, match.index));
      }

      if (match[2] && match[3]) {
        elements.push(
          <a
            key={"link-" + lineIdx + "-" + match.index}
            href={match[3]}
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary underline hover:opacity-80 transition-opacity break-all font-medium"
            onClick={(e) => e.stopPropagation()}
          >
            {match[2]}
          </a>
        );
      } else if (match[4]) {
        elements.push(
          <strong key={"bold-" + lineIdx + "-" + match.index} className="font-bold text-foreground">
            {match[4]}
          </strong>
        );
      } else if (match[5]) {
        elements.push(
          <em key={"italic-" + lineIdx + "-" + match.index} className="italic">
            {match[5]}
          </em>
        );
      }

      lastIndex = regex.lastIndex;
    }

    if (lastIndex < line.length) {
      elements.push(line.substring(lastIndex));
    }

    return (
      <span key={lineIdx} className="block leading-relaxed">
        {elements.length > 0 ? elements : line}
      </span>
    );
  };

  return (
    <div className="space-y-1.5 text-xs text-foreground/90 font-sans">
      {paragraphs.map((p, pIdx) => {
        const lines = p.split("\n");
        return (
          <div key={pIdx} className="space-y-0.5">
            {lines.map((line, lIdx) => renderFormattedLine(line, lIdx))}
          </div>
        );
      })}
    </div>
  );
}

export default function NoteCommentsSection({
  content,
  onContentChange,
  disabled = false,
}: Props) {
  const { user } = useAuth();
  const { comments } = extractCommentsFromContent(content);

  const [showAddForm, setShowAddForm] = useState(false);
  const [newCommentText, setNewCommentText] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [editingCommentId, setEditingCommentId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState("");

  const handleAddComment = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!newCommentText.trim()) return;

    setIsSubmitting(true);
    try {
      const updatedContent = addCommentToNote(content, {
        author: user?.name || "Kullanıcı",
        authorId: user?.user_id,
        content: newCommentText.trim(),
      });

      await onContentChange(updatedContent, "Yorum eklendi");
      setNewCommentText("");
      setShowAddForm(false);
      toast.success("Yorum eklendi");
    } catch (err: any) {
      toast.error(err.message || "Yorum eklenirken hata oluştu");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleStartEdit = (c: NoteComment) => {
    setEditingCommentId(c.id);
    setEditingText(c.content);
  };

  const handleSaveEdit = async (commentId: string) => {
    if (!editingText.trim()) return;
    try {
      const updatedContent = updateCommentInNote(content, commentId, editingText.trim());
      await onContentChange(updatedContent, "Yorum güncellendi");
      setEditingCommentId(null);
      setEditingText("");
      toast.success("Yorum güncellendi");
    } catch (err: any) {
      toast.error(err.message || "Yorum güncellenirken hata oluştu");
    }
  };

  const handleDeleteComment = async (commentId: string) => {
    try {
      const updatedContent = deleteCommentFromNote(content, commentId);
      await onContentChange(updatedContent, "Yorum silindi");
      toast.success("Yorum silindi");
    } catch (err: any) {
      toast.error(err.message || "Yorum silinirken hata oluştu");
    }
  };

  const insertMarkdown = (syntax: "bold" | "italic" | "link") => {
    if (syntax === "bold") {
      setNewCommentText((prev) => prev + "**kalın metin**");
    } else if (syntax === "italic") {
      setNewCommentText((prev) => prev + "*italik metin*");
    } else if (syntax === "link") {
      setNewCommentText((prev) => prev + "[bağlantı metni](https://)");
    }
  };

  return (
    <div className="mt-4 pt-3 border-t border-border/50 select-none">
      <div className="flex items-center justify-between gap-2 text-xs font-semibold text-foreground/80 mb-2.5">
        <div className="flex items-center gap-1.5">
          <MessageSquare className="w-3.5 h-3.5 text-primary" />
          <span>Yorumlar {comments.length > 0 ? `(${comments.length})` : ""}</span>
        </div>
        {!disabled && !showAddForm && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setShowAddForm(true)}
            className="h-6 px-2 text-xs text-primary hover:text-primary/80 gap-1 cursor-pointer font-medium"
            data-testid="show-add-comment-btn"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Yorum Ekle</span>
          </Button>
        )}
      </div>

      <div className="space-y-3 pt-1 select-text">
        {comments.length > 0 && (
          <div className="space-y-2.5">
            {comments.map((c) => {
              const isEditing = editingCommentId === c.id;

              return (
                <div
                  key={c.id}
                  className="p-3 rounded-lg bg-muted/30 border border-border/50 hover:border-border transition-colors group relative"
                  data-testid="note-comment-item"
                >
                  <div className="flex items-center justify-between gap-2 mb-1.5 text-[11px] text-muted-foreground">
                    <div className="flex items-center gap-1.5">
                      <span className="font-mono text-muted-foreground">
                        {new Date(c.createdAt).toLocaleString("tr-TR", {
                          day: "2-digit",
                          month: "2-digit",
                          year: "numeric",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </span>
                      {c.updatedAt && (
                        <span className="text-[10px] italic opacity-60">(düzenlendi)</span>
                      )}
                    </div>

                    {!disabled && !isEditing && (
                      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button
                          type="button"
                          onClick={() => handleStartEdit(c)}
                          className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
                          title="Yorumu Düzenle"
                        >
                          <Edit2 className="w-3 h-3" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteComment(c.id)}
                          className="p-1 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors cursor-pointer"
                          title="Yorumu Sil"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    )}
                  </div>

                  {isEditing ? (
                    <div className="space-y-2 mt-1">
                      <Textarea
                        value={editingText}
                        onChange={(e) => setEditingText(e.target.value)}
                        className="text-xs min-h-[60px] bg-background"
                        autoFocus
                      />
                      <div className="flex items-center justify-end gap-1.5">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setEditingCommentId(null)}
                          className="h-6 px-2 text-[11px]"
                        >
                          <X className="w-3 h-3 mr-1" /> İptal
                        </Button>
                        <Button
                          size="sm"
                          onClick={() => handleSaveEdit(c.id)}
                          className="h-6 px-2 text-[11px]"
                        >
                          <Check className="w-3 h-3 mr-1" /> Kaydet
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <CommentMarkdownRenderer text={c.content} />
                  )}
                </div>
              );
            })}
          </div>
        )}

        {!disabled && showAddForm && (
          <form onSubmit={handleAddComment} className="pt-1">
            <div className="rounded-lg border border-border/70 bg-card p-2.5 focus-within:border-primary/60 transition-colors shadow-2xs">
              <Textarea
                value={newCommentText}
                onChange={(e) => setNewCommentText(e.target.value)}
                placeholder="Yorum ekleyin... (**kalın**, *italik*, [link](url) desteklenir)"
                className="text-xs border-0 p-0 focus-visible:ring-0 shadow-none resize-y min-h-[50px] bg-transparent"
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                    e.preventDefault();
                    handleAddComment();
                  }
                }}
                data-testid="note-comment-input"
              />

              <div className="flex items-center justify-between pt-2 mt-1.5 border-t border-border/40 text-xs">
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => insertMarkdown("bold")}
                    className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
                    title="Kalın (**metin**)"
                  >
                    <Bold className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => insertMarkdown("italic")}
                    className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
                    title="İtalik (*metin*)"
                  >
                    <Italic className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => insertMarkdown("link")}
                    className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
                    title="Bağlantı ([metin](url))"
                  >
                    <LinkIcon className="w-3.5 h-3.5" />
                  </button>
                </div>

                <div className="flex items-center gap-1.5">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setShowAddForm(false);
                      setNewCommentText("");
                    }}
                    className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground cursor-pointer"
                  >
                    İptal
                  </Button>
                  <Button
                    type="submit"
                    size="sm"
                    disabled={!newCommentText.trim() || isSubmitting}
                    className="h-7 px-3 text-xs gap-1 cursor-pointer"
                    data-testid="note-comment-submit-btn"
                  >
                    <Send className="w-3 h-3" />
                    <span>Yorum Yap</span>
                  </Button>
                </div>
              </div>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
