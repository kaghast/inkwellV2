// Phase 1 API: capture & inbox, objects/relations, spaces, search, Today,
// templates, home. Mounted under /api by server.ts. Every route is behind the
// existing auth middleware and every query is scoped to the caller.
import express, { type RequestHandler } from "express";
import { z } from "zod";
import { handle, parse, rateLimit, uid, isoDay, id } from "../lib/http";
import { todayIso } from "../services/notesCore";
import {
  createCapture, startCaptureProcessing, listInbox, inboxCounts, acceptCapture, saveCaptureRaw,
  rejectCapture, retryCapture, serializeCapture,
} from "../services/capture";
import {
  listRelationTypes, createRelationType, createRelation, deleteRelation, acceptRelation, relationsForObject,
  pendingSuggestions,
} from "../services/relations";
import { listSpaces, createSpace, updateSpace, moveObjectToSpace, ensurePersonalWorkspace } from "../services/workspaces";
import { search } from "../services/search";
import { today, ensureDailyNote } from "../services/today";
import { TEMPLATES, applyTemplate } from "../services/templates";
import { activationSummary, recordActiveDay } from "../services/analytics";
import { aiStatus } from "../ai";
import { getAiSettings, saveAiSettings, testAiSettings, deleteAiKey } from "../services/aiSettings";
import { embeddingCoverage, reindexUser } from "../services/embeddings";
import { ask } from "../services/ask";
import { AI_ACTIONS, runAiAction, type AiActionKey } from "../services/aiActions";
import { appendToObject } from "../services/objects";
import { graphRelations, unexpectedConnections } from "../services/connections";
import { db, notes } from "../../src/db/index";
import { and, desc, eq, sql } from "drizzle-orm";
import { DAILY_TYPE_ID } from "../../src/lib/objectTypes";

const text = (max: number) => z.string().max(max);
const list = (max = 30, len = 200) => z.array(z.string().trim().min(1).max(len)).max(max);

