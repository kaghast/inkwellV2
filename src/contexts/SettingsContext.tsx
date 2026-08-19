import React, { createContext, useContext, useState, useEffect, ReactNode } from "react";

export type NoteDefaultFilter =
  | "all"
  | "incomplete_tasks"
  | "completed_tasks"
  | "with_reminders"
  | "with_images"
  | "pinned_only";

export type SearchScope = "all_time" | "selected_day";

export interface UserSettings {
  defaultFilter: NoteDefaultFilter;
  searchScope: SearchScope;
  soundEnabled: boolean;
  compactCards: boolean;
}

const DEFAULT_SETTINGS: UserSettings = {
  defaultFilter: "all",
  searchScope: "selected_day",
  soundEnabled: true,
  compactCards: false,
};

const STORAGE_KEY = "inkwell_user_settings";

interface SettingsContextType {
  settings: UserSettings;
  updateSettings: (partial: Partial<UserSettings>) => void;
  resetSettings: () => void;
}

const SettingsContext = createContext<SettingsContextType | null>(null);

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<UserSettings>(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
      }
    } catch {
      /* ignore */
    }
    return DEFAULT_SETTINGS;
  });

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    } catch {
      /* ignore */
    }
  }, [settings]);

  const updateSettings = (partial: Partial<UserSettings>) => {
    setSettings((prev) => ({ ...prev, ...partial }));
  };

  const resetSettings = () => {
    setSettings(DEFAULT_SETTINGS);
  };

  return (
    <SettingsContext.Provider value={{ settings, updateSettings, resetSettings }}>
      {children}
    </SettingsContext.Provider>
  );
}

export function useSettings(): SettingsContextType {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error("useSettings must be used within SettingsProvider");
  return ctx;
}
