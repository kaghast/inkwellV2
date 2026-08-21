import dotenv from "dotenv";
dotenv.config();

import fs from "fs";
import express, { Request, Response, NextFunction } from "express";
import cookieParser from "cookie-parser";
import cors from "cors";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import multer from "multer";
import axios from "axios";
import * as cheerio from "cheerio";
import path from "path";
import { fileURLToPath } from "url";
import { createServer as createViteServer } from "vite";
import { eq, and, or, desc, sql } from "drizzle-orm";
import { db, initDatabaseSchema, users, notes, tags, people, locations, categories, itemGroups, reminders, files, noteTypes, kanbanColumns } from "./src/db/index";
import { generateTextEmbedding } from "./src/lib/embeddings";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = parseInt(process.env.PORT || "3000", 10);
const HOST = process.env.HOST || "0.0.0.0";
const isProduction = process.env.NODE_ENV === "production" || fs.existsSync(path.resolve(__dirname, "dist", "index.html"));

const JWT_SECRET = process.env.JWT_SECRET || "inkwell_jwt_secret_key_2026";
const ACCESS_TOKEN_MIN = 60 * 24; // 1 day
const REFRESH_TOKEN_DAYS = 7;

app.use(cors({
  origin: true,
  credentials: true,
}));

// Fallback manual CORS header handler for all requests including preflights
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Access-Control-Allow-Credentials", "true");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, PATCH, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Requested-With, X-Session-ID");
  }
  if (req.method === "OPTIONS") {
    return res.sendStatus(200);
  }
  next();
});

app.use(express.json({ limit: "25mb" }));
app.use(cookieParser());

// Persistent storage directories for uploads and local data
const DATA_DIR = process.env.DATA_DIR || path.resolve(process.cwd(), ".data");
const UPLOADS_DIR = path.resolve(DATA_DIR, "uploads");
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

// Multer in-memory storage for file uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 }, // 25MB
});

function genId(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).substring(2, 10)}${Date.now().toString(36).substring(4)}`;
}

// ---------------------------------------------------------------------------
// Helpers & Regex
// ---------------------------------------------------------------------------
const TAG_RE = /(?<!\S)#([a-zA-Z0-9_\-ğüşıöçĞÜŞİÖÇ]+)(?!\S)/gu;
const MENTION_RE = /(?<!\S)@([a-zA-Z0-9_\-ğüşıöçĞÜŞİÖÇ]+)(?!\S)/gu;
const REMINDER_RE = /```reminder\s*\n([^\n]+)\n([\s\S]*?)\n?```/gi;

function extractTags(content: string): string[] {
  // Strip fenced code blocks before extracting tags
  const cleanContent = (content || "").replace(/```[\s\S]*?```/g, "");
  const extracted: string[] = [];
  const re = new RegExp(TAG_RE.source, "gu");
  let m;
  while ((m = re.exec(cleanContent)) !== null) {
    const t = m[1].toLowerCase();
    if (!extracted.includes(t)) extracted.push(t);
  }
  return extracted;
}

function extractPeople(content: string): string[] {
  // Strip fenced code blocks before extracting people
  const cleanContent = (content || "").replace(/```[\s\S]*?```/g, "");
  const extracted: string[] = [];
  const re = new RegExp(MENTION_RE.source, "gu");
  let m;
  while ((m = re.exec(cleanContent)) !== null) {
    const p = m[1].toLowerCase();
    if (!extracted.includes(p)) extracted.push(p);
  }
  return extracted;
}

function extractReminders(content: string): Array<{ at: string; text: string }> {
  const out: Array<{ at: string; text: string }> = [];
  const re = new RegExp(REMINDER_RE.source, "gi");
  let m;
  while ((m = re.exec(content || "")) !== null) {
    const iso = m[1].trim();
    const text = (m[2] || "").trim();
    const dt = new Date(iso);
    if (!isNaN(dt.getTime())) {
      out.push({ at: dt.toISOString(), text: text || "Hatırlatma" });
    }
  }
  return out;
}

async function ensureTags(userId: string, tagNames: string[]) {
  for (const raw of tagNames) {
    const name = raw.trim().toLowerCase();
    if (!name) continue;
    try {
      const existing = await db.select().from(tags).where(and(eq(tags.userId, userId), eq(tags.name, name))).limit(1);
      if (existing.length === 0) {
        await db.insert(tags).values({
          tagId: genId("tag"),
          userId,
          name,
        });
      }
    } catch (e) {
      console.warn("Failed ensuring tag in db:", e);
    }
  }
}

async function ensurePeople(userId: string, names: string[]) {
  for (const raw of names) {
    const name = raw.trim().toLowerCase();
    if (!name) continue;
    try {
      const existing = await db.select().from(people).where(and(eq(people.userId, userId), eq(people.name, name))).limit(1);
      if (existing.length === 0) {
        await db.insert(people).values({
          personId: genId("person"),
          userId,
          name,
        });
      }
    } catch (e) {
      console.warn("Failed ensuring person in db:", e);
    }
  }
}

async function syncReminders(userId: string, noteId: string, content: string) {
  try {
    await db.delete(reminders).where(and(eq(reminders.userId, userId), eq(reminders.noteId, noteId)));
    const items = extractReminders(content);
    for (const item of items) {
      await db.insert(reminders).values({
        reminderId: genId("rem"),
        userId,
        noteId,
        at: new Date(item.at),
        text: item.text,
        fired: false,
      });
    }
  } catch (err) {
    console.warn("Error syncing reminders in db:", err);
  }
}

function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function nowDatetimeIso(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function normalizeDateToIso(dateStr?: string): string {
  if (!dateStr || !dateStr.trim()) return nowDatetimeIso();
  const trimmed = dateStr.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    const d = new Date();
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${trimmed}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  }
  return trimmed;
}

function slugify(text: string): string {
  const trMap: Record<string, string> = {
    'ç': 'c', 'Ç': 'c', 'ğ': 'g', 'Ğ': 'g', 'ı': 'i', 'İ': 'i',
    'ö': 'o', 'Ö': 'o', 'ş': 's', 'Ş': 's', 'ü': 'u', 'Ü': 'u'
  };
  return (text || '')
    .split('')
    .map((c) => trMap[c] || c)
    .join('')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function generateSlugForNote(title: string, date: string, noteId: string, customSlug?: string): string {
  if (customSlug && customSlug.trim()) {
    const clean = slugify(customSlug.trim());
    if (clean) return clean;
  }
  const cleanTitle = slugify(title || '');
  const day = (date || todayIso()).slice(0, 10);
  const shortId = noteId.replace(/^note_/, '').slice(0, 6);
  if (cleanTitle) {
    return `${cleanTitle}-${shortId}`;
  }
  return `not-${day}-${shortId}`;
}

async function backfillSlugs() {
  try {
    const missingSlugs = await db.select().from(notes).where(sql`${notes.slug} IS NULL OR ${notes.slug} = ''`);
    for (const n of missingSlugs) {
      const newSlug = generateSlugForNote(n.title, n.date, n.noteId);
      await db.update(notes).set({ slug: newSlug }).where(eq(notes.noteId, n.noteId));
    }
    if (missingSlugs.length > 0) {
      console.log(`Backfilled slugs for ${missingSlugs.length} notes`);
    }
  } catch (e) {
    console.warn("Backfill slugs check failed:", e);
  }
}

// ---------------------------------------------------------------------------
// Auth Tokens & Cookies
// ---------------------------------------------------------------------------
function createAccessToken(userId: string, email: string): string {
  return jwt.sign(
    { sub: userId, email, type: "access" },
    JWT_SECRET,
    { expiresIn: `${ACCESS_TOKEN_MIN}m` }
  );
}

function createRefreshToken(userId: string): string {
  return jwt.sign(
    { sub: userId, type: "refresh" },
    JWT_SECRET,
    { expiresIn: `${REFRESH_TOKEN_DAYS}d` }
  );
}

function setAuthCookies(res: Response, accessToken: string, refreshToken: string) {
  const cookieOpts = {
    httpOnly: true,
    secure: true,
    sameSite: "none" as const,
    path: "/",
  };
  res.cookie("access_token", accessToken, { ...cookieOpts, maxAge: ACCESS_TOKEN_MIN * 60 * 1000 });
  res.cookie("refresh_token", refreshToken, { ...cookieOpts, maxAge: REFRESH_TOKEN_DAYS * 24 * 60 * 60 * 1000 });
}

function clearAuthCookies(res: Response) {
  const cookieOpts = {
    httpOnly: true,
    secure: true,
    sameSite: "none" as const,
    path: "/",
    maxAge: 0,
  };
  res.cookie("access_token", "", cookieOpts);
  res.cookie("refresh_token", "", cookieOpts);
  res.cookie("session_token", "", cookieOpts);
}

// ---------------------------------------------------------------------------
// Seed default admin user & demo notes in PostgreSQL
// ---------------------------------------------------------------------------
async function seedInitialData() {
  try {
    const adminEmail = (process.env.ADMIN_EMAIL || "admin@inkwell.app").toLowerCase();
    const adminPass = process.env.ADMIN_PASSWORD || "admin12345";
    const adminId = "user_admin_inkwell";

    const existing = await db.select().from(users).where(eq(users.userId, adminId)).limit(1);
    if (existing.length === 0) {
      await db.insert(users).values({
        userId: adminId,
        email: adminEmail,
        name: "Admin",
        passwordHash: bcrypt.hashSync(adminPass, 10),
        picture: null,
        authProvider: "email",
      });

      // Default category
      const catId = genId("cat");
      await db.insert(categories).values({
        categoryId: catId,
        userId: adminId,
        name: "Genel Notlar",
        color: "#6366f1",
      });

      const locId = genId("loc");
      await db.insert(locations).values({
        locationId: locId,
        userId: adminId,
        name: "Galata Kulesi, İstanbul",
        lat: 41.0256,
        lng: 28.9741,
      });

      const noteId1 = genId("note");
      const content1 = `# Hoş Geldiniz! 🖋️\n\n**Inkwell**'e hoş geldiniz. Düşüncelerinizi, fikirlerinizi ve günlük notlarınızı zarifçe kaydetmek için tasarlandı. Tüm verileriniz vektörel Cloud SQL veritabanında saklanır.\n\n- [x] #kurulum tamamlandı\n- [ ] İlk notunu yaz @ahmet\n- [ ] Takvimden geçmiş notları incele\n\n#başlangıç #günlük`;
      const tags1 = extractTags(content1);
      const people1 = extractPeople(content1);
      await ensureTags(adminId, tags1);
      await ensurePeople(adminId, people1);

      const embedding1 = await generateTextEmbedding(`Inkwell'e Hoş Geldiniz\n${content1}`);

      await db.insert(notes).values({
        noteId: noteId1,
        userId: adminId,
        title: "Inkwell'e Hoş Geldiniz",
        content: content1,
        date: todayIso(),
        tags: tags1,
        people: people1,
        categoryId: catId,
        locationId: locId,
        pinned: true,
        embedding: embedding1 || undefined,
      });
    }
  } catch (err) {
    console.warn("Seeding initial data warning (can be ignored if already seeded):", err);
  }
}

// ---------------------------------------------------------------------------
// Auth Middleware
// ---------------------------------------------------------------------------
interface AuthRequest extends Request {
  user?: typeof users.$inferSelect;
}

async function authMiddleware(req: AuthRequest, res: Response, next: NextFunction) {
  let token = req.cookies?.access_token;
  if (!token && req.headers.authorization?.startsWith("Bearer ")) {
    token = req.headers.authorization.substring(7);
  }
  const refreshToken = req.cookies?.refresh_token;

  if (token) {
    try {
      const payload = jwt.verify(token, JWT_SECRET) as any;
      if (payload && payload.sub) {
        const u = await db.select().from(users).where(eq(users.userId, payload.sub)).limit(1);
        if (u.length > 0) {
          req.user = u[0];
          return next();
        }
      }
    } catch {
      // Access token expired or invalid, will try refresh token below
    }
  }

  if (refreshToken) {
    try {
      const payload = jwt.verify(refreshToken, JWT_SECRET) as any;
      if (payload && payload.sub) {
        const u = await db.select().from(users).where(eq(users.userId, payload.sub)).limit(1);
        if (u.length > 0) {
          req.user = u[0];
          const newAccessToken = createAccessToken(u[0].userId, u[0].email);
          res.cookie("access_token", newAccessToken, {
            httpOnly: true,
            secure: true,
            sameSite: "none",
            maxAge: ACCESS_TOKEN_MIN * 60 * 1000,
            path: "/",
          });
          return next();
        }
      }
    } catch {
      // Refresh token expired or invalid
    }
  }

  return res.status(401).json({ detail: "Oturum süresi dolmuş veya kimlik doğrulanmamış" });
}

