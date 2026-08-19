import React, { useState, useRef } from "react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Image as ImageIcon, Upload, Loader2 } from "lucide-react";
import { uploadImage } from "@/lib/uploads";
import { toast } from "sonner";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onConfirm: (markdown: string) => void;
}

const WIDTH_PRESETS = [
  { label: "Küçük (200w)", value: "200w" },
  { label: "Orta (350w)", value: "350w" },
  { label: "Geniş (500w)", value: "500w" },
  { label: "Tam (%100)", value: "100%" },
];

export default function ImageUploadDialog({ open, onOpenChange, onConfirm }: Props) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [altText, setAltText] = useState("");
  const [width, setWidth] = useState("350w");
  const [uploading, setUploading] = useState(false);

  const reset = () => {
    setSelectedFile(null);
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(null);
    setAltText("");
    setWidth("350w");
    setUploading(false);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast.error("Lütfen bir resim dosyası seçin (PNG, JPG, WebP, GIF vb.)");
      return;
    }
    setSelectedFile(file);
    setPreviewUrl(URL.createObjectURL(file));
    if (!altText) {
      // Set filename without extension as default alt
      const name = file.name.replace(/\.[^/.]+$/, "");
      setAltText(name);
    }
  };

  const handleConfirm = async () => {
    if (!selectedFile) {
      toast.error("Lütfen bir resim dosyası seçin.");
      return;
    }

    try {
      setUploading(true);
      const res = await uploadImage(selectedFile);
      
      const widthTag = width.trim() ? ` | ${width.trim()}` : "";
      const altPart = altText.trim() ? `${altText.trim()}${widthTag}` : widthTag ? widthTag.trim() : "";
      const markdown = `![${altPart}](${res.url})`;
      
      onConfirm(markdown);
      toast.success("Resim başarıyla yüklendi");
      onOpenChange(false);
      reset();
    } catch (err: any) {
      toast.error("Resim yüklenirken bir hata oluştu");
    } finally {
      setUploading(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) reset();
        onOpenChange(v);
      }}
    >
      <DialogContent className="max-w-md bg-card border-border rounded-lg" data-testid="image-upload-dialog">
        <DialogHeader>
          <DialogTitle className="font-serif text-2xl flex items-center gap-2">
            <ImageIcon className="w-4 h-4 text-primary" strokeWidth={1.5} /> Resim Yükle
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 pt-1">
          {/* File Picker / Drop Zone */}
          <input
            type="file"
            accept="image/*"
            ref={fileInputRef}
            onChange={handleFileChange}
            className="hidden"
          />

          {!previewUrl ? (
            <div
              onClick={() => fileInputRef.current?.click()}
              className="border-2 border-dashed border-border hover:border-primary/60 hover:bg-muted/40 rounded-lg p-6 text-center cursor-pointer transition-all flex flex-col items-center justify-center gap-2"
            >
              <div className="w-10 h-10 rounded-full bg-secondary flex items-center justify-center text-muted-foreground">
                <Upload className="w-5 h-5" />
              </div>
              <p className="text-sm font-medium text-foreground">Bilgisayarınızdan Resim Seçin</p>
              <p className="text-xs text-muted-foreground">PNG, JPG, WebP veya GIF (Maksimum 10MB)</p>
            </div>
          ) : (
            <div className="space-y-2">
              <div className="relative rounded-lg overflow-hidden border border-border bg-secondary/30 max-h-48 flex items-center justify-center p-2">
                <img
                  src={previewUrl}
                  alt="Önizleme"
                  className="max-h-44 object-contain rounded"
                />
              </div>
              <div className="flex justify-between items-center text-xs text-muted-foreground px-1">
                <span className="truncate max-w-[200px]">{selectedFile?.name}</span>
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="text-primary hover:underline font-medium cursor-pointer"
                >
                  Değiştir
                </button>
              </div>
            </div>
          )}

          {/* Width Selection & Presets */}
          <div>
            <label className="text-[10px] tracking-[0.25em] uppercase text-muted-foreground block mb-1">
              Genişlik (Width)
            </label>
            <div className="grid grid-cols-4 gap-1.5 mb-2">
              {WIDTH_PRESETS.map((p) => (
                <button
                  key={p.value}
                  type="button"
                  onClick={() => setWidth(p.value)}
                  className={`py-1 px-1.5 text-xs rounded border transition-all text-center ${
                    width === p.value
                      ? "border-primary bg-primary/10 text-foreground font-semibold"
                      : "border-border hover:bg-muted text-muted-foreground"
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>
            <Input
              value={width}
              onChange={(e) => setWidth(e.target.value)}
              placeholder="Örn: 200w, 300px veya 50%"
              className="font-mono text-xs rounded-md"
              data-testid="image-width-input"
            />
          </div>

          {/* Alt / Caption Text */}
          <div>
            <label className="text-[10px] tracking-[0.25em] uppercase text-muted-foreground block mb-1">
              Açıklama / Başlık (Opsiyonel)
            </label>
            <Input
              value={altText}
              onChange={(e) => setAltText(e.target.value)}
              placeholder="Görsel açıklaması..."
              className="text-xs rounded-md"
              data-testid="image-alt-input"
            />
          </div>
        </div>

        <DialogFooter className="mt-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={uploading}>
            İptal
          </Button>
          <Button
            onClick={handleConfirm}
            disabled={!selectedFile || uploading}
            className="bg-foreground text-background hover:bg-foreground/90 rounded-md gap-2"
            data-testid="image-upload-confirm-btn"
          >
            {uploading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" /> Yükleniyor…
              </>
            ) : (
              "Nota Ekle"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
