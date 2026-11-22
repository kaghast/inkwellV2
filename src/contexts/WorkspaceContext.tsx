import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import api from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import { INBOX_CHANGED, wsApi, type InboxCounts, type Space } from "@/lib/workspaceApi";
import type { NoteType } from "@/types";

type PaletteMode = "all" | "search" | "actions" | "task" | "template";

interface WorkspaceCtx {
  inbox: InboxCounts | null;
  refreshInbox: () => void;
  spaces: Space[];
  refreshSpaces: () => void;
  noteTypes: NoteType[];
  typeById: (id?: string | null) => NoteType | undefined;
  paletteOpen: boolean;
  paletteMode: PaletteMode;
  openPalette: (mode?: PaletteMode) => void;
  closePalette: () => void;
  templateKey: string | null;
  openTemplate: (key: string | null) => void;
  registerCaptureFocus: (fn: (() => void) | null) => void;
  focusCapture: () => void;
}

const Ctx = createContext<WorkspaceCtx | null>(null);

function isEditable(el: EventTarget | null): boolean {
  const t = el as HTMLElement | null;
  if (!t) return false;
  const tag = t.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || t.isContentEditable;
}

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [inbox, setInbox] = useState<InboxCounts | null>(null);
  const [spaces, setSpaces] = useState<Space[]>([]);
  const [noteTypes, setNoteTypes] = useState<NoteType[]>([]);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [paletteMode, setPaletteMode] = useState<PaletteMode>("all");
  const [templateKey, setTemplateKey] = useState<string | null>(null);
  const captureFocus = useRef<(() => void) | null>(null);

  const refreshInbox = useCallback(() => {
    if (!user) return;
    wsApi.inboxCounts().then(setInbox).catch(() => undefined);
  }, [user]);
  const refreshSpaces = useCallback(() => {
    if (!user) return;
    wsApi.spaces().then(setSpaces).catch(() => undefined);
  }, [user]);

  useEffect(() => {
    if (!user) {
      setInbox(null);
      return;
    }
    refreshInbox();
    refreshSpaces();
    api.get("/note-types").then((r) => setNoteTypes(r.data || [])).catch(() => undefined);
    const onChange = () => refreshInbox();
    window.addEventListener(INBOX_CHANGED, onChange);
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") refreshInbox();
    }, 30_000);
    return () => {
      window.removeEventListener(INBOX_CHANGED, onChange);
      window.clearInterval(timer);
    };
  }, [user, refreshInbox, refreshSpaces]);

  // While captures are being processed, poll faster so the badge updates.
  useEffect(() => {
    if (!inbox || inbox.new + inbox.processing === 0) return;
    const t = window.setTimeout(refreshInbox, 2500);
    return () => window.clearTimeout(t);
  }, [inbox, refreshInbox]);

  const openPalette = useCallback((mode: PaletteMode = "all") => {
    setPaletteMode(mode);
    setPaletteOpen(true);
  }, []);
  const closePalette = useCallback(() => setPaletteOpen(false), []);
  const focusCapture = useCallback(() => captureFocus.current?.(), []);

  // Global shortcuts. Single keys only fire outside editable fields so the
  // editors keep their own keys; we avoid browser-reserved Ctrl combos.
  useEffect(() => {
    if (!user) return;
    let pendingG = 0;
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((o) => !o);
        setPaletteMode("all");
        return;
      }
      if (mod || e.altKey || isEditable(e.target) || document.querySelector("[role=dialog]")) return;
      const now = Date.now();
      if (pendingG && now - pendingG < 1200) {
        pendingG = 0;
        const dest = { h: "/", i: "/inbox", t: "/today", k: "/all-notes", s: "/spaces" }[e.key.toLowerCase()];
        if (dest) {
          e.preventDefault();
          navigate(dest);
        }
        return;
      }
      if (e.key === "g") {
        pendingG = now;
        return;
      }
      if (e.key === "c") {
        e.preventDefault();
        captureFocus.current?.();
      } else if (e.key === "/") {
        e.preventDefault();
        openPalette("search");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [user, navigate, openPalette]);

  const value = useMemo<WorkspaceCtx>(
    () => ({
      inbox,
      refreshInbox,
      spaces,
      refreshSpaces,
      noteTypes,
      typeById: (id) => noteTypes.find((t) => t.type_id === (id || "type_plain")),
      paletteOpen,
      paletteMode,
      openPalette,
      closePalette,
      templateKey,
      openTemplate: setTemplateKey,
      registerCaptureFocus: (fn) => {
        captureFocus.current = fn;
      },
      focusCapture,
    }),
    [inbox, refreshInbox, spaces, refreshSpaces, noteTypes, paletteOpen, paletteMode, openPalette, closePalette, templateKey, focusCapture]
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useWorkspace(): WorkspaceCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error("useWorkspace must be used inside WorkspaceProvider");
  return c;
}
