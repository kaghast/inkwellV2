import React, { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MapPin, Navigation } from "lucide-react";
import GoogleMapWrapper from "@/components/GoogleMapWrapper";
import { AdvancedMarker, Pin } from "@vis.gl/react-google-maps";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (loc: { name: string; lat: number; lng: number }) => void;
}

export default function LocationPicker({ open, onOpenChange, onSave }: Props) {
  const [name, setName] = useState("");
  const [coords, setCoords] = useState<{ lat: number; lng: number }>({
    lat: 41.0082, // Istanbul default
    lng: 28.9784,
  });

  useEffect(() => {
    if (!open) return;

    // Try geolocation
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          setCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        },
        () => {
          /* ignore error */
        }
      );
    }
  }, [open]);

  const handleMapClick = (coords: { lat: number; lng: number }) => {
    setCoords(coords);
  };

  const handleMarkerDragEnd = (e: any) => {
    if (e.latLng) {
      setCoords({ lat: e.latLng.lat(), lng: e.latLng.lng() });
    }
  };

  function handleSave() {
    if (!name.trim()) return;
    onSave({
      name: name.trim(),
      lat: coords.lat,
      lng: coords.lng,
    });
    setName("");
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md bg-card border-border">
        <DialogHeader>
          <DialogTitle className="font-serif flex items-center gap-2">
            <MapPin className="w-4 h-4 text-primary" /> Konum Ekle
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3 pt-2">
          <div>
            <label className="text-xs text-muted-foreground block mb-1">Konum Adı</label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Örn: Ev, Ofis, Kadıköy, Kafe..."
              data-testid="location-name-input"
              autoFocus
            />
          </div>

          <div className="w-full h-56 rounded-lg overflow-hidden border border-border">
            <GoogleMapWrapper
              center={coords}
              zoom={13}
              onMapClick={handleMapClick}
              draggableMarker={{
                position: coords,
                onDragEnd: (c) => setCoords(c),
              }}
              className="h-full w-full"
            >
              <AdvancedMarker
                position={coords}
                draggable={true}
                onDragEnd={handleMarkerDragEnd}
              >
                <Pin background="#2563eb" glyphColor="#ffffff" borderColor="#dbeafe" />
              </AdvancedMarker>
            </GoogleMapWrapper>
          </div>

          <div className="flex items-center justify-between text-[11px] text-muted-foreground font-mono">
            <span>Koordinatlar: {coords.lat.toFixed(4)}, {coords.lng.toFixed(4)}</span>
            <span className="text-[10px] text-primary/80">Haritaya tıklayarak veya pini sürükleyerek konumu seçin</span>
          </div>
        </div>

        <DialogFooter className="mt-4">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            İptal
          </Button>
          <Button
            onClick={handleSave}
            disabled={!name.trim()}
            className="bg-foreground text-background"
            data-testid="save-location-btn"
          >
            Kaydet
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
