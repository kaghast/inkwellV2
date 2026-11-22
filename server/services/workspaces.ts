// Workspaces and Spaces. Phase 1: every user has one personal workspace with a
// default space. All access checks go through this module so team workspaces
// (Phase 3) only have to change the membership predicate here.
import { and, eq, sql, isNull, asc } from "drizzle-orm";
import { db, notes, spaces, workspaces, workspaceMembers, users } from "../../src/db/index";
import { genId } from "./notesCore";
import { recordEvent } from "./analytics";

export type Role = "owner" | "admin" | "editor" | "commenter" | "viewer";
const WRITE_ROLES: Role[] = ["owner", "admin", "editor"];
const MANAGE_ROLES: Role[] = ["owner", "admin"];

export interface WorkspaceContext {
  workspaceId: string;
  defaultSpaceId: string;
  role: Role;
}

const cache = new Map<string, WorkspaceContext>();

/** Get (or lazily create) the caller's personal workspace and default space. */
export async function ensurePersonalWorkspace(userId: string): Promise<WorkspaceContext> {
  const hit = cache.get(userId);
  if (hit) return hit;

  const rows = await db
    .select({ workspaceId: workspaces.workspaceId, role: workspaceMembers.role })
    .from(workspaceMembers)
    .innerJoin(workspaces, eq(workspaces.workspaceId, workspaceMembers.workspaceId))
    .where(and(eq(workspaceMembers.userId, userId), eq(workspaces.kind, "personal"), eq(workspaces.ownerId, userId)))
    .limit(1);

  let workspaceId: string;
  let role: Role = "owner";
  if (rows.length > 0) {
    workspaceId = rows[0].workspaceId;
    role = rows[0].role as Role;
  } else {
    workspaceId = `ws_${userId}`;
    await db
      .insert(workspaces)
      .values({ workspaceId, name: "Kişisel çalışma alanı", kind: "personal", ownerId: userId })
      .onConflictDoNothing();
    await db.insert(workspaceMembers).values({ workspaceId, userId, role: "owner" }).onConflictDoNothing();
    await recordEvent(userId, "workspace_created", { kind: "personal" }, { once: true, workspaceId });
  }

  let def = await db
    .select({ spaceId: spaces.spaceId })
    .from(spaces)
    .where(and(eq(spaces.workspaceId, workspaceId), eq(spaces.isDefault, true)))
    .limit(1);
  if (def.length === 0) {
    const spaceId = `space_${userId}_default`;
    await db
      .insert(spaces)
      .values({ spaceId, workspaceId, createdBy: userId, name: "Kişisel", color: "#6366f1", icon: "Home", isDefault: true })
      .onConflictDoNothing();
    def = [{ spaceId }];
  }

  const ctx = { workspaceId, defaultSpaceId: def[0].spaceId, role };
  cache.set(userId, ctx);
  return ctx;
}

/** Attach the user's objects written by legacy paths (no space yet) to the default space. */
export async function attachOrphanObjects(userId: string) {
  const ctx = await ensurePersonalWorkspace(userId);
  await db
    .update(notes)
    .set({ workspaceId: ctx.workspaceId, spaceId: ctx.defaultSpaceId })
    .where(and(eq(notes.userId, userId), isNull(notes.spaceId)));
  return ctx;
}

/** Backfill for every existing user (migration 004). */
export async function backfillPersonalWorkspaces() {
  const all = await db.select({ userId: users.userId }).from(users);
  for (const u of all) {
    await attachOrphanObjects(u.userId);
  }
}

async function membership(userId: string, workspaceId: string): Promise<Role | null> {
  const r = await db
    .select({ role: workspaceMembers.role })
    .from(workspaceMembers)
    .where(and(eq(workspaceMembers.userId, userId), eq(workspaceMembers.workspaceId, workspaceId)))
    .limit(1);
  return r.length ? (r[0].role as Role) : null;
}

export class AccessError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/** Load a space the caller may read (and optionally write). Throws AccessError. */
export async function requireSpace(userId: string, spaceId: string, need: "read" | "write" | "manage" = "read") {
  const found = await db.select().from(spaces).where(eq(spaces.spaceId, spaceId)).limit(1);
  if (found.length === 0) throw new AccessError(404, "Bölüm bulunamadı");
  const role = await membership(userId, found[0].workspaceId);
  // 404 instead of 403 so ids of other tenants cannot be probed
  if (!role) throw new AccessError(404, "Bölüm bulunamadı");
  if (need === "write" && !WRITE_ROLES.includes(role)) throw new AccessError(403, "Bu bölümde yazma yetkin yok");
  if (need === "manage" && !MANAGE_ROLES.includes(role)) throw new AccessError(403, "Bu bölümü yönetme yetkin yok");
  return { space: found[0], role };
}

