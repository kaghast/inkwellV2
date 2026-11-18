import { useEffect, useState } from "react";

/** Chrome / Edge / Android install prompt event (not in TS's DOM types). */
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
}

let deferredPrompt: BeforeInstallPromptEvent | null = null;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((fn) => fn());

export function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia?.("(display-mode: standalone)").matches ||
    window.matchMedia?.("(display-mode: window-controls-overlay)").matches ||
    (navigator as any).standalone === true
  );
}

export function isIos(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  return /iphone|ipad|ipod/i.test(ua) || (/macintosh/i.test(ua) && navigator.maxTouchPoints > 1);
}

/** Registers the service worker (production builds only) and listens for install events. */
export function setupPwa() {
  if (typeof window === "undefined") return;

  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault(); // show our own install button instead of the mini-infobar
    deferredPrompt = e as BeforeInstallPromptEvent;
    notify();
  });
  window.addEventListener("appinstalled", () => {
    deferredPrompt = null;
    notify();
  });

  // The dev server keeps its hot reload; the worker would only get in the way there.
  if (!import.meta.env.PROD || !("serviceWorker" in navigator)) return;
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch((err) => {
      console.warn("Service worker registration failed:", err);
    });
  });
}

export async function promptInstall(): Promise<"accepted" | "dismissed" | "unavailable"> {
  if (!deferredPrompt) return "unavailable";
  const evt = deferredPrompt;
  deferredPrompt = null;
  notify();
  await evt.prompt();
  const { outcome } = await evt.userChoice;
  return outcome;
}

/** Install state for buttons: can the browser show its install dialog, is the app already installed? */
export function usePwaInstall() {
  const [, force] = useState(0);
  const [installed, setInstalled] = useState(isStandalone());
  useEffect(() => {
    const update = () => {
      force((n) => n + 1);
      setInstalled(isStandalone());
    };
    listeners.add(update);
    const mq = window.matchMedia?.("(display-mode: standalone)");
    mq?.addEventListener?.("change", update);
    return () => {
      listeners.delete(update);
      mq?.removeEventListener?.("change", update);
    };
  }, []);
  return {
    canInstall: Boolean(deferredPrompt) && !installed,
    installed,
    ios: isIos(),
    install: promptInstall,
  };
}