// ---------------------------------------------------------------------------
// API Router
// ---------------------------------------------------------------------------
const api = express.Router();

// Root check & AI dataset export for model training
api.get("/", (req, res) => {
  res.json({ ok: true, service: "inkwell", storage: "cloudsql-vector" });
});

// Full Backup Export Endpoint (for Google Drive & Local backup)
api.get("/backup/export", authMiddleware, async (req: AuthRequest, res: Response) => {
  const userId = req.user!.userId;
  try {
    const [userNotes, userTags, userPeople, userLocations, userGroups, userCategories, userReminders, userNoteTypes] = await Promise.all([
      db.select().from(notes).where(eq(notes.userId, userId)).orderBy(desc(notes.createdAt)),
      db.select().from(tags).where(eq(tags.userId, userId)),
      db.select().from(people).where(eq(people.userId, userId)),
      db.select().from(locations).where(eq(locations.userId, userId)),
      db.select().from(itemGroups).where(eq(itemGroups.userId, userId)),
      db.select().from(categories).where(eq(categories.userId, userId)),
      db.select().from(reminders).where(eq(reminders.userId, userId)),
      db.select().from(noteTypes).where(eq(noteTypes.userId, userId)),
    ]);

    const backupPayload = {
      version: "1.0",
      app: "Inkwell",
      exported_at: new Date().toISOString(),
      user: {
        userId: req.user!.userId,
        email: req.user!.email,
        name: req.user!.name,
      },
      stats: {
        notesCount: userNotes.length,
        tagsCount: userTags.length,
        peopleCount: userPeople.length,
        locationsCount: userLocations.length,
        groupsCount: userGroups.length,
        categoriesCount: userCategories.length,
        remindersCount: userReminders.length,
        noteTypesCount: userNoteTypes.length,
      },
      data: {
        note_types: userNoteTypes.map((nt) => ({
          type_id: nt.typeId,
          name: nt.name,
          description: nt.description,
          color: nt.color,
          icon: nt.icon,
          fields: nt.fields,
          created_at: nt.createdAt.toISOString(),
        })),
        notes: userNotes.map((n) => ({
          note_id: n.noteId,
          user_id: n.userId,
          slug: n.slug || generateSlugForNote(n.title, n.date, n.noteId),
          title: n.title,
          content: n.content,
          date: n.date,
          tags: n.tags,
          people: n.people,
          category_id: n.categoryId,
          location_id: n.locationId,
          note_type_id: n.noteTypeId || "type_plain",
          custom_fields: n.customFields || {},
          pinned: n.pinned,
          created_at: n.createdAt.toISOString(),
          updated_at: n.updatedAt.toISOString(),
        })),
        tags: userTags.map((t) => ({
          tag_id: t.tagId,
          name: t.name,
          group_id: t.groupId,
          created_at: t.createdAt.toISOString(),
        })),
        people: userPeople.map((p) => ({
          person_id: p.personId,
          name: p.name,
          group_id: p.groupId,
          created_at: p.createdAt.toISOString(),
        })),
        locations: userLocations.map((l) => ({
          location_id: l.locationId,
          name: l.name,
          lat: l.lat,
          lng: l.lng,
          group_id: l.groupId,
          created_at: l.createdAt.toISOString(),
        })),
        groups: userGroups.map((g) => ({
          group_id: g.groupId,
          name: g.name,
          type: g.type,
          color: g.color,
          created_at: g.createdAt.toISOString(),
        })),
        categories: userCategories.map((c) => ({
          category_id: c.categoryId,
          name: c.name,
          color: c.color,
          group_id: c.groupId,
          created_at: c.createdAt.toISOString(),
        })),
        reminders: userReminders.map((r) => ({
          reminder_id: r.reminderId,
          note_id: r.noteId,
          at: r.at.toISOString(),
          text: r.text,
          fired: r.fired,
          created_at: r.createdAt.toISOString(),
        })),
      },
    };

    res.json(backupPayload);
  } catch (err: any) {
    console.error("Backup export failed:", err);
    res.status(500).json({ detail: "Yedekleme verisi hazırlanamadı", error: err.message });
  }
});

// Full Backup Import Endpoint (restores from Google Drive or local JSON)
api.post("/backup/import", authMiddleware, async (req: AuthRequest, res: Response) => {
  const userId = req.user!.userId;
  const { backup, mode = "merge" } = req.body || {};

  if (!backup || !backup.data) {
    return res.status(400).json({ detail: "Geçersiz yedekleme dosyası formatı" });
  }

  const { notes: inNotes = [], tags: inTags = [], people: inPeople = [], locations: inLocations = [], groups: inGroups = [], categories: inCategories = [], reminders: inReminders = [], note_types: inNoteTypes = [] } = backup.data;

  try {
    if (mode === "replace") {
      // Clean up previous user data safely
      await db.delete(reminders).where(eq(reminders.userId, userId));
      await db.delete(notes).where(eq(notes.userId, userId));
      await db.delete(tags).where(eq(tags.userId, userId));
      await db.delete(people).where(eq(people.userId, userId));
      await db.delete(locations).where(eq(locations.userId, userId));
      await db.delete(categories).where(eq(categories.userId, userId));
      await db.delete(itemGroups).where(eq(itemGroups.userId, userId));
      await db.delete(noteTypes).where(eq(noteTypes.userId, userId));
    }

    // 0. Restore Note Types
    for (const nt of inNoteTypes) {
      const ntId = nt.type_id || genId("nt");
      if (ntId === "type_plain" || ntId === "default") continue;
      const existing = await db.select().from(noteTypes).where(and(eq(noteTypes.typeId, ntId), eq(noteTypes.userId, userId))).limit(1);
      if (existing.length === 0) {
        await db.insert(noteTypes).values({
          typeId: ntId,
          userId,
          name: nt.name || "Özel Tip",
          description: nt.description || null,
          color: nt.color || "#3b82f6",
          icon: nt.icon || "Boxes",
          isDefault: false,
          fields: nt.fields || [],
        });
      }
    }

    // 1. Restore Groups
    for (const g of inGroups) {
      const gId = g.group_id || genId("grp");
      const existing = await db.select().from(itemGroups).where(and(eq(itemGroups.groupId, gId), eq(itemGroups.userId, userId))).limit(1);
      if (existing.length === 0) {
        await db.insert(itemGroups).values({
          groupId: gId,
          userId,
          name: g.name,
          type: g.type,
          color: g.color || "#6366f1",
        });
      }
    }

    // 2. Restore Categories
    for (const c of inCategories) {
      const cId = c.category_id || genId("cat");
      const existing = await db.select().from(categories).where(and(eq(categories.categoryId, cId), eq(categories.userId, userId))).limit(1);
      if (existing.length === 0) {
        await db.insert(categories).values({
          categoryId: cId,
          userId,
          name: c.name,
          color: c.color || "#6366f1",
          groupId: c.group_id || null,
        });
      }
    }

    // 3. Restore Locations
    for (const l of inLocations) {
      const lId = l.location_id || genId("loc");
      const existing = await db.select().from(locations).where(and(eq(locations.locationId, lId), eq(locations.userId, userId))).limit(1);
      if (existing.length === 0) {
        await db.insert(locations).values({
          locationId: lId,
          userId,
          name: l.name,
          lat: l.lat,
          lng: l.lng,
          groupId: l.group_id || null,
        });
      }
    }

    // 4. Restore Tags
    for (const t of inTags) {
      const cleanName = (t.name || "").trim().toLowerCase();
      if (!cleanName) continue;
      const existing = await db.select().from(tags).where(and(eq(tags.userId, userId), eq(tags.name, cleanName))).limit(1);
      if (existing.length === 0) {
        await db.insert(tags).values({
          tagId: t.tag_id || genId("tag"),
          userId,
          name: cleanName,
          groupId: t.group_id || null,
        });
      }
    }

    // 5. Restore People
    for (const p of inPeople) {
      const cleanName = (p.name || "").trim().toLowerCase();
      if (!cleanName) continue;
      const existing = await db.select().from(people).where(and(eq(people.userId, userId), eq(people.name, cleanName))).limit(1);
      if (existing.length === 0) {
        await db.insert(people).values({
          personId: p.person_id || genId("person"),
          userId,
          name: cleanName,
          groupId: p.group_id || null,
        });
      }
    }

    // 6. Restore Notes
    let importedNotesCount = 0;
    for (const n of inNotes) {
      const nId = n.note_id || genId("note");
      const existing = await db.select().from(notes).where(and(eq(notes.noteId, nId), eq(notes.userId, userId))).limit(1);
      
      const content = n.content || "";
      const title = n.title || "";
      const noteTags = n.tags || extractTags(content);
      const notePeople = n.people || extractPeople(content);

      if (existing.length === 0) {
        // Generate embedding
        const embedding = await generateTextEmbedding(`${title}\n${content}`);
        const effectiveNoteTypeId = (n.note_type_id && n.note_type_id !== "type_plain" && n.note_type_id !== "default") ? n.note_type_id : null;
        await db.insert(notes).values({
          noteId: nId,
          userId,
          title: title || "Başlıksız Not",
          content,
          date: n.date || todayIso(),
          tags: noteTags,
          people: notePeople,
          categoryId: n.category_id || null,
          locationId: n.location_id || null,
          noteTypeId: effectiveNoteTypeId,
          customFields: n.custom_fields || {},
          pinned: Boolean(n.pinned),
          embedding: embedding || undefined,
          createdAt: n.created_at ? new Date(n.created_at) : new Date(),
          updatedAt: n.updated_at ? new Date(n.updated_at) : new Date(),
        });
        importedNotesCount++;
      } else if (mode === "merge") {
        // Update existing
        const effectiveNoteTypeId = (n.note_type_id && n.note_type_id !== "type_plain" && n.note_type_id !== "default") ? n.note_type_id : (existing[0].noteTypeId || null);
        await db.update(notes).set({
          title: title || existing[0].title,
          content: content || existing[0].content,
          tags: noteTags,
          people: notePeople,
          noteTypeId: effectiveNoteTypeId,
          customFields: n.custom_fields || existing[0].customFields || {},
          updatedAt: new Date(),
        }).where(eq(notes.noteId, nId));
        importedNotesCount++;
      }

      await syncReminders(userId, nId, content);
    }

    res.json({
      success: true,
      message: `${importedNotesCount} not ve ilişkili veriler başarıyla aktarıldı.`,
      imported: {
        notes: importedNotesCount,
        tags: inTags.length,
        people: inPeople.length,
        locations: inLocations.length,
        groups: inGroups.length,
      },
    });
  } catch (err: any) {
    console.error("Backup import failed:", err);
    res.status(500).json({ detail: "Yedek içe aktarılamadı", error: err.message });
  }
});

// Model training dataset export (returns user data with vector embeddings)
api.get("/ai/dataset", authMiddleware, async (req: AuthRequest, res: Response) => {
  const userId = req.user!.userId;
  try {
    const userNotes = await db.select().from(notes).where(eq(notes.userId, userId));
    const dataset = userNotes.map((n) => ({
      id: n.noteId,
      userId: n.userId,
      title: n.title,
      content: n.content,
      date: n.date,
      tags: n.tags,
      people: n.people,
      categoryId: n.categoryId,
      hasEmbedding: Boolean(n.embedding),
      embeddingDimension: n.embedding ? 768 : 0,
      embedding: n.embedding,
      createdAt: n.createdAt,
      updatedAt: n.updatedAt,
    }));
    res.json({
      count: dataset.length,
      user: { userId: req.user!.userId, email: req.user!.email, name: req.user!.name },
      dataset,
    });
  } catch (err: any) {
    res.status(500).json({ detail: "Failed exporting AI dataset", error: err.message });
  }
});

