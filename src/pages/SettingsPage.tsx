import React, { useState, useEffect } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import {
  Feather,
  ArrowLeft,
  Sliders,
  Cloud,
  ArrowDownUp,
  UserCheck,
  Check,
  Download,
  Upload,
  RefreshCw,
  Trash2,
  ExternalLink,
  CheckCircle2,
  AlertCircle,
  HardDrive,
  Calendar,
  Clock,
  Sparkles,
  FileText,
  Hash,
  Users,
  MapPin,
  Folder,
  Sun,
  Moon,
  Volume2,
  Globe,
  ListFilter,
  CheckSquare,
  BellRing,
  Pin,
  Image as ImageIcon,
  LogOut,
  Layers,
  FileDown,
  FileUp,
  ShieldCheck,
  CheckCheck,
  Boxes,
} from "lucide-react";
import NoteTypeManager from "@/components/NoteTypeManager";
import { useAuth } from "@/contexts/AuthContext";
import { useTheme } from "@/contexts/ThemeContext";
import { useSettings, NoteDefaultFilter, SearchScope } from "@/contexts/SettingsContext";
import { Button } from "@/components/ui/button";
import api, { formatApiError } from "@/lib/api";
import {
  connectGoogleDrive,
  getDriveAccessToken,
  getFirebaseUser,
  disconnectGoogleDrive,
} from "@/lib/firebase";
import {
  uploadBackupToDrive,
  uploadMarkdownSummaryToDrive,
  listDriveBackups,
  downloadBackupFromDrive,
  deleteBackupFromDrive,
  DriveBackupFile,
} from "@/lib/drive";
import { toast } from "sonner";
import type { User } from "@/types";

type SettingsTab = "appearance" | "note_types" | "drive" | "export_import" | "account";

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

