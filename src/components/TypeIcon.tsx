import React from "react";
import {
  FileText, Kanban, Sun, Lightbulb, FolderKanban, User, Users, CalendarDays, BookOpen, GraduationCap,
  Newspaper, Quote, Bookmark, MapPin, Paperclip, Boxes, Home, type LucideIcon,
} from "lucide-react";

// Icons for object types. Only the icons used by built-in types are bundled;
// user-defined types fall back to a neutral icon.
const ICONS: Record<string, LucideIcon> = {
  FileText, Kanban, Sun, Lightbulb, FolderKanban, User, Users, CalendarDays, BookOpen, GraduationCap,
  Newspaper, Quote, Bookmark, MapPin, Paperclip, Home,
};

export function iconFor(name?: string | null): LucideIcon {
  return (name && ICONS[name]) || Boxes;
}

export default function TypeIcon({
  icon,
  color,
  className = "w-3.5 h-3.5",
  title,
}: {
  icon?: string | null;
  color?: string | null;
  className?: string;
  title?: string;
}) {
  const Icon = iconFor(icon);
  return <Icon className={className} style={color ? { color } : undefined} aria-hidden={title ? undefined : true} aria-label={title} strokeWidth={1.75} />;
}
