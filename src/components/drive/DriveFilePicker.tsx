import React, { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Check, HardDrive, Loader2, Search, AlertTriangle, ExternalLink } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { formatApiError } from "@/lib/api";
import {
  connectGoogleDrive,
  driveKindLabel,
  GdriveReconnectRequired,
  searchDriveFiles,
  toDriveRef,
  useGdriveStatus,
  type DriveSearchFile,
} from "@/lib/googleDrive";
import type { DriveFileRef } from "@/types";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Files already linked to the note (shown as selected, not added twice). */
  linkedIds?: string[];
  onPick: (files: DriveFileRef[]) => void;
}

function fmtModified(iso: string | null): string {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleDateString("tr-TR", { day: "numeric", month: "short", year: "numeric" });
  } catch {
    return "";
  }
}

/** Searches the user's Google Drive and returns the chosen files. */
export default function DriveFilePicker({ open, onOpenChange, linkedIds = [], onPick }: Props) {
  const { status } = useGdriveStatus();
  const [q, setQ] = useState("");
  const [files, setFiles] = useState<DriveSearchFile[]>([]);
  const [nextToken, setNextToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Map<string, DriveSearchFile>>(new Map());
  const [connecting, setConnecting] = useState(false);
  const requestId = useRef(0);

  const connected = Boolean(status?.connected);

  // Fresh state every time the dialog opens
  useEffect(() => {
    if (open) {
      setQ("");
      setSelected(new Map());
      setError(null);
    }
  }, [open]);

  // Debounced search
  useEffect(() => {
    if (!open || !connected) return;
    const id = ++requestId.current;
    setLoading(true);
    const t = window.setTimeout(async () => {
      try {
        const res = await searchDriveFiles(q.trim());
        if (id !== requestId.current) return;
        setFiles(res.files);
        setNextToken(res.next_page_token);
        setError(null);
      } catch (err) {
        if (id !== requestId.current) return;
        setFiles([]);
        setNextToken(null);
        setError(err instanceof GdriveReconnectRequired ? err.message : formatApiError(err) || "Drive araması başarısız");
      } finally {
        if (id === requestId.current) setLoading(false);
      }
    }, q ? 350 : 0);
    return () => window.clearTimeout(t);
  }, [q, open, connected]);

  async function loadMore() {
    if (!nextToken) return;
    setLoadingMore(true);
    try {
      const res = await searchDriveFiles(q.trim(), nextToken);
      setFiles((prev) => [...prev, ...res.files.filter((f) => !prev.some((p) => p.id === f.id))]);
      setNextToken(res.next_page_token);
    } catch (err) {
      toast.error(formatApiError(err) || "Daha fazla dosya alınamadı");
    } finally {
      setLoadingMore(false);
    }
  }

  async function connect() {
    setConnecting(true);
    try {
      await connectGoogleDrive();
      toast.success("Google Drive bağlandı");
    } catch (err) {
      toast.error(formatApiError(err) || "Google Drive bağlantısı kurulamadı");
    } finally {
      setConnecting(false);
    }
  }

  function toggle(f: DriveSearchFile) {
    if (linkedIds.includes(f.id)) return;
    setSelected((prev) => {
      const next = new Map(prev);
      if (next.has(f.id)) next.delete(f.id);
      else next.set(f.id, f);
      return next;
    });
  }

  function confirm() {
    onPick(Array.from(selected.values()).map(toDriveRef));
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-card border-border max-w-lg" data-testid="drive-picker">
        <DialogHeader>
          <DialogTitle className="font-serif flex items-center gap-2">
            <HardDrive className="w-4 h-4 text-emerald-500" /> Drive'dan dosya seç
          </DialogTitle>
          <DialogDescription>Seçtiğin dosyalar notla ilişkilendirilir; dosyanın kendisi Drive'da kalır.</DialogDescription>
        </DialogHeader>

        {!status ? (
          <div className="flex items-center gap-2 text-xs text-muted-foreground py-6 justify-center">
            <Loader2 className="w-4 h-4 animate-spin" /> Bağlantı kontrol ediliyor...
          </div>
        ) : !connected ? (
          <div className="py-4 space-y-3 text-center">
            <p className="text-xs text-muted-foreground">
              {status.configured
                ? "Drive'da arama yapabilmek için önce Google Drive erişimine izin vermelisin."
                : "Google entegrasyonu sunucuda yapılandırılmamış."}
            </p>
            {status.configured && (
              <div className="flex items-center justify-center gap-2">
                <Button size="sm" onClick={connect} disabled={connecting} className="bg-emerald-600 hover:bg-emerald-700 text-white">
                  {connecting ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <HardDrive className="w-3.5 h-3.5 mr-1.5" />}
                  Google Drive'ı bağla
                </Button>
                <Link to="/settings?tab=drive" className="text-xs text-muted-foreground underline hover:text-foreground">
                  Ayarlar
                </Link>
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-2">
            <div className="flex items-center gap-2 border border-border rounded-md px-2.5 py-1.5 bg-background">
              <Search className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Dosya adıyla ara..."
                className="flex-1 bg-transparent text-sm outline-none min-w-0"
                autoFocus
                data-testid="drive-picker-search"
              />
              {loading && <Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground shrink-0" />}
            </div>
            {!q && <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-mono">Son değişen dosyalar</div>}

            <div className="max-h-[50vh] overflow-y-auto -mx-1 px-1 space-y-0.5" data-testid="drive-picker-results">
              {error ? (
                <div className="flex items-start gap-2 text-xs text-amber-700 dark:text-amber-300 p-3 rounded border border-amber-500/40 bg-amber-500/10">
                  <AlertTriangle className="w-4 h-4 shrink-0" />
                  <span>{error}</span>
                </div>
              ) : !loading && files.length === 0 ? (
                <div className="text-xs text-muted-foreground text-center py-8">
                  {q ? `"${q}" ile eşleşen dosya bulunamadı` : "Drive'ında dosya bulunamadı"}
                </div>
              ) : (
                files.map((f) => {
                  const linked = linkedIds.includes(f.id);
                  const isSel = selected.has(f.id) || linked;
                  return (
                    <div
                      key={f.id}
                      role="option"
                      aria-selected={isSel}
                      tabIndex={0}
                      onClick={() => toggle(f)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          toggle(f);
                        }
                      }}
                      className={`flex items-center gap-2.5 px-2 py-1.5 rounded-md text-sm transition-colors ${
                        linked ? "opacity-60 cursor-default" : "cursor-pointer hover:bg-muted/70"
                      } ${isSel && !linked ? "bg-emerald-500/10" : ""}`}
                      data-testid={`drive-picker-item-${f.id}`}
                    >
                      <span
                        className={`w-4 h-4 rounded-sm border flex items-center justify-center shrink-0 ${
                          isSel ? "bg-emerald-600 border-emerald-600" : "border-border"
                        }`}
                      >
                        {isSel && <Check className="w-3 h-3 text-white" strokeWidth={3} />}
                      </span>
                      {f.icon_link ? (
                        <img src={f.icon_link} alt="" className="w-4 h-4 shrink-0" referrerPolicy="no-referrer" />
                      ) : (
                        <HardDrive className="w-4 h-4 shrink-0 text-muted-foreground" />
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-foreground">{f.name}</div>
                        <div className="text-[11px] text-muted-foreground truncate">
                          {driveKindLabel(f.mime_type)}
                          {f.modified_time ? ` · ${fmtModified(f.modified_time)}` : ""}
                          {f.owner ? ` · ${f.owner}` : ""}
                          {linked ? " · Zaten bağlı" : ""}
                        </div>
                      </div>
                      {f.web_view_link && (
                        <a
                          href={f.web_view_link}
                          target="_blank"
                          rel="noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          className="p-1 text-muted-foreground hover:text-foreground shrink-0"
                          title="Drive'da aç"
                        >
                          <ExternalLink className="w-3.5 h-3.5" />
                        </a>
                      )}
                    </div>
                  );
                })
              )}
              {nextToken && !error && (
                <button
                  type="button"
                  onClick={loadMore}
                  disabled={loadingMore}
                  className="w-full text-xs text-muted-foreground hover:text-foreground py-2 cursor-pointer"
                >
                  {loadingMore ? "Yükleniyor..." : "Daha fazla göster"}
                </button>
              )}
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
            Vazgeç
          </Button>
          <Button size="sm" onClick={confirm} disabled={selected.size === 0} data-testid="drive-picker-confirm">
            {selected.size > 0 ? `${selected.size} dosyayı bağla` : "Dosya seç"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
