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

1. Providers: OpenAI and Anthropic implementations of `AiProvider` (REST via `fetch`, no SDKs), per-task model config, timeouts, token accounting into `ai_runs`.
2. Move embedding generation off the save path into a job; real `vector(768)` column + HNSW index on Postgres.
3. Chunking (`object_chunks`) and hybrid retrieval: Postgres full text (`tsvector`, `simple` config for Turkish), vector similarity, metadata filters, relation/backlink expansion, permission filter **in SQL**.
4. Ask Inkwell: answer only from retrieved chunks, every factual sentence cites `[object_id]`, citations validated against the retrieved set (uncited claims are stripped or flagged); "I could not find this in your knowledge" when retrieval is empty.
5. AI actions on objects and in Ask: summarize, rewrite, translate, explain, extract tasks, tags, outline, find related, find connections, compare, contradictions, meeting notes, project summary, research questions/insights. Actions write suggestions, never silent edits.
6. Vision/audio: OCR for images (slides, whiteboards, business cards → Person object), PDF/DOCX/XLSX/PPTX text extraction, audio transcription.
7. Graph 2.0 on the existing 2D/3D graph: typed relation edges, filters (type, space, date, tag, relation, person, project), node inspector, "Find unexpected connections" (embedding similarity between objects with **no** path ≤ 2, explained by the model with cited passages; proximity alone is never labelled meaningful).
8. Daily AI review: built only from that day's objects/captures/tasks/timeslots; states what it used; no inferred activity.

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