// Semantic Vector Search endpoint
api.get("/ai/semantic-search", authMiddleware, async (req: AuthRequest, res: Response) => {
  const userId = req.user!.userId;
  const q = String(req.query.q || "").trim();
  if (!q) {
    return res.json([]);
  }

  try {
    const queryEmbedding = await generateTextEmbedding(q);
    if (!queryEmbedding) {
      // Fallback text search if embedding generation failed
      const textMatches = await db.select().from(notes).where(
        and(
          eq(notes.userId, userId),
          sql`${notes.content} ILIKE ${`%${q}%`} OR ${notes.title} ILIKE ${`%${q}%`}`
        )
      );
      return res.json(textMatches);
    }

    // Cosine similarity search using pgvector
    const vectorStr = `[${queryEmbedding.join(",")}]`;
    const results = await db.select({
      note_id: notes.noteId,
      user_id: notes.userId,
      title: notes.title,
      content: notes.content,
      date: notes.date,
      tags: notes.tags,
      people: notes.people,
      category_id: notes.categoryId,
      location_id: notes.locationId,
      pinned: notes.pinned,
      created_at: notes.createdAt,
      updated_at: notes.updatedAt,
      similarity: sql<number>`1 - (${notes.embedding} <=> ${vectorStr}::vector)`,
    })
      .from(notes)
      .where(eq(notes.userId, userId))
      .orderBy(sql`${notes.embedding} <=> ${vectorStr}::vector`)
      .limit(10);

    return res.json(results);
  } catch (err: any) {
    console.error("Semantic search failed:", err);
    res.status(500).json({ detail: "Semantic search failed", error: err.message });
  }
});

// Auth Endpoints
api.post("/auth/register", async (req, res) => {
  const { email, password, name } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ detail: "E-posta ve şifre zorunludur" });
  }
  const cleanEmail = String(email).toLowerCase().trim();
  
  try {
    const existing = await db.select().from(users).where(eq(users.email, cleanEmail)).limit(1);
    if (existing.length > 0) {
      return res.status(400).json({
        detail: "Bu e-posta adresi zaten kayıtlıdır. Lütfen doğrudan giriş yapın veya Google ile bağlanın."
      });
    }
    const user_id = genId("user");
    const password_hash = bcrypt.hashSync(String(password), 10);
    
    await db.insert(users).values({
      userId: user_id,
      email: cleanEmail,
      name: name || cleanEmail.split("@")[0],
      passwordHash: password_hash,
      picture: null,
      authProvider: "email",
    });

    const accessToken = createAccessToken(user_id, cleanEmail);
    const refreshToken = createRefreshToken(user_id);
    setAuthCookies(res, accessToken, refreshToken);

    const userOut = {
      user_id,
      email: cleanEmail,
      name: name || cleanEmail.split("@")[0],
      picture: null,
      auth_provider: "email",
      token: accessToken,
      access_token: accessToken,
    };
    return res.json(userOut);
  } catch (err: any) {
    console.error("Registration error:", err);
    return res.status(500).json({ detail: "Kayıt işlemi başarısız oldu", error: err.message });
  }
});

api.post("/auth/login", async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) {
    return res.status(401).json({ detail: "Geçersiz e-posta veya şifre" });
  }
  const cleanEmail = String(email).toLowerCase().trim();
  
  try {
    const found = await db.select().from(users).where(eq(users.email, cleanEmail)).limit(1);
    const user = found[0];
    if (!user) {
      return res.status(401).json({ detail: "Geçersiz e-posta veya şifre" });
    }

    // If account was created with Google and hasn't set a local password yet,
    // automatically save this password as their password so they can log in normally!
    if (!user.passwordHash) {
      const newHash = bcrypt.hashSync(String(password), 10);
      await db.update(users).set({ passwordHash: newHash }).where(eq(users.userId, user.userId));
      user.passwordHash = newHash;
    } else if (!bcrypt.compareSync(String(password), user.passwordHash)) {
      return res.status(401).json({ detail: "Geçersiz e-posta veya şifre" });
    }

    const accessToken = createAccessToken(user.userId, cleanEmail);
    const refreshToken = createRefreshToken(user.userId);
    setAuthCookies(res, accessToken, refreshToken);

    const userOut = {
      user_id: user.userId,
      email: user.email,
      name: user.name,
      picture: user.picture,
      auth_provider: user.authProvider,
      token: accessToken,
      access_token: accessToken,
    };
    return res.json(userOut);
  } catch (err: any) {
    console.error("Login error:", err);
    return res.status(500).json({ detail: "Giriş başarısız", error: err.message });
  }
});

api.post("/auth/logout", (req, res) => {
  clearAuthCookies(res);
  res.json({ ok: true });
});

api.get("/auth/me", authMiddleware, (req: AuthRequest, res: Response) => {
  const user = req.user!;
  const accessToken = createAccessToken(user.userId, user.email);
  res.json({
    user_id: user.userId,
    email: user.email,
    name: user.name,
    picture: user.picture,
    auth_provider: user.authProvider,
    token: accessToken,
    access_token: accessToken,
  });
});

api.post("/auth/google/session", async (req, res) => {
  const sessionId = req.headers["x-session-id"] as string;
  if (!sessionId) {
    return res.status(400).json({ detail: "X-Session-ID header required" });
  }

  let email = "";
  let name = "";
  let picture = "";

  try {
    const response = await axios.get("https://demobackend.emergentagent.com/auth/v1/env/oauth/session-data", {
      headers: { "X-Session-ID": sessionId },
      timeout: 10000,
    });
    if (response.status === 200 && response.data) {
      email = (response.data.email || "").toLowerCase().trim();
      name = response.data.name || "";
      picture = response.data.picture || "";
    }
  } catch (err) {
    console.warn("Emergent auth proxy fetch failed:", (err as Error).message);
  }

  if (!email) {
    email = `google_user_${sessionId.slice(0, 8)}@emergent.sh`;
    name = "Google User";
  }

  try {
    const found = await db.select().from(users).where(eq(users.email, email)).limit(1);
    let user = found[0];
    if (user) {
      await db.update(users).set({
        name: name || user.name,
        picture: picture || user.picture,
      }).where(eq(users.userId, user.userId));
    } else {
      const user_id = genId("user");
      await db.insert(users).values({
        userId: user_id,
        email,
        name: name || email.split("@")[0],
        picture: picture || null,
        authProvider: "google",
      });
      user = (await db.select().from(users).where(eq(users.userId, user_id)).limit(1))[0];
    }

    const accessToken = createAccessToken(user.userId, user.email);
    const refreshToken = createRefreshToken(user.userId);
    setAuthCookies(res, accessToken, refreshToken);

    return res.json({
      user_id: user.userId,
      email: user.email,
      name: user.name,
      picture: user.picture,
      auth_provider: user.authProvider,
      token: accessToken,
      access_token: accessToken,
    });
  } catch (err: any) {
    return res.status(500).json({ detail: "Google session creation failed", error: err.message });
  }
});

// Google OAuth 2.0 Start URL
api.get("/auth/google/url", (req, res) => {
  const clientId = process.env.GOOGLE_CLIENT_ID || process.env.VITE_GOOGLE_CLIENT_ID || "";
  const requestedRedirect = req.query.redirect_uri as string;

  let redirectUri = requestedRedirect;
  if (!redirectUri) {
    const host = req.headers["x-forwarded-host"] || req.headers.host || "localhost:3000";
    const proto = req.headers["x-forwarded-proto"] || "http";
    redirectUri = `${proto}://${host}/api/auth/google/callback`;
  }

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "openid email profile",
    access_type: "offline",
    prompt: "select_account",
  });

  const url = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
  res.json({ url, client_id: clientId, redirect_uri: redirectUri });
});

async function handleGoogleOAuthCallback(req: Request, res: Response) {
  const { code, error } = req.query;
  if (error) {
    return res.send(`
      <!DOCTYPE html>
      <html>
        <body>
          <script>
            if (window.opener) {
              window.opener.postMessage({ type: 'OAUTH_AUTH_ERROR', error: ${JSON.stringify(String(error))} }, '*');
              window.close();
            } else {
              window.location.href = '/login?error=' + encodeURIComponent(${JSON.stringify(String(error))});
            }
          </script>
          <p>Giriş iptal edildi veya bir hata oluştu: ${String(error)}</p>
        </body>
      </html>
    `);
  }

  if (!code || typeof code !== "string") {
    return res.status(400).send("Geçersiz yetkilendirme kodu (Authorization code is missing)");
  }

  const clientId = process.env.GOOGLE_CLIENT_ID || process.env.VITE_GOOGLE_CLIENT_ID || "";
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET || "";

  const host = req.headers["x-forwarded-host"] || req.headers.host || "localhost:3000";
  const proto = req.headers["x-forwarded-proto"] || (req.secure ? "https" : "http");
  const cleanPath = ((req.baseUrl || "") + req.path).replace(/\/+$/, "") || "/api/auth/google/callback";
  
  let redirectUri = `${proto}://${host}${cleanPath}`;
  if (req.query.state && typeof req.query.state === "string") {
    try {
      const parsedState = JSON.parse(decodeURIComponent(req.query.state));
      if (parsedState?.redirectUri) {
        redirectUri = parsedState.redirectUri;
      }
    } catch {
      if (req.query.state.startsWith("http")) {
        redirectUri = req.query.state;
      }
    }
  }

  try {
    const tokenRes = await axios.post("https://oauth2.googleapis.com/token", new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }).toString(), {
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      timeout: 10000,
    });

    const { access_token } = tokenRes.data;
    const profileRes = await axios.get("https://www.googleapis.com/oauth2/v2/userinfo", {
      headers: { Authorization: `Bearer ${access_token}` },
      timeout: 10000,
    });

    const { email, name, picture } = profileRes.data;
    if (!email) {
      throw new Error("Google hesabından e-posta bilgisi alınamadı");
    }

    const cleanEmail = email.toLowerCase().trim();
    const found = await db.select().from(users).where(eq(users.email, cleanEmail)).limit(1);
    let user = found[0];

    if (user) {
      await db.update(users).set({
        name: name || user.name,
        picture: picture || user.picture,
      }).where(eq(users.userId, user.userId));
    } else {
      const user_id = genId("user");
      await db.insert(users).values({
        userId: user_id,
        email,
        name: name || cleanEmail.split("@")[0],
        picture: picture || null,
        authProvider: "google",
      });
      user = (await db.select().from(users).where(eq(users.userId, user_id)).limit(1))[0];
    }

    const newAccessToken = createAccessToken(user.userId, user.email);
    const newRefreshToken = createRefreshToken(user.userId);
    setAuthCookies(res, newAccessToken, newRefreshToken);

    const userOutWithToken = {
      user_id: user.userId,
      email: user.email,
      name: user.name,
      picture: user.picture,
      auth_provider: user.authProvider,
      token: newAccessToken,
      access_token: newAccessToken,
    };

    return res.send(`
      <!DOCTYPE html>
      <html>
        <head><title>Giriş Yapılıyor...</title></head>
        <body style="font-family: sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; background: #FAF9F6;">
          <div style="text-align: center;">
            <p style="font-size: 18px; color: #333;">Google ile giriş başarılı. Yönlendiriliyorsunuz...</p>
          </div>
          <script>
            const user = ${JSON.stringify(userOutWithToken)};
            if (window.opener) {
              window.opener.postMessage({ type: 'OAUTH_AUTH_SUCCESS', user }, '*');
              window.close();
            } else {
              window.location.href = '/';
            }
          </script>
        </body>
      </html>
    `);
  } catch (err: any) {
    console.error("Google OAuth token exchange error:", err?.response?.data || err?.message);
    const errMsg = err?.response?.data?.error_description || err?.response?.data?.error || err?.message || "OAuth error";
    return res.send(`
      <!DOCTYPE html>
      <html>
        <body>
          <script>
            if (window.opener) {
              window.opener.postMessage({ type: 'OAUTH_AUTH_ERROR', error: ${JSON.stringify(errMsg)} }, '*');
              window.close();
            } else {
              window.location.href = '/login?error=' + encodeURIComponent(${JSON.stringify(errMsg)});
            }
          </script>
          <p>Google ile giriş yapılırken bir hata oluştu: ${errMsg}</p>
        </body>
      </html>
    `);
  }
}

api.get(["/auth/google/callback", "/auth/google/callback/"], handleGoogleOAuthCallback);
app.get(["/auth/google/callback", "/auth/google/callback/"], handleGoogleOAuthCallback);
app.get(["/api/auth/google/callback", "/api/auth/google/callback/"], handleGoogleOAuthCallback);

