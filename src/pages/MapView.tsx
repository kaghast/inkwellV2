import React, { useState, useEffect, useMemo, useCallback } from "react";
import { Link, useNavigate } from "react-router-dom";
import api, { formatApiError } from "@/lib/api";
import type { Note, LocationItem, Category, ItemGroup, NoteType } from "@/types";
import TopBar from "@/components/TopBar";
import NoteCard from "@/components/NoteCard";
import NoteComposer from "@/components/NoteComposer";
import GoogleMapWrapper, { MapMaskTheme } from "@/components/GoogleMapWrapper";
import { AdvancedMarker, Pin, InfoWindow } from "@vis.gl/react-google-maps";
import {
  MapPin,
  Search,
  Plus,
  Navigation,
  FileText,
  Layers,
  ChevronRight,
  Sparkles,
  Map as MapIcon,
  X,
  Compass,
  Palette,
  Eye,
  Crosshair,
  PenTool,
  Boxes,
  Loader2,
} from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";

export default function MapView() {
  const navigate = useNavigate();
  const [locations, setLocations] = useState<LocationItem[]>([]);
  const [notes, setNotes] = useState<Note[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [noteTypes, setNoteTypes] = useState<NoteType[]>([]);
  const [selectedLocationId, setSelectedLocationId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [maskTheme, setMaskTheme] = useState<MapMaskTheme>("auto");

  // GPS Current Location State
  const [currentLocation, setCurrentLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [isLocating, setIsLocating] = useState(false);
  const [userFocusCenter, setUserFocusCenter] = useState<{ lat: number; lng: number } | null>(null);

  // Realtime Map Search Bar State (Google Maps Style)
  const [mapSearchQuery, setMapSearchQuery] = useState("");
  const [mapSearchResults, setMapSearchResults] = useState<{
    id: string;
    name: string;
    display_name: string;
    lat: number;
    lng: number;
    isExisting: boolean;
    locationId?: string;
    noteCount?: number;
  }[]>([]);
  const [isSearchingMap, setIsSearchingMap] = useState(false);
  const [showSearchDropdown, setShowSearchDropdown] = useState(false);

  // New location only modal
  const [newLocModalOpen, setNewLocModalOpen] = useState(false);
  const [newLocName, setNewLocName] = useState("");
  const [newLocLat, setNewLocLat] = useState("41.0082");
  const [newLocLng, setNewLocLng] = useState("28.9784");

  // Direct Note Creation at Coordinate Point Modal
  const [pointNoteModalOpen, setPointNoteModalOpen] = useState(false);
  const [targetCoords, setTargetCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [targetLocName, setTargetLocName] = useState("");
  const [pointNoteTitle, setPointNoteTitle] = useState("");
  const [pointNoteContent, setPointNoteContent] = useState("");
  const [pointNoteTypeId, setPointNoteTypeId] = useState("type_plain");
  const [isSubmittingNote, setIsSubmittingNote] = useState(false);

  const [composerOpen, setComposerOpen] = useState(false);

  // Automatically fetch current GPS location on page load
  useEffect(() => {
    if ("geolocation" in navigator) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const coords = { lat: pos.coords.latitude, lng: pos.coords.longitude };
          setCurrentLocation(coords);
        },
        () => {
          /* ignore initial silent error */
        },
        { enableHighAccuracy: true, timeout: 8000 }
      );
    }
  }, []);

  // Realtime Geocoding Search Effect (OpenStreetMap + Local Locations)
  useEffect(() => {
    if (!mapSearchQuery.trim()) {
      setMapSearchResults([]);
      setIsSearchingMap(false);
      return;
    }

    const timer = setTimeout(async () => {
      setIsSearchingMap(true);
      const q = mapSearchQuery.trim().toLowerCase();

      // 1. Local locations in Inkwell
      const localMatches = locations
        .filter((l) => l.name.toLowerCase().includes(q))
        .map((l) => ({
          id: `local_${l.location_id}`,
          name: l.name,
          display_name: `Kayıtlı Lokasyon (${Number(l.lat).toFixed(4)}, ${Number(l.lng).toFixed(4)})`,
          lat: Number(l.lat),
          lng: Number(l.lng),
          isExisting: true,
          locationId: l.location_id,
          noteCount: (notesByLocation[l.location_id] || []).length,
        }));

      // 2. Realtime Global OpenStreetMap Nominatim geocoder
      let globalMatches: any[] = [];
      try {
        const res = await fetch(
          `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(
            mapSearchQuery.trim()
          )}&limit=5&addressdetails=1`,
          {
            headers: {
              "Accept-Language": "tr,en",
            },
          }
        );
        if (res.ok) {
          const data = await res.json();
          globalMatches = data.map((item: any) => ({
            id: `global_${item.place_id}`,
            name: item.name || item.display_name.split(",")[0],
            display_name: item.display_name,
            lat: parseFloat(item.lat),
            lng: parseFloat(item.lon),
            isExisting: false,
          }));
        }
      } catch (e) {
        console.warn("Geocoding failed", e);
      }

      setMapSearchResults([...localMatches, ...globalMatches]);
      setIsSearchingMap(false);
    }, 350);

    return () => clearTimeout(timer);
  }, [mapSearchQuery, locations]);

  const fetchAux = useCallback(async () => {
    try {
      const [l, c, nt, n] = await Promise.all([
        api.get<LocationItem[]>("/locations"),
        api.get<Category[]>("/categories"),
        api.get<NoteType[]>("/note-types"),
        api.get<Note[]>("/notes"),
      ]);
      setLocations(Array.isArray(l.data) ? l.data : []);
      setCategories(Array.isArray(c.data) ? c.data : []);
      setNoteTypes(Array.isArray(nt.data) ? nt.data : []);
      setNotes(Array.isArray(n.data) ? n.data : []);
    } catch (err) {
      console.warn("Failed fetching map data:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAux();
  }, [fetchAux]);

  // Group notes count by location_id
  const notesByLocation = useMemo(() => {
    const map: Record<string, Note[]> = {};
    (Array.isArray(notes) ? notes : []).forEach((n) => {
      if (n && n.location_id) {
        if (!map[n.location_id]) map[n.location_id] = [];
        map[n.location_id].push(n);
      }
    });
    return map;
  }, [notes]);

  const locationMap = useMemo(() => {
    const m: Record<string, LocationItem> = {};
    (Array.isArray(locations) ? locations : []).forEach((l) => {
      if (l && l.location_id) m[l.location_id] = l;
    });
    return m;
  }, [locations]);

  const categoryMap = useMemo(() => {
    const m: Record<string, Category> = {};
    (Array.isArray(categories) ? categories : []).forEach((c) => {
      if (c && c.category_id) m[c.category_id] = c;
    });
    return m;
  }, [categories]);

  const noteTypeMap = useMemo(() => {
    const m: Record<string, NoteType> = {};
    (Array.isArray(noteTypes) ? noteTypes : []).forEach((nt) => {
      if (nt && nt.type_id) m[nt.type_id] = nt;
    });
    return m;
  }, [noteTypes]);

  // Filtered locations
  const filteredLocations = useMemo(() => {
    const list = Array.isArray(locations) ? locations : [];
    if (!searchQuery.trim()) return list;
    const q = searchQuery.toLowerCase().trim();
    return list.filter((l) => l && l.name && l.name.toLowerCase().includes(q));
  }, [locations, searchQuery]);

  const selectedLocation = selectedLocationId ? locationMap[selectedLocationId] : null;
  const selectedLocationNotes = selectedLocationId ? notesByLocation[selectedLocationId] || [] : [];

  // Sort selected location notes newest to oldest
  const sortedSelectedNotes = useMemo(() => {
    return [...selectedLocationNotes].sort((a, b) => {
      return new Date(b.date || b.created_at).getTime() - new Date(a.date || a.created_at).getTime();
    });
  }, [selectedLocationNotes]);

  // Center coordinate
  const mapCenter = useMemo<{ lat: number; lng: number }>(() => {
    if (userFocusCenter) {
      return userFocusCenter;
    }
    if (selectedLocation) {
      return { lat: Number(selectedLocation.lat), lng: Number(selectedLocation.lng) };
    }
    if (currentLocation) {
      return currentLocation;
    }
    if (locations.length > 0) {
      return { lat: Number(locations[0].lat), lng: Number(locations[0].lng) };
    }
    return { lat: 41.0082, lng: 28.9784 }; // Istanbul default
  }, [userFocusCenter, selectedLocation, currentLocation, locations]);

  // Move map directly to current GPS Location
  const goToCurrentLocation = () => {
    if ("geolocation" in navigator) {
      setIsLocating(true);
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const coords = { lat: pos.coords.latitude, lng: pos.coords.longitude };
          setCurrentLocation(coords);
          setUserFocusCenter(coords);
          setSelectedLocationId(null);
          setIsLocating(false);
          toast.success("Mevcut konumunuza odaklanıldı 📍");
        },
        (err) => {
          setIsLocating(false);
          toast.error("Konum alınamadı: " + err.message);
        },
        { enableHighAccuracy: true, timeout: 8000 }
      );
    } else {
      toast.error("Tarayıcınız konum servisini desteklemiyor");
    }
  };

  // Open note creation directly at current GPS location
  const handleAddNoteAtCurrentLocation = () => {
    if ("geolocation" in navigator) {
      setIsLocating(true);
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const coords = { lat: pos.coords.latitude, lng: pos.coords.longitude };
          setCurrentLocation(coords);
          setUserFocusCenter(coords);
          setIsLocating(false);
          setTargetCoords(coords);
          setTargetLocName("Mevcut Konumum");
          setPointNoteTitle("");
          setPointNoteContent("");
          setPointNoteModalOpen(true);
        },
        (err) => {
          setIsLocating(false);
          toast.error("Mevcut konum alınamadı: " + err.message);
        },
        { enableHighAccuracy: true, timeout: 8000 }
      );
    } else {
      toast.error("Tarayıcınız konum servisini desteklemiyor");
    }
  };

  // Click anywhere on map -> Open Direct Note modal at that coordinate
  const handleMapClick = (coords: { lat: number; lng: number }) => {
    setTargetCoords(coords);
    setTargetLocName(`Nokta (${coords.lat.toFixed(4)}, ${coords.lng.toFixed(4)})`);
    setPointNoteTitle("");
    setPointNoteContent("");
    setPointNoteModalOpen(true);
  };

  // Save Note and Location together in one single action
  const handleSaveNoteAtPoint = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!targetCoords) return;
    if (!pointNoteTitle.trim() && !pointNoteContent.trim()) {
      toast.error("Lütfen bir not başlığı veya içeriği giriniz");
      return;
    }
    if (!targetLocName.trim()) {
      toast.error("Lütfen bu konuma bir isim veriniz");
      return;
    }

    setIsSubmittingNote(true);
    try {
      const locName = targetLocName.trim();
      let locId: string;

      // Check if location already exists around this coordinate
      const existing = locations.find(
        (l) => Math.abs(Number(l.lat) - targetCoords.lat) < 0.0002 && Math.abs(Number(l.lng) - targetCoords.lng) < 0.0002
      );

      if (existing) {
        locId = existing.location_id;
      } else {
        const { data: newLoc } = await api.post<LocationItem>("/locations", {
          name: locName,
          lat: targetCoords.lat,
          lng: targetCoords.lng,
        });
        locId = newLoc.location_id;
        setLocations((prev) => [newLoc, ...prev]);
      }

      // Create Note
      const { data: newNote } = await api.post<Note>("/notes", {
        title: pointNoteTitle.trim(),
        content: pointNoteContent.trim(),
        date: new Date().toISOString().slice(0, 10),
        location_id: locId,
        note_type_id: pointNoteTypeId !== "type_plain" ? pointNoteTypeId : null,
        custom_fields: {},
      });

      setNotes((prev) => [newNote, ...prev]);
      setSelectedLocationId(locId);
      setUserFocusCenter(targetCoords);
      setPointNoteModalOpen(false);
      setPointNoteTitle("");
      setPointNoteContent("");
      setTargetCoords(null);
      toast.success(`Not "${locName}" konumuna başarıyla kaydedildi! 📍`);
      fetchAux();
    } catch (err: any) {
      toast.error(formatApiError(err) || "Not kaydedilemedi");
    } finally {
      setIsSubmittingNote(false);
    }
  };

  const handleCreateLocation = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newLocName.trim()) {
      toast.error("Lokasyon adı giriniz");
      return;
    }
    const lat = parseFloat(newLocLat);
    const lng = parseFloat(newLocLng);
    if (isNaN(lat) || isNaN(lng)) {
      toast.error("Geçerli enlem ve boylam giriniz");
      return;
    }

    try {
      const { data } = await api.post<LocationItem>("/locations", {
        name: newLocName.trim(),
        lat,
        lng,
      });
      setLocations((prev) => [data, ...prev]);
      setSelectedLocationId(data.location_id);
      setNewLocModalOpen(false);
      setNewLocName("");
      toast.success(`"${data.name}" lokasyonu eklendi`);
    } catch (err: any) {
      toast.error(err.response?.data?.detail || "Lokasyon eklenemedi");
    }
  };

  const useCurrentPosition = () => {
    if ("geolocation" in navigator) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          setNewLocLat(pos.coords.latitude.toFixed(6));
          setNewLocLng(pos.coords.longitude.toFixed(6));
          toast.success("Mevcut GPS konumunuz alındı");
        },
        (err) => {
          toast.error("Konum alınamadı: " + err.message);
        }
      );
    } else {
      toast.error("Tarayıcınız konum servisini desteklemiyor");
    }
  };

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col antialiased">
      <TopBar />

      <div className="flex-1 flex flex-col lg:flex-row h-[calc(100vh-3.5rem)] overflow-hidden">
        {/* Left Panel: Location Directory */}
        <aside className="w-full lg:w-80 xl:w-96 border-r border-border bg-card/60 flex flex-col shrink-0 h-1/3 lg:h-full overflow-hidden">
          <div className="p-3.5 border-b border-border space-y-2.5 shrink-0 bg-background/50">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <MapPin className="w-4 h-4 text-primary" />
                <h2 className="font-serif font-bold text-sm text-foreground">Kayıtlı Lokasyonlar</h2>
              </div>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={handleAddNoteAtCurrentLocation}
                  title="Mevcut GPS konumuma hemen not yaz"
                  className="flex items-center gap-1 text-[11px] px-2 py-1 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-md transition-colors cursor-pointer shadow-2xs"
                >
                  <Navigation className="w-3 h-3" /> Konuma Not
                </button>
                <button
                  type="button"
                  onClick={() => setNewLocModalOpen(true)}
                  className="flex items-center gap-1 text-[11px] px-2 py-1 bg-secondary hover:bg-muted text-foreground font-medium rounded-md transition-colors cursor-pointer border border-border"
                  data-testid="add-location-btn"
                >
                  <Plus className="w-3 h-3" /> Ekle
                </button>
              </div>
            </div>

            <div className="relative">
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Lokasyon ara…"
                className="w-full pl-8 pr-3 py-1.5 bg-background border border-border rounded-md text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/40 font-mono"
                data-testid="search-locations-input"
              />
              <Search className="w-3.5 h-3.5 text-muted-foreground absolute left-2.5 top-1/2 -translate-y-1/2" />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery("")}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>
          </div>

          {/* Location Items List */}
          <div className="flex-1 overflow-y-auto divide-y divide-border/40 p-2 space-y-1">
            {loading ? (
              <div className="p-4 text-center text-xs text-muted-foreground">Lokasyonlar yükleniyor…</div>
            ) : filteredLocations.length === 0 ? (
              <div className="p-6 text-center text-xs text-muted-foreground space-y-2">
                <p>Kayıtlı lokasyon bulunamadı.</p>
                <button
                  type="button"
                  onClick={handleAddNoteAtCurrentLocation}
                  className="text-primary hover:underline font-medium cursor-pointer"
                >
                  📍 Mevcut konumuna hemen ilk notu ekle
                </button>
              </div>
            ) : (
              filteredLocations.map((loc) => {
                const noteCount = (notesByLocation[loc.location_id] || []).length;
                const isSelected = selectedLocationId === loc.location_id;

                return (
                  <div
                    key={loc.location_id}
                    onClick={() => {
                      setSelectedLocationId(loc.location_id);
                      setUserFocusCenter({ lat: Number(loc.lat), lng: Number(loc.lng) });
                    }}
                    className={`flex items-center justify-between p-2.5 rounded-lg cursor-pointer transition-all group ${
                      isSelected
                        ? "bg-primary/10 border border-primary/30 shadow-2xs"
                        : "hover:bg-muted/60 border border-transparent"
                    }`}
                    data-testid={`location-item-${loc.location_id}`}
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div
                        className={`w-7 h-7 rounded-md flex items-center justify-center shrink-0 transition-colors ${
                          isSelected
                            ? "bg-primary text-primary-foreground font-bold shadow-sm"
                            : "bg-secondary text-foreground group-hover:bg-primary/20"
                        }`}
                      >
                        <MapPin className="w-3.5 h-3.5" />
                      </div>
                      <div className="min-w-0">
                        <div className="text-xs font-semibold truncate text-foreground group-hover:text-primary transition-colors">
                          {loc.name}
                        </div>
                        <div className="text-[10px] font-mono text-muted-foreground truncate">
                          {Number(loc.lat).toFixed(4)}, {Number(loc.lng).toFixed(4)}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-1.5 shrink-0">
                      <span
                        className={`text-[10px] font-mono font-medium px-2 py-0.5 rounded-full ${
                          noteCount > 0
                            ? "bg-primary/15 text-primary font-bold"
                            : "bg-muted text-muted-foreground"
                        }`}
                      >
                        {noteCount} not
                      </span>
                      <ChevronRight className="w-3.5 h-3.5 text-muted-foreground opacity-50 group-hover:opacity-100" />
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </aside>

        {/* Center / Right: Interactive Google Map & Location Notes Drawer */}
        <div className="flex-1 flex flex-col lg:flex-row relative min-h-[450px] lg:min-h-0 h-full w-full">
          {/* Map Surface with Top Dedicated Control Bar */}
          <div className="flex-1 flex flex-col h-full w-full relative">
            {/* Top Dedicated Map Controls & Realtime Search Bar (z-[1000] to sit cleanly above map) */}
            <div className="p-2.5 bg-background border-b border-border/80 flex items-center justify-between gap-2 flex-wrap relative z-[1000] shadow-xs">
              {/* Left Action Buttons */}
              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={handleAddNoteAtCurrentLocation}
                  disabled={isLocating}
                  className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-700 text-white px-3 py-1.5 rounded-lg shadow-sm text-xs font-semibold cursor-pointer transition-all hover:scale-[1.02]"
                >
                  {isLocating ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Navigation className="w-3.5 h-3.5" />
                  )}
                  <span>Mevcut Konumuma Not Yaz</span>
                </button>

                <button
                  type="button"
                  onClick={goToCurrentLocation}
                  disabled={isLocating}
                  title="Mevcut GPS Konumuma Odaklan"
                  className="flex items-center gap-1.5 bg-secondary hover:bg-muted text-foreground px-2.5 py-1.5 rounded-lg border border-border text-xs font-medium cursor-pointer transition-colors"
                >
                  <Crosshair className="w-3.5 h-3.5 text-blue-500" />
                  <span className="hidden sm:inline">Konumumu Bul</span>
                </button>
              </div>

              {/* Center: Google Maps Style Realtime Search Bar */}
              <div className="flex-1 min-w-[240px] max-w-md relative z-[1001]">
                <div className="relative bg-card rounded-lg border border-border shadow-xs transition-all focus-within:ring-2 focus-within:ring-primary/40 focus-within:border-primary">
                  <div className="flex items-center px-2.5 py-1.5">
                    {isSearchingMap ? (
                      <Loader2 className="w-3.5 h-3.5 text-primary animate-spin shrink-0 mr-2" />
                    ) : (
                      <Search className="w-3.5 h-3.5 text-muted-foreground shrink-0 mr-2" />
                    )}
                    <input
                      type="text"
                      value={mapSearchQuery}
                      onChange={(e) => {
                        setMapSearchQuery(e.target.value);
                        setShowSearchDropdown(true);
                      }}
                      onFocus={() => setShowSearchDropdown(true)}
                      placeholder="Haritada bir yer arayın (örn. Kadıköy, Taksim, Ankara)..."
                      className="w-full bg-transparent text-xs text-foreground placeholder:text-muted-foreground outline-none font-medium"
                    />
                    {mapSearchQuery && (
                      <button
                        type="button"
                        onClick={() => {
                          setMapSearchQuery("");
                          setMapSearchResults([]);
                          setShowSearchDropdown(false);
                        }}
                        className="p-0.5 text-muted-foreground hover:text-foreground cursor-pointer"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>

                  {/* Realtime Autocomplete Results Dropdown with high z-index */}
                  {showSearchDropdown && mapSearchQuery.trim().length > 0 && (
                    <div className="absolute top-full left-0 right-0 mt-1.5 bg-card/98 backdrop-blur-md rounded-xl border border-border shadow-2xl max-h-80 overflow-y-auto divide-y divide-border/40 z-[2000] animate-in fade-in slide-in-from-top-1 duration-150">
                      {isSearchingMap && mapSearchResults.length === 0 ? (
                        <div className="p-4 text-center text-xs text-muted-foreground flex items-center justify-center gap-2">
                          <Loader2 className="w-3.5 h-3.5 animate-spin" /> Konumlar aranıyor...
                        </div>
                      ) : mapSearchResults.length === 0 ? (
                        <div className="p-4 text-center text-xs text-muted-foreground">
                          "{mapSearchQuery}" ile eşleşen bir yer bulunamadı.
                        </div>
                      ) : (
                        mapSearchResults.map((res) => (
                          <div
                            key={res.id}
                            onClick={() => {
                              setUserFocusCenter({ lat: res.lat, lng: res.lng });
                              setShowSearchDropdown(false);
                              if (res.isExisting && res.locationId) {
                                setSelectedLocationId(res.locationId);
                                toast.success(`"${res.name}" lokasyonuna odaklanıldı`);
                              } else {
                                setTargetCoords({ lat: res.lat, lng: res.lng });
                                setTargetLocName(res.name);
                                setPointNoteTitle("");
                                setPointNoteContent("");
                                setPointNoteModalOpen(true);
                              }
                            }}
                            className="flex items-start gap-2.5 p-2.5 hover:bg-muted/60 cursor-pointer transition-colors text-left"
                          >
                            <div
                              className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 mt-0.5 ${
                                res.isExisting
                                  ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                                  : "bg-blue-500/10 text-blue-600 dark:text-blue-400"
                              }`}
                            >
                              <MapPin className="w-3.5 h-3.5" />
                            </div>
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center justify-between gap-1">
                                <span className="text-xs font-semibold text-foreground truncate">{res.name}</span>
                                <span
                                  className={`text-[10px] font-mono font-medium px-1.5 py-0.2 rounded-full shrink-0 ${
                                    res.isExisting
                                      ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
                                      : "bg-blue-500/15 text-blue-600 dark:text-blue-400"
                                  }`}
                                >
                                  {res.isExisting ? `Kayıtlı (${res.noteCount || 0} not)` : "Yeni Konum"}
                                </span>
                              </div>
                              <p className="text-[11px] text-muted-foreground truncate leading-tight mt-0.5">
                                {res.display_name}
                              </p>
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  )}
                </div>
              </div>

              {/* Right: Map Theme Mask Selector & Controls */}
              <div className="flex items-center gap-1.5 bg-secondary/80 p-1 rounded-lg border border-border text-xs shrink-0">
                <div className="flex items-center gap-1 px-1 text-muted-foreground text-[11px] font-medium border-r border-border/60">
                  <Palette className="w-3.5 h-3.5 text-primary" />
                  <span className="hidden xl:inline">Tema:</span>
                </div>
                <select
                  value={maskTheme}
                  onChange={(e) => setMaskTheme(e.target.value as MapMaskTheme)}
                  className="bg-transparent text-xs font-medium text-foreground focus:outline-none cursor-pointer pr-1"
                  title="Harita Görsel Maskesini Değiştir"
                >
                  <option value="auto">Otomatik</option>
                  <option value="dark">Karanlık Obsidian</option>
                  <option value="light">Sıcak Parşömen</option>
                  <option value="satellite">Uydu / Hibrit</option>
                  <option value="standard">Standart</option>
                </select>

                <button
                  type="button"
                  onClick={() => {
                    if (locations.length > 0) {
                      setSelectedLocationId(locations[0].location_id);
                      setUserFocusCenter({ lat: Number(locations[0].lat), lng: Number(locations[0].lng) });
                    }
                  }}
                  title="İlk lokasyona odaklan"
                  className="p-1 hover:bg-muted text-muted-foreground hover:text-foreground rounded cursor-pointer transition-colors"
                >
                  <Compass className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            {/* Map Canvas Surface */}
            <div className="flex-1 relative z-0 w-full h-full min-h-[400px] overflow-hidden">
              <GoogleMapWrapper
                center={mapCenter}
                zoom={selectedLocation ? 14 : currentLocation ? 13 : locations.length > 0 ? 11 : 6}
                maskTheme={maskTheme}
                onMapClick={handleMapClick}
                locations={locations}
                selectedLocationId={selectedLocationId}
                onSelectLocation={(id) => {
                  setSelectedLocationId(id);
                  const l = locationMap[id];
                  if (l) setUserFocusCenter({ lat: Number(l.lat), lng: Number(l.lng) });
                }}
                currentLocation={currentLocation}
                className="h-full w-full"
              >
                {locations.map((loc) => {
                  const count = (notesByLocation[loc.location_id] || []).length;
                  const isSelected = selectedLocationId === loc.location_id;

                  return (
                    <AdvancedMarker
                      key={loc.location_id}
                      position={{ lat: Number(loc.lat), lng: Number(loc.lng) }}
                      title={loc.name}
                      onClick={() => {
                        setSelectedLocationId(loc.location_id);
                        setUserFocusCenter({ lat: Number(loc.lat), lng: Number(loc.lng) });
                      }}
                    >
                      <Pin
                        background={isSelected ? "#e11d48" : "#2563eb"}
                        borderColor={isSelected ? "#ffe4e6" : "#dbeafe"}
                        glyphColor="#ffffff"
                        scale={isSelected ? 1.25 : 1.0}
                      />
                    </AdvancedMarker>
                  );
                })}
              </GoogleMapWrapper>

              {/* Map click hint badge */}
              <div className="absolute bottom-4 left-4 z-20 hidden sm:flex items-center gap-1.5 bg-background/90 backdrop-blur-md px-3 py-1.5 rounded-full border border-border text-[11px] text-muted-foreground shadow-sm pointer-events-none">
                <MapPin className="w-3 h-3 text-primary" />
                <span>Harita üzerinde istediğiniz herhangi bir noktaya tıklayarak oraya doğrudan not ekleyebilirsiniz.</span>
              </div>
            </div>
          </div>

          {/* Location-Specific Notes Panel (Opens when a location is selected) */}
          {selectedLocation && (
            <div
              className="w-full lg:w-96 xl:w-[28rem] border-t lg:border-t-0 lg:border-l border-border bg-background flex flex-col h-full shrink-0 shadow-xl z-20"
              data-testid="location-notes-panel"
            >
              {/* Drawer Header */}
              <div className="p-4 border-b border-border bg-card/60 flex items-center justify-between shrink-0">
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className="w-8 h-8 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0">
                    <MapPin className="w-4 h-4" />
                  </div>
                  <div className="min-w-0">
                    <h3 className="font-serif font-bold text-sm text-foreground truncate">
                      {selectedLocation.name}
                    </h3>
                    <div className="text-[11px] font-mono text-muted-foreground flex items-center gap-2">
                      <span>{Number(selectedLocation.lat).toFixed(4)}, {Number(selectedLocation.lng).toFixed(4)}</span>
                      <span>•</span>
                      <span className="font-bold text-foreground">{sortedSelectedNotes.length} Not</span>
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-1 shrink-0">
                  <button
                    type="button"
                    onClick={() => setComposerOpen(!composerOpen)}
                    className="flex items-center gap-1 text-xs px-2.5 py-1 bg-primary text-primary-foreground font-medium rounded-md hover:opacity-90 transition-opacity cursor-pointer shadow-2xs"
                  >
                    <Plus className="w-3 h-3" /> Not Yaz
                  </button>
                  <button
                    type="button"
                    onClick={() => setSelectedLocationId(null)}
                    className="p-1 text-muted-foreground hover:text-foreground hover:bg-muted rounded-md cursor-pointer ml-1"
                    title="Paneli kapat"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {/* Collapsible Note Composer for this location */}
              {composerOpen && (
                <div className="p-3 border-b border-border bg-secondary/30">
                  <div className="text-xs font-semibold text-foreground mb-2 flex items-center gap-1">
                    <Sparkles className="w-3.5 h-3.5 text-primary" />
                    <span>"{selectedLocation.name}" için yeni not</span>
                  </div>
                  <NoteComposer
                    defaultDate={new Date().toISOString().slice(0, 10)}
                    defaultLocationId={selectedLocation.location_id}
                    categories={categories}
                    locations={locations}
                    noteTypes={noteTypes}
                    onCreated={() => {
                      setComposerOpen(false);
                      fetchAux();
                      toast.success("Not bu lokasyona kaydedildi");
                    }}
                  />
                </div>
              )}

              {/* Location's Notes Feed */}
              <div className="flex-1 overflow-y-auto p-4 space-y-3.5 bg-muted/10">
                {sortedSelectedNotes.length === 0 ? (
                  <div className="py-16 text-center space-y-3">
                    <FileText className="w-8 h-8 mx-auto text-muted-foreground/40" />
                    <div className="font-serif text-sm font-semibold text-foreground">
                      Bu lokasyona ait henüz bir not yok
                    </div>
                    <p className="text-xs text-muted-foreground max-w-xs mx-auto">
                      Yukarıdaki "Not Yaz" butonuna tıklayarak bu konuma özel ilk notunuzu kaydedebilirsiniz.
                    </p>
                  </div>
                ) : (
                  sortedSelectedNotes.map((note) => (
                    <NoteCard
                      key={note.note_id}
                      note={note}
                      locationMap={locationMap}
                      locations={locations}
                      categoryMap={categoryMap}
                      categories={categories}
                      noteTypeMap={noteTypeMap}
                      noteTypes={noteTypes}
                      onChanged={fetchAux}
                      onDelete={fetchAux}
                    />
                  ))
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Direct Add Note At Coordinate Dialog */}
      <Dialog open={pointNoteModalOpen} onOpenChange={setPointNoteModalOpen}>
        <DialogContent className="max-w-lg bg-card border-border">
          <DialogHeader>
            <DialogTitle className="font-serif text-lg flex items-center gap-2">
              <MapPin className="w-4 h-4 text-blue-600" /> Bu Konuma Not Ekle
            </DialogTitle>
          </DialogHeader>

          <form onSubmit={handleSaveNoteAtPoint} className="space-y-3.5 pt-2">
            {/* Location Name & GPS Preview */}
            <div className="p-3 bg-secondary/50 rounded-lg border border-border/70 space-y-2">
              <div>
                <label className="text-xs font-semibold text-foreground block mb-1">
                  Konum İsmi
                </label>
                <input
                  type="text"
                  value={targetLocName}
                  onChange={(e) => setTargetLocName(e.target.value)}
                  placeholder="Örn: Mevcut Konumum, Kadıköy Kafe, Kamp Alanı..."
                  className="w-full px-3 py-1.5 bg-background border border-border rounded-md text-xs font-medium text-foreground focus:outline-none focus:ring-1 focus:ring-primary/40"
                  required
                />
              </div>

              {targetCoords && (
                <div className="flex items-center gap-2 text-[11px] font-mono text-muted-foreground">
                  <Crosshair className="w-3 h-3 text-blue-500" />
                  <span>Koordinat: {targetCoords.lat.toFixed(6)}, {targetCoords.lng.toFixed(6)}</span>
                </div>
              )}
            </div>

            {/* Note Type & Category Selector */}
            <div className="flex items-center gap-2">
              <div className="flex-1 flex items-center gap-1.5 bg-background border border-border text-xs rounded-md px-2.5 py-1.5">
                <Boxes className="w-3.5 h-3.5 text-primary shrink-0" />
                <select
                  value={pointNoteTypeId}
                  onChange={(e) => setPointNoteTypeId(e.target.value)}
                  className="w-full bg-transparent text-foreground text-xs outline-none cursor-pointer font-medium"
                >
                  <option value="type_plain">Düz Metin Not</option>
                  {noteTypes
                    .filter((nt) => nt.type_id !== "type_plain" && nt.type_id !== "default")
                    .map((nt) => (
                      <option key={nt.type_id} value={nt.type_id}>
                        {nt.name}
                      </option>
                    ))}
                </select>
              </div>
            </div>

            {/* Note Title */}
            <div>
              <label className="text-xs font-semibold text-foreground block mb-1">Not Başlığı</label>
              <input
                type="text"
                value={pointNoteTitle}
                onChange={(e) => setPointNoteTitle(e.target.value)}
                placeholder="Örn: Buradaki toplantı notları, gezi hatırası..."
                className="w-full px-3 py-1.5 bg-background border border-border rounded-md text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary/40 font-medium"
                autoFocus
              />
            </div>

            {/* Note Content */}
            <div>
              <label className="text-xs font-semibold text-foreground block mb-1">Not İçeriği</label>
              <textarea
                value={pointNoteContent}
                onChange={(e) => setPointNoteContent(e.target.value)}
                placeholder="Notunuzu yazın... #etiket @kişi ve [[not-bağlantısı]] kullanabilirsiniz."
                rows={4}
                className="w-full px-3 py-2 bg-background border border-border rounded-md text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary/40 resize-none font-mono"
              />
            </div>

            <DialogFooter className="pt-2">
              <button
                type="button"
                onClick={() => setPointNoteModalOpen(false)}
                className="px-3 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground rounded-md cursor-pointer"
              >
                İptal
              </button>
              <button
                type="submit"
                disabled={isSubmittingNote}
                className="px-4 py-1.5 text-xs font-semibold bg-blue-600 hover:bg-blue-700 text-white rounded-md cursor-pointer shadow-sm flex items-center gap-1.5"
              >
                {isSubmittingNote ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" /> Kaydediliyor...
                  </>
                ) : (
                  <>
                    <PenTool className="w-3.5 h-3.5" /> Notu ve Konumu Kaydet
                  </>
                )}
              </button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* New Location Only Dialog */}
      <Dialog open={newLocModalOpen} onOpenChange={setNewLocModalOpen}>
        <DialogContent className="max-w-md bg-card border-border">
          <DialogHeader>
            <DialogTitle className="font-serif text-lg flex items-center gap-2">
              <MapPin className="w-4 h-4 text-primary" /> Yeni Lokasyon Tanımla
            </DialogTitle>
          </DialogHeader>

          <form onSubmit={handleCreateLocation} className="space-y-3.5 pt-2">
            <div>
              <label className="text-xs font-semibold text-foreground block mb-1">Lokasyon Adı</label>
              <input
                type="text"
                value={newLocName}
                onChange={(e) => setNewLocName(e.target.value)}
                placeholder="Örn: Kadıköy Moda, Taksim Ofis, Ankara Kızılay..."
                className="w-full px-3 py-2 bg-background border border-border rounded-md text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary/40 font-mono"
                required
                autoFocus
                data-testid="new-location-name-input"
              />
            </div>

            <div className="grid grid-cols-2 gap-2.5">
              <div>
                <label className="text-xs text-muted-foreground block mb-1">Enlem (Latitude)</label>
                <input
                  type="text"
                  value={newLocLat}
                  onChange={(e) => setNewLocLat(e.target.value)}
                  className="w-full px-3 py-1.5 bg-background border border-border rounded-md text-xs font-mono text-foreground focus:outline-none focus:ring-1 focus:ring-primary/40"
                  required
                  data-testid="new-location-lat-input"
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground block mb-1">Boylam (Longitude)</label>
                <input
                  type="text"
                  value={newLocLng}
                  onChange={(e) => setNewLocLng(e.target.value)}
                  className="w-full px-3 py-1.5 bg-background border border-border rounded-md text-xs font-mono text-foreground focus:outline-none focus:ring-1 focus:ring-primary/40"
                  required
                  data-testid="new-location-lng-input"
                />
              </div>
            </div>

            <div className="flex items-center justify-between pt-1">
              <button
                type="button"
                onClick={useCurrentPosition}
                className="inline-flex items-center gap-1.5 text-xs text-primary hover:underline font-medium cursor-pointer"
              >
                <Navigation className="w-3.5 h-3.5" /> GPS Konumumu Kullan
              </button>
            </div>

            <div className="flex justify-end gap-2 pt-3 border-t border-border/60">
              <button
                type="button"
                onClick={() => setNewLocModalOpen(false)}
                className="px-3 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground rounded-md cursor-pointer"
              >
                İptal
              </button>
              <button
                type="submit"
                className="px-4 py-1.5 text-xs font-semibold bg-primary text-primary-foreground rounded-md hover:opacity-90 cursor-pointer shadow-2xs"
                data-testid="submit-new-location-btn"
              >
                Lokasyonu Kaydet
              </button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
