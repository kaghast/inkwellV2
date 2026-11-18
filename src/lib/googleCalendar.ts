import { useEffect, useState } from "react";
import api from "@/lib/api";
import type { CalendarEvent } from "@/lib/calendar";

export interface GcalStatus {
  configured: boolean;
  connected: boolean;
  email: string | null;
  connected_at: string | null;
}

let statusCache: GcalStatus | null = null;
let statusRequest: Promise<GcalStatus> | null = null;
const listeners = new Set<(s: GcalStatus) => void>();

function publish(s: GcalStatus) {
  statusCache = s;
  listeners.forEach((fn) => fn(s));
}

export function loadGcalStatus(force = false): Promise<GcalStatus> {
  if (statusCache && !force) return Promise.resolve(statusCache);
  if (!statusRequest || force) {
    statusRequest = api
      .get<GcalStatus>("/integrations/google-calendar")
      .then(({ data }) => {
        publish(data);
        return data;
      })
      .finally(() => {
        statusRequest = null;
      });
  }
  return statusRequest;
}

/** Shared connection status (Settings page and calendar panel stay in sync). */
export function useGcalStatus(): { status: GcalStatus | null; refresh: () => Promise<GcalStatus> } {
  const [status, setStatus] = useState<GcalStatus | null>(statusCache);
  useEffect(() => {
    listeners.add(setStatus);
    loadGcalStatus().then(setStatus).catch(() => undefined);
    return () => {
      listeners.delete(setStatus);
    };
  }, []);
  return { status, refresh: () => loadGcalStatus(true) };
}

/**
 * Opens Google's consent screen in a popup. The server keeps the resulting
 * refresh token, so this is needed only once per account.
 */
export async function connectGoogleCalendar(): Promise<GcalStatus> {
  // Open the popup synchronously (before any await) so it is not blocked.
  const popup = window.open("about:blank", "inkwell-gcal", "width=520,height=680");
  try {
    const { data } = await api.post<{ url: string }>("/integrations/google-calendar/connect");
    if (popup && !popup.closed) {
      popup.location.href = data.url;
    } else {
      // Popup blocked: continue in this tab; the callback returns to Settings.
      window.location.href = data.url;
      return new Promise(() => undefined);
    }
  } catch (err) {
    popup?.close();
    throw err;
  }

  return new Promise<GcalStatus>((resolve, reject) => {
    let done = false;
    const finish = async (error?: string) => {
      if (done) return;
      done = true;
      window.removeEventListener("message", onMessage);
      clearInterval(timer);
      const s = await loadGcalStatus(true).catch(() => statusCache);
      if (error) reject(new Error(error));
      else if (s?.connected) resolve(s);
      else reject(new Error("Google Takvim bağlantısı tamamlanmadı"));
    };
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      const t = event.data?.type;
      if (t === "GCAL_CONNECTED") finish();
      else if (t === "GCAL_ERROR") finish(event.data?.message || "Google Takvim bağlantısı kurulamadı");
    };
    window.addEventListener("message", onMessage);
    // The user may simply close the popup
    const timer = window.setInterval(() => {
      if (popup.closed) finish();
    }, 700);
  });
}

export async function disconnectGoogleCalendar(): Promise<void> {
  await api.delete("/integrations/google-calendar");
  await loadGcalStatus(true).catch(() => undefined);
}

export class GcalReconnectRequired extends Error {}

/** Events of one local day (YYYY-MM-DD), read through the server. */
export async function fetchGcalEventsForDate(isoDate: string): Promise<CalendarEvent[]> {
  const start = new Date(`${isoDate}T00:00:00`);
  const end = new Date(`${isoDate}T23:59:59.999`);
  try {
    const { data } = await api.get<CalendarEvent[]>("/integrations/google-calendar/events", {
      params: { time_min: start.toISOString(), time_max: end.toISOString() },
    });
    return Array.isArray(data) ? data : [];
  } catch (err: any) {
    if (err?.response?.status === 409) {
      await loadGcalStatus(true).catch(() => undefined);
      throw new GcalReconnectRequired(err.response.data?.detail || "Google Takvim yeniden bağlanmalı");
    }
    throw err;
  }
}
