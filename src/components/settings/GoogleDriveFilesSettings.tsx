import React, { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { CheckCircle2, Link2Off, Loader2, ShieldCheck, AlertTriangle, HardDrive } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { formatApiError } from "@/lib/api";
import { connectGoogleDrive, disconnectGoogleDrive, useGdriveStatus } from "@/lib/googleDrive";

function fmtDate(iso: string | null): string {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleString("tr-TR", { dateStyle: "medium", timeStyle: "short" });
  } catch {
    return iso;
  }
}

/** Settings > Google Drive: allow searching Drive and linking its files to notes. */
export default function GoogleDriveFilesSettings() {
  const { status, refresh } = useGdriveStatus();
  const [busy, setBusy] = useState<"connect" | "disconnect" | null>(null);
  const [searchParams, setSearchParams] = useSearchParams();
  const handledResult = useRef(false);

  // Result of the no-popup fallback (?gdrive=connected|error)
  useEffect(() => {
    const result = searchParams.get("gdrive");
    if (!result || handledResult.current) return;
    handledResult.current = true;
    if (result === "connected") toast.success("Google Drive bağlandı");
    else toast.error("Google Drive bağlantısı kurulamadı");
    refresh().catch(() => undefined);
    const next = new URLSearchParams(searchParams);
    next.delete("gdrive");
    setSearchParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const connect = async () => {
    setBusy("connect");
    try {
      const s = await connectGoogleDrive();
      toast.success(`Google Drive bağlandı${s.email ? ` (${s.email})` : ""}`);
    } catch (err) {
      toast.error(formatApiError(err) || "Google Drive bağlantısı kurulamadı");
    } finally {
      setBusy(null);
    }
  };

  const disconnect = async () => {
    setBusy("disconnect");
    try {
      await disconnectGoogleDrive();
      toast.success("Google Drive bağlantısı kaldırıldı");
    } catch (err) {
      toast.error(formatApiError(err) || "Bağlantı kaldırılamadı");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-4" data-testid="settings-gdrive-files">
      <div>
        <h3 className="font-serif text-xl tracking-tight flex items-center gap-2">
          <HardDrive className="w-5 h-5 text-emerald-500" strokeWidth={1.5} /> Notlara Drive dosyası bağlama
        </h3>
        <p className="text-xs text-muted-foreground mt-1 max-w-xl">
          İzin verdiğinde not eklerken veya bir notu açtığında Drive'ında arama yapıp dosya seçebilir, notu o dosyayla
          ilişkilendirebilirsin. Bir kez bağlanman yeterli.
        </p>
      </div>

      {!status ? (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="w-4 h-4 animate-spin" /> Bağlantı durumu kontrol ediliyor...
        </div>
      ) : !status.configured ? (
        <div className="p-4 rounded-lg border border-amber-500/40 bg-amber-500/10 text-xs text-amber-800 dark:text-amber-300 flex gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>
            Google entegrasyonu sunucuda yapılandırılmamış. Yöneticinin <code>GOOGLE_CLIENT_ID</code> ve{" "}
            <code>GOOGLE_CLIENT_SECRET</code> değişkenlerini tanımlaması gerekiyor.
          </span>
        </div>
      ) : status.connected ? (
        <div className="p-4 rounded-lg border border-emerald-500/40 bg-emerald-500/5 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-start gap-3 min-w-0">
            <CheckCircle2 className="w-5 h-5 text-emerald-500 shrink-0 mt-0.5" />
            <div className="min-w-0">
              <div className="text-sm font-semibold text-foreground">Google Drive bağlı</div>
              <div className="text-xs text-muted-foreground truncate" data-testid="gdrive-email">
                {status.email || "Google hesabı"}
                {status.connected_at ? ` · ${fmtDate(status.connected_at)} tarihinden beri` : ""}
              </div>
            </div>
          </div>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                disabled={busy !== null}
                className="text-red-600 dark:text-red-400 border-red-500/50 hover:bg-red-500/10 hover:text-red-700 dark:hover:text-red-300"
                data-testid="gdrive-disconnect-btn"
              >
                {busy === "disconnect" ? (
                  <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                ) : (
                  <Link2Off className="w-3.5 h-3.5 mr-1.5" />
                )}
                Bağlantıyı kaldır
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent className="bg-card border-border">
              <AlertDialogHeader>
                <AlertDialogTitle className="font-serif">Google Drive bağlantısı kaldırılsın mı?</AlertDialogTitle>
                <AlertDialogDescription>
                  Drive'da arama ve dosya seçme kapanır. Notlara bağladığın dosya bağlantıları silinmez. Google Takvim de
                  bağlı değilse Inkwell'in Google erişimi Google tarafında da iptal edilir.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Vazgeç</AlertDialogCancel>
                <AlertDialogAction onClick={disconnect} className="bg-destructive text-destructive-foreground">
                  Bağlantıyı kaldır
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      ) : (
        <div className="p-4 rounded-lg border border-border bg-muted/30 flex flex-wrap items-center justify-between gap-3">
          <div className="text-xs text-muted-foreground max-w-md">
            Google hesabınla giriş yap ve Drive dosya bilgilerini görme iznini onayla.
          </div>
          <Button
            onClick={connect}
            disabled={busy !== null}
            size="sm"
            className="bg-emerald-600 hover:bg-emerald-700 text-white"
            data-testid="gdrive-connect-btn"
          >
            {busy === "connect" ? (
              <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
            ) : (
              <HardDrive className="w-3.5 h-3.5 mr-1.5" />
            )}
            Google Drive'ı bağla
          </Button>
        </div>
      )}

      <ul className="text-[11px] text-muted-foreground space-y-1.5 max-w-xl">
        <li className="flex gap-2">
          <ShieldCheck className="w-3.5 h-3.5 shrink-0 text-emerald-500" />
          İzin yalnızca dosya adlarını, türlerini ve bağlantılarını görmek içindir; Inkwell dosya içeriklerini okuyamaz ve
          Drive'ında değişiklik yapamaz.
        </li>
        <li className="flex gap-2">
          <ShieldCheck className="w-3.5 h-3.5 shrink-0 text-emerald-500" />
          Erişim anahtarı sunucuda şifreli saklanır; Google Takvim ile aynı Google bağlantısını kullanır.
        </li>
      </ul>
    </div>
  );
}
