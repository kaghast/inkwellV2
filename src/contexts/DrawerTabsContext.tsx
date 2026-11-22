import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

/** What a drawer tab lists: notes linked to an area, tag, person, location or category. */
export type DrawerKind = "area" | "tag" | "person" | "location" | "category";

export interface DrawerTab {
  /** `${kind}:${value}` — opening the same thing twice reuses its tab. */
  id: string;
  kind: DrawerKind;
  /** area_id, tag name, person name, location_id or category_id */
  value: string;
  label: string;
  color?: string;
}

interface DrawerTabsCtx {
  tabs: DrawerTab[];
  activeId: string | null;
  /** Whether the right-side drawer is showing the active tab. */
  open: boolean;
  openTab: (tab: Omit<DrawerTab, "id">) => void;
  activate: (id: string) => void;
  closeTab: (id: string) => void;
  closeAll: () => void;
  setOpen: (open: boolean) => void;
}

const STORAGE_KEY = "inkwell:drawer-tabs";
const MAX_TABS = 12;

const Ctx = createContext<DrawerTabsCtx | null>(null);

function loadTabs(): { tabs: DrawerTab[]; activeId: string | null } {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return { tabs: [], activeId: null };
    const parsed = JSON.parse(raw);
    const tabs = Array.isArray(parsed?.tabs) ? (parsed.tabs as DrawerTab[]).filter((t) => t && t.id && t.kind) : [];
    const activeId = tabs.some((t) => t.id === parsed?.activeId) ? parsed.activeId : tabs[0]?.id ?? null;
    return { tabs, activeId };
  } catch {
    return { tabs: [], activeId: null };
  }
}

export function DrawerTabsProvider({ children }: { children: React.ReactNode }) {
  const initial = useMemo(loadTabs, []);
  const [tabs, setTabs] = useState<DrawerTab[]>(initial.tabs);
  const [activeId, setActiveId] = useState<string | null>(initial.activeId);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ tabs, activeId }));
    } catch {
      /* storage unavailable: tabs just do not survive a reload */
    }
  }, [tabs, activeId]);

  const openTab = useCallback((t: Omit<DrawerTab, "id">) => {
    const id = `${t.kind}:${t.value}`;
    setTabs((prev) => {
      const existing = prev.findIndex((x) => x.id === id);
      if (existing >= 0) {
        const next = [...prev];
        next[existing] = { ...next[existing], ...t, id };
        return next;
      }
      const next = [...prev, { ...t, id }];
      return next.length > MAX_TABS ? next.slice(next.length - MAX_TABS) : next;
    });
    setActiveId(id);
    setOpen(true);
  }, []);

  const activate = useCallback((id: string) => {
    setActiveId(id);
    setOpen(true);
  }, []);

  const closeTab = useCallback(
    (id: string) => {
      const idx = tabs.findIndex((t) => t.id === id);
      if (idx < 0) return;
      const next = tabs.filter((t) => t.id !== id);
      setTabs(next);
      if (activeId === id) {
        const neighbour = next[idx] || next[idx - 1] || null;
        setActiveId(neighbour ? neighbour.id : null);
        if (!neighbour) setOpen(false);
      }
    },
    [tabs, activeId]
  );

  const closeAll = useCallback(() => {
    setTabs([]);
    setActiveId(null);
    setOpen(false);
  }, []);

  const value = useMemo(
    () => ({ tabs, activeId, open: open && Boolean(activeId), openTab, activate, closeTab, closeAll, setOpen }),
    [tabs, activeId, open, openTab, activate, closeTab, closeAll]
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useDrawerTabs(): DrawerTabsCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useDrawerTabs must be used inside DrawerTabsProvider");
  return ctx;
}
