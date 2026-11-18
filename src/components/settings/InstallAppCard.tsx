import React from "react";
import { CheckCircle2, Download, Share, Smartphone, SquarePlus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { usePwaInstall } from "@/lib/pwa";

/** Settings card: install Inkwell as an app (or how to on iOS). */
export default function InstallAppCard() {
  const { canInstall, installed, ios, install } = usePwaInstall();

  const onInstall = async () => {
    const outcome = await install();
    if (outcome === "accepted") toast.success("Inkwell uygulama olarak yüklendi");
  };

  return (
    <div className="border-t border-border/60 pt-6" data-testid="install-app-card">
      <h3 className="text-sm font-semibold flex items-center gap-2">
        <Smartphone className="w-4 h-4 text-primary" strokeWidth={1.5} /> Uygulama olarak kullan
      </h3>
      <p className="text-xs text-muted-foreground mt-1 max-w-xl">
        Inkwell'i bilgisayarına veya telefonuna yükleyerek kendi penceresinde, ana ekrandan açabilirsin. Notların yine
        sunucuda kalır; uygulama yalnızca arayüzü cihazına kaydeder.
      </p>

      <div className="mt-3">
        {installed ? (
          <div className="inline-flex items-center gap-2 text-xs text-emerald-600 dark:text-emerald-400">
            <CheckCircle2 className="w-4 h-4" /> Inkwell bu cihazda uygulama olarak açık.
          </div>
        ) : canInstall ? (
          <Button size="sm" onClick={onInstall} data-testid="install-app-btn">
            <Download className="w-3.5 h-3.5 mr-1.5" /> Uygulamayı yükle
          </Button>
        ) : ios ? (
          <div className="text-xs text-muted-foreground space-y-1" data-testid="install-ios-hint">
            <div className="flex items-center gap-1.5">
              1. Safari'de <Share className="w-3.5 h-3.5 inline" /> <strong>Paylaş</strong> düğmesine dokun.
            </div>
            <div className="flex items-center gap-1.5">
              2. <SquarePlus className="w-3.5 h-3.5 inline" /> <strong>Ana Ekrana Ekle</strong>'yi seç.
            </div>
          </div>
        ) : (
          <div className="text-xs text-muted-foreground" data-testid="install-unavailable-hint">
            Tarayıcın şu an yükleme önermiyor. Chrome veya Edge'de adres çubuğundaki yükle simgesini ya da menüdeki
            "Uygulamayı yükle" seçeneğini kullanabilirsin.
          </div>
        )}
      </div>
    </div>
  );
}
