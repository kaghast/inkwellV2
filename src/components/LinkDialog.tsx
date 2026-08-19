import React, { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Link as LinkIcon, Youtube, MapPin } from "lucide-react";

export interface LinkDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onInsert?: (markdown: string) => void;
  onConfirm?: (title: string, url: string) => void;
  type?: "link" | "youtube" | "gmap";
}

export default function LinkDialog({
  open,
  onOpenChange,
  onInsert,
  onConfirm,
  type = "link",
}: LinkDialogProps) {
  const [url, setUrl] = useState("");
  const [text, setText] = useState("");

  const title =
    type === "youtube"
      ? "YouTube Videosu Ekle"
      : type === "gmap"
      ? "Google Harita Linki Ekle"
      : "Bağlantı Ekle";

  const Icon = type === "youtube" ? Youtube : type === "gmap" ? MapPin : LinkIcon;

  function handleInsert() {
    if (!url.trim()) return;

    if (onConfirm) {
      onConfirm(text.trim() || url.trim(), url.trim());
    } else if (onInsert) {
      let md = "";
      if (type === "youtube" || type === "gmap") {
        md = `\n${url.trim()}\n`;
      } else {
        const label = text.trim() || url.trim();
        md = `[${label}](${url.trim()})`;
      }
      onInsert(md);
    }

    setUrl("");
    setText("");
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md bg-card border-border">
        <DialogHeader>
          <DialogTitle className="font-serif flex items-center gap-2">
            <Icon className="w-4 h-4 text-primary" /> {title}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3 pt-2">
          {type === "link" && (
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Görünecek Metin (İsteğe bağlı)</label>
              <Input
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="Örn: AI Studio veya buraya tıklayın"
              />
            </div>
          )}

          <div>
            <label className="text-xs text-muted-foreground block mb-1">URL Adresi</label>
            <Input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder={
                type === "youtube"
                  ? "https://www.youtube.com/watch?v=..."
                  : type === "gmap"
                  ? "https://maps.google.com/..."
                  : "https://example.com"
              }
              autoFocus
            />
          </div>
        </div>

        <DialogFooter className="mt-4">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            İptal
          </Button>
          <Button
            onClick={handleInsert}
            disabled={!url.trim()}
            className="bg-foreground text-background"
          >
            Ekle
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
