// Team workspaces, members, roles and invitations (Phase 3a), and the access
// check for objects shared through a team workspace.
//
// Roles: owner > admin > editor > commenter > viewer. Owners and admins
// manage members and billing; editors write; commenters and viewers read.
// An object is visible to its creator and, when it lives in a team
// workspace, to that workspace's members with their role.
import { and, asc, desc, eq, gte, isNull, sql } from "drizzle-orm";
import { db, workspaces, workspaceMembers, spaces, invitations, users, notes, noteTypes } from "../../src/db/index";
import { AccessError, ensurePersonalWorkspace, type Role } from "./workspaces";
import { genId } from "./notesCore";
import { audit, checkQuota, effectivePlan, hashToken, newToken, serializePlan } from "./billing";

export const ROLES: Role[] = ["owner", "admin", "editor", "commenter", "viewer"];
const INVITABLE: Role[] = ["admin", "editor", "commenter", "viewer"];
const MANAGE: Role[] = ["owner", "admin"];
const WRITE: Role[] = ["owner", "admin", "editor"];
const INVITE_DAYS = 7;

async function roleIn(userId: string, workspaceId: string): Promise<Role | null> {
  const r = await db
    .select({ role: workspaceMembers.role })
    .from(workspaceMembers)
    .where(and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, userId)))
    .limit(1);
  return r[0] ? (r[0].role as Role) : null;
}

async function requireRole(userId: string, workspaceId: string, allowed: Role[]) {
  const ws = (await db.select().from(workspaces).where(eq(workspaces.workspaceId, workspaceId)).limit(1))[0];
  const role = ws ? await roleIn(userId, workspaceId) : null;
  // 404 for non-members so other tenants' ids cannot be probed
  if (!ws || !role) throw new AccessError(404, "Çalışma alanı bulunamadı");
  if (!allowed.includes(role)) throw new AccessError(403, "Bu işlem için yetkin yok");
  return { ws, role };
}

// ------------------------------------------------------------- object access
export type NeedAccess = "read" | "write" | "delete";

/**
 * Role of the user on an object: "owner" for its creator, else their role in
 * the object's team workspace, else null. Personal workspaces are never shared.
 */
export async function objectRole(userId: string, note: { userId: string; workspaceId: string | null }): Promise<Role | null> {
  if (note.userId === userId) return "owner";
  if (!note.workspaceId) return null;
  const ws = (await db.select({ kind: workspaces.kind }).from(workspaces).where(eq(workspaces.workspaceId, note.workspaceId)).limit(1))[0];
  if (!ws || ws.kind !== "team") return null;
  return roleIn(userId, note.workspaceId);
}

/** Throws 404 (no access) or 403 (read-only role) unless the user may do `need`. */
export async function requireObjectAccess(userId: string, note: { userId: string; workspaceId: string | null }, need: NeedAccess = "read"): Promise<Role> {
  const role = await objectRole(userId, note);
  if (!role) throw new AccessError(404, "Not bulunamadı");
  if (need === "write" && !WRITE.includes(role)) throw new AccessError(403, "Bu notu düzenleme yetkin yok");
  if (need === "delete" && !(role === "owner" || MANAGE.includes(role))) throw new AccessError(403, "Bu notu silme yetkin yok");
  return role;
}

/**
 * SQL predicate for "objects this user may read": own objects, plus objects
 * in team workspaces the user belongs to.
 */
export function visibleObjectsSql(userId: string) {
  return sql`(${notes.userId} = ${userId} OR ${notes.workspaceId} IN (
    SELECT wm.workspace_id FROM workspace_members wm JOIN workspaces w ON w.workspace_id = wm.workspace_id
    WHERE wm.user_id = ${userId} AND w.kind = 'team'))`;
}

// ---------------------------------------------------------------- workspaces
export async function listMyWorkspaces(userId: string) {
  await ensurePersonalWorkspace(userId);
  const rows = await db
    .select({ ws: workspaces, role: workspaceMembers.role })
    .from(workspaceMembers)
    .innerJoin(workspaces, eq(workspaces.workspaceId, workspaceMembers.workspaceId))
    .where(eq(workspaceMembers.userId, userId))
    .orderBy(asc(workspaces.createdAt));
  const out = [];
  for (const r of rows as any[]) {
    const [m] = await db.select({ n: sql<number>`count(*)` }).from(workspaceMembers).where(eq(workspaceMembers.workspaceId, r.ws.workspaceId));
    const { plan } = await effectivePlan(r.ws.workspaceId);
    out.push({
      workspace_id: r.ws.workspaceId,
      name: r.ws.name,
      kind: r.ws.kind,
      role: r.role,
      is_owner: r.ws.ownerId === userId,
      members: Number(m?.n || 0),
      plan: { plan_key: plan.planKey, name: plan.name, limits: plan.limits },
      created_at: r.ws.createdAt.toISOString(),
    });
  }
  return out.sort((a, b) => (a.kind === "personal" ? -1 : b.kind === "personal" ? 1 : 0));
}

