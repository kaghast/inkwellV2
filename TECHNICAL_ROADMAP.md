# Inkwell — Technical Roadmap

Each phase ships as its own branch/PR and follows the same definition of done: backend, frontend, migrations, validation/auth, error handling, tests, then `npm run lint` (type-check), `npx vite build` and `npm test` pass, the change is exercised in a browser, and the docs are updated.

Stack stays React/TypeScript/Vite/Tailwind/Radix (shadcn)/Express/Drizzle/Postgres(+PGlite). New dependencies need a reason; Phase 1 adds none (tests use `node:test` through the existing `tsx`).

---

## Phase 0 — Audit and foundation ✅ (this branch)

- Audit and four planning docs.
- Migration ledger (`schema_migrations`) and `src/db/migrations.ts`.
- `server/` module layout; new routes live in modules and are mounted from `server.ts`.
- Test runner: `npm test` → `tsx --test tests/*.test.ts`.

## Phase 1 — Capture, Inbox, Today, objects ✅ (this branch)

Backend
- Object model on `notes` (`workspace_id`, `space_id`, `visibility`, `source`, `ai_meta`).
- Object Types 2.0: system types seeded with property schemas (Idea, Project, Person, Meeting, Event, Book, Research paper, Article, Quote, Reference, Location, File, Daily note) — no code per type.
- Personal workspace + default Space per user; Spaces CRUD (`/api/spaces`), object-to-space assignment.
- Typed relations (`/api/relations`, `/api/objects/:id/relations`), relation types incl. custom; wikilink → relation sync on every note save + one-off backfill; backlinks endpoint.
- Universal capture: `POST /api/capture` (text, URL, pasted content, file id; also usable by a future web clipper / share sheet with the same auth), Inbox (`/api/inbox`), review actions (accept with edits, save without AI, reject, retry, batch accept).
- AI service abstraction with Gemini + deterministic heuristic provider; capture pipeline (context → parse → type → metadata → relation suggestions) on an in-process job runner with retries and boot recovery.
- Today: `/api/today` (daily note get-or-create, the day's objects, captures, open tasks, reminders); captures accepted on a day are related to that day's daily note.
- Global search `/api/search` (titles, content, tags, people, types, spaces, captures). Semantic ranking is deliberately left out until Phase 2: without an AI key the existing embeddings are hash vectors that carry no meaning.
- Templates that create connected objects: Research, Meeting, Project, Daily.
- Rate limiting and zod validation on new endpoints; generic error bodies.
- Privacy-respecting analytics events (`first_object`, `first_capture`, `first_relation`, `first_backlink`, `returned`) and an activation summary endpoint.

Frontend
- New navigation rail: Home, Inbox (badge), Today, Knowledge, Explore ▸, Work ▸, Spaces, Settings.
- Persistent "Aklında ne var?" capture bar in the header on every page; `c` opens capture, `Ctrl/⌘+K` command palette, `/` search.
- Home, Inbox (review UI), Today, Spaces pages; object relations panel on the note page; template dialog.
- "Encryption" renamed to **Parola kilidi** in the UI (it is a lock, not encryption).

Verification: `npm run lint` (tsc), `npx vite build`, `npm test` (16 unit tests) and `npm run test:api` (12 end-to-end API tests incl. tenant isolation, against a running server) pass. The boot migrations were run against a copy of a real pre-Phase-1 PGlite database; all 15 existing notes were attached to the default space. The UI flows were exercised in a browser at desktop and 375 px widths.

Known limits after Phase 1 (by design, documented in the PR):
- The Gemini extraction path (`server/ai/gemini.ts`) is implemented but **not exercised**: no `GEMINI_API_KEY` was available. Its response parser and prompt are unit-tested; the live call is not.
- The job runner is in-process: work survives restarts (re-queued at boot from `captures.status`) but not multiple server instances.
- Team workspaces, invites and roles beyond the owner exist only in the schema and access helpers.
- OCR, PDF/DOCX text extraction and audio transcription need an AI provider with vision/audio → Phase 2. Files and images are captured into the Inbox with their file attached and metadata from the filename.
- Search ranks in Node over the user's rows (same O(n) cost as today's list endpoint); SQL/pgvector retrieval → Phase 2.

## Phase 2 — AI pipeline, Ask Inkwell, Graph 2.0

### Phase 2a status (shipped)

