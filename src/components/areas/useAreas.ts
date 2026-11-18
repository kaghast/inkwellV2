import { useEffect, useState } from "react";
import type { Area } from "@/types";
import { addSharedArea, getCachedAreas, loadSharedAreas, subscribeSharedAreas } from "@/lib/areas";

/** Shared, cached area list (one request for all cards and pickers on a page). */
export function useAreas(): [Area[], (a: Area) => void] {
  const [areas, setAreas] = useState<Area[]>(getCachedAreas());
  useEffect(() => {
    const unsubscribe = subscribeSharedAreas(setAreas);
    loadSharedAreas().then(setAreas);
    return unsubscribe;
  }, []);
  return [areas, addSharedArea];
}
