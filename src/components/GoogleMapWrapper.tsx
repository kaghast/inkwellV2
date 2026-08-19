import React, { useState, useEffect } from "react";
import { APIProvider, Map, AdvancedMarker, Pin, InfoWindow, useMap } from "@vis.gl/react-google-maps";
import { DARK_MAP_STYLES, LIGHT_MAP_STYLES } from "@/lib/mapThemes";
import { KeyRound, Sparkles, Layers, Compass, ExternalLink } from "lucide-react";

import type { MapMouseEvent } from "@vis.gl/react-google-maps";

export const GOOGLE_MAPS_API_KEY =
  process.env.GOOGLE_MAPS_PLATFORM_KEY ||
  (import.meta as any).env?.VITE_GOOGLE_MAPS_PLATFORM_KEY ||
  (globalThis as any).GOOGLE_MAPS_PLATFORM_KEY ||
  "";

export const hasValidKey = Boolean(GOOGLE_MAPS_API_KEY) && GOOGLE_MAPS_API_KEY !== "YOUR_API_KEY";

export type MapMaskTheme = "auto" | "dark" | "light" | "paper" | "standard" | "satellite";

interface GoogleMapWrapperProps {
  center: { lat: number; lng: number };
  zoom?: number;
  className?: string;
  style?: React.CSSProperties;
  children?: React.ReactNode;
  onMapClick?: (coords: { lat: number; lng: number }) => void;
  maskTheme?: MapMaskTheme;
  interactive?: boolean;
}

export function GoogleMapsKeySplash() {
  return (
    <div className="flex items-center justify-center h-full min-h-[360px] p-6 bg-card border border-border/80 rounded-xl shadow-sm text-foreground">
      <div className="max-w-md text-center space-y-4">
        <div className="w-12 h-12 rounded-full bg-primary/10 text-primary mx-auto flex items-center justify-center">
          <KeyRound className="w-6 h-6" />
        </div>
        <div>
          <h3 className="font-serif text-lg font-bold">Google Maps API Anahtarı Gerekli</h3>
          <p className="text-xs text-muted-foreground mt-1">
            Harita servisinin çalışabilmesi için Google Maps Platform API anahtarınızı tanımlayın.
          </p>
        </div>

        <div className="text-left bg-muted/40 border border-border/60 rounded-lg p-3.5 space-y-2 text-xs">
          <div className="font-medium text-foreground flex items-center gap-1.5">
            <span>Adım 1:</span>
            <a
              href="https://console.cloud.google.com/google/maps-apis/start?utm_campaign=gmp-code-assist-ais"
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary hover:underline inline-flex items-center gap-1"
            >
              Google Cloud Console'dan API Key Alın <ExternalLink className="w-3 h-3" />
            </a>
          </div>
          <div className="text-muted-foreground">
            <span className="font-medium text-foreground">Adım 2:</span> Sağ üst köşedeki <strong>Ayarlar (⚙️)</strong> → <strong>Secrets</strong> menüsünü açın.
          </div>
          <div className="text-muted-foreground">
            <span className="font-medium text-foreground">Adım 3:</span> <code>GOOGLE_MAPS_PLATFORM_KEY</code> adıyla anahtarınızı ekleyin.
          </div>
        </div>

        <p className="text-[11px] text-muted-foreground/80 italic">
          Anahtar eklendikten sonra uygulama otomatik olarak haritayı yükler.
        </p>
      </div>
    </div>
  );
}

function MapCenterController({ center, zoom }: { center: { lat: number; lng: number }; zoom?: number }) {
  const map = useMap();
  useEffect(() => {
    if (map && center && typeof center.lat === "number" && typeof center.lng === "number") {
      map.panTo(center);
      if (zoom) map.setZoom(zoom);
    }
  }, [map, center.lat, center.lng, zoom]);
  return null;
}

export default function GoogleMapWrapper({
  center,
  zoom = 12,
  className = "",
  style,
  children,
  onMapClick,
  maskTheme = "auto",
  interactive = true,
}: GoogleMapWrapperProps) {
  const [isDarkMode, setIsDarkMode] = useState(false);

  useEffect(() => {
    const checkDark = () => {
      setIsDarkMode(document.documentElement.classList.contains("dark"));
    };
    checkDark();
    const observer = new MutationObserver(checkDark);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);

  if (!hasValidKey) {
    return <GoogleMapsKeySplash />;
  }

  // Determine active styles based on maskTheme
  let activeStyles: google.maps.MapTypeStyle[] | undefined;
  let mapTypeId = "roadmap";

  if (maskTheme === "satellite") {
    mapTypeId = "satellite";
  } else if (maskTheme === "dark" || (maskTheme === "auto" && isDarkMode)) {
    activeStyles = DARK_MAP_STYLES;
  } else if (maskTheme === "light" || maskTheme === "paper" || (maskTheme === "auto" && !isDarkMode)) {
    activeStyles = LIGHT_MAP_STYLES;
  }

  return (
    <div className={`relative w-full h-full min-h-[220px] rounded-xl overflow-hidden ${className}`}>
      <APIProvider apiKey={GOOGLE_MAPS_API_KEY} version="weekly">
        <Map
          defaultCenter={center}
          defaultZoom={zoom}
          mapTypeId={mapTypeId}
          styles={activeStyles}
          mapId="DEMO_MAP_ID"
          internalUsageAttributionIds={["gmp_mcp_codeassist_v1_aistudio"]}
          style={{ width: "100%", height: "100%", ...style }}
          disableDefaultUI={!interactive}
          gestureHandling={interactive ? "greedy" : "none"}
          onClick={(e: MapMouseEvent) => {
            if (onMapClick && e.detail.latLng) {
              onMapClick(e.detail.latLng);
            }
          }}
        >
          <MapCenterController center={center} zoom={zoom} />
          {children}
        </Map>
      </APIProvider>

      {/* Elegant Theme Mask Overlay */}
      <div className="pointer-events-none absolute inset-0 rounded-xl ring-1 ring-inset ring-border/50 shadow-inner" />
      {isDarkMode && maskTheme !== "satellite" && (
        <div className="pointer-events-none absolute inset-0 bg-blue-950/5 mix-blend-color" />
      )}
    </div>
  );
}
