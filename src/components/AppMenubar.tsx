import React, { useState } from "react";
import { Link, useNavigate, useLocation } from "react-router-dom";
import {
  Feather,
  Plus,
  Calendar,
  FileText,
  Network,
  MapPin,
  Kanban as KanbanIcon,
  Settings,
  Bell,
  CheckCheck,
  Clock,
  Sun,
  Moon,
  LogOut,
  Menu,
  X,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useTheme } from "@/contexts/ThemeContext";
import { useReminders } from "@/contexts/ReminderContext";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import SettingsDialog from "@/components/SettingsDialog";
import type { User } from "@/types";

interface Props {
  onLeftSidebarToggle?: () => void;
  onRightSidebarToggle?: () => void;
  showSidebarToggles?: boolean;
}

export default function AppMenubar({
  onLeftSidebarToggle,
  onRightSidebarToggle,
  showSidebarToggles = false,
}: Props) {
  const { user, logout } = useAuth();
  const { theme, toggle } = useTheme();
  const { reminders, unreadCount, markAsRead, markAllAsRead } = useReminders();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const u = user as User | false | null;

  const initials = ((u && u.name) || (u && u.email) || "?").slice(0, 2).toUpperCase();

  const sortedReminders = [...reminders].sort(
    (a, b) => new Date(b.targetIso).getTime() - new Date(a.targetIso).getTime()
  );

  const navItems = [
    {
      label: "Günlük Akış",
      path: "/",
      icon: Calendar,
      testId: "nav-daily",
    },
    {
      label: "Bütün Notlar",
      path: "/all-notes",
      icon: FileText,
      testId: "nav-all-notes",
    },
    {
      label: "Ağ Görünümü",
      path: "/graph",
      icon: Network,
      testId: "nav-graph",
    },
    {
      label: "Harita",
      path: "/map",
      icon: MapPin,
      testId: "nav-map",
    },
    {
      label: "Kanban",
      path: "/kanban",
      icon: KanbanIcon,
      testId: "nav-kanban",
    },
  ];

  return (
    <>
      {/* 1. TOP HEADER (Header'ı tamamen kaldırma - Inkwell logo ve başlık sağda, bildirimler ve kişisel menü sağda) */}
      <header
        className="fixed top-0 left-0 lg:left-16 right-0 h-14 z-30 bg-background/95 backdrop-blur-md border-b border-border flex items-center justify-between px-3 sm:px-5 select-none"
        data-testid="app-header"
      >
        {/* Left Area: Mobile Menu Toggle & Optional Breadcrumb */}
        <div className="flex items-center gap-2">
          <Button
            size="icon"
            variant="ghost"
            className="lg:hidden h-8 w-8 text-muted-foreground hover:text-foreground"
            onClick={() => setMobileMenuOpen(true)}
            data-testid="mobile-menubar-toggle-btn"
          >
            <Menu className="w-4 h-4" strokeWidth={1.5} />
          </Button>
        </div>

        {/* Right Area: Inkwell Logo + Başlık & Bildirimler & Tema & Kişisel Menü */}
        <div className="flex items-center gap-2 sm:gap-3">
          {/* Inkwell Logo ve Başlık (Header üzerinde sağda) */}
          <Link
            to="/"
            className="flex items-center gap-2 px-2.5 py-1 rounded-lg hover:bg-muted/50 transition-colors group cursor-pointer"
            data-testid="header-logo-link"
          >
            <div className="w-7 h-7 rounded-md bg-primary/10 border border-primary/20 flex items-center justify-center text-primary group-hover:bg-primary group-hover:text-primary-foreground transition-all shadow-2xs">
              <Feather className="w-3.5 h-3.5" strokeWidth={1.75} />
            </div>
            <div className="flex flex-col">
              <span className="font-serif text-base font-bold tracking-tight text-foreground leading-none">
                Inkwell
              </span>
              <span className="hidden sm:inline-block text-[9px] font-mono text-muted-foreground leading-none mt-0.5">
                v2
              </span>
            </div>
          </Link>

          <div className="h-4 w-[1px] bg-border/80 hidden sm:block" />

          {/* Quick New Note Button for Mobile */}
          <Link
            to="/new"
            className="lg:hidden flex items-center gap-1 text-xs px-2.5 py-1.5 bg-primary text-primary-foreground font-semibold rounded-md shadow-2xs hover:opacity-90 transition-opacity"
            data-testid="mobile-quick-new-note-btn"
          >
            <Plus className="w-3.5 h-3.5" />
            <span className="hidden xs:inline">Yeni Not</span>
          </Link>

          {/* Notifications Dropdown (Bildirimler - Header üzerinde sağda) */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                size="icon"
                variant="ghost"
                className="relative h-8 w-8 text-muted-foreground hover:text-foreground cursor-pointer rounded-lg"
                data-testid="header-notifications-btn"
                title="Bildirimler & Hatırlatmalar"
              >
                <Bell className="w-4 h-4" strokeWidth={1.5} />
                {unreadCount > 0 && (
                  <span className="absolute -top-0.5 -right-0.5 px-1 py-0.2 min-w-4 h-4 bg-[hsl(var(--accent-tag))] text-white text-[9px] font-mono font-bold rounded-full flex items-center justify-center">
                    {unreadCount}
                  </span>
                )}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-80 bg-popover border-border p-0 shadow-xl mt-1">
              <div className="flex items-center justify-between p-3 border-b border-border">
                <div className="flex items-center gap-1.5">
                  <span className="font-serif font-semibold text-sm">Bildirimler & Hatırlatmalar</span>
                  {unreadCount > 0 && (
                    <span className="bg-[hsl(var(--accent-tag))/0.15] text-[hsl(var(--accent-tag))] font-mono text-[10px] font-bold px-1.5 py-0.5 rounded-full">
                      {unreadCount} yeni
                    </span>
                  )}
                </div>
                {unreadCount > 0 && (
                  <button
                    type="button"
                    onClick={markAllAsRead}
                    className="text-[11px] text-muted-foreground hover:text-foreground flex items-center gap-1 cursor-pointer"
                  >
                    <CheckCheck className="w-3 h-3" /> Tümünü oku
                  </button>
                )}
              </div>

              <div className="max-h-72 overflow-y-auto divide-y divide-border/40">
                {sortedReminders.length === 0 ? (
                  <div className="py-8 text-center text-xs text-muted-foreground italic">
                    Henüz kayıtlı bir hatırlatma yok
                  </div>
                ) : (
                  sortedReminders.slice(0, 10).map((r) => {
                    const targetTime = new Date(r.targetIso).getTime();
                    const isPast = Date.now() >= targetTime;
                    return (
                      <div
                        key={r.id}
                        onClick={() => {
                          markAsRead(r.id);
                          navigate(r.noteId ? `/note/${r.noteId}` : `/day/${r.date}`);
                        }}
                        className={`p-3 cursor-pointer transition-colors flex items-start gap-2.5 ${
                          !r.read && isPast
                            ? "bg-accent/40 hover:bg-accent/60"
                            : "hover:bg-muted/40"
                        }`}
                      >
                        <div
                          className={`w-2 h-2 rounded-full mt-1.5 shrink-0 ${
                            !r.read && isPast
                              ? "bg-[hsl(var(--accent-tag))]"
                              : "bg-transparent"
                          }`}
                        />
                        <div className="flex-1 min-w-0">
                          <div className="text-xs font-medium text-foreground font-serif leading-snug">
                            {r.text}
                          </div>
                          <div className="flex items-center gap-2 text-[10px] text-muted-foreground mt-1 font-mono">
                            <span className="flex items-center gap-1">
                              <Calendar className="w-3 h-3" />
                              {r.date}
                            </span>
                            <span className="flex items-center gap-1">
                              <Clock className="w-3 h-3" />
                              {new Date(r.targetIso).toLocaleTimeString("tr-TR", {
                                hour: "2-digit",
                                minute: "2-digit",
                              })}
                            </span>
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Theme Toggle Button */}
          <Button
            size="icon"
            variant="ghost"
            className="h-8 w-8 text-muted-foreground hover:text-foreground cursor-pointer rounded-lg"
            onClick={toggle}
            title="Açık / Koyu Tema"
          >
            {theme === "dark" ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
          </Button>

          {/* User Account / Profile Dropdown Menu (Kişisel Menü - Header üzerinde sağda) */}
          {u && u.user_id && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className="flex items-center gap-1.5 p-1 rounded-full hover:ring-2 hover:ring-primary/40 transition-all cursor-pointer select-none"
                  data-testid="header-user-btn"
                  title={u.name || u.email}
                >
                  <Avatar className="h-7 w-7 ring-1 ring-border shadow-2xs">
                    {u.picture && <AvatarImage src={u.picture} alt={u.name || ""} />}
                    <AvatarFallback className="text-[10px] font-mono bg-primary/10 text-primary font-bold">
                      {initials}
                    </AvatarFallback>
                  </Avatar>
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56 bg-popover border-border shadow-xl mt-1">
                <DropdownMenuLabel className="font-mono text-xs">
                  <div className="truncate font-semibold">{u.name}</div>
                  <div className="text-muted-foreground truncate font-normal text-[11px]">{u.email}</div>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />

                <DropdownMenuItem
                  onClick={() => navigate("/settings")}
                  data-testid="header-settings-item"
                  className="cursor-pointer"
                >
                  <Settings className="w-3.5 h-3.5 mr-2 text-muted-foreground" strokeWidth={1.5} /> Ayarlar
                </DropdownMenuItem>

                <DropdownMenuSeparator />

                <DropdownMenuItem
                  onClick={logout}
                  data-testid="header-logout-item"
                  className="cursor-pointer text-destructive focus:text-destructive"
                >
                  <LogOut className="w-3.5 h-3.5 mr-2" strokeWidth={1.5} /> Çıkış yap
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </header>

      {/* 2. SOL BAR: SADECE ICON MENU (w-16 on lg+ screens) */}
      <aside
        className="hidden lg:flex fixed left-0 top-0 bottom-0 w-16 bg-card border-r border-border flex-col items-center justify-between py-3 z-40 select-none"
        data-testid="desktop-icon-menubar"
      >
        {/* Top: + Yeni Not Ekle Icon Button */}
        <div className="flex flex-col items-center gap-3 w-full">
          <Link
            to="/new"
            className="w-10 h-10 rounded-xl bg-primary text-primary-foreground flex items-center justify-center shadow-sm hover:scale-105 active:scale-95 transition-all group relative cursor-pointer"
            data-testid="menubar-new-note-btn"
            title="Yeni Not Ekle"
          >
            <Plus className="w-5 h-5 group-hover:rotate-90 transition-transform duration-200" />
            <span className="absolute left-14 px-2.5 py-1 bg-popover text-popover-foreground text-xs font-semibold rounded-md shadow-md border border-border pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity z-50 whitespace-nowrap">
              Yeni Not Ekle
            </span>
          </Link>

          <div className="w-8 h-[1px] bg-border/80" />

          {/* Navigation Icon Menu */}
          <nav className="flex flex-col items-center gap-1.5 w-full px-2">
            {navItems.map((item) => {
              const Icon = item.icon;
              const isActive =
                item.path === "/"
                  ? location.pathname === "/" || location.pathname.startsWith("/day/")
                  : location.pathname === item.path;

              return (
                <Link
                  key={item.path}
                  to={item.path}
                  data-testid={item.testId}
                  title={item.label}
                  className={`w-10 h-10 rounded-xl flex items-center justify-center transition-all group relative cursor-pointer ${
                    isActive
                      ? "bg-primary/15 text-primary border border-primary/25 shadow-2xs font-semibold"
                      : "text-muted-foreground hover:text-foreground hover:bg-muted/70"
                  }`}
                >
                  {isActive && (
                    <span className="absolute -left-2 top-1/2 -translate-y-1/2 w-1 h-4 bg-primary rounded-r-full" />
                  )}
                  <Icon className="w-4 h-4" strokeWidth={isActive ? 2 : 1.75} />
                  {/* Floating Hover Tooltip */}
                  <span className="absolute left-14 px-2.5 py-1 bg-popover text-popover-foreground text-xs font-medium rounded-md shadow-md border border-border pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity z-50 whitespace-nowrap">
                    {item.label}
                  </span>
                </Link>
              );
            })}
          </nav>
        </div>

        {/* Bottom: Settings Icon */}
        <div className="flex flex-col items-center gap-2 w-full px-2">
          <Link
            to="/settings"
            data-testid="menubar-settings-btn"
            title="Ayarlar"
            className={`w-10 h-10 rounded-xl flex items-center justify-center transition-all group relative cursor-pointer ${
              location.pathname === "/settings"
                ? "bg-primary/15 text-primary border border-primary/25 shadow-2xs font-semibold"
                : "text-muted-foreground hover:text-foreground hover:bg-muted/70"
            }`}
          >
            {location.pathname === "/settings" && (
              <span className="absolute -left-2 top-1/2 -translate-y-1/2 w-1 h-4 bg-primary rounded-r-full" />
            )}
            <Settings className="w-4 h-4" strokeWidth={1.75} />
            <span className="absolute left-14 px-2.5 py-1 bg-popover text-popover-foreground text-xs font-medium rounded-md shadow-md border border-border pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity z-50 whitespace-nowrap">
              Ayarlar
            </span>
          </Link>
        </div>
      </aside>

      {/* 3. MOBILE DRAWER SHEET */}
      {mobileMenuOpen && (
        <div className="lg:hidden fixed inset-0 z-50 flex">
          <div
            className="fixed inset-0 bg-background/80 backdrop-blur-xs transition-opacity"
            onClick={() => setMobileMenuOpen(false)}
          />

          <div className="relative flex flex-col w-72 max-w-full bg-card border-r border-border p-4 shadow-2xl z-10 animate-in slide-in-from-left duration-200">
            <div className="flex items-center justify-between pb-4 border-b border-border/80 mb-4">
              <Link
                to="/"
                onClick={() => setMobileMenuOpen(false)}
                className="flex items-center gap-2"
              >
                <div className="w-7 h-7 rounded-md bg-primary/10 border border-primary/20 flex items-center justify-center text-primary">
                  <Feather className="w-4 h-4" strokeWidth={1.75} />
                </div>
                <span className="font-serif text-lg font-bold text-foreground">Inkwell</span>
              </Link>

              <Button
                size="icon"
                variant="ghost"
                className="h-8 w-8"
                onClick={() => setMobileMenuOpen(false)}
              >
                <X className="w-4 h-4" />
              </Button>
            </div>

            <div className="mb-4">
              <Link
                to="/new"
                onClick={() => setMobileMenuOpen(false)}
                className="w-full flex items-center justify-center gap-2 py-2.5 px-4 bg-primary text-primary-foreground font-semibold text-xs rounded-lg shadow-sm hover:opacity-95 transition-opacity"
              >
                <Plus className="w-4 h-4" />
                <span>Yeni Not Ekle</span>
              </Link>
            </div>

            <div className="flex-1 overflow-y-auto space-y-1">
              {navItems.map((item) => {
                const Icon = item.icon;
                const isActive =
                  item.path === "/"
                    ? location.pathname === "/" || location.pathname.startsWith("/day/")
                    : location.pathname === item.path;

                return (
                  <Link
                    key={item.path}
                    to={item.path}
                    onClick={() => setMobileMenuOpen(false)}
                    className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-xs font-medium transition-all cursor-pointer ${
                      isActive
                        ? "bg-primary/10 text-primary font-semibold border border-primary/20"
                        : "text-muted-foreground hover:text-foreground hover:bg-muted/60"
                    }`}
                  >
                    <Icon className="w-4 h-4" strokeWidth={1.75} />
                    <span>{item.label}</span>
                  </Link>
                );
              })}
            </div>

            <div className="pt-4 border-t border-border/80 flex items-center justify-between">
              <button
                type="button"
                onClick={() => {
                  setMobileMenuOpen(false);
                  navigate("/settings");
                }}
                className="flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground p-1"
              >
                <Settings className="w-4 h-4" />
                <span>Ayarlar</span>
              </button>

              <button
                type="button"
                onClick={logout}
                className="flex items-center gap-1.5 text-xs text-destructive hover:opacity-80 p-1"
              >
                <LogOut className="w-3.5 h-3.5" />
                <span>Çıkış</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Settings Modal Dialog */}
      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
    </>
  );
}