// ---------------------------------------------------------------------------
// Item Groups Endpoints (Tags, People, Locations, Categories)
// ---------------------------------------------------------------------------
api.get("/groups", authMiddleware, async (req: AuthRequest, res: Response) => {
  const userId = req.user!.userId;
  const type = req.query.type as string; // 'tags' | 'people' | 'locations' | 'categories'
  try {
    let query = db.select().from(itemGroups).where(eq(itemGroups.userId, userId));
    const all = await query;
    let filtered = all.map((g) => ({
      group_id: g.groupId,
      user_id: g.userId,
      name: g.name,
      type: g.type,
      color: g.color,
      created_at: g.createdAt.toISOString(),
      updated_at: g.updatedAt.toISOString(),
    }));
    if (type) {
      filtered = filtered.filter((g) => g.type === type);
    }
    res.json(filtered);
  } catch (err: any) {
    res.status(500).json({ detail: "Gruplar alınamadı", error: err.message });
  }
});

api.post("/groups", authMiddleware, async (req: AuthRequest, res: Response) => {
  const userId = req.user!.userId;
  const { name, type, color } = req.body || {};
  if (!name || !name.trim()) {
    return res.status(400).json({ detail: "Grup adı zorunludur" });
  }
  if (!type || !["tags", "people", "locations", "categories"].includes(type)) {
    return res.status(400).json({ detail: "Geçersiz grup türü" });
  }

  const groupId = genId("grp");
  try {
    await db.insert(itemGroups).values({
      groupId,
      userId,
      name: name.trim(),
      type,
      color: color || null,
    });
    const created = (await db.select().from(itemGroups).where(eq(itemGroups.groupId, groupId)).limit(1))[0];
    res.json({
      group_id: created.groupId,
      user_id: created.userId,
      name: created.name,
      type: created.type,
      color: created.color,
      created_at: created.createdAt.toISOString(),
      updated_at: created.updatedAt.toISOString(),
    });
  } catch (err: any) {
    res.status(500).json({ detail: "Grup oluşturulamadı", error: err.message });
  }
});

api.put("/groups/:group_id", authMiddleware, async (req: AuthRequest, res: Response) => {
  const userId = req.user!.userId;
  const groupId = req.params.group_id;
  const { name, color } = req.body || {};

  try {
    const found = await db.select().from(itemGroups).where(and(eq(itemGroups.groupId, groupId), eq(itemGroups.userId, userId))).limit(1);
    if (found.length === 0) {
      return res.status(404).json({ detail: "Grup bulunamadı" });
    }

    const updateObj: any = { updatedAt: new Date() };
    if (name !== undefined) updateObj.name = name.trim();
    if (color !== undefined) updateObj.color = color;

    await db.update(itemGroups).set(updateObj).where(eq(itemGroups.groupId, groupId));
    const updated = (await db.select().from(itemGroups).where(eq(itemGroups.groupId, groupId)).limit(1))[0];
    res.json({
      group_id: updated.groupId,
      user_id: updated.userId,
      name: updated.name,
      type: updated.type,
      color: updated.color,
      created_at: updated.createdAt.toISOString(),
      updated_at: updated.updatedAt.toISOString(),
    });
  } catch (err: any) {
    res.status(500).json({ detail: "Grup güncellenemedi", error: err.message });
  }
});

api.delete("/groups/:group_id", authMiddleware, async (req: AuthRequest, res: Response) => {
  const userId = req.user!.userId;
  const groupId = req.params.group_id;
  try {
    // When deleting a group, items are freed (groupId set to null) automatically via cascade or explicit update
    await db.update(tags).set({ groupId: null }).where(and(eq(tags.groupId, groupId), eq(tags.userId, userId)));
    await db.update(people).set({ groupId: null }).where(and(eq(people.groupId, groupId), eq(people.userId, userId)));
    await db.update(locations).set({ groupId: null }).where(and(eq(locations.groupId, groupId), eq(locations.userId, userId)));
    await db.update(categories).set({ groupId: null }).where(and(eq(categories.groupId, groupId), eq(categories.userId, userId)));

    await db.delete(itemGroups).where(and(eq(itemGroups.groupId, groupId), eq(itemGroups.userId, userId)));
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ detail: "Grup silinemedi", error: err.message });
  }
});

// Endpoint to move items to a group (or set group_id: null to free)
api.patch("/groups/assign", authMiddleware, async (req: AuthRequest, res: Response) => {
  const userId = req.user!.userId;
  const { type, item_id, group_id } = req.body || {};

  if (!type || !item_id) {
    return res.status(400).json({ detail: "type and item_id are required" });
  }

  const targetGroupId = group_id || null;

  try {
    if (type === "tags") {
      await db.update(tags).set({ groupId: targetGroupId }).where(and(eq(tags.tagId, item_id), eq(tags.userId, userId)));
    } else if (type === "people") {
      await db.update(people).set({ groupId: targetGroupId }).where(and(eq(people.personId, item_id), eq(people.userId, userId)));
    } else if (type === "locations") {
      await db.update(locations).set({ groupId: targetGroupId }).where(and(eq(locations.locationId, item_id), eq(locations.userId, userId)));
    } else if (type === "categories") {
      await db.update(categories).set({ groupId: targetGroupId }).where(and(eq(categories.categoryId, item_id), eq(categories.userId, userId)));
    } else {
      return res.status(400).json({ detail: "Geçersiz öğe türü" });
    }

    res.json({ ok: true, type, item_id, group_id: targetGroupId });
  } catch (err: any) {
    res.status(500).json({ detail: "Öğe gruba taşınamadı", error: err.message });
  }
});

// ---------------------------------------------------------------------------
// Note Types Endpoints (User-defined custom note types & parameters)
// ---------------------------------------------------------------------------
const DEFAULT_NOTE_TYPE = {
  type_id: "type_plain",
  user_id: null,
  name: "Düz Metin",
  description: "Standart sade metin ve Markdown notları",
  color: "#64748b",
  icon: "FileText",
  is_default: true,
  fields: [],
};

const DEFAULT_CARD_NOTE_TYPE = {
  type_id: "type_card",
  user_id: null,
  name: "Kart",
  description: "Kanban panosu ve kart görünümü için özel not tipi",
  color: "#8b5cf6",
  icon: "Kanban",
  is_default: true,
  fields: [],
};

api.get("/note-types", authMiddleware, async (req: AuthRequest, res: Response) => {
  const userId = req.user!.userId;
  try {
    const items = await db.select().from(noteTypes).where(eq(noteTypes.userId, userId)).orderBy(desc(noteTypes.createdAt));
    const userTypes = items.map((t) => ({
      type_id: t.typeId,
      user_id: t.userId,
      name: t.name,
      description: t.description,
      color: t.color,
      icon: t.icon,
      is_default: t.isDefault,
      fields: t.fields || [],
      created_at: t.createdAt.toISOString(),
      updated_at: t.updatedAt.toISOString(),
    }));

    res.json([DEFAULT_NOTE_TYPE, DEFAULT_CARD_NOTE_TYPE, ...userTypes]);
  } catch (err: any) {
    res.status(500).json({ detail: "Not tipleri alınamadı", error: err.message });
  }
});

api.post("/note-types", authMiddleware, async (req: AuthRequest, res: Response) => {
  const userId = req.user!.userId;
  const { name, description, color, icon, fields } = req.body || {};
  if (!name || !name.trim()) {
    return res.status(400).json({ detail: "Not tipi adı zorunludur" });
  }

  const typeId = genId("nt");
  try {
    const validatedFields = Array.isArray(fields) ? fields.map((f: any, idx: number) => ({
      id: f.id || `field_${idx + 1}_${Math.random().toString(36).slice(2, 7)}`,
      name: (f.name || "").trim() || `Parametre ${idx + 1}`,
      type: ["dropdown", "boolean", "number", "text", "datetime", "calculation", "datetime_range"].includes(f.type) ? f.type : "text",
      options: Array.isArray(f.options)
        ? f.options.map(String).map((s: string) => s.trim()).filter(Boolean)
        : (typeof f.options === "string" ? f.options.split(",").map((s: string) => s.trim()).filter(Boolean) : []),
      calcConfig: f.calcConfig && typeof f.calcConfig === "object" ? {
        fieldAId: String(f.calcConfig.fieldAId || ""),
        fieldBId: String(f.calcConfig.fieldBId || ""),
        operator: String(f.calcConfig.operator || "+"),
        unit: f.calcConfig.unit ? String(f.calcConfig.unit).trim() : "",
        decimalPlaces: typeof f.calcConfig.decimalPlaces === "number" ? f.calcConfig.decimalPlaces : 2,
      } : undefined,
      required: Boolean(f.required),
      placeholder: f.placeholder || "",
    })) : [];

    await db.insert(noteTypes).values({
      typeId,
      userId,
      name: name.trim(),
      description: description || null,
      color: color || "#3b82f6",
      icon: icon || "Boxes",
      isDefault: false,
      fields: validatedFields,
    });

    const item = (await db.select().from(noteTypes).where(eq(noteTypes.typeId, typeId)).limit(1))[0];
    res.json({
      type_id: item.typeId,
      user_id: item.userId,
      name: item.name,
      description: item.description,
      color: item.color,
      icon: item.icon,
      is_default: item.isDefault,
      fields: item.fields || [],
      created_at: item.createdAt.toISOString(),
      updated_at: item.updatedAt.toISOString(),
    });
  } catch (err: any) {
    res.status(500).json({ detail: "Not tipi oluşturulamadı", error: err.message });
  }
});

api.put("/note-types/:type_id", authMiddleware, async (req: AuthRequest, res: Response) => {
  const userId = req.user!.userId;
  const typeId = req.params.type_id;
  const { name, description, color, icon, fields } = req.body || {};

  if (typeId === "type_plain" || typeId === "type_card" || typeId === "default") {
    return res.status(400).json({ detail: "Varsayılan 'Düz Metin' ve 'Kart' sistem not tipleri değiştirilemez veya silinemez." });
  }

  try {
    const found = await db.select().from(noteTypes).where(and(eq(noteTypes.typeId, typeId), eq(noteTypes.userId, userId))).limit(1);
    if (found.length === 0) {
      return res.status(404).json({ detail: "Not tipi bulunamadı" });
    }

    if (found[0].isDefault) {
      return res.status(400).json({ detail: "Varsayılan not tipi güncellenemez" });
    }

    const updateObj: any = { updatedAt: new Date() };
    if (name !== undefined) {
      if (!name.trim()) return res.status(400).json({ detail: "Not tipi adı boş olamaz" });
      updateObj.name = name.trim();
    }
    if (description !== undefined) updateObj.description = description;
    if (color !== undefined) updateObj.color = color;
    if (icon !== undefined) updateObj.icon = icon;
    if (fields !== undefined && Array.isArray(fields)) {
      updateObj.fields = fields.map((f: any, idx: number) => ({
        id: f.id || `field_${idx + 1}_${Math.random().toString(36).slice(2, 7)}`,
        name: (f.name || "").trim() || `Parametre ${idx + 1}`,
        type: ["dropdown", "boolean", "number", "text", "datetime", "calculation", "datetime_range"].includes(f.type) ? f.type : "text",
        options: Array.isArray(f.options)
          ? f.options.map(String).map((s: string) => s.trim()).filter(Boolean)
          : (typeof f.options === "string" ? f.options.split(",").map((s: string) => s.trim()).filter(Boolean) : []),
        calcConfig: f.calcConfig && typeof f.calcConfig === "object" ? {
          fieldAId: String(f.calcConfig.fieldAId || ""),
          fieldBId: String(f.calcConfig.fieldBId || ""),
          operator: String(f.calcConfig.operator || "+"),
          unit: f.calcConfig.unit ? String(f.calcConfig.unit).trim() : "",
          decimalPlaces: typeof f.calcConfig.decimalPlaces === "number" ? f.calcConfig.decimalPlaces : 2,
        } : undefined,
        required: Boolean(f.required),
        placeholder: f.placeholder || "",
      }));
    }

    await db.update(noteTypes).set(updateObj).where(eq(noteTypes.typeId, typeId));
    const updated = (await db.select().from(noteTypes).where(eq(noteTypes.typeId, typeId)).limit(1))[0];
    res.json({
      type_id: updated.typeId,
      user_id: updated.userId,
      name: updated.name,
      description: updated.description,
      color: updated.color,
      icon: updated.icon,
      is_default: updated.isDefault,
      fields: updated.fields || [],
      created_at: updated.createdAt.toISOString(),
      updated_at: updated.updatedAt.toISOString(),
    });
  } catch (err: any) {
    res.status(500).json({ detail: "Not tipi güncellenemedi", error: err.message });
  }
});

