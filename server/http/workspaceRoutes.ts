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
import { today, ensureDailyNote, logToDay } from "../services/today";
import {
  monthView, ensureMonthlyNote, futureLog, migrationCandidates, migrateTask, logToPage,
  listCollections, createCollection, collectionDetail, journalIndex, monthlyReview,
} from "../services/journal";
import { habitMonth, createHabit, updateHabit, deleteHabit, setHabitDay, setDayRating } from "../services/habits";
import { MONTH_RE } from "../../src/lib/journal";
import { applyTemplate } from "../services/templates";
import { listTemplates, createTemplate, updateTemplate, deleteTemplate } from "../services/userTemplates";
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
    ["/capture", "/inbox", "/relations", "/relation-types", "/objects", "/spaces", "/workspace", "/search", "/today", "/templates", "/home", "/ai/settings", "/ai/embeddings", "/ai/actions", "/ask", "/graph", "/journal"],
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
  r.post(
    "/today/log",
    handle(async (req) => {
      const body = parse(
        z.object({ date: isoDay.optional(), text: z.string().min(1).max(2000), kind: z.enum(["task", "event", "note"]).optional() }),
        req.body
      );
      return logToDay(uid(req), body.date || todayIso(), todayIso(), { text: body.text as string, kind: body.kind });
    })
  );

  // --------------------------------------------------------------- journal
  const monthKey = z.string().regex(MONTH_RE, "Ay YYYY-MM biçiminde olmalı");
  r.get(
    "/journal/month",
    handle(async (req) => monthView(uid(req), parse(monthKey.default(todayIso().slice(0, 7)), req.query.month)))
  );
  r.post(
    "/journal/month",
    handle(async (req) => ensureMonthlyNote(uid(req), parse(z.object({ month: monthKey }), req.body).month as string))
  );
  r.get(
    "/journal/future",
    handle(async (req) => {
      const q = parse(z.object({ from: monthKey.optional(), months: z.coerce.number().int().min(1).max(24).optional() }), req.query);
      return futureLog(uid(req), (q.from as string) || todayIso().slice(0, 7), q.months || 12);
    })
  );
  r.get(
    "/journal/migration",
    handle(async (req) => ({ tasks: await migrationCandidates(uid(req), parse(isoDay.default(todayIso()), req.query.date) as string) }))
  );
  r.post(
    "/journal/migrate",
    handle(async (req) => {
      const b = parse(
        z.object({
          note_id: z.string().min(1),
          task_index: z.number().int().min(0),
          action: z.enum(["today", "month", "cancel"]),
          date: isoDay.optional(),
          month: monthKey.optional(),
        }),
        req.body
      );
      return migrateTask(uid(req), {
        note_id: b.note_id as string,
        task_index: b.task_index as number,
        action: b.action as "today" | "month" | "cancel",
        date: (b.date as string) || todayIso(),
        month: b.month as string | undefined,
      });
    })
  );
  r.post(
    "/journal/log",
    handle(async (req) => {
      const b = parse(
        z.object({
          note_id: z.string().min(1),
          text: z.string().min(1).max(2000),
          kind: z.enum(["task", "event", "note"]).optional(),
          section: z.string().max(60).optional(),
        }),
        req.body
      );
      return logToPage(uid(req), b.note_id as string, { text: b.text as string, kind: b.kind, section: b.section });
    })
  );
  r.get("/journal/collections", handle(async (req) => listCollections(uid(req))));
  r.post(
    "/journal/collections",
    handle(async (req) => {
      const b = parse(z.object({ title: z.string().min(1).max(200), description: z.string().max(2000).optional() }), req.body);
      return createCollection(uid(req), { title: b.title as string, description: b.description });
    })
  );
  r.get("/journal/collections/:id", handle(async (req) => collectionDetail(uid(req), req.params.id)));
  r.get("/journal/index", handle(async (req) => journalIndex(uid(req))));

  // Habits and mood (2.5d). `today` is the client's local day, for streaks.
  r.get(
    "/journal/habits",
    handle(async (req) => {
      const q = parse(z.object({ month: monthKey.optional(), today: isoDay.optional(), all: z.string().optional() }), req.query);
      const today = (q.today as string) || todayIso();
      return habitMonth(uid(req), (q.month as string) || today.slice(0, 7), today, q.all === "1");
    })
  );
  const habitColor = z.string().regex(/^#[0-9a-fA-F]{6}$/).nullable().optional();
  r.post(
    "/journal/habits",
    handle(async (req) => {
      const b = parse(z.object({ name: z.string().min(1).max(80), color: habitColor }), req.body);
      return createHabit(uid(req), { name: b.name as string, color: b.color });
    })
  );
  r.put(
    "/journal/habits/:id",
    handle(async (req) => {
      const b = parse(z.object({ name: z.string().max(80).optional(), color: habitColor, archived: z.boolean().optional(), position: z.number().int().min(0).max(1000).optional() }), req.body);
      return updateHabit(uid(req), req.params.id, b as any);
    })
  );
  r.delete("/journal/habits/:id", handle(async (req) => deleteHabit(uid(req), req.params.id)));
  r.put(
    "/journal/habits/:id/days/:day",
    handle(async (req) => {
      const day = parse(isoDay, req.params.day) as string;
      const b = parse(z.object({ done: z.boolean() }), req.body);
      return setHabitDay(uid(req), req.params.id, day, b.done as boolean);
    })
  );
  r.put(
    "/journal/ratings/:day",
    handle(async (req) => {
      const day = parse(isoDay, req.params.day) as string;
      const scale = z.number().int().min(1).max(5).nullable().optional();
      const b = parse(z.object({ mood: scale, energy: scale }), req.body);
      return setDayRating(uid(req), day, { mood: b.mood, energy: b.energy });
    })
  );

  // Monthly review (2.5e); rate limited because it may call a model
  r.post(
    "/journal/review",
    rateLimit("review", 6),
    handle(async (req) => {
      const b = parse(z.object({ month: monthKey, today: isoDay.optional() }), req.body);
      return monthlyReview(uid(req), b.month as string, (b.today as string) || todayIso());
    })
  );

  // -------------------------------------------------------------- templates
  r.get("/templates", handle(async (req) => listTemplates(uid(req), { includeHidden: req.query.all === "1" })));
  const templateBody = z.object({
    name: z.string().trim().max(80).optional(),
    description: z.string().max(300).optional(),
    note_type_id: id.optional().nullable(),
    title_template: z.string().max(300).optional(),
    content_template: z.string().max(50_000).optional(),
    hidden: z.boolean().optional(),
  });
  r.post("/templates", rateLimit("templates-edit", 60), handle(async (req) => createTemplate(uid(req), parse(templateBody, req.body))));
  r.put("/templates/:key", rateLimit("templates-edit", 60), handle(async (req) => updateTemplate(uid(req), req.params.key, parse(templateBody, req.body))));
  r.delete("/templates/:key", handle(async (req) => deleteTemplate(uid(req), req.params.key)));
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
