import { useEffect, useState } from "react";
import api from "@/lib/api";
import type { DriveFileRef } from "@/types";

// Google Drive file linking (Settings > Google Drive). The server keeps the
// Google grant shared with Google Calendar; Inkwell only reads file metadata.

export interface GdriveStatus {
  configured: boolean;
  connected: boolean;
  email: string | null;
  connected_at: string | null;
}

export interface DriveSearchFile extends DriveFileRef {
  modified_time: string | null;
  owner: string | null;
}

let statusCache: GdriveStatus | null = null;
let statusRequest: Promise<GdriveStatus> | null = null;
const listeners = new Set<(s: GdriveStatus) => void>();

function publish(s: GdriveStatus) {
  statusCache = s;
  listeners.forEach((fn) => fn(s));
}

export function loadGdriveStatus(force = false): Promise<GdriveStatus> {
  if (statusCache && !force) return Promise.resolve(statusCache);
  if (!statusRequest || force) {
    statusRequest = api
      .get<GdriveStatus>("/integrations/google-drive")
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

/** Shared connection status (Settings, note composer and picker stay in sync). */
export function useGdriveStatus(): { status: GdriveStatus | null; refresh: () => Promise<GdriveStatus> } {
  const [status, setStatus] = useState<GdriveStatus | null>(statusCache);
  useEffect(() => {
    listeners.add(setStatus);
    loadGdriveStatus().then(setStatus).catch(() => undefined);
    return () => {
      listeners.delete(setStatus);
    };
  }, []);
  return { status, refresh: () => loadGdriveStatus(true) };
}

/** Opens Google's consent screen in a popup; needed once per account. */
export async function connectGoogleDrive(): Promise<GdriveStatus> {
  // Open the popup synchronously (before any await) so it is not blocked.
  const popup = window.open("about:blank", "inkwell-gdrive", "width=520,height=680");
  try {
    const { data } = await api.post<{ url: string }>("/integrations/google-drive/connect");
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

  return new Promise<GdriveStatus>((resolve, reject) => {
    let done = false;
    const finish = async (error?: string) => {
      if (done) return;
      done = true;
      window.removeEventListener("message", onMessage);
      clearInterval(timer);
      const s = await loadGdriveStatus(true).catch(() => statusCache);
      if (error) reject(new Error(error));
      else if (s?.connected) resolve(s);
      else reject(new Error("Google Drive bağlantısı tamamlanmadı"));
    };
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      const t = event.data?.type;
      if (t === "GDRIVE_CONNECTED") finish();
      else if (t === "GDRIVE_ERROR") finish(event.data?.message || "Google Drive bağlantısı kurulamadı");
    };
    window.addEventListener("message", onMessage);
    // The user may simply close the popup
    const timer = window.setInterval(() => {
      if (popup.closed) finish();
    }, 700);
  });
}

export async function disconnectGoogleDrive(): Promise<void> {
  await api.delete("/integrations/google-drive");
  await loadGdriveStatus(true).catch(() => undefined);
}

export class GdriveReconnectRequired extends Error {}

/** Searches Drive by file name; an empty query lists recently changed files. */
export async function searchDriveFiles(
  q: string,
  pageToken?: string | null
): Promise<{ files: DriveSearchFile[]; next_page_token: string | null }> {
  try {
    const { data } = await api.get<{ files: DriveSearchFile[]; next_page_token: string | null }>(
      "/integrations/google-drive/files",
      { params: { q: q || undefined, page_token: pageToken || undefined } }
    );
    return { files: Array.isArray(data?.files) ? data.files : [], next_page_token: data?.next_page_token || null };
  } catch (err: any) {
    if (err?.response?.status === 409) {
      await loadGdriveStatus(true).catch(() => undefined);
      throw new GdriveReconnectRequired(err.response.data?.detail || "Google Drive yeniden bağlanmalı");
    }
    throw err;
  }
}

/** Only the fields stored on the note. */
export function toDriveRef(f: DriveFileRef): DriveFileRef {
  return { id: f.id, name: f.name, mime_type: f.mime_type, web_view_link: f.web_view_link, icon_link: f.icon_link };
}

/** Readable file kind for Google's MIME types. */
export function driveKindLabel(mime: string): string {
  const map: Record<string, string> = {
    "application/vnd.google-apps.document": "Doküman",
    "application/vnd.google-apps.spreadsheet": "E-tablo",
    "application/vnd.google-apps.presentation": "Sunu",
    "application/vnd.google-apps.form": "Form",
    "application/vnd.google-apps.drawing": "Çizim",
    "application/vnd.google-apps.folder": "Klasör",
    "application/pdf": "PDF",
  };
  if (map[mime]) return map[mime];
  if (mime.startsWith("image/")) return "Görsel";
  if (mime.startsWith("video/")) return "Video";
  if (mime.startsWith("audio/")) return "Ses";
  if (mime.startsWith("text/")) return "Metin";
  return "Dosya";
}