- **Providers:** Gemini and Anthropic Claude. Anthropic uses the official `@anthropic-ai/sdk`, with server-side refusal fallback enabled. Users pick the provider and key in Settings > Yapay Zeka; keys are encrypted, verified with a real call, and the user's key takes precedence over the server key. OpenAI is not done.
- **Embeddings:** Generated in a background job after every save (no AI call on the save path). Each vector stores its model in `notes.embedding_model`; legacy hash vectors (model NULL) are never compared. Reindexing is automatic when a provider is enabled, or via `POST /api/ai/embeddings/reindex`. Claude has no embeddings, so semantic search runs only with Gemini.
- **Hybrid retrieval:** BM25 over ~700-character chunks, plus note-level cosine similarity, plus a boost from relation neighbours. Owner, filter (type, space, tag, date) and password-locked exclusion are applied in SQL; ranking runs in Node.
- **Ask Inkwell (`/ask`):** Answers use numbered sources. `[n]` citations are checked against the retrieved set: invalid numbers are removed, and uncited sentences are counted and flagged. Without a model the page lists the sources only, and it says "bulamadım" when nothing matches.
- **AI actions on the note page:** All 15 listed actions. Results are suggestions; "Nota ekle" appends them as a new version. "İlgili notlar" works without a model.
- **Graph 2.0 (`/network`):** Typed relation edges (amber, labelled on hover) and filters for object type, relation type, date, Bölüm and person. The inspector shows typed relations, "İlgili notları bul" and Ask. "Beklenmedik bağlantılar" finds pairs that are similar (by embeddings, otherwise TF-IDF) but more than two hops apart; a pair is shown only when the model explains it with `[1]`/`[2]` passages, and "NONE" or uncited explanations are dropped.
- **Tests:** A deterministic mock provider (`AI_PROVIDER=mock`, refused when `NODE_ENV=production`) lets the end-to-end tests cover the model paths. Live Gemini and Claude calls were not exercised because no real key was available; key validation was checked against Google's API with an invalid key.

Remaining in Phase 2:
- OpenAI provider
- `vector` column with an HNSW index on Postgres, and `tsvector` full text in SQL (ranking is still in Node)
- `ai_runs` token accounting
- Vision/OCR and file text extraction
- Daily AI review
- 3D graph

### Original Phase 2 plan

1. Providers: OpenAI and Anthropic implementations of `AiProvider` (REST via `fetch`, no SDKs), per-task model config, timeouts, token accounting into `ai_runs`.
2. Move embedding generation off the save path into a job; real `vector(768)` column + HNSW index on Postgres.
3. Chunking (`object_chunks`) and hybrid retrieval: Postgres full text (`tsvector`, `simple` config for Turkish), vector similarity, metadata filters, relation/backlink expansion, permission filter **in SQL**.
4. Ask Inkwell: answer only from retrieved chunks, every factual sentence cites `[object_id]`, citations validated against the retrieved set (uncited claims are stripped or flagged); "I could not find this in your knowledge" when retrieval is empty.
5. AI actions on objects and in Ask: summarize, rewrite, translate, explain, extract tasks, tags, outline, find related, find connections, compare, contradictions, meeting notes, project summary, research questions/insights. Actions write suggestions, never silent edits.
6. Vision/audio: OCR for images (slides, whiteboards, business cards → Person object), PDF/DOCX/XLSX/PPTX text extraction, audio transcription.
7. Graph 2.0 on the existing 2D/3D graph: typed relation edges, filters (type, space, date, tag, relation, person, project), node inspector, "Find unexpected connections" (embedding similarity between objects with **no** path ≤ 2, explained by the model with cited passages; proximity alone is never labelled meaningful).
8. Daily AI review: built only from that day's objects/captures/tasks/timeslots; states what it used; no inferred activity.

## Phase 2.5 — Journal (Bullet Journal method)

Goal: Inkwell can be used as a bullet journal — rapid logging, daily/monthly/future logs, migration, collections, trackers, reflection — built on the existing daily notes, markdown tasks, templates and Today page. It sits before Phase 3 so the journal data model is settled before sharing arrives; journal content stays private by default.

Principle: **the markdown text stays the source of truth.** Bullets live in note content; any table added for them is a derived index that can be rebuilt from content. Existing `- [ ]` / `- [x]` stay valid and keep their meaning.

Bullet syntax (one list item per entry):

