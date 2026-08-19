import React, { createContext, useContext, useEffect, useState, useCallback, ReactNode } from "react";
import api from "@/lib/api";
import type { User } from "@/types";

type UserState = User | false | null;

interface AuthCtx {
  user: UserState;
  loading: boolean;
  setUser: (u: UserState) => void;
  setSessionToken: (token: string) => void;
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthCtx | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUserState] = useState<UserState>(null);
  const [loading, setLoading] = useState(true);

  const setUser = useCallback((u: UserState) => {
    if (u && typeof u === "object") {
      const tok = (u as any).token || (u as any).access_token;
      if (tok && typeof window !== "undefined") {
        localStorage.setItem("inkwell_token", tok);
      }
    } else if (u === false && typeof window !== "undefined") {
      localStorage.removeItem("inkwell_token");
    }
    setUserState(u);
  }, []);

  const checkAuth = useCallback(async () => {
    try {
      const { data } = await api.get<User>("/auth/me");
      setUser(data);
    } catch {
      setUser(false);
    } finally {
      setLoading(false);
    }
  }, [setUser]);

  useEffect(() => {
    if (typeof window !== "undefined" && window.location.hash?.includes("session_id=")) {
      setLoading(false);
      return;
    }
    checkAuth();
  }, [checkAuth]);

  const setSessionToken = useCallback((token: string) => {
    if (typeof window !== "undefined") {
      localStorage.setItem("inkwell_token", token);
    }
    checkAuth();
  }, [checkAuth]);

  const value: AuthCtx = {
    user,
    loading,
    setUser,
    setSessionToken,
    refresh: checkAuth,
    logout: async () => {
      try {
        await api.post("/auth/logout");
      } catch {
        /* ignore */
      }
      if (typeof window !== "undefined") {
        localStorage.removeItem("inkwell_token");
      }
      setUserState(false);
    },
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export const useAuth = (): AuthCtx => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
};
