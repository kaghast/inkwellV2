import React from "react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  Settings,
  CheckSquare,
  ListFilter,
  Volume2,
  Globe,
  BellRing,
  Pin,
  Image as ImageIcon,
  Check,
} from "lucide-react";
import { useSettings, NoteDefaultFilter, SearchScope } from "@/contexts/SettingsContext";
import { toast } from "sonner";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}

const FILTER_OPTIONS: { id: NoteDefaultFilter; label: string; desc: string; icon: any }[] = [
  {
    id: "all",
    label: "Tüm Notlar",
    desc: "Tüm notları standart olarak listele",
    icon: ListFilter,
  },
  {
    id: "incomplete_tasks",
    label: "Tamamlanmamış Görevler",
    desc: "Sadece yapılacak (tamamlanmamış) görev içeren notları filtrele",
    icon: CheckSquare,
  },
  {
    id: "completed_tasks",
    label: "Tamamlanmış Görevler",
    desc: "Sadece tamamlanmış görev içeren notları filtrele",
    icon: Check,
  },
  {
    id: "with_reminders",
    label: "Hatırlatmalı Notlar",
    desc: "Sadece aktif hatırlatması olan notları filtrele",
    icon: BellRing,
  },
  {
    id: "pinned_only",
    label: "Sabitlenmiş Notlar",
    desc: "Sadece panoya sabitlenen önemli notları göster",
    icon: Pin,
  },
  {
    id: "with_images",
    label: "Görsel İçeren Notlar",
    desc: "Sadece resim eklenmiş notları göster",
    icon: ImageIcon,
  },
];

export default function SettingsDialog({ open, onOpenChange }: Props) {
  const { settings, updateSettings, resetSettings } = useSettings();

  const handleFilterChange = (filter: NoteDefaultFilter) => {
    updateSettings({ defaultFilter: filter });
    const selected = FILTER_OPTIONS.find((f) => f.id === filter);
    toast.success(`Varsayılan filtre: ${selected?.label}`);
  };

  const handleScopeChange = (scope: SearchScope) => {
    updateSettings({ searchScope: scope });
    toast.success(`Arama kapsamı: ${scope === "all_time" ? "Tüm Zamanlar" : "Seçili Gün"}`);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-lg bg-card border-border rounded-xl shadow-2xl p-6 select-none"
        data-testid="settings-dialog"
      >
        <DialogHeader>
          <DialogTitle className="font-serif text-2xl flex items-center gap-2.5">
            <Settings className="w-5 h-5 text-primary" strokeWidth={1.5} /> Uygulama & Filtre Ayarları
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-6 pt-2 max-h-[70vh] overflow-y-auto pr-1">
          {/* Default Note Filter */}
          <div>
            <label className="text-[11px] font-semibold tracking-[0.2em] uppercase text-muted-foreground block mb-2">
              Varsayılan Not Filtresi
            </label>
            <p className="text-xs text-muted-foreground mb-3">
              Not listeniz açıldığında veya arama yapıldığında uygulanacak varsayılan filtre:
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {FILTER_OPTIONS.map((opt) => {
                const Icon = opt.icon;
                const active = settings.defaultFilter === opt.id;
                return (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => handleFilterChange(opt.id)}
                    className={`p-3 rounded-lg border text-left transition-all flex items-start gap-2.5 cursor-pointer ${
                      active
                        ? "border-primary bg-primary/10 text-foreground ring-1 ring-primary/40 shadow-xs"
                        : "border-border hover:bg-muted/50 text-muted-foreground hover:text-foreground"
                    }`}
                    data-testid={`settings-filter-opt-${opt.id}`}
                  >
                    <Icon className={`w-4 h-4 mt-0.5 shrink-0 ${active ? "text-primary" : "text-muted-foreground"}`} />
                    <div className="min-w-0 flex-1">
                      <div className="text-xs font-semibold leading-tight">{opt.label}</div>
                      <div className="text-[10px] text-muted-foreground mt-0.5 line-clamp-2 leading-relaxed">
                        {opt.desc}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Search Scope */}
          <div className="border-t border-border/60 pt-4">
            <label className="text-[11px] font-semibold tracking-[0.2em] uppercase text-muted-foreground block mb-2 flex items-center gap-1.5">
              <Globe className="w-3.5 h-3.5" /> Genel Arama Kapsamı
            </label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => handleScopeChange("all_time")}
                className={`py-2 px-3 rounded-lg border text-xs font-medium transition-all text-center cursor-pointer ${
                  settings.searchScope === "all_time"
                    ? "border-primary bg-primary/10 text-foreground font-semibold"
                    : "border-border hover:bg-muted text-muted-foreground"
                }`}
                data-testid="settings-scope-all-time"
              >
                Tüm Zamanlar (Genel Arama)
              </button>
              <button
                type="button"
                onClick={() => handleScopeChange("selected_day")}
                className={`py-2 px-3 rounded-lg border text-xs font-medium transition-all text-center cursor-pointer ${
                  settings.searchScope === "selected_day"
                    ? "border-primary bg-primary/10 text-foreground font-semibold"
                    : "border-border hover:bg-muted text-muted-foreground"
                }`}
                data-testid="settings-scope-selected-day"
              >
                Yalnızca Seçili Gün
              </button>
            </div>
          </div>

          {/* Sound & Notification */}
          <div className="border-t border-border/60 pt-4">
            <label className="text-[11px] font-semibold tracking-[0.2em] uppercase text-muted-foreground block mb-2 flex items-center gap-1.5">
              <Volume2 className="w-3.5 h-3.5" /> Bildirim & Ses Tercihleri
            </label>
            <label className="flex items-center gap-3 p-2.5 rounded-lg border border-border hover:bg-muted/40 cursor-pointer">
              <input
                type="checkbox"
                checked={settings.soundEnabled}
                onChange={(e) => updateSettings({ soundEnabled: e.target.checked })}
                className="rounded border-border accent-primary h-4 w-4"
                data-testid="settings-sound-toggle"
              />
              <div className="text-xs">
                <span className="font-medium text-foreground block">Hatırlatma bildirim seslerini çal</span>
                <span className="text-[10px] text-muted-foreground">Hatırlatma zamanı geldiğinde hafif bir zil sesi çalar</span>
              </div>
            </label>
          </div>
        </div>

        <DialogFooter className="mt-4 pt-3 border-t border-border flex items-center justify-between">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              resetSettings();
              toast.info("Ayarlar varsayılana sıfırlandı");
            }}
            className="text-xs text-muted-foreground hover:text-destructive"
          >
            Varsayılana Sıfırla
          </Button>
          <Button
            onClick={() => onOpenChange(false)}
            className="bg-foreground text-background hover:bg-foreground/90 rounded-md text-xs"
            data-testid="settings-close-btn"
          >
            Tamam
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