| Entry | Markdown | Shown as |
| --- | --- | --- |
| Open task | `- [ ] text` | checkbox |
| Done task | `- [x] text` | ticked |
| Migrated (carried forward) | `- [>] text` | › |
| Scheduled (future log) | `- [<] text` | ‹ |
| Cancelled | `- [-] text` | struck through |
| Event | `- [o] text` | ○ |
| Note | `- text` | – |
| Signifiers | `!` priority, `?` explore, right after the bullet: `- [ ] ! text` | badge |

Sub-steps:

- **2.5a Rapid logging and task states** — parser for the syntax above (`src/lib/tasks.ts`), task state changes through `PATCH /notes/:id/tasks` (`state` in addition to `checked`), rendering and a state menu in notes, a quick-entry line on Today (`POST /today/log`) that writes into the day's daily note, daily template in rapid-log format. Task progress counts open + done only.
- **2.5b Monthly log, future log, migration** — `type_monthly` / `type_future` system types, `notes.period_key` (`2026-11`, unique per user and type), monthly page (calendar list + task list), future log grid, migration review (carry to today / schedule to a month / cancel; the original line becomes `[>]`/`[<]` with a link to where it went; nothing is deleted).
- **2.5c Collections and index** — `type_collection` with `part_of` relations, auto-built index page (months, collections, threads).
- **2.5d Trackers** — `habits` + `habit_logs`, monthly habit grid and streaks, optional mood/energy on the daily note.
- **2.5e Reflection and AI** — daily/weekly/monthly reflection prompts; AI monthly review (done, postponed repeatedly, recurring themes) with citations, which also covers Phase 2's "daily AI review".
- Derived `bullets` index table (kind, state, signifier, date, scheduled month, origin/moved links) once cross-day queries need it (2.5b), rebuilt on every save.

Changes to existing features: Today page becomes the daily log; note preview renders bullet states; templates gain monthly/future/collection; capture gets an "add to today's log" target; Ask/search filter by bullet kind/state; a task bullet can be turned into a Kanban card.

Out of scope: handwriting/stylus (Phase 6), shared journals (Phases 3–4), decorative page layouts.

### Phase 2.5a status

- Bullet parser, states and signifiers in `src/lib/tasks.ts` (pure, unit tested); `[>] [<] [-] [o]` lines are rendered with their own markers, open/done keep the checkbox.
- `PATCH /notes/:id/tasks` accepts `{ index, state }` (`open | done | migrated | scheduled | cancelled`); `{ index, checked }` still works.
- Task menu on every task in the note view (done, carried forward, scheduled, cancelled, reopen).
- Today: quick-entry line (`POST /today/log`) — prefixes `.`/`t` task, `o` event, `-` note, `!` priority, `?` explore; creates the daily note when missing.
- Daily template uses the rapid-log format (`## Kayıt`, `## Yansıma`); customised daily templates are kept.

### Phase 2.5b/c status

- System types `type_monthly` ("Aylık Kayıt") and `type_collection` ("Koleksiyon"). Monthly logs are unique per user and month the same way daily notes are unique per day (type + date prefix), so **no `period_key` column was needed**; monthly notes use `period = "month"` and appear in the existing month strip. Journal page types (daily, monthly) are never offered to capture or user templates.
- `server/services/journal.ts`, routes under `/api/journal/*`:
  - `GET /journal/month?month=` — monthly log + calendar list built from that month's daily notes (events, done/open counts); `POST /journal/month` creates the month page (idempotent).
  - `GET /journal/future?from=&months=` — future log from the next months' monthly logs.
  - `GET /journal/migration?date=` — open tasks in daily notes of the last 92 days before `date` and in earlier monthly logs.
  - `POST /journal/migrate` — `today` (copy to the day's log, original becomes `[>] … → [[target]]`), `month` (copy to the month's "Görevler", original `[<] … → [[target]]`), `cancel` (`[-]`). The copy is written first and removed again if the source update fails; nothing is deleted. A task that is no longer open returns 409.
  - `POST /journal/log` — add an entry to a section of any own page (month, collection).
  - `GET/POST /journal/collections`, `GET /journal/collections/:id` (entries + notes linked with `part_of`), `GET /journal/index` (months, collections, top tags).
- Pages: `/journal/month/:month`, `/journal/future`, `/journal/collections/:id`, `/journal` (index); "Defter" group in the rail, palette entries, `g m` / `g j` shortcuts; Today shows "Taşınacaklar" and links to the month.
- The derived `bullets` table is **deferred**: all journal reads parse note content directly, which is fast enough at personal scale. It comes back when cross-workspace queries (Phase 3) need SQL filtering.

