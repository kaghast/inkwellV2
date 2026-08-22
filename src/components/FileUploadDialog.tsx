import React, { useState, useRef } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { uploadFile } from "@/lib/uploads";
import { toast } from "sonner";
import {
  FileUp,
  Paperclip,
  FileText,
  Video,
  FileSpreadsheet,
  FileCode,
  FileArchive,
  Music,
  Check,
  X,
  Loader2,
} from "lucide-react";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onInsert: (markdownLink: string) => void;
}

function getFileIcon(filename: string) {
  const ext = filename.split(".").pop()?.toLowerCase() || "";
  if (["pdf", "txt", "doc", "docx", "md"].includes(ext)) {
    return <FileText className="w-8 h-8 text-rose-500" />;
  }
  if (["mp4", "webm", "mov", "avi", "mkv"].includes(ext)) {
    return <Video className="w-8 h-8 text-blue-500" />;
  }
  if (["mp3", "wav", "ogg", "aac"].includes(ext)) {
    return <Music className="w-8 h-8 text-amber-500" />;
  }
  if (["xls", "xlsx", "csv"].includes(ext)) {
    return <FileSpreadsheet className="w-8 h-8 text-emerald-500" />;
  }
  if (["zip", "rar", "tar", "gz", "7z"].includes(ext)) {
    return <FileArchive className="w-8 h-8 text-purple-500" />;
  }
  if (["json", "js", "ts", "html", "css", "py"].includes(ext)) {
    return <FileCode className="w-8 h-8 text-cyan-500" />;
  }
  return <Paperclip className="w-8 h-8 text-primary" />;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
}

export default function FileUploadDialog({ open, onOpenChange, onInsert }: Props) {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [customLabel, setCustomLabel] = useState("");
  const [uploading, setUploading] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const handleSelectFile = (file: File) => {
    setSelectedFile(file);
    if (!customLabel.trim()) {
      setCustomLabel(file.name);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleSelectFile(e.dataTransfer.files[0]);
    }
  };

  const handleUploadAndInsert = async () => {
    if (!selectedFile) return;
    setUploading(true);
    try {
      const res = await uploadFile(selectedFile);
      const label = customLabel.trim() || selectedFile.name;
      // Generate standard Markdown link that opens in new tab
      const link = `[${label}](${res.url})`;
      onInsert(link);
      toast.success("Dosya başarıyla yüklendi ve nota eklendi");
      setSelectedFile(null);
      setCustomLabel("");
      onOpenChange(false);
    } catch (err: any) {
      toast.error(err?.response?.data?.detail || err.message || "Dosya yüklenirken hata oluştu");
    } finally {
      setUploading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md bg-card border-border rounded-lg" data-testid="file-upload-dialog">
        <DialogHeader>
          <DialogTitle className="font-serif text-lg flex items-center gap-2">
            <FileUp className="w-5 h-5 text-primary" />
            <span>Dosya / Belge Yükle</span>
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Dropzone Area */}
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setIsDragOver(true);
            }}
            onDragLeave={() => setIsDragOver(false)}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
            className={`border-2 border-dashed rounded-lg p-6 flex flex-col items-center justify-center gap-2.5 text-center cursor-pointer transition-all ${
              isDragOver
                ? "border-primary bg-primary/10 scale-[0.99]"
                : "border-border hover:border-primary/50 hover:bg-muted/40"
            }`}
          >
            <input
              ref={fileInputRef}
              type="file"
              onChange={(e) => e.target.files?.[0] && handleSelectFile(e.target.files[0])}
              className="hidden"
            />

            {selectedFile ? (
              <div className="flex flex-col items-center gap-2">
                {getFileIcon(selectedFile.name)}
                <span className="text-xs font-semibold text-foreground max-w-xs truncate">
                  {selectedFile.name}
                </span>
                <span className="text-[11px] font-mono text-muted-foreground">
                  {formatBytes(selectedFile.size)}
                </span>
                <span className="text-[10px] text-primary underline">Farklı dosya seç</span>
              </div>
            ) : (
              <>
                <div className="w-12 h-12 rounded-full bg-secondary flex items-center justify-center text-primary">
                  <Paperclip className="w-6 h-6" />
                </div>
                <div className="space-y-1">
                  <p className="text-xs font-medium text-foreground">
                    Dosyayı buraya sürükleyin veya <span className="text-primary underline">seçin</span>
                  </p>
                  <p className="text-[11px] text-muted-foreground">
                    PDF, TXT, DOCX, XLSX, MP4, MP3, ZIP vb. tüm yaygın formatlar
                  </p>
                </div>
              </>
            )}
          </div>

          {/* Custom Label Input */}
          {selectedFile && (
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-foreground/80">
                Bağlantı Başlığı (İsteğe Bağlı)
              </label>
              <input
                type="text"
                value={customLabel}
                onChange={(e) => setCustomLabel(e.target.value)}
                placeholder="Not içinde görünecek bağlantı metni"
                className="w-full text-xs bg-background border border-border rounded px-3 py-2 text-foreground outline-none focus:border-primary"
              />
            </div>
          )}
        </div>

        <DialogFooter className="flex items-center justify-between gap-2 pt-2 border-t border-border/60">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => onOpenChange(false)}
            disabled={uploading}
          >
            İptal
          </Button>

          <Button
            type="button"
            size="sm"
            onClick={handleUploadAndInsert}
            disabled={!selectedFile || uploading}
            className="gap-1.5 cursor-pointer"
            data-testid="file-upload-confirm-btn"
          >
            {uploading ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                <span>Yükleniyor...</span>
              </>
            ) : (
              <>
                <Check className="w-3.5 h-3.5" />
                <span>Nota Ekle</span>
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
