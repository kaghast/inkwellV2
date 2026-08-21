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
    pinned: boolean('pinned').default(false).notNull(),
    archived: boolean('archived').default(false).notNull(),
    // 768-dimensional text embedding vector (text-embedding-004 / Gemini embedding)
    embedding: vector('embedding', { dimensions: 768 }),
    aiSummary: text('ai_summary'),
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