export async function createTeamWorkspace(userId: string, name: string) {
  const owned = await db
    .select({ n: sql<number>`count(*)` })
    .from(workspaces)
    .where(and(eq(workspaces.ownerId, userId), eq(workspaces.kind, "team")));
  if (Number(owned[0]?.n || 0) >= 10) throw new AccessError(400, "En fazla 10 ekip çalışma alanı oluşturabilirsin");
  const workspaceId = genId("ws");
  await db.insert(workspaces).values({ workspaceId, name: name.trim(), kind: "team", ownerId: userId });
  await db.insert(workspaceMembers).values({ workspaceId, userId, role: "owner" });
  await db.insert(spaces).values({ spaceId: genId("space"), workspaceId, createdBy: userId, name: "Genel", color: "#0ea5e9", icon: "Users", isDefault: true });
  await audit(userId, "team.created", "workspace", workspaceId, { name: name.trim() });
  return (await listMyWorkspaces(userId)).find((w) => w.workspace_id === workspaceId);
}

export async function renameWorkspace(userId: string, workspaceId: string, name: string) {
  await requireRole(userId, workspaceId, MANAGE);
  await db.update(workspaces).set({ name: name.trim(), updatedAt: new Date() }).where(eq(workspaces.workspaceId, workspaceId));
  await audit(userId, "team.renamed", "workspace", workspaceId, { name: name.trim() });
  return { ok: true };
}

export async function workspaceDetail(userId: string, workspaceId: string) {
  const { ws, role } = await requireRole(userId, workspaceId, ROLES);
  const members = await db
    .select({ userId: users.userId, name: users.name, email: users.email, picture: users.picture, role: workspaceMembers.role, joinedAt: workspaceMembers.createdAt })
    .from(workspaceMembers)
    .innerJoin(users, eq(users.userId, workspaceMembers.userId))
    .where(eq(workspaceMembers.workspaceId, workspaceId))
    .orderBy(asc(workspaceMembers.createdAt));
  const canManage = MANAGE.includes(role);
  const invites = canManage
    ? await db
        .select()
        .from(invitations)
        .where(and(eq(invitations.workspaceId, workspaceId), isNull(invitations.acceptedAt), isNull(invitations.revokedAt), gte(invitations.expiresAt, new Date())))
        .orderBy(desc(invitations.createdAt))
    : [];
  const spaceRows = await db.select().from(spaces).where(eq(spaces.workspaceId, workspaceId)).orderBy(asc(spaces.orderIndex), asc(spaces.createdAt));
  const { plan, subscription } = await effectivePlan(workspaceId);
  return {
    workspace_id: ws.workspaceId,
    name: ws.name,
    kind: ws.kind,
    role,
    can_manage: canManage,
    can_write: WRITE.includes(role),
    plan: serializePlan(plan),
    subscription,
    members: members.map((m: any) => ({
      user_id: m.userId,
      name: m.name,
      email: canManage || m.userId === userId ? m.email : null,
      picture: m.picture,
      role: m.role,
      joined_at: m.joinedAt.toISOString(),
    })),
    invitations: invites.map((i: any) => ({
      invitation_id: i.invitationId,
      email: i.email,
      role: i.role,
      expires_at: i.expiresAt.toISOString(),
      created_at: i.createdAt.toISOString(),
    })),
    spaces: spaceRows.map((s: any) => ({ space_id: s.spaceId, name: s.name, color: s.color, icon: s.icon, is_default: s.isDefault, archived: s.archived })),
  };
}

