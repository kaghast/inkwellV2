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

  const renderNavLinks = (onItemClick?: () => void) => (
    <div className="space-y-1">
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
            onClick={() => {
              if (onItemClick) onItemClick();
            }}
            className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-xs font-medium transition-all cursor-pointer ${
              isActive
                ? "bg-primary/10 text-primary font-semibold border border-primary/20 shadow-2xs"
                : "text-muted-foreground hover:text-foreground hover:bg-muted/60"
            }`}
          >
            <Icon className={`w-4 h-4 ${isActive ? "text-primary" : "text-muted-foreground"}`} strokeWidth={1.75} />
            <span>{item.label}</span>
          </Link>
        );
      })}
    </div>
  );

  return (
    <>
      {/* Mobile Top Header (Visible only on < lg screens) */}
      <header className="lg:hidden sticky top-0 z-40 h-14 border-b border-border bg-background/95 backdrop-blur-md flex items-center justify-between px-3 select-none">
        <div className="flex items-center gap-2">
          <Button
            size="icon"
            variant="ghost"
            className="h-8 w-8"
            onClick={() => setMobileMenuOpen(true)}
            data-testid="mobile-menubar-toggle-btn"
          >
            <Menu className="w-4 h-4" strokeWidth={1.5} />
          </Button>
          <Link to="/" className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-md bg-primary/10 border border-primary/20 flex items-center justify-center text-primary">
              <Feather className="w-4 h-4" strokeWidth={1.75} />
            </div>
            <span className="font-serif text-base font-bold text-foreground">Inkwell</span>
          </Link>
        </div>

        <div className="flex items-center gap-2">
          {/* Quick New Note Button Mobile */}
          <Link
            to="/new"
            className="flex items-center gap-1 text-xs px-2.5 py-1.5 bg-primary text-primary-foreground font-semibold rounded-md shadow-2xs hover:opacity-90 transition-opacity"
            data-testid="mobile-quick-new-note-btn"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Yeni Not</span>
          </Link>

          {/* Theme Toggle */}
          <Button
            size="icon"
            variant="ghost"
            className="h-8 w-8 text-muted-foreground hover:text-foreground"
            onClick={toggle}
          >
            {theme === "dark" ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
          </Button>

          {/* Mobile User Avatar */}
          {u && u.user_id && (
            <Avatar className="h-7 w-7 ring-1 ring-border" onClick={() => navigate("/settings")}>
              {u.picture && <AvatarImage src={u.picture} alt={u.name || ""} />}
              <AvatarFallback className="text-[10px] font-mono bg-secondary font-bold">{initials}</AvatarFallback>
            </Avatar>
          )}
        </div>
      </header>

      {/* Mobile Drawer Sheet */}
      {mobileMenuOpen && (
        <div className="lg:hidden fixed inset-0 z-50 flex">
          {/* Backdrop */}
          <div
            className="fixed inset-0 bg-background/80 backdrop-blur-xs transition-opacity"
            onClick={() => setMobileMenuOpen(false)}
          />

          {/* Drawer Content */}
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

            {/* Primary Action Button */}
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

            {/* Navigation Links */}
            <div className="flex-1 overflow-y-auto">
              {renderNavLinks(() => setMobileMenuOpen(false))}
            </div>

            {/* Footer */}
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

      {/* Desktop Fixed Left Menubar (Permanent on lg+ screens) */}
      <aside
        className="hidden lg:flex fixed left-0 top-0 bottom-0 w-64 bg-card border-r border-border flex-col justify-between p-4 z-40 select-none"
        data-testid="desktop-menubar"
      >
        {/* Top Area: Brand & New Note CTA Button */}
        <div className="space-y-4">
          {/* Brand Logo */}
          <Link
            to="/"
            className="flex items-center gap-2.5 px-2 py-1 group cursor-pointer transition-colors"
          >
            <div className="w-8 h-8 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center text-primary group-hover:bg-primary group-hover:text-primary-foreground transition-all shadow-2xs">
              <Feather className="w-4 h-4" strokeWidth={1.75} />
            </div>
            <div>
              <span className="font-serif text-lg tracking-tight font-bold text-foreground">
                Inkwell
              </span>
              <span className="block text-[10px] font-mono text-muted-foreground leading-none">
                Kişisel Not & Zihin Defteri
              </span>
            </div>
          </Link>

          {/* Prominent Primary CTA Button */}
          <Link
            to="/new"
            className="w-full flex items-center justify-center gap-2 py-2.5 px-4 bg-primary text-primary-foreground font-semibold text-xs rounded-xl shadow-xs hover:opacity-95 transition-all cursor-pointer group"
            data-testid="menubar-new-note-btn"
          >
            <Plus className="w-4 h-4 group-hover:rotate-90 transition-transform duration-200" />
            <span>Yeni Not Ekle</span>
          </Link>

          {/* Main Navigation Links */}
          <nav className="pt-2">{renderNavLinks()}</nav>
        </div>

        {/* Bottom Area: Notifications, Theme Toggle, User Profile & Settings */}
        <div className="pt-4 border-t border-border/80 space-y-2">
          {/* Quick Actions Bar (Notifications + Theme) */}
          <div className="flex items-center justify-between px-2 py-1 rounded-lg bg-secondary/50 border border-border/60">
            {/* Notifications Dropdown */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  size="sm"
                  variant="ghost"
                  className="relative h-8 px-2 text-muted-foreground hover:text-foreground cursor-pointer"
                  data-testid="menubar-notifications-btn"
                >
                  <Bell className="w-4 h-4 mr-1.5" strokeWidth={1.5} />
                  <span className="text-[11px] font-medium">Bildirimler</span>
                  {unreadCount > 0 && (
                    <span className="ml-1.5 px-1.5 py-0.2 bg-[hsl(var(--accent-tag))] text-white text-[9px] font-mono font-bold rounded-full">
                      {unreadCount}
                    </span>
                  )}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-80 bg-popover border-border p-0 shadow-xl ml-2">
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

            {/* Theme Toggle */}
            <Button
              size="icon"
              variant="ghost"
              className="h-8 w-8 text-muted-foreground hover:text-foreground cursor-pointer"
              onClick={toggle}
              title="Açık / Koyu Tema"
            >
              {theme === "dark" ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </Button>
          </div>

          {/* User Account / Profile Row */}
          {u && u.user_id && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className="w-full flex items-center justify-between p-2 rounded-xl border border-border/70 hover:border-primary/40 bg-card hover:bg-secondary/40 transition-all cursor-pointer text-left group"
                  data-testid="menubar-user-btn"
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <Avatar className="h-8 w-8 ring-1 ring-border">
                      {u.picture && <AvatarImage src={u.picture} alt={u.name || ""} />}
                      <AvatarFallback className="text-xs font-mono bg-primary/10 text-primary font-bold">
                        {initials}
                      </AvatarFallback>
                    </Avatar>
                    <div className="min-w-0 flex-1">
                      <div className="text-xs font-medium text-foreground truncate group-hover:text-primary transition-colors">
                        {u.name || "Kullanıcı"}
                      </div>
                      <div className="text-[10px] text-muted-foreground font-mono truncate">
                        {u.email}
                      </div>
                    </div>
                  </div>
                  <Settings className="w-3.5 h-3.5 text-muted-foreground group-hover:text-foreground shrink-0 ml-1" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56 bg-popover border-border shadow-xl">
                <DropdownMenuLabel className="font-mono text-xs">
                  <div className="truncate font-semibold">{u.name}</div>
                  <div className="text-muted-foreground truncate font-normal text-[11px]">{u.email}</div>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />

                <DropdownMenuItem
                  onClick={() => navigate("/settings")}
                  data-testid="menubar-settings-item"
                  className="cursor-pointer"
                >
                  <Settings className="w-3.5 h-3.5 mr-2 text-muted-foreground" strokeWidth={1.5} /> Ayarlar
                </DropdownMenuItem>

                <DropdownMenuSeparator />

                <DropdownMenuItem
                  onClick={logout}
                  data-testid="menubar-logout-item"
                  className="cursor-pointer text-destructive focus:text-destructive"
                >
                  <LogOut className="w-3.5 h-3.5 mr-2" strokeWidth={1.5} /> Çıkış yap
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </aside>

      {/* Settings Modal Dialog */}
      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
    </>
  );
}