### Phase 2.5d/e status

- Migration `2026_11_25_009_habits` adds three tables (no existing table changes): `habits` (name, colour, position, archived), `habit_logs` (one row per done day, primary key `(habit_id, day)`), `day_ratings` (mood and energy 1–5 per user and day).
- `server/services/habits.ts`, routes `GET/POST /journal/habits`, `PUT/DELETE /journal/habits/:id`, `PUT /journal/habits/:id/days/:day`, `PUT /journal/ratings/:day`. Streaks (`habitStreaks` in `src/lib/journal.ts`) count back from today, or from yesterday while today is not ticked. Archiving keeps history; deleting asks first and removes the habit's log rows.
- Pages: `/journal/habits/:month` (habit × day grid with streaks, mood and energy rows), Today shows a "Alışkanlıklar ve ruh hali" card.
- Reflection: rotating questions (`DAILY_PROMPTS`, `WEEKLY_PROMPTS` on Sundays, `MONTHLY_PROMPTS`) on Today and the month page; answers go into the page's `## Yansıma` section as `- **Soru** cevap` (the section is added to older pages that lack it). New monthly logs include `## Yansıma`.
- Monthly review `POST /journal/review` (rate limited): counts from the month's daily notes, monthly log, habits and mood (`server/services/reviewFacts.ts`, pure and unit tested: task states, events, tasks postponed at least twice, top tags, averages). With a model it adds a short narrative citing numbered pages, validated with `checkCitations`; without one it returns the counts only. Locked notes are never read. "Ayın sayfasına ekle" appends it under `## Değerlendirme` with citations turned into `[[links]]` (a version is saved). This also covers Phase 2's "daily AI review" item at month granularity.

## Phase 3 — SaaS: workspaces, roles, tenancy, billing, storage, jobs

1. Team workspaces, workspace switcher, invitations (hashed tokens, expiry), roles Owner/Admin/Editor/Commenter/Viewer.
2. Central access layer: every object query goes through `scopeForUser(userId)` that joins memberships; per-role tests; tenant-isolation tests (user A can never read B's ids via any endpoint).
3. Plans/limits config, `usage_records`, quota checks for objects/storage/members/AI; `BillingProvider` abstraction + Stripe (checkout, portal, webhooks with signature verification and idempotency); trial and downgrade rules (over-limit becomes read-only, never deletion).
4. Storage abstraction (`local`, `s3` — S3/R2/MinIO share the API) with signed URLs; background copy of existing uploads with checksum verification.
5. Durable jobs (Postgres-backed queue, `SELECT … FOR UPDATE SKIP LOCKED`), job dashboard, dead-letter.
6. Security: cookie-only sessions + CSRF token, session table/revocation, rate limits on auth, upload sniffing, audit log, real optional E2E encryption for locked notes (AES-GCM + PBKDF2/Argon2id; encrypted notes are excluded from search/AI by design).
7. Ops: structured logs, health/readiness, error tracking hook, scheduled backups + restore runbook.

## Phase 4 — Collaboration

Shared spaces, sharing links, comments table with mentions, notifications, activity feed, version comparison (diff view). No realtime co-editing yet; optimistic locking on `updated_at` to prevent lost updates.

## Phase 5 — Integrations

Web clipper (uses `POST /api/capture` with a scoped API key), share endpoint for a future mobile app, Drive and Calendar into the object model (Event objects), email-in capture address, outgoing webhooks.

## Phase 6 — Advanced

Mobile app, voice capture, automations (rules on capture/type/relation events).

---

## Implementation order rationale

Capture and the Inbox come first because they make the product's promise ("capture anything") usable on day one and they feed every later feature with typed, related objects. Relations come in the same phase because the "connection you had not noticed" moment needs a relation graph to exist before AI can extend it. Workspaces are modelled in Phase 1 (so object rows already carry `workspace_id`) but team features wait for Phase 3, when the access layer is centralised.

## Blockers and missing credentials

| Need | Status | Effect |
| --- | --- | --- |
| `GEMINI_API_KEY` (or OpenAI/Anthropic key) | Not configured in dev | Capture uses the heuristic provider; UI labels results as "Kural tabanlı" instead of AI. |
| Stripe keys + webhook secret | Not configured | Billing abstraction only (Phase 3); no payment UI. |
| S3/R2/MinIO credentials | Not configured | Local disk + DB backup stays primary. |
| Production database access | Not granted | Migrations are written and tested on PGlite; running them on production is the owner's call. |
