import React, { useState } from "react";
import { Link, useNavigate, useLocation } from "react-router-dom";
import {
  Feather,
  Sun,
  Moon,
  LogOut,
  Menu,
  CalendarDays,
  Bell,
  CheckCheck,
  Calendar,
  Clock,
  Settings,
  FileText,
  MapPin,
  Kanban as KanbanIcon,
  LayoutGrid,
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
  onLeftMenu?: () => void;
  onRightMenu?: () => void;
}

export default function TopBar({ onLeftMenu, onRightMenu }: Props) {
  const { user, logout } = useAuth();
  const { theme, toggle } = useTheme();
  const { reminders, unreadCount, markAsRead, markAllAsRead } = useReminders();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const u = user as User | false | null;

  const initials = ((u && u.name) || (u && u.email) || "?").slice(0, 2).toUpperCase();

  // Sort reminders by time
  const sortedReminders = [...reminders].sort(
    (a, b) => new Date(b.targetIso).getTime() - new Date(a.targetIso).getTime()
  );

  const navItems = [
    {
      label: "Bütün Notlar",
      path: "/all-notes",
      icon: FileText,
      testId: "nav-all-notes",
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
      <header
        className="sticky top-0 z-40 h-14 border-b border-border bg-background/90 backdrop-blur-xl flex items-center justify-between px-3 sm:px-6 select-none"
        data-testid="topbar"
      >
        {/* Left Zone: Brand & Mobile Sidebar Toggle */}
        <div className="flex items-center gap-2 shrink-0">
          <Button
            size="icon"
            variant="ghost"
            className="lg:hidden h-8 w-8"
            onClick={onLeftMenu}
            data-testid="topbar-left-menu-btn"
          >
            <Menu className="w-4 h-4" strokeWidth={1.25} />
          </Button>
          <Link to="/" className="flex items-center gap-2 group cursor-pointer">
            <div className="w-7 h-7 rounded-md bg-primary/10 border border-primary/20 flex items-center justify-center text-primary group-hover:bg-primary group-hover:text-primary-foreground transition-colors">
              <Feather className="w-4 h-4" strokeWidth={1.75} />
            </div>
            <span className="font-serif text-lg tracking-tight font-bold text-foreground">
              Inkwell
            </span>
          </Link>
        </div>

        {/* Center Zone: 3 Main Navigation Tabs */}
        <nav
          className="flex items-center gap-1 sm:gap-1.5 p-1 rounded-lg bg-secondary/60 border border-border/80"
          data-testid="topbar-nav-tabs"
        >
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = location.pathname === item.path;

            return (
              <Link
                key={item.path}
                to={item.path}
                data-testid={item.testId}
                className={`flex items-center gap-1.5 px-2.5 sm:px-3.5 py-1 sm:py-1.5 rounded-md text-xs font-medium whitespace-nowrap transition-all cursor-pointer ${
                  isActive
                    ? "bg-background text-foreground shadow-xs border border-border/80 font-semibold"
                    : "text-muted-foreground hover:text-foreground hover:bg-background/50"
                }`}
              >
                <Icon className={`w-3.5 h-3.5 ${isActive ? "text-primary" : "text-muted-foreground"}`} />
                <span className="hidden sm:inline">{item.label}</span>
                <span className="sm:hidden">{item.label.split(" ")[0]}</span>
              </Link>
            );
          })}
        </nav>

        {/* Right Zone: Calendar Menu, Notifications, Theme, User */}
        <div className="flex items-center gap-1 sm:gap-1.5 shrink-0">
          <Button
            size="icon"
            variant="ghost"
            className="lg:hidden h-8 w-8"
            onClick={onRightMenu}
            data-testid="topbar-right-menu-btn"
          >
            <CalendarDays className="w-4 h-4" strokeWidth={1.25} />
          </Button>

          {/* Notifications / Reminders Dropdown */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                size="icon"
                variant="ghost"
                className="relative h-8 w-8 text-muted-foreground hover:text-foreground cursor-pointer"
                data-testid="notification-bell-btn"
              >
                <Bell className="w-4 h-4" strokeWidth={1.5} />
                {unreadCount > 0 && (
                  <span
                    className="absolute top-1 right-1 min-w-[15px] h-[15px] px-1 bg-[hsl(var(--accent-tag))] text-white text-[9px] font-mono font-bold rounded-full flex items-center justify-center animate-pulse"
                    data-testid="notification-badge"
                  >
                    {unreadCount > 9 ? "9+" : unreadCount}
                  </span>
                )}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-80 bg-popover border-border p-0 shadow-xl">
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
                    <CheckCheck className="w-3 h-3" /> Tümünü okundu yap
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
                          navigate(`/day/${r.date}`);
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
                            {isPast && (
                              <span className="text-[hsl(var(--accent-tag))] font-semibold">
                                (Süresi doldu)
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </DropdownMenuContent>
          </DropdownMenu>

          <Button
            size="icon"
            variant="ghost"
            className="h-8 w-8 text-muted-foreground hover:text-foreground cursor-pointer"
            onClick={toggle}
            data-testid="theme-toggle-btn"
          >
            {theme === "dark" ? (
              <Sun className="w-4 h-4" strokeWidth={1.5} />
            ) : (
              <Moon className="w-4 h-4" strokeWidth={1.5} />
            )}
          </Button>

          {u && u.user_id && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="ml-1 outline-none cursor-pointer" data-testid="user-menu-btn">
                  <Avatar className="h-7 w-7 ring-1 ring-border">
                    {u.picture && <AvatarImage src={u.picture} alt={u.name || ""} />}
                    <AvatarFallback className="text-xs font-mono bg-secondary font-bold">
                      {initials}
                    </AvatarFallback>
                  </Avatar>
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56 bg-popover border-border shadow-lg">
                <DropdownMenuLabel className="font-mono text-xs">
                  <div className="truncate font-semibold">{u.name}</div>
                  <div className="text-muted-foreground truncate">{u.email}</div>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />

                {/* Ayarlar Option directly above Çıkış yap */}
                <DropdownMenuItem
                  onClick={() => navigate("/settings")}
                  data-testid="settings-menu-btn"
                  className="cursor-pointer"
                >
                  <Settings className="w-3.5 h-3.5 mr-2 text-muted-foreground" strokeWidth={1.5} /> Ayarlar
                </DropdownMenuItem>

                <DropdownMenuSeparator />

                {/* Çıkış Yap */}
                <DropdownMenuItem
                  onClick={logout}
                  data-testid="logout-btn"
                  className="cursor-pointer text-destructive focus:text-destructive"
                >
                  <LogOut className="w-3.5 h-3.5 mr-2" strokeWidth={1.5} /> Çıkış yap
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </header>

      {/* Settings Modal Dialog */}
      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
    </>
  );
}
