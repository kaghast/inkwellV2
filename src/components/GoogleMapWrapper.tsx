import React, { useState, useEffect, useRef } from "react";
import L from "leaflet";
import { APIProvider, Map, AdvancedMarker, Pin, InfoWindow, useMap } from "@vis.gl/react-google-maps";
import { DARK_MAP_STYLES, LIGHT_MAP_STYLES } from "@/lib/mapThemes";
import type { LocationItem } from "@/types";
import type { MapMouseEvent } from "@vis.gl/react-google-maps";

export const GOOGLE_MAPS_API_KEY =
  process.env.GOOGLE_MAPS_PLATFORM_KEY ||
  (import.meta as any).env?.VITE_GOOGLE_MAPS_PLATFORM_KEY ||
  (globalThis as any).GOOGLE_MAPS_PLATFORM_KEY ||
  "";

export const hasValidKey = Boolean(GOOGLE_MAPS_API_KEY) && GOOGLE_MAPS_API_KEY !== "YOUR_API_KEY";

export type MapMaskTheme = "auto" | "dark" | "light" | "paper" | "standard" | "satellite";

export interface GoogleMapWrapperProps {
  center: { lat: number; lng: number };
  zoom?: number;
  className?: string;
  style?: React.CSSProperties;
  children?: React.ReactNode;
  onMapClick?: (coords: { lat: number; lng: number }) => void;
  maskTheme?: MapMaskTheme;
  interactive?: boolean;
  locations?: LocationItem[];
  selectedLocationId?: string | null;
  onSelectLocation?: (id: string) => void;
  draggableMarker?: {
    position: { lat: number; lng: number };
    onDragEnd: (coords: { lat: number; lng: number }) => void;
  };
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

function LeafletMapFallback({
  center,
  zoom = 12,
  className = "",
  style,
  onMapClick,
  maskTheme = "auto",
  interactive = true,
  locations = [],
  selectedLocationId,
  onSelectLocation,
  draggableMarker,
}: GoogleMapWrapperProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markersLayerRef = useRef<L.LayerGroup | null>(null);
  const [isDark, setIsDark] = useState(false);

  useEffect(() => {
    const checkDark = () => {
      setIsDark(document.documentElement.classList.contains("dark"));
    };
    checkDark();
    const observer = new MutationObserver(checkDark);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);

  let tileUrl = "https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png";
  if (maskTheme === "satellite") {
    tileUrl = "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";
  } else if (maskTheme === "dark" || (maskTheme === "auto" && isDark)) {
    tileUrl = "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png";
  } else if (maskTheme === "standard") {
    tileUrl = "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png";
  }

  useEffect(() => {
    if (!containerRef.current) return;
    if (mapRef.current) {
      mapRef.current.remove();
    }

    const map = L.map(containerRef.current, {
      center: [center.lat, center.lng],
      zoom: zoom,
      zoomControl: interactive,
      dragging: interactive,
      scrollWheelZoom: interactive,
      attributionControl: false,
    });

    L.tileLayer(tileUrl, {
      maxZoom: 19,
      subdomains: "abcd",
    }).addTo(map);

    if (onMapClick) {
      map.on("click", (e: L.LeafletMouseEvent) => {
        onMapClick({ lat: e.latlng.lat, lng: e.latlng.lng });
      });
    }

    const markersLayer = L.layerGroup().addTo(map);
    markersLayerRef.current = markersLayer;
    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
      markersLayerRef.current = null;
    };
  }, [tileUrl, interactive]);

  useEffect(() => {
    if (mapRef.current && center && typeof center.lat === "number" && typeof center.lng === "number") {
      mapRef.current.panTo([center.lat, center.lng], { animate: true, duration: 0.5 });
      if (zoom) mapRef.current.setZoom(zoom);
    }
  }, [center.lat, center.lng, zoom]);

  useEffect(() => {
    if (!markersLayerRef.current || !mapRef.current) return;
    markersLayerRef.current.clearLayers();

    locations.forEach((loc) => {
      const isSelected = selectedLocationId === loc.location_id;
      const color = isSelected ? "#e11d48" : "#2563eb";

      const customIcon = L.divIcon({
        className: "custom-map-marker",
        html: `
          <div style="
            display: flex;
            align-items: center;
            justify-content: center;
            width: ${isSelected ? "32px" : "26px"};
            height: ${isSelected ? "32px" : "26px"};
            background-color: ${color};
            color: white;
            border-radius: 50% 50% 50% 0;
            transform: rotate(-45deg);
            border: 2px solid white;
            box-shadow: 0 4px 8px rgba(0,0,0,0.35);
            cursor: pointer;
            transition: all 0.2s ease;
          ">
            <div style="
              width: 8px;
              height: 8px;
              background-color: white;
              border-radius: 50%;
              transform: rotate(45deg);
            "></div>
          </div>
        `,
        iconSize: [isSelected ? 32 : 26, isSelected ? 32 : 26],
        iconAnchor: [isSelected ? 16 : 13, isSelected ? 32 : 26],
      });

      const marker = L.marker([Number(loc.lat), Number(loc.lng)], { icon: customIcon });
      marker.bindTooltip(`<b>${loc.name}</b>`, { direction: "top", offset: [0, -20] });
      marker.on("click", () => {
        onSelectLocation?.(loc.location_id);
      });
      markersLayerRef.current?.addLayer(marker);
    });

    if (draggableMarker) {
      const dragIcon = L.divIcon({
        className: "custom-drag-marker",
        html: `
          <div style="
            display: flex;
            align-items: center;
            justify-content: center;
            width: 32px;
            height: 32px;
            background-color: #2563eb;
            color: white;
            border-radius: 50% 50% 50% 0;
            transform: rotate(-45deg);
            border: 2px solid white;
            box-shadow: 0 4px 10px rgba(37,99,235,0.5);
            cursor: grab;
          ">
            <div style="
              width: 8px;
              height: 8px;
              background-color: white;
              border-radius: 50%;
              transform: rotate(45deg);
            "></div>
          </div>
        `,
        iconSize: [32, 32],
        iconAnchor: [16, 32],
      });

      const dragMarker = L.marker([draggableMarker.position.lat, draggableMarker.position.lng], {
        icon: dragIcon,
        draggable: true,
      });

      dragMarker.on("dragend", () => {
        const pos = dragMarker.getLatLng();
        draggableMarker.onDragEnd({ lat: pos.lat, lng: pos.lng });
      });

      markersLayerRef.current?.addLayer(dragMarker);
    }
  }, [locations, selectedLocationId, draggableMarker, onSelectLocation]);

  return (
    <div className={`relative w-full h-full min-h-[220px] rounded-xl overflow-hidden ${className}`}>
      <div ref={containerRef} style={{ width: "100%", height: "100%", ...style }} className="w-full h-full" />
    </div>
  );
}

export default function GoogleMapWrapper(props: GoogleMapWrapperProps) {
  const {
    center,
    zoom = 12,
    className = "",
    style,
    children,
    onMapClick,
    maskTheme = "auto",
    interactive = true,
  } = props;

  const [isDarkMode, setIsDarkMode] = useState(false);
  const [gmapError, setGmapError] = useState(false);

  useEffect(() => {
    const checkDark = () => {
      setIsDarkMode(document.documentElement.classList.contains("dark"));
    };
    checkDark();
    const observer = new MutationObserver(checkDark);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);

  if (!hasValidKey || gmapError) {
    return <LeafletMapFallback {...props} />;
  }

  let mapTypeId = "roadmap";
  if (maskTheme === "satellite") {
    mapTypeId = "satellite";
  }

  return (
    <div className={`relative w-full h-full min-h-[220px] rounded-xl overflow-hidden ${className}`}>
      <APIProvider
        apiKey={GOOGLE_MAPS_API_KEY}
        version="weekly"
        onError={(err) => {
          console.warn("[GoogleMaps] Failed loading Google Maps, falling back to OpenStreetMap:", err);
          setGmapError(true);
        }}
      >
        <Map
          defaultCenter={center}
          defaultZoom={zoom}
          mapTypeId={mapTypeId}
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