export function createWorkspaceRouter(auth: RequestHandler) {
  const r = express.Router();
  r.use(
    ["/capture", "/inbox", "/relations", "/relation-types", "/objects", "/spaces", "/workspace", "/search", "/today", "/templates", "/home", "/ai/settings", "/ai/embeddings", "/ai/actions", "/ask", "/graph"],
    auth
  );

  // ---------------------------------------------------------------- capture
  const captureBody = z.object({
    text: text(100_000).optional(),
    url: z.string().url().max(2000).optional().nullable(),
    file_id: z.string().regex(/^file_[a-z0-9]+$/i).optional().nullable(),
    source: z.enum(["quick", "paste", "file", "image", "api", "share", "palette", "clipper"]).optional(),
    space_id: id.optional().nullable(),
    captured_on: isoDay.optional().nullable(),
    // direct = save immediately as an object without AI (still recorded as a capture)
    mode: z.enum(["inbox", "direct"]).optional(),
    type_id: id.optional().nullable(),
  });

  r.post(
    "/capture",
    rateLimit("capture", 60),
    handle(async (req) => {
      const body = parse(captureBody, req.body);
      const cap = await createCapture(uid(req), body);
      if (body.mode === "direct") {
        return saveCaptureRaw(uid(req), cap.captureId, { type_id: body.type_id });
      }
      startCaptureProcessing(cap.captureId);
      return { capture: serializeCapture(cap) };
    })
  );

  r.get(
    "/inbox",
    handle(async (req) => {
      const scope = parse(z.enum(["open", "processed", "all"]).default("open"), req.query.scope);
      return { items: await listInbox(uid(req), scope), counts: await inboxCounts(uid(req)) };
    })
  );
  r.get("/inbox/counts", handle(async (req) => inboxCounts(uid(req))));

  const acceptBody = z.object({
    title: text(300).optional(),
    type_id: id.optional(),
    space_id: id.optional().nullable(),
    tags: list(20, 60).optional(),
    people: list(20, 80).optional(),
    tasks: list(30, 300).optional(),
    related_ids: list(20).optional(),
    summary: text(2000).optional(),
  });
  r.post("/inbox/:id/accept", handle(async (req) => acceptCapture(uid(req), req.params.id, parse(acceptBody, req.body))));
  r.post("/inbox/:id/save-raw", handle(async (req) => saveCaptureRaw(uid(req), req.params.id)));
  r.post("/inbox/:id/reject", handle(async (req) => ({ capture: await rejectCapture(uid(req), req.params.id) })));
  r.post("/inbox/:id/retry", handle(async (req) => ({ capture: await retryCapture(uid(req), req.params.id) })));
  r.post(
    "/inbox/accept-batch",
    handle(async (req) => {
      const { ids } = parse(z.object({ ids: list(50) }), req.body);
      const results: Array<{ capture_id: string; ok: boolean; object_id?: string; error?: string }> = [];
      for (const cid of ids) {
        try {
          const out = await acceptCapture(uid(req), cid, {});
          results.push({ capture_id: cid, ok: true, object_id: out.object_id });
        } catch (e: any) {
          results.push({ capture_id: cid, ok: false, error: e?.status ? e.message : "Kabul edilemedi" });
        }
      }
      return { results };
    })
  );

  // -------------------------------------------------------------- relations
  r.get("/relation-types", handle(async (req) => listRelationTypes(uid(req))));
  r.post(
    "/relation-types",
    handle(async (req) =>
      createRelationType(
        uid(req),
        parse(z.object({ label: z.string().trim().min(1).max(60), inverse_label: z.string().trim().max(60).optional(), symmetric: z.boolean().optional() }), req.body) as any
      )
    )
  );
  r.get("/objects/:id/relations", handle(async (req) => relationsForObject(uid(req), req.params.id)));
  r.post(
    "/relations",
    handle(async (req) => {
      const body = parse(z.object({ source_id: id, target_id: id, relation_type: z.string().max(80).optional(), note: text(500).optional().nullable() }), req.body);
      return createRelation(uid(req), { ...(body as any), origin: "manual" });
    })
  );
  r.delete("/relations/:id", handle(async (req) => { await deleteRelation(uid(req), req.params.id); return { ok: true }; }));
  r.post("/relations/:id/accept", handle(async (req) => { await acceptRelation(uid(req), req.params.id); return { ok: true }; }));

  // ----------------------------------------------------------------- spaces
  r.get(
    "/workspace",
    handle(async (req) => {
      const ctx = await ensurePersonalWorkspace(uid(req));
      return { workspace_id: ctx.workspaceId, kind: "personal", role: ctx.role, default_space_id: ctx.defaultSpaceId, spaces: await listSpaces(uid(req)) };
    })
  );
  r.get("/spaces", handle(async (req) => listSpaces(uid(req))));
  const spaceBody = z.object({
    name: z.string().trim().min(1).max(80),
    description: text(500).optional(),
    color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional().nullable(),
    icon: z.string().max(40).optional().nullable(),
  });
  r.post("/spaces", handle(async (req) => createSpace(uid(req), parse(spaceBody, req.body) as any)));
  r.put("/spaces/:id", handle(async (req) => updateSpace(uid(req), req.params.id, parse(spaceBody.partial().extend({ archived: z.boolean().optional() }), req.body))));
  r.patch(
    "/objects/:id/space",
    handle(async (req) => {
      const { space_id } = parse(z.object({ space_id: id }), req.body);
      const t = await moveObjectToSpace(uid(req), req.params.id, space_id);
      return { ok: true, space_id: t.spaceId };
    })
  );

  // ----------------------------------------------------------------- search
  r.get(
    "/search",
    rateLimit("search", 120),
    handle(async (req) => {
      const q = parse(
        z.object({ q: z.string().max(200).default(""), type_id: id.optional(), space_id: id.optional(), limit: z.coerce.number().int().min(1).max(50).optional() }),
        req.query
      );
      if (!q.q.trim()) return { query: "", objects: [], inbox: [], spaces: [] };
      return search(uid(req), q.q, q);
    })
  );

  // ------------------------------------------------------------------ today
  r.get(
    "/today",
    handle(async (req) => {
      const date = parse(isoDay.default(todayIso()), req.query.date);
      return today(uid(req), date);
    })
  );
  r.post(
    "/today/daily-note",
    handle(async (req) => {
      const { date } = parse(z.object({ date: isoDay.optional() }), req.body);
      return ensureDailyNote(uid(req), date || todayIso(), todayIso());
    })
  );

  // -------------------------------------------------------------- templates
  r.get("/templates", handle(async () => TEMPLATES));
  r.post(
    "/templates/:key/apply",
    rateLimit("templates", 30),
    handle(async (req) => {
      const body = parse(
        z.object({
          title: text(200).optional(),
          date: isoDay.optional(),
          people: list(20, 80).optional(),
          project: text(200).optional(),
          tasks: list(30, 200).optional(),
          questions: list(30, 300).optional(),
          papers: list(30, 300).optional(),
          goal: text(1000).optional(),
          space_id: id.optional().nullable(),
        }),
        req.body
      );
      return applyTemplate(uid(req), req.params.key, body, todayIso());
    })
  );

  // ------------------------------------------------------- AI settings
  r.get("/ai/settings", handle(async (req) => getAiSettings(uid(req))));
  r.put(
    "/ai/settings",
    rateLimit("ai-settings", 20),
    handle(async (req) => {
      const out = await saveAiSettings(
        uid(req),
        parse(
          z.object({
            provider: z.enum(["gemini", "anthropic"]).optional(),
            api_key: z.string().trim().max(300).optional().nullable(),
            model: z.string().trim().max(100).regex(/^[\w.\-/]*$/).optional().nullable(),
            enabled: z.boolean().optional(),
          }),
          req.body
        )
      );
      // A newly enabled provider re-embeds notes whose vectors came from another model
      if (out.settings.enabled) void reindexUser(uid(req)).catch(() => undefined);
      return out;
    })
  );
  r.post("/ai/settings/test", rateLimit("ai-settings", 20), handle(async (req) => testAiSettings(uid(req))));
  r.get("/ai/embeddings", handle(async (req) => embeddingCoverage(uid(req))));
  r.post("/ai/embeddings/reindex", rateLimit("ai-reindex", 5), handle(async (req) => ({ queued: await reindexUser(uid(req)) })));
  r.delete("/ai/settings", handle(async (req) => deleteAiKey(uid(req))));

  // ----------------------------------------------------------- Ask Inkwell
  const filtersSchema = z
    .object({
      type_id: id.optional(),
      space_id: id.optional(),
      tag: z.string().max(60).optional(),
      date_from: isoDay.optional(),
      date_to: isoDay.optional(),
    })
    .optional();
  r.post(
    "/ask",
    rateLimit("ask", 30),
    handle(async (req) => {
      const body = parse(z.object({ question: z.string().trim().min(2).max(1000), filters: filtersSchema }), req.body);
      return ask(uid(req), body.question, (body.filters || {}) as any);
    })
  );

  // ------------------------------------------------------------ AI actions
  r.get("/ai/actions", handle(async () => Object.entries(AI_ACTIONS).map(([key, v]) => ({ key, label: v.label, output: v.output }))));
  r.post(
    "/objects/:id/ai",
    rateLimit("ai-action", 30),
    handle(async (req) => {
      const body = parse(
        z.object({
          action: z.enum(Object.keys(AI_ACTIONS) as [AiActionKey, ...AiActionKey[]]),
          language: z.string().trim().max(40).optional(),
          other_id: id.optional(),
        }),
        req.body
      );
      return runAiAction(uid(req), req.params.id, body.action, body);
    })
  );
  r.post(
    "/objects/:id/append",
    rateLimit("append", 60),
    handle(async (req) => {
      const body = parse(z.object({ text: z.string().min(1).max(50_000), summary: z.string().max(200).optional() }), req.body);
      return appendToObject(uid(req), req.params.id, body.text, body.summary || "Yapay zeka çıktısı eklendi");
    })
  );

  // -------------------------------------------------------------- Graph 2.0
  r.get("/graph/relations", handle(async (req) => graphRelations(uid(req))));
  r.post("/graph/unexpected", rateLimit("unexpected", 6), handle(async (req) => unexpectedConnections(uid(req))));

  // ------------------------------------------------------------------- home
  r.get(
    "/home",
    handle(async (req) => {
      const userId = uid(req);
      await recordActiveDay(userId);
      const recent = await db
        .select({ noteId: notes.noteId, slug: notes.slug, title: notes.title, noteTypeId: notes.noteTypeId, updatedAt: notes.updatedAt, spaceId: notes.spaceId })
        .from(notes)
        .where(and(eq(notes.userId, userId), eq(notes.archived, false), sql`coalesce(${notes.noteTypeId}, '') <> ${DAILY_TYPE_ID}`))
        .orderBy(desc(notes.updatedAt))
        .limit(8);
      return {
        inbox: await inboxCounts(userId),
        activation: await activationSummary(userId),
        suggestions: await pendingSuggestions(userId),
        recent: recent.map((n: any) => ({
          note_id: n.noteId,
          slug: n.slug,
          title: n.title || "Adsız",
          note_type_id: n.noteTypeId || "type_plain",
          space_id: n.spaceId,
          updated_at: n.updatedAt.toISOString(),
        })),
        ai: await aiStatus(userId),
      };
    })
  );

  return r;
}