/** Objects in a team workspace (optionally one space), for its members. */
export async function workspaceObjects(userId: string, workspaceId: string, spaceId?: string | null, limit = 200) {
  const { ws } = await requireRole(userId, workspaceId, ROLES);
  if (ws.kind !== "team") throw new AccessError(400, "Kişisel çalışma alanının nesneleri not listesindedir");
  const conds: any[] = [eq(notes.workspaceId, workspaceId), eq(notes.archived, false)];
  if (spaceId) conds.push(eq(notes.spaceId, spaceId));
  const rows = await db
    .select({
      id: notes.noteId, slug: notes.slug, title: notes.title, typeId: notes.noteTypeId, typeName: noteTypes.name, spaceId: notes.spaceId,
      updatedAt: notes.updatedAt, isEncrypted: notes.isEncrypted, author: users.name, authorId: notes.userId,
    })
    .from(notes)
    .leftJoin(noteTypes, eq(noteTypes.typeId, notes.noteTypeId))
    .leftJoin(users, eq(users.userId, notes.userId))
    .where(and(...conds))
    .orderBy(desc(notes.updatedAt))
    .limit(Math.min(Math.max(limit, 1), 500));
  return rows.map((r: any) => ({
    note_id: r.id, slug: r.slug, title: r.title || "Adsız", type_id: r.typeId || "type_plain", type_name: r.typeName || "Düz Metin",
    space_id: r.spaceId, updated_at: r.updatedAt.toISOString(), is_encrypted: Boolean(r.isEncrypted), author: r.author || null, mine: r.authorId === userId,
  }));
}

// ---------------------------------------------------------------- members
export async function changeMemberRole(userId: string, workspaceId: string, memberId: string, role: Role) {
  const { ws, role: myRole } = await requireRole(userId, workspaceId, MANAGE);
  if (ws.kind !== "team") throw new AccessError(400, "Kişisel çalışma alanında üye yok");
  if (!INVITABLE.includes(role)) throw new AccessError(400, "Geçersiz rol");
  const target = await roleIn(memberId, workspaceId);
  if (!target) throw new AccessError(404, "Üye bulunamadı");
  if (target === "owner") throw new AccessError(400, "Sahibin rolü değiştirilemez");
  if (myRole === "admin" && target === "admin" && memberId !== userId) throw new AccessError(403, "Bir yönetici başka bir yöneticinin rolünü değiştiremez");
  await db.update(workspaceMembers).set({ role }).where(and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, memberId)));
  await audit(userId, "team.role_changed", "workspace", workspaceId, { member: memberId, from: target, to: role });
  return { ok: true };
}

/** Removes a member (or the caller leaves). Their objects stay in the workspace. */
export async function removeMember(userId: string, workspaceId: string, memberId: string) {
  const self = memberId === userId;
  const { ws, role: myRole } = await requireRole(userId, workspaceId, self ? ROLES : MANAGE);
  if (ws.kind !== "team") throw new AccessError(400, "Kişisel çalışma alanından ayrılamazsın");
  const target = await roleIn(memberId, workspaceId);
  if (!target) throw new AccessError(404, "Üye bulunamadı");
  if (target === "owner") throw new AccessError(400, self ? "Sahip çalışma alanından ayrılamaz" : "Sahip çıkarılamaz");
  if (!self && myRole === "admin" && target === "admin") throw new AccessError(403, "Bir yönetici başka bir yöneticiyi çıkaramaz");
  await db.delete(workspaceMembers).where(and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, memberId)));
  await audit(userId, self ? "team.left" : "team.member_removed", "workspace", workspaceId, { member: memberId });
  return { ok: true };
}

// ------------------------------------------------------------- invitations
/**
 * Creates an invitation and returns its one-time link token (only its hash
 * is stored). There is no e-mail sender yet: the inviter shares the link.
 */
export async function inviteMember(userId: string, workspaceId: string, email: string, role: Role) {
  const { ws } = await requireRole(userId, workspaceId, MANAGE);
  if (ws.kind !== "team") throw new AccessError(400, "Kişisel çalışma alanına üye davet edilemez; önce bir ekip çalışma alanı oluştur");
  if (!INVITABLE.includes(role)) throw new AccessError(400, "Geçersiz rol");
  const addr = email.trim().toLowerCase();
  const existing = await db
    .select({ id: users.userId })
    .from(users)
    .innerJoin(workspaceMembers, eq(workspaceMembers.userId, users.userId))
    .where(and(eq(workspaceMembers.workspaceId, workspaceId), sql`lower(${users.email}) = ${addr}`))
    .limit(1);
  if (existing.length) throw new AccessError(409, "Bu kişi zaten üye");
  // Replace an open invitation for the same address instead of stacking them
  await db
    .update(invitations)
    .set({ revokedAt: new Date() })
    .where(and(eq(invitations.workspaceId, workspaceId), eq(invitations.email, addr), isNull(invitations.acceptedAt), isNull(invitations.revokedAt)));
  await checkQuota(userId, "members", { workspaceId });
  const { token, hash } = newToken();
  const invitationId = genId("inv");
  const expiresAt = new Date(Date.now() + INVITE_DAYS * 24 * 3600 * 1000);
  await db.insert(invitations).values({ invitationId, workspaceId, email: addr, role, tokenHash: hash, invitedBy: userId, expiresAt });
  await audit(userId, "team.invited", "workspace", workspaceId, { email: addr, role });
  return { invitation_id: invitationId, email: addr, role, expires_at: expiresAt.toISOString(), token, path: `/invite/${token}` };
}