api.delete("/note-types/:type_id", authMiddleware, async (req: AuthRequest, res: Response) => {
  const userId = req.user!.userId;
  const typeId = req.params.type_id;

  if (typeId === "type_plain" || typeId === "type_card" || typeId === "default") {
    return res.status(400).json({ detail: "Varsayılan 'Düz Metin' ve 'Kart' sistem not tipleri silinemez." });
  }

  try {
    const found = await db.select().from(noteTypes).where(and(eq(noteTypes.typeId, typeId), eq(noteTypes.userId, userId))).limit(1);
    if (found.length === 0) {
      return res.status(404).json({ detail: "Not tipi bulunamadı" });
    }
    if (found[0].isDefault) {
      return res.status(400).json({ detail: "Varsayılan not tipi silinemez." });
    }

    // Unlink notes with this note_type_id
    await db.update(notes).set({ noteTypeId: null }).where(and(eq(notes.noteTypeId, typeId), eq(notes.userId, userId)));
    await db.delete(noteTypes).where(and(eq(noteTypes.typeId, typeId), eq(noteTypes.userId, userId)));
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ detail: "Not tipi silinemedi", error: err.message });
  }
});

// ---------------------------------------------------------------------------
// Kanban Columns Endpoints
// ---------------------------------------------------------------------------
const DEFAULT_KANBAN_COLUMNS = [
  { column_id: "todo", name: "Yapılacaklar", color: "#3b82f6", order_index: 0 },
  { column_id: "in_progress", name: "Devam Edenler", color: "#f59e0b", order_index: 1 },
  { column_id: "review", name: "İncelemede", color: "#8b5cf6", order_index: 2 },
  { column_id: "done", name: "Tamamlananlar", color: "#10b981", order_index: 3 },
];