export default function SettingsPage() {
  const { user, logout } = useAuth();
  const { theme, toggle } = useTheme();
  const { settings, updateSettings, resetSettings } = useSettings();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const tabParam = (searchParams.get("tab") as SettingsTab) || "appearance";
  const [activeTab, setActiveTab] = useState<SettingsTab>(tabParam);

  // Google Drive state
  const [isConnectingDrive, setIsConnectingDrive] = useState(false);
  const [driveToken, setDriveToken] = useState<string | null>(getDriveAccessToken());
  const [driveUser, setDriveUser] = useState(getFirebaseUser());
  const [driveBackups, setDriveBackups] = useState<DriveBackupFile[]>([]);
  const [loadingBackups, setLoadingBackups] = useState(false);
  const [isExportingDrive, setIsExportingDrive] = useState(false);
  const [isImportingDrive, setIsImportingDrive] = useState(false);

  // Local Export/Import state
  const [isExportingLocal, setIsExportingLocal] = useState(false);
  const [isImportingLocal, setIsImportingLocal] = useState(false);

  // System Stats
  const [stats, setStats] = useState<any>(null);
  const [loadingStats, setLoadingStats] = useState(false);

  const u = user as User | false | null;

  // Sync url param
  const handleTabChange = (tab: SettingsTab) => {
    setActiveTab(tab);
    setSearchParams({ tab });
  };

  // Fetch drive backups if token exists
  const refreshDriveBackups = async (token?: string) => {
    const activeTok = token || driveToken || getDriveAccessToken();
    if (!activeTok) return;
    setLoadingBackups(true);
    try {
      const files = await listDriveBackups(activeTok);
      setDriveBackups(files);
    } catch (err: any) {
      console.warn("Drive backups fetch warning:", err);
    } finally {
      setLoadingBackups(false);
    }
  };

  // Fetch account stats
  const fetchStats = async () => {
    setLoadingStats(true);
    try {
      const { data } = await api.get("/backup/export");
      if (data && data.stats) {
        setStats(data.stats);
      }
    } catch (err) {
      /* ignore */
    } finally {
      setLoadingStats(false);
    }
  };

  useEffect(() => {
    const currentTok = getDriveAccessToken();
    if (currentTok) {
      setDriveToken(currentTok);
      setDriveUser(getFirebaseUser());
      refreshDriveBackups(currentTok);
    }
    fetchStats();
  }, []);

  // Connect Google Drive
  const handleConnectDrive = async () => {
    setIsConnectingDrive(true);
    try {
      const { user: fUser, accessToken } = await connectGoogleDrive();
      setDriveToken(accessToken);
      setDriveUser(fUser);
      toast.success(`Google Drive bağlandı (${fUser.email})`);
      await refreshDriveBackups(accessToken);
    } catch (err: any) {
      toast.error(err.message || "Google Drive bağlantısı kurulamadı");
    } finally {
      setIsConnectingDrive(false);
    }
  };

  // Disconnect Google Drive
  const handleDisconnectDrive = async () => {
    await disconnectGoogleDrive();
    setDriveToken(null);
    setDriveUser(null);
    setDriveBackups([]);
    toast.info("Google Drive bağlantısı kesildi");
  };

  // Export to Google Drive
  const handleExportToGoogleDrive = async (exportType: "json" | "markdown" = "json") => {
    let tok = driveToken || getDriveAccessToken();
    if (!tok) {
      try {
        const { accessToken } = await connectGoogleDrive();
        tok = accessToken;
        setDriveToken(accessToken);
        setDriveUser(getFirebaseUser());
      } catch (err: any) {
        toast.error("Yedekleme için önce Google Drive yetkilendirmesi yapmalısınız.");
        return;
      }
    }

    setIsExportingDrive(true);
    try {
      // 1. Fetch full backup data from backend
      const { data: backupData } = await api.get("/backup/export");

      if (exportType === "json") {
        const uploaded = await uploadBackupToDrive(tok, backupData);
        toast.success(`Yedek Google Drive'a kaydedildi: ${uploaded.name}`);
      } else {
        const notesList = backupData.data?.notes || [];
        const uploaded = await uploadMarkdownSummaryToDrive(tok, notesList);
        toast.success(`Markdown arşivi Google Drive'a kaydedildi: ${uploaded.name}`);
      }

      await refreshDriveBackups(tok);
      await fetchStats();
    } catch (err: any) {
      toast.error(err.message || "Google Drive'a yedekleme başarısız oldu");
    } finally {
      setIsExportingDrive(false);
    }
  };

  // Import from Google Drive File
  const handleImportFromGoogleDrive = async (file: DriveBackupFile, mode: "merge" | "replace" = "merge") => {
    const tok = driveToken || getDriveAccessToken();
    if (!tok) {
      toast.error("Google Drive oturumunuz aktif değil.");
      return;
    }

    const confirmMsg =
      mode === "replace"
        ? `DİKKAT: "${file.name}" dosyasını içe aktarıp mevcut verilerinizin üzerine yazmak istediğinize emin misiniz?`
        : `"${file.name}" dosyasındaki notları mevcut listenizle birleştirmek istiyor musunuz?`;

    if (!window.confirm(confirmMsg)) return;

    setIsImportingDrive(true);
    try {
      const backupData = await downloadBackupFromDrive(tok, file.id);
      const { data } = await api.post("/backup/import", { backup: backupData, mode });
      toast.success(data.message || "Yedek başarıyla geri yüklendi!");
      await fetchStats();
    } catch (err: any) {
      toast.error(err.message || "Google Drive'dan geri yükleme başarısız oldu");
    } finally {
      setIsImportingDrive(false);
    }
  };

  // Delete Backup File from Drive
  const handleDeleteDriveBackup = async (file: DriveBackupFile) => {
    const tok = driveToken || getDriveAccessToken();
    if (!tok) return;

    if (!window.confirm(`"${file.name}" yedek dosyası Google Drive'ınızdan silinsin mi?`)) return;

    try {
      await deleteBackupFromDrive(tok, file.id);
      toast.success("Yedek dosyası silindi");
      setDriveBackups((prev) => prev.filter((f) => f.id !== file.id));
    } catch (err: any) {
      toast.error(err.message || "Dosya silinemedi");
    }
  };

  // Local JSON Export
  const handleExportLocalJson = async () => {
    setIsExportingLocal(true);
    try {
      const { data } = await api.get("/backup/export");
      const jsonStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(data, null, 2));
      const downloadAnchor = document.createElement("a");
      downloadAnchor.setAttribute("href", jsonStr);
      const dateStr = new Date().toISOString().slice(0, 10);
      downloadAnchor.setAttribute("download", `inkwell_backup_${dateStr}.json`);
      document.body.appendChild(downloadAnchor);
      downloadAnchor.click();
      downloadAnchor.remove();
      toast.success("Yedek JSON dosyası bilgisayarınıza indirildi");
    } catch (err: any) {
      toast.error(formatApiError(err) || "Dışa aktarma başarısız oldu");
    } finally {
      setIsExportingLocal(false);
    }
  };

  // Local JSON Import
  const handleLocalFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (event) => {
      try {
        const text = event.target?.result as string;
        const parsed = JSON.parse(text);
        if (!parsed || !parsed.data) {
          throw new Error("Geçerli bir Inkwell yedekleme dosyası değil.");
        }

        const mode = window.confirm(
          "Yedek notları mevcut notlarınızla birleştirmek istiyor musunuz? (İptal derseniz mevcutların üstüne yazar)"
        )
          ? "merge"
          : "replace";

        setIsImportingLocal(true);
        const { data } = await api.post("/backup/import", { backup: parsed, mode });
        toast.success(data.message || "Yedek başarıyla yüklendi!");
        await fetchStats();
      } catch (err: any) {
        toast.error(err.message || "Dosya okunamadı veya format geçersiz");
      } finally {
        setIsImportingLocal(false);
        e.target.value = "";
      }
    };
    reader.readAsText(file);
  };

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col paper select-none" data-testid="settings-page">
      {/* Top Header Bar */}
      <header className="sticky top-0 z-30 h-14 border-b border-border bg-background/80 backdrop-blur-xl flex items-center justify-between px-4 lg:px-8">
        <div className="flex items-center gap-3">
          <Link
            to="/"
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground p-1.5 rounded-md hover:bg-muted transition-colors cursor-pointer"
            data-testid="settings-back-btn"
          >
            <ArrowLeft className="w-4 h-4" />
            <span className="font-medium">Notlara Dön</span>
          </Link>
          <div className="h-4 w-px bg-border/60 mx-1" />
          <div className="flex items-center gap-2">
            <Feather className="w-4 h-4 text-foreground" strokeWidth={1.5} />
            <h1 className="font-serif text-lg font-bold tracking-tight">Ayarlar & Yedekleme</h1>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {u && (
            <div className="flex items-center gap-2 text-xs font-mono text-muted-foreground bg-muted/50 px-2.5 py-1 rounded-md border border-border/50">
              <span className="w-2 h-2 rounded-full bg-emerald-500" />
              <span className="truncate max-w-[160px]">{u.email}</span>
            </div>
          )}
        </div>
      </header>

      {/* Main Settings Container */}
      <div className="flex-1 max-w-6xl w-full mx-auto p-4 lg:p-8 flex flex-col md:flex-row gap-6 items-start">
        {/* Left Sidebar Navigation Tabs */}
        <div className="w-full md:w-64 shrink-0 bg-card border border-border rounded-xl p-2 shadow-xs space-y-1">
          <button
            type="button"
            onClick={() => handleTabChange("appearance")}
            data-testid="settings-tab-appearance"
            className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-xs font-medium transition-all text-left cursor-pointer ${
              activeTab === "appearance"
                ? "bg-primary text-primary-foreground font-semibold shadow-xs"
                : "text-muted-foreground hover:text-foreground hover:bg-muted/70"
            }`}
          >
            <Sliders className="w-4 h-4 shrink-0" />
            <span className="truncate flex-1">Görünüm & Tercihler</span>
          </button>

          <button
            type="button"
            onClick={() => handleTabChange("note_types")}
            data-testid="settings-tab-note-types"
            className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-xs font-medium transition-all text-left cursor-pointer ${
              activeTab === "note_types"
                ? "bg-primary text-primary-foreground font-semibold shadow-xs"
                : "text-muted-foreground hover:text-foreground hover:bg-muted/70"
            }`}
          >
            <Boxes className="w-4 h-4 shrink-0 text-indigo-400" />
            <span className="truncate flex-1">Not Tipleri & Parametreler</span>
          </button>

          <button
            type="button"
            onClick={() => handleTabChange("drive")}
            data-testid="settings-tab-drive"
            className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-xs font-medium transition-all text-left cursor-pointer ${
              activeTab === "drive"
                ? "bg-primary text-primary-foreground font-semibold shadow-xs"
                : "text-muted-foreground hover:text-foreground hover:bg-muted/70"
            }`}
          >
            <Cloud className="w-4 h-4 shrink-0 text-sky-400" />
            <span className="truncate flex-1">Google Drive Yedekleme</span>
            {driveToken && <span className="w-2 h-2 rounded-full bg-emerald-400 shrink-0" />}
          </button>

          <button
            type="button"
            onClick={() => handleTabChange("export_import")}
            data-testid="settings-tab-export-import"
            className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-xs font-medium transition-all text-left cursor-pointer ${
              activeTab === "export_import"
                ? "bg-primary text-primary-foreground font-semibold shadow-xs"
                : "text-muted-foreground hover:text-foreground hover:bg-muted/70"
            }`}
          >
            <ArrowDownUp className="w-4 h-4 shrink-0 text-amber-500" />
            <span className="truncate flex-1">Veri Dışa / İçe Aktar</span>
          </button>

          <button
            type="button"
            onClick={() => handleTabChange("account")}
            data-testid="settings-tab-account"
            className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-xs font-medium transition-all text-left cursor-pointer ${
              activeTab === "account"
                ? "bg-primary text-primary-foreground font-semibold shadow-xs"
                : "text-muted-foreground hover:text-foreground hover:bg-muted/70"
            }`}
          >
            <UserCheck className="w-4 h-4 shrink-0 text-emerald-500" />
            <span className="truncate flex-1">Hesap & Veritabanı</span>
          </button>
        </div>

        {/* Right Content Panel */}
        <div className="flex-1 w-full bg-card border border-border rounded-xl p-6 lg:p-8 shadow-xs min-h-[480px]">
          {/* TAB 1: Görünüm & Tercihler */}
          {activeTab === "appearance" && (
            <div className="space-y-8 animate-in fade-in duration-200">
              <div>
                <h2 className="font-serif text-2xl font-bold flex items-center gap-2">
                  <Sliders className="w-5 h-5 text-primary" strokeWidth={1.5} /> Görünüm & Filtre Tercihleri
                </h2>
                <p className="text-xs text-muted-foreground mt-1">
                  Temayı, arama kapsamını ve not listenizin varsayılan başlangıç görünümünü özelleştirin.
                </p>
              </div>

              {/* Theme Selector */}
              <div className="border-t border-border/60 pt-6">
                <label className="text-[11px] font-semibold tracking-[0.2em] uppercase text-muted-foreground block mb-3">
                  Arayüz Teması
                </label>
                <div className="grid grid-cols-2 sm:grid-cols-2 gap-3 max-w-md">
                  <button
                    type="button"
                    onClick={() => theme === "dark" && toggle()}
                    className={`p-3.5 rounded-xl border flex items-center gap-3 transition-all cursor-pointer ${
                      theme === "light"
                        ? "border-primary bg-primary/10 text-foreground ring-1 ring-primary/40 font-semibold"
                        : "border-border hover:bg-muted/50 text-muted-foreground"
                    }`}
                  >
                    <Sun className="w-5 h-5 text-amber-500 shrink-0" />
                    <div className="text-left">
                      <div className="text-xs font-semibold">Açık Kâğıt Teması</div>
                      <div className="text-[10px] text-muted-foreground">Sıcak kâğıt dokusu ve mürekkep tonları</div>
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => theme === "light" && toggle()}
                    className={`p-3.5 rounded-xl border flex items-center gap-3 transition-all cursor-pointer ${
                      theme === "dark"
                        ? "border-primary bg-primary/10 text-foreground ring-1 ring-primary/40 font-semibold"
                        : "border-border hover:bg-muted/50 text-muted-foreground"
                    }`}
                  >
                    <Moon className="w-5 h-5 text-sky-400 shrink-0" />
                    <div className="text-left">
                      <div className="text-xs font-semibold">Koyu Gece Teması</div>
                      <div className="text-[10px] text-muted-foreground">Gözü yormayan derin ve şık koyu mod</div>
                    </div>
                  </button>
                </div>
              </div>

              {/* Default Note Filter */}
              <div className="border-t border-border/60 pt-6">
                <label className="text-[11px] font-semibold tracking-[0.2em] uppercase text-muted-foreground block mb-2">
                  Varsayılan Not Filtresi
                </label>
                <p className="text-xs text-muted-foreground mb-4">
                  Uygulama ilk açıldığında veya takvim gününe tıklandığında öncelikli listelenecek not türü:
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
                  {FILTER_OPTIONS.map((opt) => {
                    const Icon = opt.icon;
                    const active = settings.defaultFilter === opt.id;
                    return (
                      <button
                        key={opt.id}
                        type="button"
                        onClick={() => {
                          updateSettings({ defaultFilter: opt.id });
                          toast.success(`Varsayılan filtre güncellendi: ${opt.label}`);
                        }}
                        className={`p-3 rounded-lg border text-left transition-all flex items-start gap-2.5 cursor-pointer ${
                          active
                            ? "border-primary bg-primary/10 text-foreground ring-1 ring-primary/40 shadow-2xs font-medium"
                            : "border-border hover:bg-muted/50 text-muted-foreground hover:text-foreground"
                        }`}
                      >
                        <Icon className={`w-4 h-4 mt-0.5 shrink-0 ${active ? "text-primary" : "text-muted-foreground"}`} />
                        <div className="min-w-0 flex-1">
                          <div className="text-xs font-semibold leading-tight">{opt.label}</div>
                          <div className="text-[10px] text-muted-foreground mt-0.5 line-clamp-2">
                            {opt.desc}
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Search Scope */}
              <div className="border-t border-border/60 pt-6">
                <label className="text-[11px] font-semibold tracking-[0.2em] uppercase text-muted-foreground block mb-2 flex items-center gap-1.5">
                  <Globe className="w-3.5 h-3.5" /> Genel Arama Kapsamı
                </label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-w-lg">
                  <button
                    type="button"
                    onClick={() => {
                      updateSettings({ searchScope: "all_time" });
                      toast.success("Arama kapsamı: Tüm Zamanlar");
                    }}
                    className={`py-2.5 px-3.5 rounded-lg border text-xs font-medium transition-all text-left cursor-pointer ${
                      settings.searchScope === "all_time"
                        ? "border-primary bg-primary/10 text-foreground font-semibold"
                        : "border-border hover:bg-muted text-muted-foreground"
                    }`}
                  >
                    <div className="font-semibold">Tüm Zamanlar (Genel Arama)</div>
                    <div className="text-[10px] text-muted-foreground mt-0.5">Yazdığınız kelimeleri tüm geçmiş ve gelecek notlarda arar</div>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      updateSettings({ searchScope: "selected_day" });
                      toast.success("Arama kapsamı: Yalnızca Seçili Gün");
                    }}
                    className={`py-2.5 px-3.5 rounded-lg border text-xs font-medium transition-all text-left cursor-pointer ${
                      settings.searchScope === "selected_day"
                        ? "border-primary bg-primary/10 text-foreground font-semibold"
                        : "border-border hover:bg-muted text-muted-foreground"
                    }`}
                  >
                    <div className="font-semibold">Yalnızca Seçili Gün</div>
                    <div className="text-[10px] text-muted-foreground mt-0.5">Sadece takvimde seçilen tarihin notları arasında arama yapar</div>
                  </button>
                </div>
              </div>

              {/* Sound Notifications */}
              <div className="border-t border-border/60 pt-6">
                <label className="text-[11px] font-semibold tracking-[0.2em] uppercase text-muted-foreground block mb-3 flex items-center gap-1.5">
                  <Volume2 className="w-3.5 h-3.5" /> Hatırlatma & Bildirim Sesleri
                </label>
                <label className="flex items-center gap-3 p-3.5 rounded-xl border border-border hover:bg-muted/40 cursor-pointer max-w-lg">
                  <input
                    type="checkbox"
                    checked={settings.soundEnabled}
                    onChange={(e) => updateSettings({ soundEnabled: e.target.checked })}
                    className="rounded border-border accent-primary h-4 w-4 cursor-pointer"
                  />
                  <div className="text-xs">
                    <span className="font-medium text-foreground block">Hatırlatma bildirim seslerini çal</span>
                    <span className="text-[10px] text-muted-foreground">Hatırlatma zamanı geldiğinde hafif bir zil tonu çalar</span>
                  </div>
                </label>
              </div>

              {/* Reset to Defaults */}
              <div className="border-t border-border/60 pt-6 flex justify-end">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    resetSettings();
                    toast.info("Ayarlar varsayılana sıfırlandı");
                  }}
                  className="text-xs text-muted-foreground hover:text-destructive"
                >
                  Ayarları Varsayılana Sıfırla
                </Button>
              </div>
            </div>
          )}

          {/* TAB: Not Tipleri & Parametreler */}
          {activeTab === "note_types" && <NoteTypeManager />}

          {/* TAB 2: Google Drive Yedekleme & Senkronizasyon */}
          {activeTab === "drive" && (
            <div className="space-y-8 animate-in fade-in duration-200">
              <div>
                <h2 className="font-serif text-2xl font-bold flex items-center gap-2">
                  <Cloud className="w-5 h-5 text-sky-500" strokeWidth={1.5} /> Google Drive Yedekleme & İçe Aktarma
                </h2>
                <p className="text-xs text-muted-foreground mt-1">
                  Giriş yaptığınız Gmail hesabınızın Google Drive alanına tam not yedeği oluşturun veya mevcut bir yedeği anında geri yükleyin.
                </p>
              </div>

              {/* Google Drive Status Banner */}
              <div className="p-4 bg-muted/40 border border-border rounded-xl flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <div className={`p-2.5 rounded-xl ${driveToken ? "bg-emerald-500/10 text-emerald-500" : "bg-sky-500/10 text-sky-500"}`}>
                    <Cloud className="w-6 h-6" />
                  </div>
                  <div>
                    <div className="text-sm font-semibold flex items-center gap-1.5">
                      {driveToken ? "Google Drive Bağlantısı Aktif" : "Google Drive Bağlı Değil"}
                      {driveToken && <CheckCircle2 className="w-4 h-4 text-emerald-500" />}
                    </div>
                    <div className="text-xs text-muted-foreground mt-0.5">
                      {driveUser?.email
                        ? `Bağlı Hesap: ${driveUser.email}`
                        : driveToken
                        ? "Hesap erişimi aktif"
                        : "Yedekleme ve geri yükleme için Google Drive hesabınıza izin verin"}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  {!driveToken ? (
                    <Button
                      type="button"
                      onClick={handleConnectDrive}
                      disabled={isConnectingDrive}
                      data-testid="connect-drive-btn"
                      className="bg-sky-600 hover:bg-sky-700 text-white rounded-lg text-xs font-medium cursor-pointer"
                    >
                      {isConnectingDrive ? <RefreshCw className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <Cloud className="w-3.5 h-3.5 mr-1.5" />}
                      Google Drive'a Bağlan
                    </Button>
                  ) : (
                    <>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => refreshDriveBackups()}
                        disabled={loadingBackups}
                        className="text-xs rounded-lg cursor-pointer"
                        title="Yedek listesini yenile"
                      >
                        <RefreshCw className={`w-3.5 h-3.5 ${loadingBackups ? "animate-spin" : ""}`} />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={handleDisconnectDrive}
                        className="text-xs text-muted-foreground hover:text-destructive rounded-lg cursor-pointer"
                      >
                        Bağlantıyı Kes
                      </Button>
                    </>
                  )}
                </div>
              </div>

              {/* Actions: Export to Google Drive */}
              <div className="border-t border-border/60 pt-6 space-y-4">
                <h3 className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground flex items-center gap-1.5">
                  <Upload className="w-3.5 h-3.5 text-primary" /> Google Drive'a Dışa Aktar (Yedekle)
                </h3>
                <p className="text-xs text-muted-foreground">
                  Google Drive'ınızda otomatik olarak bir <strong>'Inkwell Notes Backups'</strong> klasörü oluşturulur ve tüm notlarınız, etiketleriniz, konumlarınız ile gruplarınız formatlı JSON veya Markdown olarak kaydedilir.
                </p>

                <div className="flex flex-wrap items-center gap-3">
                  <Button
                    type="button"
                    onClick={() => handleExportToGoogleDrive("json")}
                    disabled={isExportingDrive}
                    data-testid="drive-export-json-btn"
                    className="bg-foreground text-background hover:bg-foreground/90 rounded-lg text-xs font-medium cursor-pointer"
                  >
                    {isExportingDrive ? (
                      <RefreshCw className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                    ) : (
                      <Upload className="w-3.5 h-3.5 mr-1.5" />
                    )}
                    Google Drive'a Tam Veri Yedeği Oluştur (.json)
                  </Button>

                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => handleExportToGoogleDrive("markdown")}
                    disabled={isExportingDrive}
                    data-testid="drive-export-md-btn"
                    className="rounded-lg text-xs font-medium cursor-pointer"
                  >
                    <FileText className="w-3.5 h-3.5 mr-1.5 text-sky-500" />
                    Markdown Arşivi Olarak Drive'a Aktar (.md)
                  </Button>
                </div>
              </div>

              {/* Backups List on Google Drive */}
              <div className="border-t border-border/60 pt-6 space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground flex items-center gap-1.5">
                    <Download className="w-3.5 h-3.5 text-primary" /> Drive'daki Inkwell Yedekleri ({driveBackups.length})
                  </h3>
                  {driveToken && (
                    <button
                      type="button"
                      onClick={() => refreshDriveBackups()}
                      className="text-[11px] text-muted-foreground hover:text-foreground flex items-center gap-1 cursor-pointer"
                    >
                      <RefreshCw className={`w-3 h-3 ${loadingBackups ? "animate-spin" : ""}`} /> Listeyi Yenile
                    </button>
                  )}
                </div>

                {!driveToken ? (
                  <div className="p-8 text-center border border-dashed border-border rounded-xl bg-muted/20">
                    <Cloud className="w-8 h-8 text-muted-foreground/50 mx-auto mb-2" />
                    <p className="text-xs text-muted-foreground">
                      Drive'ınızdaki yedekleri listelemek ve geri yüklemek için yukarıdaki butondan Google Drive'a bağlanın.
                    </p>
                  </div>
                ) : loadingBackups ? (
                  <div className="py-12 text-center text-xs text-muted-foreground flex items-center justify-center gap-2">
                    <RefreshCw className="w-4 h-4 animate-spin text-primary" /> Google Drive taranıyor...
                  </div>
                ) : driveBackups.length === 0 ? (
                  <div className="p-8 text-center border border-dashed border-border rounded-xl bg-muted/20">
                    <HardDrive className="w-8 h-8 text-muted-foreground/50 mx-auto mb-2" />
                    <p className="text-xs text-muted-foreground">
                      Google Drive'ınızda henüz kayıtlı bir Inkwell yedeği bulunamadı.
                    </p>
                    <p className="text-[11px] text-muted-foreground/70 mt-1">
                      Yukarıdaki 'Google Drive'a Tam Veri Yedeği Oluştur' butonu ile ilk yedeğinizi kaydedebilirsiniz.
                    </p>
                  </div>
                ) : (
                  <div className="divide-y divide-border/60 border border-border rounded-xl overflow-hidden bg-card">
                    {driveBackups.map((file) => {
                      const createdDate = file.createdTime
                        ? new Date(file.createdTime).toLocaleString("tr-TR")
                        : "—";
                      const isJson = file.name.endsWith(".json");

                      return (
                        <div
                          key={file.id}
                          className="p-3.5 hover:bg-muted/40 transition-colors flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                          data-testid={`drive-backup-row-${file.id}`}
                        >
                          <div className="flex items-start gap-3 min-w-0">
                            <div className="p-2 rounded-lg bg-muted text-primary shrink-0 mt-0.5">
                              {isJson ? <Folder className="w-4 h-4 text-amber-500" /> : <FileText className="w-4 h-4 text-sky-500" />}
                            </div>
                            <div className="min-w-0">
                              <div className="text-xs font-semibold text-foreground truncate flex items-center gap-2">
                                <span>{file.name}</span>
                                {file.notesCount !== undefined && (
                                  <span className="text-[10px] font-mono px-1.5 py-0.2 bg-primary/10 text-primary rounded-full">
                                    {file.notesCount} not
                                  </span>
                                )}
                              </div>
                              <div className="text-[10px] text-muted-foreground flex items-center gap-3 mt-1 font-mono">
                                <span>📅 {createdDate}</span>
                                {file.size && <span>💾 {Math.round(parseInt(file.size, 10) / 1024)} KB</span>}
                              </div>
                            </div>
                          </div>

                          <div className="flex items-center gap-1.5 shrink-0 self-end sm:self-center">
                            {isJson && (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => handleImportFromGoogleDrive(file, "merge")}
                                disabled={isImportingDrive}
                                className="text-xs rounded-lg h-7 px-2.5 cursor-pointer text-foreground hover:bg-primary hover:text-primary-foreground"
                                title="Bu yedeği mevcut notlarınıza ekleyerek geri yükleyin"
                              >
                                <Download className="w-3 h-3 mr-1" /> Geri Yükle
                              </Button>
                            )}

                            {file.webViewLink && (
                              <a
                                href={file.webViewLink}
                                target="_blank"
                                rel="noreferrer"
                                className="p-1.5 text-muted-foreground hover:text-foreground rounded hover:bg-muted transition-colors cursor-pointer"
                                title="Google Drive'da Görüntüle"
                              >
                                <ExternalLink className="w-3.5 h-3.5" />
                              </a>
                            )}

                            <button
                              type="button"
                              onClick={() => handleDeleteDriveBackup(file)}
                              className="p-1.5 text-muted-foreground hover:text-destructive rounded hover:bg-muted transition-colors cursor-pointer"
                              title="Drive'dan Sil"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* TAB 3: Yerel Dosya Dışa / İçe Aktar */}
          {activeTab === "export_import" && (
            <div className="space-y-8 animate-in fade-in duration-200">
              <div>
                <h2 className="font-serif text-2xl font-bold flex items-center gap-2">
                  <ArrowDownUp className="w-5 h-5 text-amber-500" strokeWidth={1.5} /> Yerel Veri Dışa & İçe Aktar
                </h2>
                <p className="text-xs text-muted-foreground mt-1">
                  Tüm verilerinizi JSON formatında bilgisayarınıza indirebilir veya yerel bir yedek dosyasından geri yükleyebilirsiniz.
                </p>
              </div>

              {/* Local Export */}
              <div className="border-t border-border/60 pt-6 space-y-4">
                <h3 className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground flex items-center gap-1.5">
                  <FileDown className="w-3.5 h-3.5 text-primary" /> Bilgisayara İndir (Dışa Aktar)
                </h3>
                <p className="text-xs text-muted-foreground">
                  Notlarınız, #etiketleriniz, @kişileriniz, konumlarınız, gruplarınız ve hatırlatmalarınız tek bir JSON dosyası olarak cihazınıza indirilir.
                </p>

                <Button
                  type="button"
                  onClick={handleExportLocalJson}
                  disabled={isExportingLocal}
                  data-testid="local-export-btn"
                  className="bg-foreground text-background hover:bg-foreground/90 rounded-lg text-xs font-medium cursor-pointer"
                >
                  {isExportingLocal ? (
                    <RefreshCw className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                  ) : (
                    <Download className="w-3.5 h-3.5 mr-1.5" />
                  )}
                  Tüm Verileri İndir (.json)
                </Button>
              </div>

              {/* Local Import */}
              <div className="border-t border-border/60 pt-6 space-y-4">
                <h3 className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground flex items-center gap-1.5">
                  <FileUp className="w-3.5 h-3.5 text-emerald-500" /> Yerel Dosyadan İçe Aktar
                </h3>
                <p className="text-xs text-muted-foreground">
                  Daha önce indirdiğiniz bir Inkwell JSON yedekleme dosyasını seçerek notlarınızı anında geri yükleyin.
                </p>

                <div className="p-6 border-2 border-dashed border-border rounded-xl text-center hover:border-primary/60 transition-colors bg-muted/20">
                  <Upload className="w-8 h-8 text-muted-foreground/60 mx-auto mb-2" />
                  <label className="inline-block cursor-pointer">
                    <span className="bg-primary text-primary-foreground hover:opacity-90 px-4 py-2 rounded-lg text-xs font-medium shadow-xs">
                      {isImportingLocal ? "İçe aktarılıyor..." : "Yedek Dosyası Seç (.json)"}
                    </span>
                    <input
                      type="file"
                      accept=".json,application/json"
                      onChange={handleLocalFileSelect}
                      disabled={isImportingLocal}
                      className="hidden"
                      data-testid="local-import-input"
                    />
                  </label>
                  <p className="text-[11px] text-muted-foreground mt-2">
                    Desteklenen format: .json (Inkwell Backup Format v1.0)
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* TAB 4: Hesap & Sistem Bilgileri */}
          {activeTab === "account" && (
            <div className="space-y-8 animate-in fade-in duration-200">
              <div>
                <h2 className="font-serif text-2xl font-bold flex items-center gap-2">
                  <UserCheck className="w-5 h-5 text-emerald-500" strokeWidth={1.5} /> Hesap & Veritabanı Bilgileri
                </h2>
                <p className="text-xs text-muted-foreground mt-1">
                  Oturum açtığınız kullanıcı hesabı ve Cloud SQL veritabanı istatistikleri.
                </p>
              </div>

              {/* Profile Details */}
              <div className="border-t border-border/60 pt-6">
                <label className="text-[11px] font-semibold tracking-[0.2em] uppercase text-muted-foreground block mb-3">
                  Kullanıcı Profili
                </label>
                {u && (
                  <div className="bg-muted/40 border border-border rounded-xl p-4 space-y-3 max-w-lg">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-muted-foreground">Kullanıcı Adı:</span>
                      <span className="font-semibold text-foreground">{u.name || "—"}</span>
                    </div>
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-muted-foreground">E-posta:</span>
                      <span className="font-mono text-foreground">{u.email}</span>
                    </div>
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-muted-foreground">Giriş Türü:</span>
                      <span className="capitalize font-mono px-2 py-0.5 bg-background rounded text-[11px] border border-border/60">
                        {u.auth_provider || "Email"}
                      </span>
                    </div>
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-muted-foreground">Hesap Kimliği (ID):</span>
                      <span className="font-mono text-[11px] text-muted-foreground">{u.user_id}</span>
                    </div>
                  </div>
                )}
              </div>

              {/* Storage & Database Stats */}
              <div className="border-t border-border/60 pt-6">
                <div className="flex items-center justify-between mb-3">
                  <label className="text-[11px] font-semibold tracking-[0.2em] uppercase text-muted-foreground">
                    Veritabanı Durumu (Cloud SQL & Vektör)
                  </label>
                  <button
                    type="button"
                    onClick={fetchStats}
                    className="text-[11px] text-muted-foreground hover:text-foreground flex items-center gap-1 cursor-pointer"
                  >
                    <RefreshCw className={`w-3 h-3 ${loadingStats ? "animate-spin" : ""}`} /> Yenile
                  </button>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <div className="p-3.5 bg-muted/40 border border-border rounded-xl text-center">
                    <div className="font-serif text-2xl font-bold text-foreground">
                      {stats ? stats.notesCount : "—"}
                    </div>
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground mt-1 flex items-center justify-center gap-1">
                      <FileText className="w-3 h-3" /> Toplam Not
                    </div>
                  </div>

                  <div className="p-3.5 bg-muted/40 border border-border rounded-xl text-center">
                    <div className="font-serif text-2xl font-bold text-sky-500">
                      {stats ? stats.tagsCount : "—"}
                    </div>
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground mt-1 flex items-center justify-center gap-1">
                      <Hash className="w-3 h-3" /> Etiketler
                    </div>
                  </div>

                  <div className="p-3.5 bg-muted/40 border border-border rounded-xl text-center">
                    <div className="font-serif text-2xl font-bold text-emerald-500">
                      {stats ? stats.peopleCount : "—"}
                    </div>
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground mt-1 flex items-center justify-center gap-1">
                      <Users className="w-3 h-3" /> Kişiler
                    </div>
                  </div>

                  <div className="p-3.5 bg-muted/40 border border-border rounded-xl text-center">
                    <div className="font-serif text-2xl font-bold text-rose-500">
                      {stats ? stats.locationsCount : "—"}
                    </div>
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground mt-1 flex items-center justify-center gap-1">
                      <MapPin className="w-3 h-3" /> Konumlar
                    </div>
                  </div>
                </div>

                <div className="mt-3 p-3 bg-primary/5 border border-primary/20 rounded-xl text-xs text-muted-foreground flex items-center gap-2">
                  <ShieldCheck className="w-4 h-4 text-emerald-500 shrink-0" />
                  <span>
                    Vektörel Arama Desteği: <strong>pgvector</strong> aktif (768 boyutlu semantik embedding).
                  </span>
                </div>
              </div>

              {/* Logout Option */}
              <div className="border-t border-border/60 pt-6">
                <Button
                  variant="destructive"
                  onClick={logout}
                  data-testid="settings-logout-btn"
                  className="rounded-lg text-xs font-medium cursor-pointer"
                >
                  <LogOut className="w-3.5 h-3.5 mr-1.5" /> Hesaptan Çıkış Yap
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
