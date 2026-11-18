import api from "@/lib/api";
import type { Area } from "@/types";

/** Palette offered when creating / recolouring an area. */
export const AREA_COLORS = [
  "#6366f1", // indigo
  "#0ea5e9", // sky
  "#10b981", // emerald
  "#f59e0b", // amber
  "#ef4444", // red
  "#ec4899", // pink
  "#8b5cf6", // violet
  "#14b8a6", // teal
  "#64748b", // slate
];

export interface AreaTreeNode {
  area: Area;
  children: AreaTreeNode[];
  depth: number;
  /** Notes linked to this area or any sub-area (each note counted once). */
  totalNotes: number;
}

export async function fetchAreas(): Promise<Area[]> {
  const { data } = await api.get<Area[]>("/areas");
  return Array.isArray(data) ? data : [];
}

export function areaMap(areas: Area[]): Record<string, Area> {
  const m: Record<string, Area> = {};
  for (const a of areas) m[a.area_id] = a;
  return m;
}

/** An area is hidden when it, or any ancestor, is archived. */
export function isEffectivelyArchived(area: Area, byId: Record<string, Area>): boolean {
  let cur: Area | undefined = area;
  const seen = new Set<string>();
  while (cur && !seen.has(cur.area_id)) {
    if (cur.archived) return true;
    seen.add(cur.area_id);
    cur = cur.parent_id ? byId[cur.parent_id] : undefined;
  }
  return false;
}

/** Colour of an area, inherited from the nearest coloured ancestor. */
export function areaColor(area: Area, byId: Record<string, Area>): string {
  let cur: Area | undefined = area;
  const seen = new Set<string>();
  while (cur && !seen.has(cur.area_id)) {
    if (cur.color) return cur.color;
    seen.add(cur.area_id);
    cur = cur.parent_id ? byId[cur.parent_id] : undefined;
  }
  return AREA_COLORS[0];
}

/** "Ana alan › Alt alan" breadcrumb text. */
export function areaPath(area: Area, byId: Record<string, Area>): string {
  const parts: string[] = [];
  let cur: Area | undefined = area;
  const seen = new Set<string>();
  while (cur && !seen.has(cur.area_id)) {
    parts.unshift(cur.name);
    seen.add(cur.area_id);
    cur = cur.parent_id ? byId[cur.parent_id] : undefined;
  }
  return parts.join(" › ");
}

/**
 * Builds the area forest. Areas whose parent is missing are treated as main areas,
 * so nothing ever disappears from the UI because of a dangling parent id.
 */
export function buildAreaTree(
  areas: Area[],
  noteAreaIds: string[][] = [],
  opts: { includeArchived?: boolean } = {}
): AreaTreeNode[] {
  const byId = areaMap(areas);
  const visible = areas.filter((a) => opts.includeArchived || !isEffectivelyArchived(a, byId));
  const visibleIds = new Set(visible.map((a) => a.area_id));

  const childrenOf: Record<string, Area[]> = {};
  const roots: Area[] = [];
  for (const a of visible) {
    if (a.parent_id && visibleIds.has(a.parent_id) && a.parent_id !== a.area_id) {
      (childrenOf[a.parent_id] ||= []).push(a);
    } else {
      roots.push(a);
    }
  }
  const sortAreas = (list: Area[]) =>
    list.sort((x, y) => x.order_index - y.order_index || x.name.localeCompare(y.name, "tr"));

  const build = (a: Area, depth: number, trail: Set<string>): AreaTreeNode => {
    const nextTrail = new Set(trail).add(a.area_id);
    const kids = sortAreas(childrenOf[a.area_id] || [])
      .filter((c) => !nextTrail.has(c.area_id))
      .map((c) => build(c, depth + 1, nextTrail));
    return { area: a, children: kids, depth, totalNotes: 0 };
  };
  const forest = sortAreas(roots).map((r) => build(r, 0, new Set()));

  // Count each note once per subtree, even if it is linked to several sub-areas.
  const subtreeIds = (node: AreaTreeNode): Set<string> => {
    const s = new Set<string>([node.area.area_id]);
    node.children.forEach((c) => subtreeIds(c).forEach((id) => s.add(id)));
    return s;
  };
  const assignTotals = (node: AreaTreeNode) => {
    const ids = subtreeIds(node);
    node.totalNotes = noteAreaIds.filter((list) => list.some((id) => ids.has(id))).length;
    node.children.forEach(assignTotals);
  };
  forest.forEach(assignTotals);
  return forest;
}

export function flattenTree(nodes: AreaTreeNode[]): AreaTreeNode[] {
  const out: AreaTreeNode[] = [];
  const walk = (list: AreaTreeNode[]) =>
    list.forEach((n) => {
      out.push(n);
      walk(n.children);
    });
  walk(nodes);
  return out;
}

export async function setNoteAreas(noteId: string, areaIds: string[]): Promise<string[]> {
  const { data } = await api.patch<{ area_ids: string[] }>(`/notes/${noteId}/areas`, { area_ids: areaIds });
  return Array.isArray(data?.area_ids) ? data.area_ids : areaIds;
}
