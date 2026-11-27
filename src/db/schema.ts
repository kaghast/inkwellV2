import { pgTable, text, timestamp, boolean, doublePrecision, vector, jsonb, index, integer } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';

// Users table (Stores logged in user accounts)
export const users = pgTable('users', {
  userId: text('user_id').primaryKey(),
  email: text('email').notNull().unique(),
  name: text('name').notNull(),
  picture: text('picture'),
  passwordHash: text('password_hash'),
  authProvider: text('auth_provider').default('email').notNull(),
  /** Set by a platform admin; a disabled user cannot sign in or use the API. */
  disabled: boolean('disabled').default(false).notNull(),
  lastLoginAt: timestamp('last_login_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updated_at: timestamp('updated_at').defaultNow().notNull(),
});

// Item groups table (for grouping tags, people, locations, categories)
export const itemGroups = pgTable('item_groups', {
  groupId: text('group_id').primaryKey(),
  userId: text('user_id').references(() => users.userId, { onDelete: 'cascade' }).notNull(),
  name: text('name').notNull(),
  type: text('type').notNull(), // 'tags' | 'people' | 'locations' | 'categories'
  color: text('color'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// Note Types table (Custom note types with dynamic parameters)
export interface NoteTypeField {
  id: string; // unique field id e.g. "field_1"
  name: string; // Label e.g. "Başlangıç - Bitiş Tarihi", "Öncelik", "Maliyet", "Tamamlandı mı?"
  type: 'datetime_range' | 'dropdown' | 'boolean' | 'number' | 'text' | 'datetime';
  options?: string[]; // For dropdown options
  required?: boolean;
  placeholder?: string;
}

export const noteTypes = pgTable('note_types', {
  typeId: text('type_id').primaryKey(),
  userId: text('user_id').references(() => users.userId, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  description: text('description'),
  color: text('color'),
  icon: text('icon'),
  isDefault: boolean('is_default').default(false).notNull(),
  fields: jsonb('fields').$type<NoteTypeField[]>().default([]).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// Kanban Columns table
export const kanbanColumns = pgTable('kanban_columns', {
  columnId: text('column_id').primaryKey(),
  userId: text('user_id').references(() => users.userId, { onDelete: 'cascade' }).notNull(),
  name: text('name').notNull(),
  color: text('color').default('#3b82f6'),
  orderIndex: doublePrecision('order_index').default(0).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// Categories table
export const categories = pgTable('categories', {
  categoryId: text('category_id').primaryKey(),
  userId: text('user_id').references(() => users.userId, { onDelete: 'cascade' }).notNull(),
  name: text('name').notNull(),
  color: text('color'),
  icon: text('icon'),
  groupId: text('group_id').references(() => itemGroups.groupId, { onDelete: 'set null' }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// Tags table
export const tags = pgTable('tags', {
  tagId: text('tag_id').primaryKey(),
  userId: text('user_id').references(() => users.userId, { onDelete: 'cascade' }).notNull(),
  name: text('name').notNull(),
  groupId: text('group_id').references(() => itemGroups.groupId, { onDelete: 'set null' }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// People (@mentions) table
export const people = pgTable('people', {
  personId: text('person_id').primaryKey(),
  userId: text('user_id').references(() => users.userId, { onDelete: 'cascade' }).notNull(),
  name: text('name').notNull(),
  groupId: text('group_id').references(() => itemGroups.groupId, { onDelete: 'set null' }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// Locations table
export const locations = pgTable('locations', {
  locationId: text('location_id').primaryKey(),
  userId: text('user_id').references(() => users.userId, { onDelete: 'cascade' }).notNull(),
  name: text('name').notNull(),
  lat: doublePrecision('lat').notNull(),
  lng: doublePrecision('lng').notNull(),
  groupId: text('group_id').references(() => itemGroups.groupId, { onDelete: 'set null' }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// Stickers, Icons and Emojis table
export const stickers = pgTable('stickers', {
  stickerId: text('sticker_id').primaryKey(),
  userId: text('user_id').references(() => users.userId, { onDelete: 'cascade' }).notNull(),
  name: text('name').notNull(),
  content: text('content').notNull(),
  type: text('type').default('emoji').notNull(), // 'emoji' | 'icon' | 'sticker'
  groupId: text('group_id').references(() => itemGroups.groupId, { onDelete: 'set null' }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// Keywords and Phrases (max 120 chars) table
export const phrases = pgTable('phrases', {
  phraseId: text('phrase_id').primaryKey(),
  userId: text('user_id').references(() => users.userId, { onDelete: 'cascade' }).notNull(),
  name: text('name').notNull(),
  phrase: text('phrase').notNull(),
  groupId: text('group_id').references(() => itemGroups.groupId, { onDelete: 'set null' }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export interface DriveFileRef {
  id: string;
  name: string;
  mime_type: string;
  web_view_link: string | null;
  icon_link: string | null;
}

// Notes table with pgvector embeddings for AI training and semantic search
export const notes = pgTable(
  'notes',
  {
    noteId: text('note_id').primaryKey(),
    userId: text('user_id').references(() => users.userId, { onDelete: 'cascade' }).notNull(),
    slug: text('slug'),
    title: text('title').default('').notNull(),
    content: text('content').default('').notNull(),
    date: text('date').notNull(), // ISO datetime string: YYYY-MM-DDTHH:mm:ss or YYYY-MM-DD
    tags: jsonb('tags').$type<string[]>().default([]).notNull(),
    people: jsonb('people').$type<string[]>().default([]).notNull(),
    categoryId: text('category_id').references(() => categories.categoryId, { onDelete: 'set null' }),
    locationId: text('location_id').references(() => locations.locationId, { onDelete: 'set null' }),
    noteTypeId: text('note_type_id').references(() => noteTypes.typeId, { onDelete: 'set null' }),
    customFields: jsonb('custom_fields').$type<Record<string, any>>().default({}).notNull(),
    // Knowledge areas (Alanlar) this note belongs to; a note can sit in many areas
    areaIds: jsonb('area_ids').$type<string[]>().default([]).notNull(),
    // What `date` stands for: a single day (default), the ISO week starting on that
    // Monday, or the month starting on that 1st
    period: text('period').default('day').notNull(),
    // Google Drive files linked to the note (metadata only: id, name, type, link, icon)
    driveFiles: jsonb('drive_files').$type<DriveFileRef[]>().default([]).notNull(),
    pinned: boolean('pinned').default(false).notNull(),
    archived: boolean('archived').default(false).notNull(),
    isEncrypted: boolean('is_encrypted').default(false).notNull(),
    passwordHash: text('password_hash'),
    // 768-dimensional text embedding vector (text-embedding-004 / Gemini embedding)
    embedding: vector('embedding', { dimensions: 768 }),
    aiSummary: text('ai_summary'),
    // Which model produced `embedding` (e.g. "gemini:gemini-embedding-001"); NULL = legacy hash vector
    embeddingModel: text('embedding_model'),
    // Object model (Phase 1). Nullable for rows written by legacy paths; the
    // boot backfill attaches them to the owner's personal workspace/space.
    workspaceId: text('workspace_id'),
    spaceId: text('space_id'),
    visibility: text('visibility').default('private').notNull(),
    // Where the object came from (capture id, url, author, site, kind)
    source: jsonb('source').$type<Record<string, any>>().default({}).notNull(),
    // AI/heuristic extraction metadata (provider, detected type, confidence, entities)
    aiMeta: jsonb('ai_meta').$type<Record<string, any>>().default({}).notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
    index('note_user_idx').on(table.userId),
    index('note_date_idx').on(table.date),
    index('note_slug_idx').on(table.slug),
  ]
);

// Note Versions table (Stores historical versions of notes)
export const noteVersions = pgTable(
  'note_versions',
  {
    versionId: text('version_id').primaryKey(),
    noteId: text('note_id').references(() => notes.noteId, { onDelete: 'cascade' }).notNull(),
    userId: text('user_id').references(() => users.userId, { onDelete: 'cascade' }).notNull(),
    versionNumber: integer('version_number').default(1).notNull(),
    title: text('title').default('').notNull(),
    content: text('content').default('').notNull(),
    date: text('date').notNull(),
    tags: jsonb('tags').$type<string[]>().default([]).notNull(),
    people: jsonb('people').$type<string[]>().default([]).notNull(),
    customFields: jsonb('custom_fields').$type<Record<string, any>>().default({}).notNull(),
    changeSummary: text('change_summary'),
    isEncrypted: boolean('is_encrypted').default(false).notNull(),
    passwordHash: text('password_hash'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    index('ver_note_idx').on(table.noteId),
    index('ver_user_idx').on(table.userId),
    index('ver_num_idx').on(table.noteId, table.versionNumber),
  ]
);

// Reminders table
export const reminders = pgTable('reminders', {
  reminderId: text('reminder_id').primaryKey(),
  userId: text('user_id').references(() => users.userId, { onDelete: 'cascade' }).notNull(),
  noteId: text('note_id').references(() => notes.noteId, { onDelete: 'cascade' }).notNull(),
  at: timestamp('at').notNull(),
  text: text('text').notNull(),
  fired: boolean('fired').default(false).notNull(),
  firedAt: timestamp('fired_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// Stored file metadata and contents
export const files = pgTable('files', {
  fileId: text('file_id').primaryKey(),
  userId: text('user_id').references(() => users.userId, { onDelete: 'cascade' }).notNull(),
  originalFilename: text('original_filename').notNull(),
  contentType: text('content_type').notNull(),
  size: doublePrecision('size').notNull(),
  dataBase64: text('data_base64').notNull(),
  isDeleted: boolean('is_deleted').default(false).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// Relationships
export const usersRelations = relations(users, ({ many }) => ({
  notes: many(notes),
  noteVersions: many(noteVersions),
  noteTypes: many(noteTypes),
  categories: many(categories),
  tags: many(tags),
  people: many(people),
  locations: many(locations),
  stickers: many(stickers),
  phrases: many(phrases),
  groups: many(itemGroups),
  reminders: many(reminders),
}));

export const noteVersionsRelations = relations(noteVersions, ({ one }) => ({
  user: one(users, {
    fields: [noteVersions.userId],
    references: [users.userId],
  }),
  note: one(notes, {
    fields: [noteVersions.noteId],
    references: [notes.noteId],
  }),
}));

export const noteTypesRelations = relations(noteTypes, ({ one, many }) => ({
  user: one(users, {
    fields: [noteTypes.userId],
    references: [users.userId],
  }),
  notes: many(notes),
}));

export const categoriesRelations = relations(categories, ({ one, many }) => ({
  user: one(users, {
    fields: [categories.userId],
    references: [users.userId],
  }),
  group: one(itemGroups, {
    fields: [categories.groupId],
    references: [itemGroups.groupId],
  }),
  notes: many(notes),
}));

export const itemGroupsRelations = relations(itemGroups, ({ one, many }) => ({
  user: one(users, {
    fields: [itemGroups.userId],
    references: [users.userId],
  }),
  tags: many(tags),
  people: many(people),
  locations: many(locations),
  categories: many(categories),
}));

export const notesRelations = relations(notes, ({ one, many }) => ({
  user: one(users, {
    fields: [notes.userId],
    references: [users.userId],
  }),
  noteType: one(noteTypes, {
    fields: [notes.noteTypeId],
    references: [noteTypes.typeId],
  }),
  category: one(categories, {
    fields: [notes.categoryId],
    references: [categories.categoryId],
  }),
  location: one(locations, {
    fields: [notes.locationId],
    references: [locations.locationId],
  }),
  reminders: many(reminders),
  versions: many(noteVersions),
}));

// Knowledge areas (Alanlar): hierarchical, archivable buckets for notes.
// parent_id = null means a main area; otherwise it is a sub-area.
export const areas = pgTable(
  'areas',
  {
    areaId: text('area_id').primaryKey(),
    userId: text('user_id').references(() => users.userId, { onDelete: 'cascade' }).notNull(),
    parentId: text('parent_id'),
    name: text('name').notNull(),
    description: text('description'),
    color: text('color'),
    orderIndex: doublePrecision('order_index').default(0).notNull(),
    archived: boolean('archived').default(false).notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [index('area_user_idx').on(table.userId)]
);

// Google Calendar connection per user. The refresh token is stored encrypted
// (AES-256-GCM) so the user signs in to Google only once.
export const googleIntegrations = pgTable('google_integrations', {
  userId: text('user_id').primaryKey().references(() => users.userId, { onDelete: 'cascade' }),
  googleEmail: text('google_email'),
  refreshTokenEnc: text('refresh_token_enc').notNull(),
  accessToken: text('access_token'),
  accessTokenExpiresAt: timestamp('access_token_expires_at'),
  scopes: text('scopes'),
  connectedAt: timestamp('connected_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// ---------------------------------------------------------------------------
// Phase 1: workspaces, spaces, relations, captures, analytics
// (DDL lives in src/db/migrations.ts)
// ---------------------------------------------------------------------------
export const schemaMigrations = pgTable('schema_migrations', {
  id: text('id').primaryKey(),
  appliedAt: timestamp('applied_at').defaultNow().notNull(),
});

export const workspaces = pgTable('workspaces', {
  workspaceId: text('workspace_id').primaryKey(),
  name: text('name').notNull(),
  kind: text('kind').default('personal').notNull(), // personal | team
  ownerId: text('owner_id').references(() => users.userId, { onDelete: 'cascade' }).notNull(),
  plan: text('plan').default('free').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const workspaceMembers = pgTable('workspace_members', {
  workspaceId: text('workspace_id').references(() => workspaces.workspaceId, { onDelete: 'cascade' }).notNull(),
  userId: text('user_id').references(() => users.userId, { onDelete: 'cascade' }).notNull(),
  role: text('role').default('owner').notNull(), // owner | admin | editor | commenter | viewer
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const spaces = pgTable('spaces', {
  spaceId: text('space_id').primaryKey(),
  workspaceId: text('workspace_id').references(() => workspaces.workspaceId, { onDelete: 'cascade' }).notNull(),
  createdBy: text('created_by'),
  name: text('name').notNull(),
  description: text('description'),
  color: text('color'),
  icon: text('icon'),
  isDefault: boolean('is_default').default(false).notNull(),
  archived: boolean('archived').default(false).notNull(),
  orderIndex: doublePrecision('order_index').default(0).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const relationTypes = pgTable('relation_types', {
  typeKey: text('type_key').primaryKey(),
  userId: text('user_id').references(() => users.userId, { onDelete: 'cascade' }), // NULL = system type
  label: text('label').notNull(),
  inverseLabel: text('inverse_label').notNull(),
  symmetric: boolean('is_symmetric').default(false).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const objectRelations = pgTable(
  'object_relations',
  {
    relationId: text('relation_id').primaryKey(),
    userId: text('user_id').references(() => users.userId, { onDelete: 'cascade' }).notNull(),
    workspaceId: text('workspace_id'),
    sourceId: text('source_id').references(() => notes.noteId, { onDelete: 'cascade' }).notNull(),
    targetId: text('target_id').references(() => notes.noteId, { onDelete: 'cascade' }).notNull(),
    relationType: text('relation_type').default('related_to').notNull(),
    origin: text('origin').default('manual').notNull(), // wikilink | manual | template | capture | ai
    status: text('status').default('active').notNull(), // active | suggested
    note: text('note'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    index('rel_source_idx').on(table.sourceId),
    index('rel_target_idx').on(table.targetId),
    index('rel_user_idx').on(table.userId),
  ]
);

export interface CaptureSuggestion {
  provider?: string;
  type_id?: string;
  type_confidence?: number;
  title?: string;
  summary?: string;
  tags?: string[];
  people?: string[];
  organizations?: string[];
  locations?: string[];
  dates?: string[];
  tasks?: string[];
  url?: string | null;
  site?: string | null;
  author?: string | null;
  related?: Array<{ object_id: string; title: string; reason: string }>;
  /** Why the attached file gave no text (no model, unsupported type...). */
  file_text_note?: string | null;
}

export const captures = pgTable(
  'captures',
  {
    captureId: text('capture_id').primaryKey(),
    userId: text('user_id').references(() => users.userId, { onDelete: 'cascade' }).notNull(),
    workspaceId: text('workspace_id'),
    spaceId: text('space_id'),
    status: text('status').default('new').notNull(), // new | processing | ready | processed | failed
    resolution: text('resolution'), // accepted | saved_raw | rejected | logged
    source: text('source').default('quick').notNull(),
    rawText: text('raw_text').default('').notNull(),
    rawUrl: text('raw_url'),
    fileId: text('file_id'),
    // Text read from the attached file (office formats locally, images/PDF by OCR)
    fileText: text('file_text'),
    fileTextMethod: text('file_text_method'),
    suggestion: jsonb('suggestion').$type<CaptureSuggestion>().default({}).notNull(),
    provider: text('provider'),
    error: text('error'),
    attempts: integer('attempts').default(0).notNull(),
    objectId: text('object_id').references(() => notes.noteId, { onDelete: 'set null' }),
    capturedOn: text('captured_on').notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
    processedAt: timestamp('processed_at'),
  },
  (table) => [index('capture_user_status_idx').on(table.userId, table.status)]
);

export const analyticsEvents = pgTable(
  'analytics_events',
  {
    eventId: text('event_id').primaryKey(),
    userId: text('user_id').references(() => users.userId, { onDelete: 'cascade' }),
    workspaceId: text('workspace_id'),
    event: text('event').notNull(),
    props: jsonb('props').$type<Record<string, any>>().default({}).notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [index('ae_user_event_idx').on(table.userId, table.event)]
);

// Per-user AI provider configuration. The API key is stored encrypted
// (AES-256-GCM, server/lib/secrets.ts) and never returned to the browser.
export const aiSettings = pgTable('ai_settings', {
  userId: text('user_id').primaryKey().references(() => users.userId, { onDelete: 'cascade' }),
  provider: text('provider').default('gemini').notNull(),
  apiKeyEnc: text('api_key_enc'),
  keyHint: text('key_hint'),
  model: text('model'),
  enabled: boolean('enabled').default(false).notNull(),
  lastCheckAt: timestamp('last_check_at'),
  lastCheckOk: boolean('last_check_ok'),
  lastError: text('last_error'),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// User templates (Settings > Şablonlar). builtin_key set = the user's override
// of a built-in template (meeting/project/research/daily); NULL = own template.
export const userTemplates = pgTable(
  'user_templates',
  {
    templateId: text('template_id').primaryKey(),
    userId: text('user_id').references(() => users.userId, { onDelete: 'cascade' }).notNull(),
    builtinKey: text('builtin_key'),
    name: text('name').notNull(),
    description: text('description'),
    noteTypeId: text('note_type_id'),
    titleTemplate: text('title_template'),
    contentTemplate: text('content_template'),
    hidden: boolean('hidden').default(false).notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [index('utpl_user_idx').on(table.userId)]
);

// Habit definitions. A habit is a tag: the done days are the daily-note
// lines carrying it ("- [x] Okuma #okuma"), not rows of their own.
export const habits = pgTable(
  'habits',
  {
    habitId: text('habit_id').primaryKey(),
    userId: text('user_id').references(() => users.userId, { onDelete: 'cascade' }).notNull(),
    name: text('name').notNull(),
    tag: text('tag'),
    color: text('color'),
    position: integer('position').default(0).notNull(),
    archived: boolean('archived').default(false).notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [index('habits_user_idx').on(table.userId)]
);

// Legacy (before habits became note lines). Rows are moved into daily notes
// the first time the user's habits are read, then deleted.
export const habitLogs = pgTable(
  'habit_logs',
  {
    habitId: text('habit_id').references(() => habits.habitId, { onDelete: 'cascade' }).notNull(),
    userId: text('user_id').references(() => users.userId, { onDelete: 'cascade' }).notNull(),
    day: text('day').notNull(), // YYYY-MM-DD
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [index('habit_logs_user_day_idx').on(table.userId, table.day)]
);

// Daily mood and energy, 1..5 each (null = not recorded)
export const dayRatings = pgTable('day_ratings', {
  userId: text('user_id').references(() => users.userId, { onDelete: 'cascade' }).notNull(),
  day: text('day').notNull(),
  mood: integer('mood'),
  energy: integer('energy'),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// One row per model call: who, which provider/model, what for, tokens, outcome
export const aiRuns = pgTable(
  'ai_runs',
  {
    runId: text('run_id').primaryKey(),
    userId: text('user_id').references(() => users.userId, { onDelete: 'cascade' }),
    provider: text('provider').notNull(),
    model: text('model'),
    task: text('task').notNull(),
    inputTokens: integer('input_tokens'),
    outputTokens: integer('output_tokens'),
    ok: boolean('ok').notNull(),
    error: text('error'),
    durationMs: integer('duration_ms').notNull(),
    /** 'user' (own key) or 'server' (counts against the plan's AI quota). */
    keySource: text('key_source'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [index('ai_runs_user_created_idx').on(table.userId, table.createdAt)]
);

// ---------------------------------------------------------------------------
// Phase 3a: plans, subscriptions, payments, invitations, billing, audit
// (DDL lives in src/db/migrations.ts, migration 012)
// ---------------------------------------------------------------------------
export interface PlanLimits {
  objects?: number;
  storage_mb?: number;
  members?: number;
  ai_calls_month?: number;
}

export const plans = pgTable('plans', {
  planKey: text('plan_key').primaryKey(),
  name: text('name').notNull(),
  description: text('description').default('').notNull(),
  priceMonthly: text('price_monthly').default('0').notNull(),
  priceYearly: text('price_yearly').default('0').notNull(),
  currency: text('currency').default('TRY').notNull(),
  limits: jsonb('limits').$type<PlanLimits>().default({}).notNull(),
  features: jsonb('features').$type<string[]>().default([]).notNull(),
  isActive: boolean('is_active').default(true).notNull(),
  isDefault: boolean('is_default').default(false).notNull(),
  sortOrder: integer('sort_order').default(0).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const subscriptions = pgTable('subscriptions', {
  workspaceId: text('workspace_id').primaryKey(),
  planKey: text('plan_key').notNull(),
  period: text('period').default('month').notNull(), // month | year
  currentPeriodEnd: timestamp('current_period_end'),
  source: text('source').default('payment').notNull(), // payment | admin
  note: text('note'),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const payments = pgTable('payments', {
  paymentId: text('payment_id').primaryKey(),
  workspaceId: text('workspace_id').notNull(),
  userId: text('user_id'),
  planKey: text('plan_key').notNull(),
  period: text('period').notNull(),
  amount: text('amount').notNull(),
  currency: text('currency').default('TRY').notNull(),
  status: text('status').default('pending').notNull(), // pending | paid | failed
  provider: text('provider').default('iyzico').notNull(),
  token: text('token'),
  providerPaymentId: text('provider_payment_id'),
  error: text('error'),
  periodEnd: timestamp('period_end'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  paidAt: timestamp('paid_at'),
});

export const invitations = pgTable('invitations', {
  invitationId: text('invitation_id').primaryKey(),
  workspaceId: text('workspace_id').notNull(),
  email: text('email').notNull(),
  role: text('role').default('editor').notNull(),
  tokenHash: text('token_hash').notNull(),
  invitedBy: text('invited_by'),
  expiresAt: timestamp('expires_at').notNull(),
  acceptedAt: timestamp('accepted_at'),
  acceptedBy: text('accepted_by'),
  revokedAt: timestamp('revoked_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const billingProfiles = pgTable('billing_profiles', {
  userId: text('user_id').primaryKey(),
  fullName: text('full_name').notNull(),
  phone: text('phone').notNull(),
  address: text('address').notNull(),
  city: text('city').notNull(),
  country: text('country').default('Turkey').notNull(),
  zipCode: text('zip_code'),
  identityNumberEnc: text('identity_number_enc'),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const auditLogs = pgTable('audit_logs', {
  auditId: text('audit_id').primaryKey(),
  actorId: text('actor_id'),
  action: text('action').notNull(),
  targetType: text('target_type'),
  targetId: text('target_id'),
  details: jsonb('details').$type<Record<string, unknown>>().default({}).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});
