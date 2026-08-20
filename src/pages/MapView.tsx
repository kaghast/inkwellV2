import React, { useState, useEffect, useMemo, useCallback } from "react";
import { Link, useNavigate } from "react-router-dom";
import api from "@/lib/api";
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
} from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

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

  // New location modal
  const [newLocModalOpen, setNewLocModalOpen] = useState(false);
  const [newLocName, setNewLocName] = useState("");
  const [newLocLat, setNewLocLat] = useState("41.0082");
  const [newLocLng, setNewLocLng] = useState("28.9784");

  const [composerOpen, setComposerOpen] = useState(false);

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
    if (selectedLocation) {
      return { lat: Number(selectedLocation.lat), lng: Number(selectedLocation.lng) };
    }
    if (locations.length > 0) {
      return { lat: Number(locations[0].lat), lng: Number(locations[0].lng) };
    }
    return { lat: 41.0082, lng: 28.9784 }; // Istanbul default
  }, [selectedLocation, locations]);

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

  // Click anywhere on map to add location
  const handleMapClick = (coords: { lat: number; lng: number }) => {
    const lat = coords.lat;
    const lng = coords.lng;
    setNewLocLat(lat.toFixed(6));
    setNewLocLng(lng.toFixed(6));
    setNewLocName(`Harita Noktası (${lat.toFixed(3)}, ${lng.toFixed(3)})`);
    setNewLocModalOpen(true);
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
              <button
                type="button"
                onClick={() => setNewLocModalOpen(true)}
                className="flex items-center gap-1 text-xs px-2.5 py-1 bg-primary text-primary-foreground font-medium rounded-md hover:opacity-90 transition-opacity cursor-pointer shadow-2xs"
                data-testid="add-location-btn"
              >
                <Plus className="w-3 h-3" /> Yeni Ekle
              </button>
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
                  onClick={() => setNewLocModalOpen(true)}
                  className="text-primary hover:underline font-medium cursor-pointer"
                >
                  + Yeni bir lokasyon ekle
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
                          {loc.lat.toFixed(4)}, {loc.lng.toFixed(4)}
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
        <div className="flex-1 flex flex-col lg:flex-row relative h-2/3 lg:h-full overflow-hidden">
          {/* Google Map Surface */}
          <div className="flex-1 relative h-full w-full">
            <GoogleMapWrapper
              center={mapCenter}
              zoom={selectedLocation ? 14 : locations.length > 0 ? 11 : 6}
              maskTheme={maskTheme}
              onMapClick={handleMapClick}
              locations={locations}
              selectedLocationId={selectedLocationId}
              onSelectLocation={(id) => setSelectedLocationId(id)}
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
                    onClick={() => setSelectedLocationId(loc.location_id)}
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

            {/* Floating Map Theme Mask Selector & Controls */}
            <div className="absolute top-3 right-3 z-10 flex items-center gap-2 bg-background/90 backdrop-blur-md p-1.5 rounded-lg border border-border shadow-md text-xs">
              <div className="flex items-center gap-1 px-1.5 text-muted-foreground text-[11px] font-medium border-r border-border/60">
                <Palette className="w-3 h-3 text-primary" />
                <span className="hidden sm:inline">Tema Maskesi:</span>
              </div>
              <select
                value={maskTheme}
                onChange={(e) => setMaskTheme(e.target.value as MapMaskTheme)}
                className="bg-transparent text-xs font-medium text-foreground focus:outline-none cursor-pointer pr-2"
                title="Harita Görsel Maskesini Değiştir"
              >
                <option value="auto">Otomatik (Uygulama Teması)</option>
                <option value="dark">Karanlık Obsidian Maskesi</option>
                <option value="light">Sıcak Parşömen Maskesi</option>
                <option value="satellite">Uydu / Hibrit</option>
                <option value="standard">Google Standart</option>
              </select>

              <button
                type="button"
                onClick={() => {
                  if (locations.length > 0) {
                    setSelectedLocationId(locations[0].location_id);
                  }
                }}
                title="İlk lokasyona odaklan"
                className="p-1 hover:bg-muted text-muted-foreground hover:text-foreground rounded cursor-pointer transition-colors ml-1"
              >
                <Compass className="w-3.5 h-3.5" />
              </button>
            </div>

            {/* Map click hint badge */}
            <div className="absolute bottom-4 left-4 z-10 hidden sm:flex items-center gap-1.5 bg-background/90 backdrop-blur-md px-3 py-1.5 rounded-full border border-border text-[11px] text-muted-foreground shadow-sm pointer-events-none">
              <MapPin className="w-3 h-3 text-primary" />
              <span>Harita üzerine tıklayarak o koordinata doğrudan yeni lokasyon ekleyebilirsiniz.</span>
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
                      <span>{selectedLocation.lat.toFixed(4)}, {selectedLocation.lng.toFixed(4)}</span>
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

      {/* New Location Dialog */}
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