export async function revokeInvitation(userId: string, workspaceId: string, invitationId: string) {
  await requireRole(userId, workspaceId, MANAGE);
  const r = await db
    .update(invitations)
    .set({ revokedAt: new Date() })
    .where(and(eq(invitations.invitationId, invitationId), eq(invitations.workspaceId, workspaceId), isNull(invitations.acceptedAt)))
    .returning({ id: invitations.invitationId });
  if (!r.length) throw new AccessError(404, "Davet bulunamadı");
  await audit(userId, "team.invite_revoked", "workspace", workspaceId, { invitation_id: invitationId });
  return { ok: true };
}

async function openInvitation(token: string) {
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) throw new AccessError(404, "Davet bulunamadı ya da süresi dolmuş");
  const inv = (await db.select().from(invitations).where(eq(invitations.tokenHash, hashToken(token))).limit(1))[0];
  if (!inv || inv.revokedAt || inv.acceptedAt || inv.expiresAt < new Date()) throw new AccessError(404, "Davet bulunamadı ya da süresi dolmuş");
  return inv;
}

/** What the invite page shows before accepting. */
export async function invitationPreview(userId: string, token: string) {
  const inv = await openInvitation(token);
  const ws = (await db.select().from(workspaces).where(eq(workspaces.workspaceId, inv.workspaceId)).limit(1))[0];
  const inviter = inv.invitedBy ? (await db.select({ name: users.name }).from(users).where(eq(users.userId, inv.invitedBy)).limit(1))[0] : null;
  const me = (await db.select({ email: users.email }).from(users).where(eq(users.userId, userId)).limit(1))[0];
  return {
    workspace_name: ws?.name || "Çalışma alanı",
    role: inv.role,
    invited_by: inviter?.name || null,
    email: inv.email,
    email_matches: (me?.email || "").toLowerCase() === inv.email,
    already_member: Boolean(await roleIn(userId, inv.workspaceId)),
    expires_at: inv.expiresAt.toISOString(),
  };
}

export async function acceptInvitation(userId: string, token: string) {
  const inv = await openInvitation(token);
  const me = (await db.select({ email: users.email }).from(users).where(eq(users.userId, userId)).limit(1))[0];
  if (!me || me.email.toLowerCase() !== inv.email) throw new AccessError(403, `Bu davet ${inv.email} adresine gönderildi; o hesapla giriş yap`);
  if (await roleIn(userId, inv.workspaceId)) throw new AccessError(409, "Zaten bu çalışma alanının üyesisin");
  // Mark accepted first so a link works once even with parallel requests
  const moved = await db
    .update(invitations)
    .set({ acceptedAt: new Date(), acceptedBy: userId })
    .where(and(eq(invitations.invitationId, inv.invitationId), isNull(invitations.acceptedAt), isNull(invitations.revokedAt)))
    .returning({ id: invitations.invitationId });
  if (!moved.length) throw new AccessError(404, "Davet bulunamadı ya da süresi dolmuş");
  await db.insert(workspaceMembers).values({ workspaceId: inv.workspaceId, userId, role: inv.role }).onConflictDoNothing();
  await audit(userId, "team.joined", "workspace", inv.workspaceId, { role: inv.role, invitation_id: inv.invitationId });
  return { workspace_id: inv.workspaceId, role: inv.role };
}

/** Team workspaces (id list) the user belongs to; used to show shared objects. */
export async function teamWorkspaceIds(userId: string): Promise<string[]> {
  const rows = await db
    .select({ id: workspaces.workspaceId })
    .from(workspaceMembers)
    .innerJoin(workspaces, eq(workspaces.workspaceId, workspaceMembers.workspaceId))
    .where(and(eq(workspaceMembers.userId, userId), eq(workspaces.kind, "team")));
  return rows.map((r: any) => r.id);
}

