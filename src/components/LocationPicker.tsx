import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  MapPin,
  Search,
  Crosshair,
  Loader2,
  X,
  Navigation,
  Compass,
  Check,
  Sparkles,
} from "lucide-react";
import GoogleMapWrapper from "@/components/GoogleMapWrapper";
import { AdvancedMarker, Pin } from "@vis.gl/react-google-maps";
import { toast } from "sonner";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (loc: { name: string; lat: number; lng: number }) => void;
  initialLocation?: { name?: string; lat?: number; lng?: number };
}

interface SearchResult {
  id: string;
  name: string;
  display_name: string;
  lat: number;
  lng: number;
  type?: string;
}

export default function LocationPicker({ open, onOpenChange, onSave, initialLocation }: Props) {
  const [name, setName] = useState(initialLocation?.name || "");
  const [coords, setCoords] = useState<{ lat: number; lng: number }>({
    lat: initialLocation?.lat || 41.0082, // Istanbul default
    lng: initialLocation?.lng || 28.9784,
  });
  const [zoom, setZoom] = useState(13);

  // Search & Autocomplete state
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const [isLocating, setIsLocating] = useState(false);
  const [isReverseGeocoding, setIsReverseGeocoding] = useState(false);

  const searchInputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Reset or initialize when opened
  useEffect(() => {
    if (open) {
      if (initialLocation && initialLocation.lat && initialLocation.lng) {
        setCoords({ lat: initialLocation.lat, lng: initialLocation.lng });
        setName(initialLocation.name || "");
        setZoom(15);
      } else {
        // Try initial geolocation if no initial location
        if (navigator.geolocation) {
          navigator.geolocation.getCurrentPosition(
            (pos) => {
              const userCoords = { lat: pos.coords.latitude, lng: pos.coords.longitude };
              setCoords(userCoords);
              setZoom(14);
              if (!name) {
                reverseGeocode(userCoords.lat, userCoords.lng);
              }
            },
            () => {
              /* ignore silent initial error */
            },
            { enableHighAccuracy: true, timeout: 6000 }
          );
        }
      }
    } else {
      setSearchQuery("");
      setSearchResults([]);
      setShowDropdown(false);
    }
  }, [open, initialLocation]);

  // Click outside listener to close search dropdown
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node) &&
        searchInputRef.current &&
        !searchInputRef.current.contains(e.target as Node)
      ) {
        setShowDropdown(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Reverse geocoding helper (Nominatim)
  const reverseGeocode = useCallback(async (lat: number, lng: number) => {
    setIsReverseGeocoding(true);
    try {
      const res = await fetch(
        `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&addressdetails=1`,
        {
          headers: {
            "Accept-Language": "tr,en",
          },
        }
      );
      if (res.ok) {
        const data = await res.json();
        if (data && data.address) {
          const addr = data.address;
          const detectedName =
            data.name ||
            addr.amenity ||
            addr.building ||
            addr.shop ||
            addr.tourism ||
            addr.leisure ||
            addr.historic ||
            (addr.road && addr.suburb ? `${addr.road}, ${addr.suburb}` : null) ||
            addr.road ||
            addr.neighbourhood ||
            addr.suburb ||
            addr.city_district ||
            addr.town ||
            addr.city ||
            data.display_name?.split(",")[0];

          if (detectedName) {
            setName(detectedName);
          }
        }
      }
    } catch (e) {
      console.warn("Reverse geocode failed:", e);
    } finally {
      setIsReverseGeocoding(false);
    }
  }, []);

  // Autocomplete search debounce effect
  useEffect(() => {
    if (!searchQuery.trim()) {
      setSearchResults([]);
      setIsSearching(false);
      setShowDropdown(false);
      return;
    }

    const timer = setTimeout(async () => {
      setIsSearching(true);
      try {
        const res = await fetch(
          `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(
            searchQuery.trim()
          )}&limit=6&addressdetails=1`,
          {
            headers: {
              "Accept-Language": "tr,en",
            },
          }
        );

        if (res.ok) {
          const data = await res.json();
          const mapped: SearchResult[] = data.map((item: any) => {
            const shortName = item.name || item.display_name.split(",")[0];
            return {
              id: String(item.place_id || `${item.lat}_${item.lon}`),
              name: shortName,
              display_name: item.display_name,
              lat: parseFloat(item.lat),
              lng: parseFloat(item.lon),
              type: item.type || item.class,
            };
          });
          setSearchResults(mapped);
          setShowDropdown(mapped.length > 0);
        }
      } catch (err) {
        console.warn("Geocoding search failed:", err);
      } finally {
        setIsSearching(false);
      }
    }, 320);

    return () => clearTimeout(timer);
  }, [searchQuery]);

  // Handle selecting an autocomplete result
  const handleSelectResult = (result: SearchResult) => {
    const newCoords = { lat: result.lat, lng: result.lng };
    setCoords(newCoords);
    setZoom(16);
    setName(result.name);
    setSearchQuery(result.name);
    setShowDropdown(false);
    toast.success(`"${result.name}" konumuna gidildi`);
  };

  // Handle click on map
  const handleMapClick = (newCoords: { lat: number; lng: number }) => {
    setCoords(newCoords);
    reverseGeocode(newCoords.lat, newCoords.lng);
  };

  // Handle marker drag end
  const handleMarkerDragEnd = (newCoords: { lat: number; lng: number }) => {
    setCoords(newCoords);
    reverseGeocode(newCoords.lat, newCoords.lng);
  };

  const handleGoogleMarkerDragEnd = (e: any) => {
    if (e.latLng) {
      const newCoords = { lat: e.latLng.lat(), lng: e.latLng.lng() };
      setCoords(newCoords);
      reverseGeocode(newCoords.lat, newCoords.lng);
    }
  };

  // GPS Locate me button
  const handleLocateMe = () => {
    if (!navigator.geolocation) {
      toast.error("Tarayıcınız konum servisini desteklemiyor");
      return;
    }
    setIsLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const userCoords = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        setCoords(userCoords);
        setZoom(16);
        reverseGeocode(userCoords.lat, userCoords.lng);
        setIsLocating(false);
        toast.success("Mevcut konumunuz bulundu");
      },
      (err) => {
        console.warn("GPS error:", err);
        toast.error("Konumunuz alınamadı. Lütfen konum izinlerini kontrol edin.");
        setIsLocating(false);
      },
      { enableHighAccuracy: true, timeout: 8000 }
    );
  };

  function handleSave() {
    if (!name.trim()) {
      toast.error("Lütfen bir konum adı girin");
      return;
    }
    onSave({
      name: name.trim(),
      lat: coords.lat,
      lng: coords.lng,
    });
    setName("");
    setSearchQuery("");
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl w-[96vw] sm:max-w-4xl bg-card border-border p-4 sm:p-6 overflow-hidden max-h-[92vh] flex flex-col gap-4 rounded-xl shadow-2xl">
        {/* Header */}
        <DialogHeader className="pb-1 border-b border-border/60">
          <DialogTitle className="font-serif text-lg sm:text-xl flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center gap-2 text-foreground">
              <div className="p-1.5 rounded-lg bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-500/20">
                <MapPin className="w-5 h-5" />
              </div>
              <div>
                <span className="font-semibold">Konum Seç & Ekle</span>
                <p className="text-xs text-muted-foreground font-sans font-normal mt-0.5">
                  Harita üzerinde arayın, pini taşıyın veya tıklayarak konumu belirleyin.
                </p>
              </div>
            </div>

            {/* GPS Locate Me Button */}
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleLocateMe}
              disabled={isLocating}
              className="h-8 text-xs font-mono gap-1.5 border-border hover:bg-secondary cursor-pointer"
              title="Mevcut GPS konumumu bul"
            >
              {isLocating ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin text-primary" />
              ) : (
                <Crosshair className="w-3.5 h-3.5 text-primary" />
              )}
              <span>{isLocating ? "Konum Alınıyor..." : "Mevcut Konumum"}</span>
            </Button>
          </DialogTitle>
        </DialogHeader>

        {/* Search & Location Name Input Controls */}
        <div className="grid grid-cols-1 md:grid-cols-12 gap-3 pt-1">
          {/* Autocomplete Search Bar */}
          <div className="md:col-span-7 relative">
            <label className="text-xs font-medium text-foreground/80 block mb-1 flex items-center gap-1.5">
              <Search className="w-3.5 h-3.5 text-primary" />
              <span>Haritada Mekan / Adres Ara (Otomatik Tamamlama)</span>
            </label>

            <div className="relative">
              <Input
                ref={searchInputRef}
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  if (!showDropdown && e.target.value.trim()) setShowDropdown(true);
                }}
                onFocus={() => {
                  if (searchResults.length > 0) setShowDropdown(true);
                }}
                placeholder="Mekan, sokak, mahalle, şehir veya ülke ara..."
                className="pr-16 pl-9 text-xs sm:text-sm h-9 bg-background border-border/90 focus-visible:ring-1 focus-visible:ring-primary font-sans"
                data-testid="location-search-input"
              />
              <Search className="w-4 h-4 text-muted-foreground absolute left-3 top-2.5 pointer-events-none" />

              <div className="absolute right-2 top-1.5 flex items-center gap-1">
                {isSearching && <Loader2 className="w-4 h-4 animate-spin text-primary" />}
                {searchQuery && !isSearching && (
                  <button
                    type="button"
                    onClick={() => {
                      setSearchQuery("");
                      setSearchResults([]);
                      setShowDropdown(false);
                    }}
                    className="p-1 text-muted-foreground hover:text-foreground rounded transition-colors"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </div>

            {/* Autocomplete Results Dropdown */}
            {showDropdown && (
              <div
                ref={dropdownRef}
                className="absolute z-50 left-0 right-0 top-full mt-1 bg-popover/95 backdrop-blur-md border border-border rounded-lg shadow-2xl overflow-hidden max-h-64 overflow-y-auto"
              >
                {searchResults.length === 0 && !isSearching ? (
                  <div className="p-3 text-xs text-muted-foreground text-center">
                    Eşleşen konum bulunamadı.
                  </div>
                ) : (
                  searchResults.map((res) => (
                    <button
                      key={res.id}
                      type="button"
                      onClick={() => handleSelectResult(res)}
                      className="w-full text-left px-3 py-2.5 hover:bg-secondary/80 border-b border-border/40 last:border-0 transition-colors flex items-start gap-2.5 cursor-pointer group"
                    >
                      <MapPin className="w-4 h-4 text-rose-500 shrink-0 mt-0.5 group-hover:scale-110 transition-transform" />
                      <div className="min-w-0 flex-1">
                        <div className="text-xs font-semibold text-foreground group-hover:text-primary transition-colors truncate">
                          {res.name}
                        </div>
                        <div className="text-[11px] text-muted-foreground truncate leading-tight">
                          {res.display_name}
                        </div>
                      </div>
                    </button>
                  ))
                )}
              </div>
            )}
          </div>

          {/* Location Name (Editable by user) */}
          <div className="md:col-span-5">
            <label className="text-xs font-medium text-foreground/80 block mb-1 flex items-center justify-between">
              <span className="flex items-center gap-1.5">
                <MapPin className="w-3.5 h-3.5 text-rose-500" />
                <span>Konum Adı (Kaydedilecek)</span>
              </span>
              {isReverseGeocoding && (
                <span className="text-[10px] text-primary flex items-center gap-1 font-mono">
                  <Loader2 className="w-2.5 h-2.5 animate-spin" /> İsim bulunuyor...
                </span>
              )}
            </label>
            <div className="relative">
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Örn: Ev, Ofis, Kadıköy Starbucks, Kampüs..."
                className="text-xs sm:text-sm h-9 bg-background border-border/90 focus-visible:ring-1 focus-visible:ring-primary font-medium"
                data-testid="location-name-input"
              />
            </div>
          </div>
        </div>

        {/* Large Map Area */}
        <div className="w-full flex-1 min-h-[320px] sm:min-h-[380px] md:min-h-[420px] rounded-xl overflow-hidden border border-border/80 relative shadow-inner bg-secondary/20">
          <GoogleMapWrapper
            center={coords}
            zoom={zoom}
            onMapClick={handleMapClick}
            draggableMarker={{
              position: coords,
              onDragEnd: handleMarkerDragEnd,
            }}
            className="h-full w-full"
          >
            <AdvancedMarker
              position={coords}
              draggable={true}
              onDragEnd={handleGoogleMarkerDragEnd}
            >
              <Pin background="#e11d48" glyphColor="#ffffff" borderColor="#ffe4e6" />
            </AdvancedMarker>
          </GoogleMapWrapper>

          {/* Floating Coordinate Badge */}
          <div className="absolute bottom-2.5 left-2.5 z-10 bg-background/90 backdrop-blur-sm border border-border px-2.5 py-1 rounded-md text-[11px] font-mono text-muted-foreground shadow-sm flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            <span>
              {coords.lat.toFixed(5)}, {coords.lng.toFixed(5)}
            </span>
          </div>

          {/* Floating Instructions Banner */}
          <div className="absolute top-2.5 right-2.5 z-10 bg-background/90 backdrop-blur-sm border border-border px-2.5 py-1 rounded-md text-[11px] text-muted-foreground shadow-sm hidden sm:flex items-center gap-1.5">
            <Sparkles className="w-3.5 h-3.5 text-primary" />
            <span>Haritaya tıklayarak veya pini sürükleyerek konumu değiştirebilirsiniz</span>
          </div>
        </div>

        {/* Footer */}
        <DialogFooter className="flex items-center justify-between sm:justify-between w-full pt-2 border-t border-border/60 gap-2">
          <div className="text-[11px] text-muted-foreground truncate max-w-[260px] sm:max-w-md">
            {name ? (
              <span className="flex items-center gap-1">
                <Check className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                <strong className="text-foreground">{name}</strong> olarak kaydedilecek
              </span>
            ) : (
              <span className="text-amber-500">Lütfen konum için bir isim belirleyin</span>
            )}
          </div>

          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => onOpenChange(false)}
              className="text-xs h-8 cursor-pointer"
            >
              İptal
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={handleSave}
              disabled={!name.trim()}
              className="bg-primary text-primary-foreground hover:bg-primary/90 text-xs h-8 px-4 font-medium shadow-sm cursor-pointer"
              data-testid="save-location-btn"
            >
              <MapPin className="w-3.5 h-3.5 mr-1.5" /> Konumu Ekle
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