export function serializeSpace(s: typeof spaces.$inferSelect, objectCount = 0) {
  return {
    space_id: s.spaceId,
    workspace_id: s.workspaceId,
    name: s.name,
    description: s.description || "",
    color: s.color,
    icon: s.icon,
    is_default: s.isDefault,
    archived: s.archived,
    order_index: s.orderIndex,
    object_count: objectCount,
    created_at: s.createdAt.toISOString(),
    updated_at: s.updatedAt.toISOString(),
  };
}

export async function listSpaces(userId: string) {
  const ctx = await ensurePersonalWorkspace(userId);
  const rows = await db
    .select()
    .from(spaces)
    .where(eq(spaces.workspaceId, ctx.workspaceId))
    .orderBy(asc(spaces.orderIndex), asc(spaces.createdAt));
  const counts = await db
    .select({ spaceId: notes.spaceId, n: sql<number>`count(*)` })
    .from(notes)
    .where(eq(notes.userId, userId))
    .groupBy(notes.spaceId);
  const byId = new Map<string, number>(counts.map((c: any) => [c.spaceId, Number(c.n)]));
  return rows.map((s: typeof spaces.$inferSelect) => serializeSpace(s, byId.get(s.spaceId) || 0));
}

export async function createSpace(userId: string, input: { name: string; description?: string; color?: string; icon?: string }) {
  const ctx = await ensurePersonalWorkspace(userId);
  if (!MANAGE_ROLES.includes(ctx.role)) throw new AccessError(403, "Bölüm oluşturma yetkin yok");
  const spaceId = genId("space");
  const maxOrder = await db
    .select({ m: sql<number>`coalesce(max(${spaces.orderIndex}), 0)` })
    .from(spaces)
    .where(eq(spaces.workspaceId, ctx.workspaceId));
  await db.insert(spaces).values({
    spaceId,
    workspaceId: ctx.workspaceId,
    createdBy: userId,
    name: input.name,
    description: input.description || null,
    color: input.color || null,
    icon: input.icon || null,
    orderIndex: Number(maxOrder[0]?.m || 0) + 1,
  });
  const row = (await db.select().from(spaces).where(eq(spaces.spaceId, spaceId)).limit(1))[0];
  return serializeSpace(row, 0);
}

export async function updateSpace(
  userId: string,
  spaceId: string,
  patch: { name?: string; description?: string; color?: string | null; icon?: string | null; archived?: boolean }
) {
  const { space } = await requireSpace(userId, spaceId, "manage");
  if (patch.archived && space.isDefault) throw new AccessError(400, "Varsayılan bölüm arşivlenemez");
  const set: Record<string, any> = { updatedAt: new Date() };
  if (patch.name !== undefined) set.name = patch.name;
  if (patch.description !== undefined) set.description = patch.description;
  if (patch.color !== undefined) set.color = patch.color;
  if (patch.icon !== undefined) set.icon = patch.icon;
  if (patch.archived !== undefined) set.archived = patch.archived;
  await db.update(spaces).set(set).where(eq(spaces.spaceId, spaceId));
  const row = (await db.select().from(spaces).where(eq(spaces.spaceId, spaceId)).limit(1))[0];
  return serializeSpace(row);
}

/** Resolve the space for a new object: the requested one if writable, else the default. */
export async function resolveTargetSpace(userId: string, spaceId?: string | null) {
  const ctx = await ensurePersonalWorkspace(userId);
  if (!spaceId) return { workspaceId: ctx.workspaceId, spaceId: ctx.defaultSpaceId };
  const { space } = await requireSpace(userId, spaceId, "write");
  if (space.archived) throw new AccessError(400, "Arşivlenmiş bölüme nesne eklenemez");
  return { workspaceId: space.workspaceId, spaceId: space.spaceId };
}

export async function moveObjectToSpace(userId: string, noteId: string, spaceId: string) {
  const target = await resolveTargetSpace(userId, spaceId);
  const found = await db
    .select({ noteId: notes.noteId })
    .from(notes)
    .where(and(eq(notes.noteId, noteId), eq(notes.userId, userId)))
    .limit(1);
  if (found.length === 0) throw new AccessError(404, "Nesne bulunamadı");
  await db.update(notes).set({ spaceId: target.spaceId, workspaceId: target.workspaceId }).where(eq(notes.noteId, noteId));
  return target;
}

/** Test hook: forget cached workspace contexts. */
export function _clearWorkspaceCache() {
  cache.clear();
}