async function ensureKanbanTable() {
  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS kanban_columns (
        column_id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        color TEXT DEFAULT '#3b82f6',
        order_index DOUBLE PRECISION DEFAULT 0 NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
      );
    `);
  } catch (err) {
    console.warn("Failed ensuring kanban_columns table:", err);
  }
}

api.get("/kanban/columns", authMiddleware, async (req: AuthRequest, res: Response) => {
  const userId = req.user!.userId;
  try {
    const cols = await db.select().from(kanbanColumns).where(eq(kanbanColumns.userId, userId));
    if (cols.length === 0) {
      // Seed default columns for user
      const inserted = [];
      for (let i = 0; i < DEFAULT_KANBAN_COLUMNS.length; i++) {
        const def = DEFAULT_KANBAN_COLUMNS[i];
        const newId = `col_${def.column_id}_${genId("k")}`;
        await db.insert(kanbanColumns).values({
          columnId: newId,
          userId,
          name: def.name,
          color: def.color,
          orderIndex: i,
        });
        inserted.push({
          column_id: newId,
          user_id: userId,
          name: def.name,
          color: def.color,
          order_index: i,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        });
      }
      return res.json(inserted);
    }

    const sorted = cols
      .sort((a, b) => a.orderIndex - b.orderIndex)
      .map((c) => ({
        column_id: c.columnId,
        user_id: c.userId,
        name: c.name,
        color: c.color,
        order_index: c.orderIndex,
        created_at: c.createdAt.toISOString(),
        updated_at: c.updatedAt.toISOString(),
      }));

    res.json(sorted);
  } catch (err: any) {
    res.status(500).json({ detail: "Kanban sütunları alınamadı", error: err.message });
  }
});

api.post("/kanban/columns", authMiddleware, async (req: AuthRequest, res: Response) => {
  const userId = req.user!.userId;
  const { name, color, order_index } = req.body || {};
  if (!name || !name.trim()) {
    return res.status(400).json({ detail: "Sütun adı zorunludur" });
  }

  const columnId = genId("col");
  try {
    const existing = await db.select().from(kanbanColumns).where(eq(kanbanColumns.userId, userId));
    const nextOrder = typeof order_index === "number" ? order_index : existing.length;

    await db.insert(kanbanColumns).values({
      columnId,
      userId,
      name: name.trim(),
      color: color || "#3b82f6",
      orderIndex: nextOrder,
    });

    const item = (await db.select().from(kanbanColumns).where(eq(kanbanColumns.columnId, columnId)).limit(1))[0];
    res.json({
      column_id: item.columnId,
      user_id: item.userId,
      name: item.name,
      color: item.color,
      order_index: item.orderIndex,
      created_at: item.createdAt.toISOString(),
      updated_at: item.updatedAt.toISOString(),
    });
  } catch (err: any) {
    res.status(500).json({ detail: "Sütun oluşturulamadı", error: err.message });
  }
});

api.put("/kanban/columns/:column_id", authMiddleware, async (req: AuthRequest, res: Response) => {
  const userId = req.user!.userId;
  const columnId = req.params.column_id;
  const { name, color, order_index } = req.body || {};

  try {
    const found = await db.select().from(kanbanColumns).where(and(eq(kanbanColumns.columnId, columnId), eq(kanbanColumns.userId, userId))).limit(1);
    if (found.length === 0) {
      return res.status(404).json({ detail: "Sütun bulunamadı" });
    }

    const updateObj: any = { updatedAt: new Date() };
    if (name !== undefined) {
      if (!name.trim()) return res.status(400).json({ detail: "Sütun adı boş olamaz" });
      updateObj.name = name.trim();
    }
    if (color !== undefined) updateObj.color = color;
    if (order_index !== undefined) updateObj.orderIndex = Number(order_index);

    await db.update(kanbanColumns).set(updateObj).where(eq(kanbanColumns.columnId, columnId));
    const updated = (await db.select().from(kanbanColumns).where(eq(kanbanColumns.columnId, columnId)).limit(1))[0];
    res.json({
      column_id: updated.columnId,
      user_id: updated.userId,
      name: updated.name,
      color: updated.color,
      order_index: updated.orderIndex,
      created_at: updated.createdAt.toISOString(),
      updated_at: updated.updatedAt.toISOString(),
    });
  } catch (err: any) {
    res.status(500).json({ detail: "Sütun güncellenemedi", error: err.message });
  }
});

api.delete("/kanban/columns/:column_id", authMiddleware, async (req: AuthRequest, res: Response) => {
  const userId = req.user!.userId;
  const columnId = req.params.column_id;

  try {
    await db.delete(kanbanColumns).where(and(eq(kanbanColumns.columnId, columnId), eq(kanbanColumns.userId, userId)));
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ detail: "Sütun silinemedi", error: err.message });
  }
});

// ---------------------------------------------------------------------------
// Categories Endpoints
// ---------------------------------------------------------------------------
api.get("/categories", authMiddleware, async (req: AuthRequest, res: Response) => {
  const userId = req.user!.userId;
  try {
    const items = await db.select().from(categories).where(eq(categories.userId, userId)).orderBy(desc(categories.createdAt));
    res.json(items.map((c) => ({
      category_id: c.categoryId,
      user_id: c.userId,
      name: c.name,
      color: c.color,
      icon: c.icon,
      group_id: c.groupId,
      created_at: c.createdAt.toISOString(),
    })));
  } catch (err: any) {
    res.status(500).json({ detail: "Kategoriler alınamadı", error: err.message });
  }
});

api.post("/categories", authMiddleware, async (req: AuthRequest, res: Response) => {
  const userId = req.user!.userId;
  const { name, color, icon, group_id } = req.body || {};
  if (!name || !name.trim()) {
    return res.status(400).json({ detail: "Kategori adı zorunludur" });
  }

  const categoryId = genId("cat");
  try {
    await db.insert(categories).values({
      categoryId,
      userId,
      name: name.trim(),
      color: color || "#6366f1",
      icon: icon || null,
      groupId: group_id || null,
    });
    const item = (await db.select().from(categories).where(eq(categories.categoryId, categoryId)).limit(1))[0];
    res.json({
      category_id: item.categoryId,
      user_id: item.userId,
      name: item.name,
      color: item.color,
      icon: item.icon,
      group_id: item.groupId,
      created_at: item.createdAt.toISOString(),
    });
  } catch (err: any) {
    res.status(500).json({ detail: "Kategori oluşturulamadı", error: err.message });
  }
});

api.put("/categories/:category_id", authMiddleware, async (req: AuthRequest, res: Response) => {
  const userId = req.user!.userId;
  const categoryId = req.params.category_id;
  const { name, color, icon, group_id } = req.body || {};

  try {
    const found = await db.select().from(categories).where(and(eq(categories.categoryId, categoryId), eq(categories.userId, userId))).limit(1);
    if (found.length === 0) {
      return res.status(404).json({ detail: "Kategori bulunamadı" });
    }

    const updateObj: any = {};
    if (name !== undefined) updateObj.name = name.trim();
    if (color !== undefined) updateObj.color = color;
    if (icon !== undefined) updateObj.icon = icon;
    if (group_id !== undefined) updateObj.groupId = group_id || null;

    await db.update(categories).set(updateObj).where(eq(categories.categoryId, categoryId));
    const updated = (await db.select().from(categories).where(eq(categories.categoryId, categoryId)).limit(1))[0];
    res.json({
      category_id: updated.categoryId,
      user_id: updated.userId,
      name: updated.name,
      color: updated.color,
      icon: updated.icon,
      group_id: updated.groupId,
      created_at: updated.createdAt.toISOString(),
    });
  } catch (err: any) {
    res.status(500).json({ detail: "Kategori güncellenemedi", error: err.message });
  }
});

api.delete("/categories/:category_id", authMiddleware, async (req: AuthRequest, res: Response) => {
  const userId = req.user!.userId;
  const categoryId = req.params.category_id;
  try {
    await db.update(notes).set({ categoryId: null }).where(and(eq(notes.categoryId, categoryId), eq(notes.userId, userId)));
    await db.delete(categories).where(and(eq(categories.categoryId, categoryId), eq(categories.userId, userId)));
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ detail: "Kategori silinemedi", error: err.message });
  }
});

// ---------------------------------------------------------------------------
// Notes Endpoints (Backed by Cloud SQL + Vector Embeddings)
// ---------------------------------------------------------------------------
api.post("/notes", authMiddleware, async (req: AuthRequest, res: Response) => {
  const userId = req.user!.userId;
  const { title, content, date, location_id, category_id, note_type_id, custom_fields, created_at, slug } = req.body || {};
  const noteContent = content || "";
  const tagsArr = extractTags(noteContent);
  const peopleArr = extractPeople(noteContent);

  await ensureTags(userId, tagsArr);
  await ensurePeople(userId, peopleArr);

  const noteId = genId("note");
  const noteTitle = (title || "").trim();
  const finalDate = normalizeDateToIso(date);
  const finalSlug = generateSlugForNote(noteTitle, finalDate, noteId, slug);
  const embedding = await generateTextEmbedding(`${noteTitle}\n${noteContent}`);

  try {
    const effectiveNoteTypeId = (note_type_id && note_type_id !== "type_plain" && note_type_id !== "default") ? note_type_id : null;
    const finalCustomFields = custom_fields && typeof custom_fields === "object" ? { ...custom_fields } : {};
    if (effectiveNoteTypeId === "type_card" && !finalCustomFields.kanban_column) {
      finalCustomFields.kanban_column = "todo";
    }

    const values: any = {
      noteId,
      userId,
      slug: finalSlug,
      title: noteTitle,
      content: noteContent,
      date: finalDate,
      tags: tagsArr,
      people: peopleArr,
      categoryId: category_id || null,
      locationId: location_id || null,
      noteTypeId: effectiveNoteTypeId,
      customFields: finalCustomFields,
      pinned: false,
      archived: false,
    };
    if (embedding) {
      values.embedding = embedding;
    }
    if (created_at) {
      const parsed = new Date(created_at);
      if (!isNaN(parsed.getTime())) values.createdAt = parsed;
    }

    await db.insert(notes).values(values);
    await syncReminders(userId, noteId, noteContent);

    const inserted = (await db.select().from(notes).where(eq(notes.noteId, noteId)).limit(1))[0];
    res.json({
      note_id: inserted.noteId,
      user_id: inserted.userId,
      slug: inserted.slug || finalSlug,
      title: inserted.title,
      content: inserted.content,
      date: inserted.date,
      tags: inserted.tags,
      people: inserted.people,
      category_id: inserted.categoryId,
      location_id: inserted.locationId,
      note_type_id: inserted.noteTypeId || "type_plain",
      custom_fields: inserted.customFields || {},
      pinned: inserted.pinned,
      archived: inserted.archived || false,
      created_at: inserted.createdAt.toISOString(),
      updated_at: inserted.updatedAt.toISOString(),
    });
  } catch (err: any) {
    console.error("Failed saving note to vector db:", err);
    res.status(500).json({ detail: "Not kaydedilemedi", error: err.message });
  }
});

api.get("/notes", authMiddleware, async (req: AuthRequest, res: Response) => {
  const userId = req.user!.userId;
  const {
    date,
    tag,
    person,
    location_id,
    category_id,
    note_type_id,
    q,
    pinned,
    sortOrder,
    limit: rawLimit,
    offset: rawOffset,
    paginate,
  } = req.query;

  const rawTags = req.query.tags;
  const tagsArr: string[] = Array.isArray(rawTags)
    ? (rawTags as string[]).map(String)
    : rawTags
    ? [String(rawTags)]
    : [];
  if (tag && typeof tag === "string") tagsArr.push(tag);

  const rawPeople = req.query.people;
  const peopleArr: string[] = Array.isArray(rawPeople)
    ? (rawPeople as string[]).map(String)
    : rawPeople
    ? [String(rawPeople)]
    : [];
  if (person && typeof person === "string") peopleArr.push(person);

  const rawLocs = req.query.location_ids;
  const locsArr: string[] = Array.isArray(rawLocs)
    ? (rawLocs as string[]).map(String)
    : rawLocs
    ? [String(rawLocs)]
    : [];
  if (location_id && typeof location_id === "string") locsArr.push(location_id);

  const targetTags = Array.from(new Set(tagsArr.map((t) => t.toLowerCase())));
  const targetPeople = Array.from(new Set(peopleArr.map((p) => p.toLowerCase())));
  const targetLocs = Array.from(new Set(locsArr));

  try {
    const items = await db.select().from(notes).where(eq(notes.userId, userId)).orderBy(desc(notes.createdAt));
    const totalUserNotes = items.length;

    let filtered = items.map((n) => ({
      note_id: n.noteId,
      user_id: n.userId,
      slug: n.slug || generateSlugForNote(n.title, n.date, n.noteId),
      title: n.title,
      content: n.content,
      date: n.date,
      tags: n.tags || [],
      people: n.people || [],
      category_id: n.categoryId,
      location_id: n.locationId,
      note_type_id: n.noteTypeId || "type_plain",
      custom_fields: n.customFields || {},
      pinned: n.pinned,
      archived: n.archived || false,
      created_at: n.createdAt.toISOString(),
      updated_at: n.updatedAt.toISOString(),
    }));

    if (date && typeof date === "string") {
      filtered = filtered.filter((n) => n.date.startsWith(date) || n.date.slice(0, 10) === date);
    }

    if (category_id && typeof category_id === "string") {
      filtered = filtered.filter((n) => n.category_id === category_id);
    }

    if (note_type_id && typeof note_type_id === "string") {
      filtered = filtered.filter((n) => {
        if (note_type_id === "type_plain" || note_type_id === "default") {
          return !n.note_type_id || n.note_type_id === "type_plain" || n.note_type_id === "default";
        }
        return n.note_type_id === note_type_id;
      });
    }

    if (pinned !== undefined) {
      const isPinned = pinned === "true" || (pinned as unknown) === true;
      filtered = filtered.filter((n) => (isPinned ? n.pinned === true : !n.pinned));
    }

    if (targetTags.length > 0) {
      filtered = filtered.filter((n) => targetTags.every((t) => n.tags.includes(t)));
    }

    if (targetPeople.length > 0) {
      filtered = filtered.filter((n) => targetPeople.every((p) => n.people.includes(p)));
    }

    if (targetLocs.length > 0) {
      filtered = filtered.filter((n) => n.location_id && targetLocs.includes(n.location_id));
    }

    // Backend Search across Title, Content, Tags, People
    if (q && typeof q === "string" && q.trim()) {
      const queryStr = q.trim().toLowerCase();
      filtered = filtered.filter(
        (n) =>
          n.title.toLowerCase().includes(queryStr) ||
          n.content.toLowerCase().includes(queryStr) ||
          n.tags.some((t) => t.toLowerCase().includes(queryStr)) ||
          n.people.some((p) => p.toLowerCase().includes(queryStr))
      );
    }

    // Backend Sorting (newest first / oldest first)
    filtered.sort((a, b) => {
      const timeA = new Date(a.date || a.created_at).getTime();
      const timeB = new Date(b.date || b.created_at).getTime();
      if (sortOrder === "oldest") {
        return timeA - timeB;
      }
      return timeB - timeA;
    });

    const filteredTotal = filtered.length;
    const isPaginate = paginate === "true" || rawLimit !== undefined;

    if (isPaginate) {
      const limit = rawLimit !== undefined ? Math.max(1, parseInt(String(rawLimit), 10)) : 10;
      const offset = rawOffset !== undefined ? Math.max(0, parseInt(String(rawOffset), 10)) : 0;
      const paginatedItems = filtered.slice(offset, offset + limit);
      const hasMore = offset + limit < filteredTotal;

      res.setHeader("X-Total-Count", totalUserNotes.toString());
      res.setHeader("X-Filtered-Count", filteredTotal.toString());
      res.setHeader("X-Has-More", hasMore ? "true" : "false");

      return res.json({
        items: paginatedItems,
        total: totalUserNotes,
        filtered_total: filteredTotal,
        has_more: hasMore,
        limit,
        offset,
      });
    }

    res.setHeader("X-Total-Count", totalUserNotes.toString());
    res.setHeader("X-Filtered-Count", filteredTotal.toString());
    res.setHeader("X-Has-More", "false");
    res.json(filtered);
  } catch (err: any) {
    console.error("Failed fetching notes from db:", err);
    res.status(500).json({ detail: "Notlar yüklenemedi", error: err.message });
  }
});

api.get("/notes/calendar", authMiddleware, async (req: AuthRequest, res: Response) => {
  const userId = req.user!.userId;
  const year = parseInt(req.query.year as string, 10);
  const month = parseInt(req.query.month as string, 10);

  if (isNaN(year) || isNaN(month)) {
    return res.status(400).json({ detail: "Year and month required" });
  }

  const prefix = `${year.toString().padStart(4, "0")}-${month.toString().padStart(2, "0")}-`;
  
  try {
    const rows = await db.select().from(notes).where(
      and(
        eq(notes.userId, userId),
        sql`${notes.date} LIKE ${`${prefix}%`}`
      )
    );

    const counts: Record<string, number> = {};
    for (const r of rows) {
      const dayKey = (r.date || "").slice(0, 10);
      if (dayKey) {
        counts[dayKey] = (counts[dayKey] || 0) + 1;
      }
    }
    res.json(counts);
  } catch (err: any) {
    res.status(500).json({ detail: "Takvim verisi alınamadı", error: err.message });
  }
});

api.get("/notes/:note_id", authMiddleware, async (req: AuthRequest, res: Response) => {
  const userId = req.user!.userId;
  const identifier = req.params.note_id;
  try {
    const found = await db.select().from(notes).where(
      and(
        or(eq(notes.noteId, identifier), eq(notes.slug, identifier)),
        eq(notes.userId, userId)
      )
    ).limit(1);

    if (found.length === 0) {
      return res.status(404).json({ detail: "Not bulunamadı" });
    }
    const n = found[0];
    res.json({
      note_id: n.noteId,
      user_id: n.userId,
      slug: n.slug || generateSlugForNote(n.title, n.date, n.noteId),
      title: n.title,
      content: n.content,
      date: n.date,
      tags: n.tags || [],
      people: n.people || [],
      category_id: n.categoryId,
      location_id: n.locationId,
      note_type_id: n.noteTypeId || "type_plain",
      custom_fields: n.customFields || {},
      pinned: n.pinned,
      archived: n.archived || false,
      created_at: n.createdAt.toISOString(),
      updated_at: n.updatedAt.toISOString(),
    });
  } catch (err: any) {
    res.status(500).json({ detail: "Not alınamadı", error: err.message });
  }
});

api.put("/notes/:note_id", authMiddleware, async (req: AuthRequest, res: Response) => {
  const userId = req.user!.userId;
  const identifier = req.params.note_id;
  
  try {
    const found = await db.select().from(notes).where(
      and(
        or(eq(notes.noteId, identifier), eq(notes.slug, identifier)),
        eq(notes.userId, userId)
      )
    ).limit(1);

    if (found.length === 0) {
      return res.status(404).json({ detail: "Not bulunamadı" });
    }
    const current = found[0];
    const noteId = current.noteId;

    const { title, content, date, location_id, category_id, note_type_id, custom_fields, created_at, slug, archived } = req.body || {};

    if (current.archived && archived === undefined) {
      return res.status(403).json({ detail: "Arşivlenmiş notlar düzenlenemez. Lütfen önce arşivden çıkarın." });
    }

    const noteContent = content !== undefined ? content : current.content;
    const noteTitle = (title !== undefined ? title : current.title).trim();
    const tagsArr = extractTags(noteContent);
    const peopleArr = extractPeople(noteContent);

    await ensureTags(userId, tagsArr);
    await ensurePeople(userId, peopleArr);

    const embedding = await generateTextEmbedding(`${noteTitle}\n${noteContent}`);

    const effectiveNoteTypeId = note_type_id !== undefined
      ? (note_type_id && note_type_id !== "type_plain" && note_type_id !== "default" ? note_type_id : null)
      : current.noteTypeId;

    const newDate = date !== undefined ? normalizeDateToIso(date) : current.date;
    
    let newSlug = current.slug;
    if (slug !== undefined && slug.trim()) {
      newSlug = slugify(slug.trim());
    } else if (!newSlug) {
      newSlug = generateSlugForNote(noteTitle, newDate, noteId);
    }

    const baseCustomFields = custom_fields !== undefined ? (custom_fields || {}) : (current.customFields || {});
    const finalCustomFields = typeof baseCustomFields === "object" ? { ...baseCustomFields } : {};
    if (effectiveNoteTypeId === "type_card" && !finalCustomFields.kanban_column) {
      finalCustomFields.kanban_column = "todo";
    }

    const updateData: any = {
      slug: newSlug,
      title: noteTitle,
      content: noteContent,
      date: newDate,
      tags: tagsArr,
      people: peopleArr,
      categoryId: category_id !== undefined ? (category_id || null) : current.categoryId,
      locationId: location_id !== undefined ? (location_id || null) : current.locationId,
      noteTypeId: effectiveNoteTypeId,
      customFields: finalCustomFields,
      updatedAt: new Date(),
    };
    if (archived !== undefined) {
      updateData.archived = Boolean(archived);
    }
    if (embedding) {
      updateData.embedding = embedding;
    }
    if (created_at) {
      const parsed = new Date(created_at);
      if (!isNaN(parsed.getTime())) updateData.createdAt = parsed;
    }

    await db.update(notes).set(updateData).where(eq(notes.noteId, noteId));
    await syncReminders(userId, noteId, noteContent);

    const updated = (await db.select().from(notes).where(eq(notes.noteId, noteId)).limit(1))[0];
    res.json({
      note_id: updated.noteId,
      user_id: updated.userId,
      slug: updated.slug || newSlug,
      title: updated.title,
      content: updated.content,
      date: updated.date,
      tags: updated.tags || [],
      people: updated.people || [],
      category_id: updated.categoryId,
      location_id: updated.locationId,
      note_type_id: updated.noteTypeId || "type_plain",
      custom_fields: updated.customFields || {},
      pinned: updated.pinned,
      archived: updated.archived || false,
      created_at: updated.createdAt.toISOString(),
      updated_at: updated.updatedAt.toISOString(),
    });
  } catch (err: any) {
    res.status(500).json({ detail: "Not güncellenemedi", error: err.message });
  }
});

api.patch("/notes/:note_id/pin", authMiddleware, async (req: AuthRequest, res: Response) => {
  const userId = req.user!.userId;
  const identifier = req.params.note_id;
  try {
    const found = await db.select().from(notes).where(
      and(
        or(eq(notes.noteId, identifier), eq(notes.slug, identifier)),
        eq(notes.userId, userId)
      )
    ).limit(1);

    if (found.length === 0) {
      return res.status(404).json({ detail: "Not bulunamadı" });
    }
    const current = found[0];
    if (current.archived) {
      return res.status(403).json({ detail: "Arşivlenmiş notlar panoya sabitlenemez. Lütfen önce arşivden çıkarın." });
    }
    const newPinned = !current.pinned;
    await db.update(notes).set({ pinned: newPinned, updatedAt: new Date() }).where(eq(notes.noteId, current.noteId));
    
    const updated = (await db.select().from(notes).where(eq(notes.noteId, current.noteId)).limit(1))[0];
    res.json({
      note_id: updated.noteId,
      user_id: updated.userId,
      slug: updated.slug || current.slug,
      title: updated.title,
      content: updated.content,
      date: updated.date,
      tags: updated.tags || [],
      people: updated.people || [],
      category_id: updated.categoryId,
      location_id: updated.locationId,
      note_type_id: updated.noteTypeId || "type_plain",
      custom_fields: updated.customFields || {},
      pinned: updated.pinned,
      archived: updated.archived || false,
      created_at: updated.createdAt.toISOString(),
      updated_at: updated.updatedAt.toISOString(),
    });
  } catch (err: any) {
    res.status(500).json({ detail: "Sabitleme durumu değiştirilemedi", error: err.message });
  }
});

const handleArchiveToggle = async (req: AuthRequest, res: Response) => {
  const userId = req.user!.userId;
  const identifier = req.params.note_id;
  try {
    const found = await db.select().from(notes).where(
      and(
        or(eq(notes.noteId, identifier), eq(notes.slug, identifier)),
        eq(notes.userId, userId)
      )
    ).limit(1);

    if (found.length === 0) {
      return res.status(404).json({ detail: "Not bulunamadı" });
    }
    const current = found[0];
    const newArchived = req.body?.archived !== undefined ? Boolean(req.body.archived) : !current.archived;
    const updateValues: any = {
      archived: newArchived,
      updatedAt: new Date(),
    };
    // Auto unpin when archiving
    if (newArchived) {
      updateValues.pinned = false;
    }
    await db.update(notes).set(updateValues).where(eq(notes.noteId, current.noteId));
    
    const updated = (await db.select().from(notes).where(eq(notes.noteId, current.noteId)).limit(1))[0];
    res.json({
      note_id: updated.noteId,
      user_id: updated.userId,
      slug: updated.slug || current.slug,
      title: updated.title,
      content: updated.content,
      date: updated.date,
      tags: updated.tags || [],
      people: updated.people || [],
      category_id: updated.categoryId,
      location_id: updated.locationId,
      note_type_id: updated.noteTypeId || "type_plain",
      custom_fields: updated.customFields || {},
      pinned: updated.pinned,
      archived: updated.archived || false,
      created_at: updated.createdAt.toISOString(),
      updated_at: updated.updatedAt.toISOString(),
    });
  } catch (err: any) {
    res.status(500).json({ detail: "Arşivleme durumu değiştirilemedi", error: err.message });
  }
};

api.patch("/notes/:note_id/archive", authMiddleware, handleArchiveToggle);
api.post("/notes/:note_id/archive", authMiddleware, handleArchiveToggle);
api.put("/notes/:note_id/archive", authMiddleware, handleArchiveToggle);
api.patch("/notes/:note_id/unarchive", authMiddleware, handleArchiveToggle);
api.post("/notes/:note_id/unarchive", authMiddleware, handleArchiveToggle);

api.delete("/notes/:note_id", authMiddleware, async (req: AuthRequest, res: Response) => {
  const userId = req.user!.userId;
  const identifier = req.params.note_id;
  try {
    const found = await db.select().from(notes).where(
      and(
        or(eq(notes.noteId, identifier), eq(notes.slug, identifier)),
        eq(notes.userId, userId)
      )
    ).limit(1);

    if (found.length === 0) {
      return res.status(404).json({ detail: "Not bulunamadı" });
    }
    if (found[0].archived) {
      return res.status(403).json({ detail: "Arşivlenmiş notlar silinemez. Lütfen önce arşivden çıkarın." });
    }
    await db.delete(notes).where(eq(notes.noteId, found[0].noteId));
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ detail: "Not silinemedi", error: err.message });
  }
});

// ---------------------------------------------------------------------------
// Tags Endpoints
// ---------------------------------------------------------------------------
api.get("/tags", authMiddleware, async (req: AuthRequest, res: Response) => {
  const userId = req.user!.userId;
  const q = req.query.q ? String(req.query.q).toLowerCase() : "";
  try {
    let query = db.select().from(tags).where(eq(tags.userId, userId));
    const items = await query;
    let filtered = items.map((t) => ({
      tag_id: t.tagId,
      user_id: t.userId,
      name: t.name,
      group_id: t.groupId,
      created_at: t.createdAt.toISOString(),
    }));
    if (q) {
      filtered = filtered.filter((t) => t.name.startsWith(q) || t.name.includes(q));
    }
    filtered.sort((a, b) => a.name.localeCompare(b.name));
    res.json(filtered);
  } catch (err: any) {
    res.status(500).json({ detail: "Etiketler yüklenemedi", error: err.message });
  }
});

api.put("/tags/:tag_id", authMiddleware, async (req: AuthRequest, res: Response) => {
  const userId = req.user!.userId;
  const tagId = req.params.tag_id;
  const { name, group_id } = req.body || {};

  try {
    const found = await db.select().from(tags).where(and(eq(tags.tagId, tagId), eq(tags.userId, userId))).limit(1);
    if (found.length === 0) {
      return res.status(404).json({ detail: "Not found" });
    }
    const currentTag = found[0];

    const updateObj: any = {};
    if (group_id !== undefined) updateObj.groupId = group_id || null;

    if (name) {
      const newName = name.trim().toLowerCase();
      if (currentTag.name !== newName) {
        const conflict = await db.select().from(tags).where(and(eq(tags.userId, userId), eq(tags.name, newName))).limit(1);
        if (conflict.length > 0) {
          return res.status(400).json({ detail: "Tag name already exists" });
        }
        updateObj.name = newName;

        const oldName = currentTag.name;
        const userNotes = await db.select().from(notes).where(eq(notes.userId, userId));
        const regex = new RegExp(`(?<!\\S)#${oldName}(?!\\w)`, "gui");
        for (const n of userNotes) {
          if (n.tags && n.tags.includes(oldName)) {
            const newContent = n.content.replace(regex, `#${newName}`);
            const newTags = n.tags.map((t) => (t === oldName ? newName : t));
            await db.update(notes).set({ content: newContent, tags: newTags, updatedAt: new Date() }).where(eq(notes.noteId, n.noteId));
          }
        }
      }
    }

    if (Object.keys(updateObj).length > 0) {
      await db.update(tags).set(updateObj).where(eq(tags.tagId, tagId));
    }

    const updated = (await db.select().from(tags).where(eq(tags.tagId, tagId)).limit(1))[0];
    res.json({
      tag_id: updated.tagId,
      user_id: updated.userId,
      name: updated.name,
      group_id: updated.groupId,
      created_at: updated.createdAt.toISOString(),
    });
  } catch (err: any) {
    res.status(500).json({ detail: "Etiket güncellenemedi", error: err.message });
  }
});

api.delete("/tags/:tag_id", authMiddleware, async (req: AuthRequest, res: Response) => {
  const userId = req.user!.userId;
  try {
    await db.delete(tags).where(and(eq(tags.tagId, req.params.tag_id), eq(tags.userId, userId)));
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ detail: "Etiket silinemedi", error: err.message });
  }
});

// ---------------------------------------------------------------------------
// People Endpoints
// ---------------------------------------------------------------------------
api.get("/people", authMiddleware, async (req: AuthRequest, res: Response) => {
  const userId = req.user!.userId;
  const q = req.query.q ? String(req.query.q).toLowerCase() : "";
  try {
    const items = await db.select().from(people).where(eq(people.userId, userId));
    let filtered = items.map((p) => ({
      person_id: p.personId,
      user_id: p.userId,
      name: p.name,
      group_id: p.groupId,
      created_at: p.createdAt.toISOString(),
    }));
    if (q) {
      filtered = filtered.filter((p) => p.name.startsWith(q) || p.name.includes(q));
    }
    filtered.sort((a, b) => a.name.localeCompare(b.name));
    res.json(filtered);
  } catch (err: any) {
    res.status(500).json({ detail: "Kişiler yüklenemedi", error: err.message });
  }
});

api.put("/people/:person_id", authMiddleware, async (req: AuthRequest, res: Response) => {
  const userId = req.user!.userId;
  const personId = req.params.person_id;
  const { name, group_id } = req.body || {};

  try {
    const found = await db.select().from(people).where(and(eq(people.personId, personId), eq(people.userId, userId))).limit(1);
    if (found.length === 0) {
      return res.status(404).json({ detail: "Not found" });
    }
    const currentPerson = found[0];

    const updateObj: any = {};
    if (group_id !== undefined) updateObj.groupId = group_id || null;

    if (name) {
      const newName = name.trim().toLowerCase();
      if (currentPerson.name !== newName) {
        const conflict = await db.select().from(people).where(and(eq(people.userId, userId), eq(people.name, newName))).limit(1);
        if (conflict.length > 0) {
          return res.status(400).json({ detail: "Person name already exists" });
        }
        updateObj.name = newName;

        const oldName = currentPerson.name;
        const userNotes = await db.select().from(notes).where(eq(notes.userId, userId));
        const regex = new RegExp(`(?<!\\S)@${oldName}(?!\\w)`, "gui");
        for (const n of userNotes) {
          if (n.people && n.people.includes(oldName)) {
            const newContent = n.content.replace(regex, `@${newName}`);
            const newPeople = n.people.map((p) => (p === oldName ? newName : p));
            await db.update(notes).set({ content: newContent, people: newPeople, updatedAt: new Date() }).where(eq(notes.noteId, n.noteId));
          }
        }
      }
    }

    if (Object.keys(updateObj).length > 0) {
      await db.update(people).set(updateObj).where(eq(people.personId, personId));
    }

    const updated = (await db.select().from(people).where(eq(people.personId, personId)).limit(1))[0];
    res.json({
      person_id: updated.personId,
      user_id: updated.userId,
      name: updated.name,
      group_id: updated.groupId,
      created_at: updated.createdAt.toISOString(),
    });
  } catch (err: any) {
    res.status(500).json({ detail: "Kişi güncellenemedi", error: err.message });
  }
});

api.delete("/people/:person_id", authMiddleware, async (req: AuthRequest, res: Response) => {
  const userId = req.user!.userId;
  try {
    await db.delete(people).where(and(eq(people.personId, req.params.person_id), eq(people.userId, userId)));
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ detail: "Kişi silinemedi", error: err.message });
  }
});

// ---------------------------------------------------------------------------
// Locations Endpoints
// ---------------------------------------------------------------------------
api.get("/locations", authMiddleware, async (req: AuthRequest, res: Response) => {
  const userId = req.user!.userId;
  try {
    const items = await db.select().from(locations).where(eq(locations.userId, userId)).orderBy(desc(locations.createdAt));
    res.json(items.map((l) => ({
      location_id: l.locationId,
      user_id: l.userId,
      name: l.name,
      lat: l.lat,
      lng: l.lng,
      group_id: l.groupId,
      created_at: l.createdAt.toISOString(),
    })));
  } catch (err: any) {
    res.status(500).json({ detail: "Konumlar alınamadı", error: err.message });
  }
});

api.post("/locations", authMiddleware, async (req: AuthRequest, res: Response) => {
  const userId = req.user!.userId;
  const { name, lat, lng, group_id } = req.body || {};

  const numLat = typeof lat === "number" ? lat : parseFloat(String(lat));
  const numLng = typeof lng === "number" ? lng : parseFloat(String(lng));

  if (isNaN(numLat) || isNaN(numLng)) {
    return res.status(400).json({ detail: "Geçerli bir koordinat (enlem ve boylam) girilmelidir" });
  }

  const locId = genId("loc");
  const locName = (name && String(name).trim()) || `Yer ${new Date().toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" })}`;

  try {
    await db.insert(locations).values({
      locationId: locId,
      userId,
      name: locName,
      lat: numLat,
      lng: numLng,
      groupId: group_id || null,
    });
    const loc = (await db.select().from(locations).where(eq(locations.locationId, locId)).limit(1))[0];
    res.json({
      location_id: loc.locationId,
      user_id: loc.userId,
      name: loc.name,
      lat: loc.lat,
      lng: loc.lng,
      group_id: loc.groupId,
      created_at: loc.createdAt.toISOString(),
    });
  } catch (err: any) {
    res.status(500).json({ detail: "Konum kaydedilemedi", error: err.message });
  }
});

api.put("/locations/:location_id", authMiddleware, async (req: AuthRequest, res: Response) => {
  const userId = req.user!.userId;
  const locId = req.params.location_id;
  const { name, group_id } = req.body || {};

  try {
    const found = await db.select().from(locations).where(and(eq(locations.locationId, locId), eq(locations.userId, userId))).limit(1);
    if (found.length === 0) {
      return res.status(404).json({ detail: "Konum bulunamadı" });
    }

    const updateObj: any = {};
    if (name !== undefined) updateObj.name = name.trim();
    if (group_id !== undefined) updateObj.groupId = group_id || null;

    if (Object.keys(updateObj).length > 0) {
      await db.update(locations).set(updateObj).where(eq(locations.locationId, locId));
    }

    const loc = (await db.select().from(locations).where(eq(locations.locationId, locId)).limit(1))[0];
    res.json({
      location_id: loc.locationId,
      user_id: loc.userId,
      name: loc.name,
      lat: loc.lat,
      lng: loc.lng,
      group_id: loc.groupId,
      created_at: loc.createdAt.toISOString(),
    });
  } catch (err: any) {
    res.status(500).json({ detail: "Konum güncellenemedi", error: err.message });
  }
});

api.delete("/locations/:location_id", authMiddleware, async (req: AuthRequest, res: Response) => {
  const userId = req.user!.userId;
  const locId = req.params.location_id;
  try {
    await db.delete(locations).where(and(eq(locations.locationId, locId), eq(locations.userId, userId)));
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ detail: "Konum silinemedi", error: err.message });
  }
});

// ---------------------------------------------------------------------------
// Geocode (Photon/OSM proxy)
// ---------------------------------------------------------------------------
const geocodeCache = new Map<string, { timestamp: number; data: any }>();
const GEOCODE_TTL = 10 * 60 * 1000; // 10 min

api.get("/geocode", authMiddleware, async (req: AuthRequest, res: Response) => {
  const q = String(req.query.q || "").trim();
  const limit = Math.max(1, Math.min(parseInt(req.query.limit as string, 10) || 6, 10));
  if (!q) return res.json([]);

  const cacheKey = `${q.toLowerCase()}|${limit}`;
  const cached = geocodeCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < GEOCODE_TTL) {
    return res.json(cached.data);
  }

  try {
    const response = await axios.get("https://photon.komoot.io/api/", {
      params: { q, limit },
      timeout: 10000,
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; InkwellNotes/1.0)",
        Accept: "application/json",
      },
    });

    const feats = response.data?.features || [];
    const out = feats
      .map((f: any) => {
        const props = f.properties || {};
        const coords = f.geometry?.coordinates || [null, null];
        const lon = coords[0];
        const lat = coords[1];
        if (lat == null || lon == null) return null;
        const name = props.name || "";
        const parts = [
          name,
          props.street,
          props.city || props.county,
          props.state,
          props.country,
        ].filter(Boolean);
        const displayName = parts.join(", ") || name || "—";
        return {
          display_name: displayName,
          name,
          lat: Number(lat),
          lng: Number(lon),
          type: props.type,
          osm_key: props.osm_key,
        };
      })
      .filter(Boolean);

    geocodeCache.set(cacheKey, { timestamp: Date.now(), data: out });
    res.json(out);
  } catch (err) {
    console.warn("Geocode proxy failed:", (err as Error).message);
    res.status(502).json({ detail: "Geocoding upstream error" });
  }
});

// ---------------------------------------------------------------------------
// File Uploads & Download (Stored directly in Cloud SQL)
// ---------------------------------------------------------------------------
const handleImageUpload = async (req: AuthRequest, res: Response) => {
  let file = req.file;
  if (!file && req.files) {
    if (Array.isArray(req.files) && req.files.length > 0) {
      file = req.files[0];
    } else if (typeof req.files === "object") {
      const filesObj = req.files as Record<string, Express.Multer.File[]>;
      file = (filesObj["file"] && filesObj["file"][0]) || (filesObj["image"] && filesObj["image"][0]);
    }
  }

  // Support base64 upload in body if sent as JSON
  if (!file && req.body && req.body.dataBase64) {
    const fileId = genId("file");
    const mime = req.body.contentType || "image/png";
    const buffer = Buffer.from(req.body.dataBase64.replace(/^data:image\/\w+;base64,/, ""), "base64");
    try {
      // 1. Save to database for relational backup
      await db.insert(files).values({
        fileId,
        userId: req.user!.userId,
        originalFilename: req.body.filename || "pasted-image.png",
        contentType: mime,
        size: buffer.length,
        dataBase64: buffer.toString("base64"),
        isDeleted: false,
      });

      // 2. Save directly to persistent storage volume
      try {
        fs.writeFileSync(path.resolve(UPLOADS_DIR, fileId), buffer);
      } catch (e) {
        console.warn("[Uploads] Persistent disk save warning:", e);
      }

      return res.json({
        file_id: fileId,
        url: `/api/files/${fileId}`,
        size: buffer.length,
        content_type: mime,
      });
    } catch (err: any) {
      return res.status(500).json({ detail: "Görsel kaydedilemedi", error: err.message });
    }
  }

  if (!file) {
    return res.status(400).json({ detail: "No file provided" });
  }
  if (!file.mimetype.startsWith("image/")) {
    return res.status(400).json({ detail: "Only images allowed" });
  }

  const fileId = genId("file");
  try {
    // 1. Save to database
    await db.insert(files).values({
      fileId,
      userId: req.user!.userId,
      originalFilename: file.originalname || "image.png",
      contentType: file.mimetype,
      size: file.size,
      dataBase64: file.buffer.toString("base64"),
      isDeleted: false,
    });

    // 2. Save directly to persistent storage volume
    try {
      fs.writeFileSync(path.resolve(UPLOADS_DIR, fileId), file.buffer);
    } catch (e) {
      console.warn("[Uploads] Persistent disk save warning:", e);
    }

    res.json({
      file_id: fileId,
      url: `/api/files/${fileId}`,
      size: file.size,
      content_type: file.mimetype,
    });
  } catch (err: any) {
    res.status(500).json({ detail: "Görsel veritabanına yüklenemedi", error: err.message });
  }
};

api.post(
  "/uploads/image",
  authMiddleware,
  upload.fields([{ name: "file", maxCount: 1 }, { name: "image", maxCount: 1 }]),
  handleImageUpload
);

api.post(
  "/upload",
  authMiddleware,
  upload.fields([{ name: "file", maxCount: 1 }, { name: "image", maxCount: 1 }]),
  handleImageUpload
);

api.get("/files/:file_id", async (req: Request, res: Response) => {
  const fileId = req.params.file_id;
  try {
    const diskPath = path.resolve(UPLOADS_DIR, fileId);
    
    // Check if file is directly available on persistent volume
    if (fs.existsSync(diskPath)) {
      const found = await db.select().from(files).where(and(eq(files.fileId, fileId), eq(files.isDeleted, false))).limit(1);
      const contentType = found[0]?.contentType || "image/png";
      res.setHeader("Content-Type", contentType);
      res.setHeader("Cache-Control", "public, max-age=86400, immutable");
      return res.sendFile(diskPath);
    }

    // Fallback: Read from database and populate persistent disk cache
    const found = await db.select().from(files).where(and(eq(files.fileId, fileId), eq(files.isDeleted, false))).limit(1);
    if (found.length === 0) {
      return res.status(404).json({ detail: "File not found" });
    }
    const file = found[0];
    const buffer = Buffer.from(file.dataBase64, "base64");

    try {
      fs.writeFileSync(diskPath, buffer);
    } catch {
      /* ignore */
    }

    res.setHeader("Content-Type", file.contentType || "image/png");
    res.setHeader("Cache-Control", "public, max-age=86400, immutable");
    res.send(buffer);
  } catch (err: any) {
    res.status(500).json({ detail: "Dosya okunamadı", error: err.message });
  }
});

// ---------------------------------------------------------------------------
// Link Preview (OpenGraph metadata proxy)
// ---------------------------------------------------------------------------
const linkCache = new Map<string, { timestamp: number; data: any }>();
const LINK_TTL = 30 * 60 * 1000;

api.get("/link-preview", authMiddleware, async (req: AuthRequest, res: Response) => {
  const url = String(req.query.url || "").trim();
  if (!url || !url.startsWith("http")) {
    return res.status(400).json({ detail: "Valid HTTP(S) URL is required" });
  }

  const cached = linkCache.get(url);
  if (cached && Date.now() - cached.timestamp < LINK_TTL) {
    return res.json(cached.data);
  }

  try {
    const response = await axios.get(url, {
      timeout: 6000,
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
      maxRedirects: 5,
    });

    const html = response.data;
    const $ = cheerio.load(typeof html === "string" ? html : "");

    const getMeta = (prop: string, name?: string) =>
      $(`meta[property="${prop}"]`).attr("content") ||
      $(`meta[name="${name || prop}"]`).attr("content") ||
      "";

    const title =
      getMeta("og:title", "twitter:title") ||
      $("title").text() ||
      new URL(url).hostname;

    const description =
      getMeta("og:description", "description") ||
      getMeta("twitter:description");

    const image =
      getMeta("og:image", "twitter:image") ||
      getMeta("og:image:url");

    const siteName =
      getMeta("og:site_name") ||
      new URL(url).hostname;

    let absoluteImage = image;
    if (image && !image.startsWith("http")) {
      try {
        absoluteImage = new URL(image, url).toString();
      } catch {}
    }

    const data = {
      url,
      title: title.trim(),
      description: description.trim().slice(0, 300),
      image: absoluteImage,
      site_name: siteName.trim(),
    };

    linkCache.set(url, { timestamp: Date.now(), data });
    return res.json(data);
  } catch (err: any) {
    try {
      const hostname = new URL(url).hostname;
      return res.json({
        url,
        title: hostname,
        description: "",
        image: "",
        site_name: hostname,
      });
    } catch {
      return res.status(502).json({ detail: "Link önizleme alınamadı" });
    }
  }
});

// ---------------------------------------------------------------------------
// Reminders Endpoints
// ---------------------------------------------------------------------------
api.get("/reminders/upcoming", authMiddleware, async (req: AuthRequest, res: Response) => {
  const userId = req.user!.userId;
  try {
    const list = await db.select().from(reminders).where(and(eq(reminders.userId, userId), eq(reminders.fired, false)));
    res.json(list.map((r) => ({
      reminder_id: r.reminderId,
      user_id: r.userId,
      note_id: r.noteId,
      at: r.at.toISOString(),
      text: r.text,
      fired: r.fired,
      created_at: r.createdAt.toISOString(),
    })));
  } catch (err: any) {
    res.status(500).json({ detail: "Hatırlatmalar alınamadı", error: err.message });
  }
});

api.post("/reminders/:reminder_id/fire", authMiddleware, async (req: AuthRequest, res: Response) => {
  const userId = req.user!.userId;
  const remId = req.params.reminder_id;
  try {
    await db.update(reminders).set({ fired: true, firedAt: new Date() }).where(and(eq(reminders.reminderId, remId), eq(reminders.userId, userId)));
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ detail: "Hatırlatma güncellenemedi", error: err.message });
  }
});

app.get("/health", (_req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

app.use("/api", api);

// ---------------------------------------------------------------------------
// Production / Dev Server setup
// ---------------------------------------------------------------------------
async function startServer() {
  try {
    await initDatabaseSchema();
    await seedInitialData();
    await ensureKanbanTable();
    await backfillSlugs();
  } catch (err) {
    console.warn("Database initialization notice:", err);
  }

  if (isProduction) {
    const distPath = path.resolve(__dirname, "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res, next) => {
      if (req.path.startsWith("/api/")) {
        return next();
      }
      res.sendFile(path.resolve(distPath, "index.html"));
    });
  } else {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  }

  app.listen(PORT, HOST, () => {
    console.log(`Server listening on http://${HOST}:${PORT}`);
  });
}

startServer();
