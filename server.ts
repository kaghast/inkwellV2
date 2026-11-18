import dotenv from "dotenv";
dotenv.config();

import fs from "fs";
import crypto from "crypto";
import dns from "dns/promises";
import net from "net";
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
import { db, initDatabaseSchema, users, notes, tags, people, locations, categories, itemGroups, reminders, files, noteTypes, kanbanColumns, noteVersions, stickers, phrases, areas, googleIntegrations } from "./src/db/index";
import { generateTextEmbedding } from "./src/lib/embeddings";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = parseInt(process.env.PORT || "3000", 10);
const HOST = process.env.HOST || "0.0.0.0";
const isProduction = process.env.NODE_ENV === "production" || fs.existsSync(path.resolve(__dirname, "dist", "index.html"));

// Persistent storage directories for uploads and local data
const DATA_DIR = process.env.DATA_DIR || path.resolve(process.cwd(), ".data");
const UPLOADS_DIR = path.resolve(DATA_DIR, "uploads");
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

// JWT secret: never fall back to a hard-coded, publicly known value. If no
// JWT_SECRET is configured, generate a random one once and persist it in the
// data directory so sessions survive restarts.
function resolveJwtSecret(): string {
  const fromEnv = (process.env.JWT_SECRET || "").trim();
  if (fromEnv) return fromEnv;
  const secretFile = path.resolve(DATA_DIR, ".jwt_secret");
  try {
    if (fs.existsSync(secretFile)) {
      const stored = fs.readFileSync(secretFile, "utf8").trim();
      if (stored.length >= 32) return stored;
    }
    const generated = crypto.randomBytes(48).toString("hex");
    fs.writeFileSync(secretFile, generated, { mode: 0o600 });
    console.warn("[Auth] JWT_SECRET is not set; generated a random secret in the data directory.");
    return generated;
  } catch (e) {
    console.warn("[Auth] Could not persist generated JWT secret; sessions will reset on restart.", e);
    return crypto.randomBytes(48).toString("hex");
  }
}

const JWT_SECRET = resolveJwtSecret();
const ACCESS_TOKEN_MIN = 60 * 24; // 1 day
const REFRESH_TOKEN_DAYS = 7;

// Cookie SameSite policy. "lax" protects against CSRF; set COOKIE_SAMESITE=none
// only when the frontend is served from a different site than the API.
const COOKIE_SAMESITE: "lax" | "strict" | "none" = (() => {
  const v = (process.env.COOKIE_SAMESITE || "lax").toLowerCase();
  return v === "none" || v === "strict" ? v : "lax";
})();

app.disable("x-powered-by");

// CORS: only same-origin requests and explicitly allow-listed origins
// (comma separated CORS_ORIGINS) may make credentialed cross-origin calls.
const CORS_ORIGINS = (process.env.CORS_ORIGINS || "")
  .split(",")
  .map((s) => s.trim().replace(/\/+$/, ""))
  .filter(Boolean);

function isAllowedOrigin(origin: string | undefined, req: Request): boolean {
  if (!origin) return true;
  if (CORS_ORIGINS.includes("*")) return false; // wildcard + credentials is never allowed
  if (CORS_ORIGINS.includes(origin)) return true;
  try {
    const host = (req.headers["x-forwarded-host"] as string) || req.headers.host || "";
    return new URL(origin).host === host.split(",")[0].trim();
  } catch {
    return false;
  }
}

app.use(
  cors((req, cb) => {
    const origin = req.headers.origin;
    const allowed = isAllowedOrigin(origin, req as Request);
    cb(null, {
      origin: allowed ? origin || false : false,
      credentials: true,
      methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
      allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With", "X-Session-ID"],
    });
  })
);

app.use((_req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  next();
});

app.use(express.json({ limit: "25mb" }));
app.use(cookieParser());

function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// JSON.stringify output that is safe to embed inside an inline <script>.
function jsonForScript(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .split(String.fromCharCode(0x2028)).join("\\u2028")
    .split(String.fromCharCode(0x2029)).join("\\u2029");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Multer in-memory storage for file uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 }, // 25MB
});

function genId(prefix: string): string {
  // Cryptographically random IDs: some IDs (e.g. file IDs) act as unguessable URLs.
  return `${prefix}_${crypto.randomBytes(8).toString("hex")}${Date.now().toString(36).substring(4)}`;
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

async function saveNoteVersion(
  userId: string,
  noteId: string,
  noteData: {
    title?: string;
    content?: string;
    date?: string;
    tags?: string[];
    people?: string[];
    custom_fields?: Record<string, any>;
    customFields?: Record<string, any>;
    is_encrypted?: boolean;
    isEncrypted?: boolean;
    password_hash?: string | null;
    passwordHash?: string | null;
  },
  changeSummary = "Değişiklik yapıldı"
) {
  try {
    const existingVersions = await db
      .select({ versionNumber: noteVersions.versionNumber })
      .from(noteVersions)
      .where(and(eq(noteVersions.noteId, noteId), eq(noteVersions.userId, userId)))
      .orderBy(desc(noteVersions.versionNumber))
      .limit(1);

    const nextVer = (existingVersions[0]?.versionNumber || 0) + 1;
    const versionId = genId("ver");

    await db.insert(noteVersions).values({
      versionId,
      noteId,
      userId,
      versionNumber: nextVer,
      title: noteData.title || "",
      content: noteData.content || "",
      date: noteData.date || new Date().toISOString(),
      tags: noteData.tags || [],
      people: noteData.people || [],
      customFields: noteData.customFields || noteData.custom_fields || {},
      changeSummary,
      isEncrypted: Boolean(noteData.isEncrypted || noteData.is_encrypted),
      passwordHash: noteData.passwordHash !== undefined ? noteData.passwordHash : (noteData.password_hash || null),
      createdAt: new Date(),
    });
  } catch (e) {
    console.error("Failed to save note version in db:", e);
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

function extractNoteDates(note: { date?: string | null; content?: string | null }): string[] {
  const dates = new Set<string>();
  if (note.date) {
    dates.add(note.date.slice(0, 10));
  }
  if (note.content) {
    const matches = note.content.matchAll(/<!--\s*comment:id=[^,]+,(?:author=[^,]+,)?date=([^,>]+)/gi);
    for (const match of matches) {
      if (match[1]) {
        const d = match[1].trim().slice(0, 10);
        if (d && /^\d{4}-\d{2}-\d{2}$/.test(d)) {
          dates.add(d);
        }
      }
    }
  }
  return Array.from(dates);
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
    sameSite: COOKIE_SAMESITE,
    path: "/",
  };
  res.cookie("access_token", accessToken, { ...cookieOpts, maxAge: ACCESS_TOKEN_MIN * 60 * 1000 });
  res.cookie("refresh_token", refreshToken, { ...cookieOpts, maxAge: REFRESH_TOKEN_DAYS * 24 * 60 * 60 * 1000 });
}

function clearAuthCookies(res: Response) {
  const cookieOpts = {
    httpOnly: true,
    secure: true,
    sameSite: COOKIE_SAMESITE,
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
    const adminId = "user_admin_inkwell";

    const existing = await db.select().from(users).where(eq(users.userId, adminId)).limit(1);
    if (existing.length === 0) {
      // Never seed a publicly known default password in production.
      let adminPass = process.env.ADMIN_PASSWORD || "";
      if (!adminPass) {
        if (process.env.NODE_ENV === "production") {
          adminPass = crypto.randomBytes(12).toString("base64url");
          console.warn(`[Seed] ADMIN_PASSWORD not set. Generated one-time admin password for ${adminEmail}: ${adminPass}`);
        } else {
          adminPass = "admin12345";
        }
      }
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
            sameSite: COOKIE_SAMESITE,
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
    const [userNotes, userTags, userPeople, userLocations, userGroups, userCategories, userReminders, userNoteTypes, userAreas] = await Promise.all([
      db.select().from(notes).where(eq(notes.userId, userId)).orderBy(desc(notes.createdAt)),
      db.select().from(tags).where(eq(tags.userId, userId)),
      db.select().from(people).where(eq(people.userId, userId)),
      db.select().from(locations).where(eq(locations.userId, userId)),
      db.select().from(itemGroups).where(eq(itemGroups.userId, userId)),
      db.select().from(categories).where(eq(categories.userId, userId)),
      db.select().from(reminders).where(eq(reminders.userId, userId)),
      db.select().from(noteTypes).where(eq(noteTypes.userId, userId)),
      db.select().from(areas).where(eq(areas.userId, userId)),
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
        areasCount: userAreas.length,
      },
      data: {
        areas: (userAreas as AreaRow[]).map((a) => ({
          area_id: a.areaId,
          parent_id: a.parentId || null,
          name: a.name,
          description: a.description || null,
          color: a.color || null,
          order_index: a.orderIndex,
          archived: Boolean(a.archived),
          created_at: a.createdAt.toISOString(),
        })),
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
          area_ids: n.areaIds || [],
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

  const { notes: inNotes = [], tags: inTags = [], people: inPeople = [], locations: inLocations = [], groups: inGroups = [], categories: inCategories = [], reminders: inReminders = [], note_types: inNoteTypes = [], areas: inAreas = [] } = backup.data;

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
      await db.delete(areas).where(eq(areas.userId, userId));
    }

    // 0a. Restore Areas (ids are kept so notes' area_ids stay valid)
    for (const a of Array.isArray(inAreas) ? inAreas : []) {
      if (!a || typeof a.name !== "string" || !a.name.trim()) continue;
      const aId = typeof a.area_id === "string" && a.area_id ? a.area_id : genId("area");
      const taken = await db.select().from(areas).where(eq(areas.areaId, aId)).limit(1);
      if (taken.length === 0) {
        await db.insert(areas).values({
          areaId: aId,
          userId,
          parentId: typeof a.parent_id === "string" ? a.parent_id : null,
          name: a.name.trim().slice(0, 80),
          description: a.description || null,
          color: a.color || null,
          orderIndex: Number(a.order_index) || 0,
          archived: Boolean(a.archived),
        });
      }
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
          areaIds: await sanitizeAreaIds(userId, n.area_ids),
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
          ...(Array.isArray(n.area_ids) ? { areaIds: await sanitizeAreaIds(userId, n.area_ids) } : {}),
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

function parseEmbedding(raw: unknown): number[] | null {
  let arr: unknown = raw;
  if (typeof raw === "string") {
    try {
      arr = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (!Array.isArray(arr) || arr.length === 0) return null;
  const nums = arr.map(Number);
  return nums.every((v) => Number.isFinite(v)) ? nums : null;
}

function cosineSimilarity(a: number[], b: number[]): number {
  const len = Math.min(a.length, b.length);
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < len; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

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
          // Parenthesised so the OR cannot escape the user_id filter
          // (otherwise title matches from other users' notes would leak).
          sql`(${notes.content} ILIKE ${`%${q}%`} OR ${notes.title} ILIKE ${`%${q}%`})`
        )
      );
      return res.json(textMatches);
    }

    // Cosine similarity computed in Node: the embedding column is stored as TEXT
    // (see initDatabaseSchema), so the pgvector `<=>` operator is not available.
    const userNotes = await db.select().from(notes).where(eq(notes.userId, userId));
    const results = userNotes
      .map((n: typeof notes.$inferSelect) => {
        const vec = parseEmbedding(n.embedding);
        if (!vec) return null;
        return {
          note_id: n.noteId,
          user_id: n.userId,
          title: n.title,
          content: n.content,
          date: n.date,
          tags: n.tags,
          people: n.people,
          category_id: n.categoryId,
          location_id: n.locationId,
          pinned: n.pinned,
          created_at: n.createdAt,
          updated_at: n.updatedAt,
          similarity: cosineSimilarity(queryEmbedding, vec),
        };
      })
      .filter((r: any): r is NonNullable<typeof r> => r !== null)
      .sort((a: any, b: any) => b.similarity - a.similarity)
      .slice(0, 10);

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

    // Accounts without a local password (e.g. created via Google) must sign in
    // with their provider. Setting a password here would let anyone who knows
    // the e-mail address take over the account.
    if (!user.passwordHash) {
      return res.status(401).json({ detail: "Bu hesap Google ile oluşturulmuş. Lütfen Google ile giriş yapın." });
    }
    if (!bcrypt.compareSync(String(password), user.passwordHash)) {
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

  // Do not mint a session for an unverified session id: without a verified
  // e-mail from the auth provider there is no identity to sign in as.
  if (!email) {
    return res.status(401).json({ detail: "Google oturumu doğrulanamadı" });
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
  // Calendar connections reuse this callback URL; their state is a signed token.
  const gcalState = readGcalState(req.query.state);
  if (gcalState) return handleGcalCallback(req, res, gcalState);

  const { code, error } = req.query;
  if (error) {
    return res.send(`
      <!DOCTYPE html>
      <html>
        <body>
          <script>
            if (window.opener) {
              window.opener.postMessage({ type: 'OAUTH_AUTH_ERROR', error: ${jsonForScript(String(error))} }, window.location.origin);
              window.close();
            } else {
              window.location.href = '/login?error=' + encodeURIComponent(${jsonForScript(String(error))});
            }
          </script>
          <p>Giriş iptal edildi veya bir hata oluştu: ${escapeHtml(error)}</p>
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
            const user = ${jsonForScript(userOutWithToken)};
            if (window.opener) {
              // Only deliver the token to a window on our own origin.
              window.opener.postMessage({ type: 'OAUTH_AUTH_SUCCESS', user }, window.location.origin);
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
              window.opener.postMessage({ type: 'OAUTH_AUTH_ERROR', error: ${jsonForScript(String(errMsg))} }, window.location.origin);
              window.close();
            } else {
              window.location.href = '/login?error=' + encodeURIComponent(${jsonForScript(String(errMsg))});
            }
          </script>
          <p>Google ile giriş yapılırken bir hata oluştu: ${escapeHtml(errMsg)}</p>
        </body>
      </html>
    `);
  }
}

// ---------------------------------------------------------------------------
// Google Calendar integration (Settings > Google Takvim)
// The user consents once; the refresh token is kept server-side, encrypted,
// and access tokens are refreshed on demand. Disconnecting revokes it at Google.
// ---------------------------------------------------------------------------
const GCAL_SCOPES = ["openid", "email", "https://www.googleapis.com/auth/calendar.events.readonly"];
const GCAL_READ_SCOPE = "https://www.googleapis.com/auth/calendar.events.readonly";

function integrationKey(): Buffer {
  const material = process.env.INTEGRATION_ENCRYPTION_KEY || `inkwell-integrations:${JWT_SECRET}`;
  return crypto.createHash("sha256").update(material).digest();
}

function encryptSecret(plain: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", integrationKey(), iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString("base64")}:${tag.toString("base64")}:${enc.toString("base64")}`;
}

function decryptSecret(payload: string): string {
  const [v, iv, tag, enc] = payload.split(":");
  if (v !== "v1" || !iv || !tag || !enc) throw new Error("Unknown secret format");
  const decipher = crypto.createDecipheriv("aes-256-gcm", integrationKey(), Buffer.from(iv, "base64"));
  decipher.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(enc, "base64")), decipher.final()]).toString("utf8");
}

function googleClientConfig() {
  return {
    clientId: process.env.GOOGLE_CLIENT_ID || process.env.VITE_GOOGLE_CLIENT_ID || "",
    clientSecret: process.env.GOOGLE_CLIENT_SECRET || "",
  };
}

/** Same callback URL as Google sign-in, so no extra redirect URI has to be registered. */
function googleCallbackUrl(req: Request): string {
  const host = req.headers["x-forwarded-host"] || req.headers.host || "localhost:3000";
  const proto = req.headers["x-forwarded-proto"] || (req.secure ? "https" : "http");
  return `${String(proto).split(",")[0].trim()}://${String(host).split(",")[0].trim()}/api/auth/google/callback`;
}

class GcalReconnectError extends Error {}

/** Returns a valid access token for the user's calendar, refreshing it when needed. */
async function getGcalAccessToken(userId: string, forceRefresh = false): Promise<string> {
  const rows = await db.select().from(googleIntegrations).where(eq(googleIntegrations.userId, userId)).limit(1);
  const row = rows[0];
  if (!row) throw new GcalReconnectError("Google Takvim bağlı değil");

  const expiresAt = row.accessTokenExpiresAt ? new Date(row.accessTokenExpiresAt).getTime() : 0;
  if (!forceRefresh && row.accessToken && expiresAt - Date.now() > 60_000) return row.accessToken;

  const { clientId, clientSecret } = googleClientConfig();
  let refreshToken: string;
  try {
    refreshToken = decryptSecret(row.refreshTokenEnc);
  } catch {
    // Key changed (e.g. JWT_SECRET rotated): the stored token is unusable.
    await db.delete(googleIntegrations).where(eq(googleIntegrations.userId, userId));
    throw new GcalReconnectError("Google Takvim bağlantısı yenilenmeli");
  }

  try {
    const tokenRes = await axios.post(
      "https://oauth2.googleapis.com/token",
      new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken,
        grant_type: "refresh_token",
      }).toString(),
      { headers: { "Content-Type": "application/x-www-form-urlencoded" }, timeout: 10000 }
    );
    const { access_token, expires_in } = tokenRes.data || {};
    if (!access_token) throw new Error("No access token");
    await db
      .update(googleIntegrations)
      .set({
        accessToken: access_token,
        accessTokenExpiresAt: new Date(Date.now() + (Number(expires_in) || 3600) * 1000),
        updatedAt: new Date(),
      })
      .where(eq(googleIntegrations.userId, userId));
    return access_token;
  } catch (err: any) {
    if (err?.response?.data?.error === "invalid_grant") {
      // Access was revoked in the Google account or the token expired.
      await db.delete(googleIntegrations).where(eq(googleIntegrations.userId, userId));
      throw new GcalReconnectError("Google Takvim erişimi geri alınmış; lütfen Ayarlar'dan yeniden bağlanın");
    }
    throw err;
  }
}

function gcalPopupResponse(res: Response, ok: boolean, message: string) {
  const payload = { type: ok ? "GCAL_CONNECTED" : "GCAL_ERROR", message };
  return res.send(`<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Google Takvim</title></head>
<body style="font-family:system-ui,sans-serif;padding:24px">
<p>${escapeHtml(message)}</p>
<script>
  (function () {
    var payload = ${jsonForScript(payload)};
    if (window.opener) {
      window.opener.postMessage(payload, window.location.origin);
      window.close();
    } else {
      window.location.href = '/settings?tab=integrations&gcal=' + (payload.type === 'GCAL_CONNECTED' ? 'connected' : 'error');
    }
  })();
</script>
</body></html>`);
}

/** Handles Google's redirect when the OAuth state belongs to a calendar connection. */
/** The Inkwell user of the browser session (cookies), if any. */
function sessionUserId(req: Request): string | null {
  for (const token of [req.cookies?.access_token, req.cookies?.refresh_token]) {
    if (!token) continue;
    try {
      const p = jwt.verify(token, JWT_SECRET) as any;
      if (p?.sub) return String(p.sub);
    } catch {
      /* try the next one */
    }
  }
  return null;
}

async function handleGcalCallback(req: Request, res: Response, state: { uid: string; redirectUri: string }) {
  // The browser finishing the flow must be signed in as the user who started it,
  // so a connect link made by someone else cannot attach a calendar to their account.
  if (sessionUserId(req) !== state.uid) {
    return gcalPopupResponse(res, false, "Oturum doğrulanamadı. Lütfen Inkwell'e giriş yapıp Ayarlar'dan tekrar deneyin.");
  }
  const { code, error } = req.query;
  if (error) return gcalPopupResponse(res, false, "Google Takvim izni verilmedi.");
  if (!code || typeof code !== "string") return gcalPopupResponse(res, false, "Yetkilendirme kodu alınamadı.");

  const { clientId, clientSecret } = googleClientConfig();
  try {
    const tokenRes = await axios.post(
      "https://oauth2.googleapis.com/token",
      new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: state.redirectUri,
        grant_type: "authorization_code",
      }).toString(),
      { headers: { "Content-Type": "application/x-www-form-urlencoded" }, timeout: 10000 }
    );
    const { access_token, refresh_token, expires_in, scope } = tokenRes.data || {};
    const granted = String(scope || "");
    if (!granted.split(" ").includes(GCAL_READ_SCOPE)) {
      return gcalPopupResponse(res, false, "Takvim okuma izni verilmedi. Lütfen izin ekranında takvim kutusunu işaretleyin.");
    }

    const existing = await db.select().from(googleIntegrations).where(eq(googleIntegrations.userId, state.uid)).limit(1);
    if (!refresh_token && !existing[0]) {
      return gcalPopupResponse(res, false, "Google kalıcı erişim vermedi. Lütfen tekrar deneyin.");
    }

    let googleEmail: string | null = null;
    try {
      const profile = await axios.get("https://www.googleapis.com/oauth2/v2/userinfo", {
        headers: { Authorization: `Bearer ${access_token}` },
        timeout: 10000,
      });
      googleEmail = profile.data?.email || null;
    } catch {
      /* the e-mail is only shown in Settings */
    }

    const values = {
      googleEmail,
      accessToken: access_token,
      accessTokenExpiresAt: new Date(Date.now() + (Number(expires_in) || 3600) * 1000),
      scopes: granted,
      updatedAt: new Date(),
      ...(refresh_token ? { refreshTokenEnc: encryptSecret(refresh_token) } : {}),
    };
    if (existing[0]) {
      await db.update(googleIntegrations).set(values).where(eq(googleIntegrations.userId, state.uid));
    } else {
      await db.insert(googleIntegrations).values({
        userId: state.uid,
        refreshTokenEnc: encryptSecret(refresh_token),
        ...values,
      });
    }
    return gcalPopupResponse(res, true, "Google Takvim bağlandı. Bu pencere kapanabilir.");
  } catch (err: any) {
    console.error("Google Calendar connect error:", err?.response?.data || err?.message);
    return gcalPopupResponse(res, false, "Google Takvim bağlantısı kurulamadı.");
  }
}

/** If the OAuth state is a signed calendar-connection state, returns it. */
function readGcalState(raw: unknown): { uid: string; redirectUri: string } | null {
  if (typeof raw !== "string" || !raw.startsWith("eyJ")) return null;
  try {
    const p = jwt.verify(raw, JWT_SECRET) as any;
    if (p?.purpose === "gcal" && typeof p.uid === "string" && typeof p.redirectUri === "string") {
      return { uid: p.uid, redirectUri: p.redirectUri };
    }
  } catch {
    /* expired or not ours */
  }
  return null;
}

api.get("/integrations/google-calendar", authMiddleware, async (req: AuthRequest, res: Response) => {
  const { clientId, clientSecret } = googleClientConfig();
  const rows = await db
    .select({ email: googleIntegrations.googleEmail, connectedAt: googleIntegrations.connectedAt })
    .from(googleIntegrations)
    .where(eq(googleIntegrations.userId, req.user!.userId))
    .limit(1);
  res.json({
    configured: Boolean(clientId && clientSecret),
    connected: rows.length > 0,
    email: rows[0]?.email || null,
    connected_at: rows[0]?.connectedAt || null,
  });
});

api.post("/integrations/google-calendar/connect", authMiddleware, async (req: AuthRequest, res: Response) => {
  const { clientId, clientSecret } = googleClientConfig();
  if (!clientId || !clientSecret) {
    return res.status(503).json({ detail: "Google entegrasyonu sunucuda yapılandırılmamış (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET)." });
  }
  const redirectUri = googleCallbackUrl(req);
  const state = jwt.sign({ purpose: "gcal", uid: req.user!.userId, redirectUri }, JWT_SECRET, { expiresIn: "10m" });
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: GCAL_SCOPES.join(" "),
    access_type: "offline", // returns a refresh token
    prompt: "consent", // always issue a refresh token, even on reconnect
    include_granted_scopes: "true",
    state,
  });
  if (req.user!.email) params.set("login_hint", req.user!.email);
  res.json({ url: `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}` });
});

api.delete("/integrations/google-calendar", authMiddleware, async (req: AuthRequest, res: Response) => {
  const userId = req.user!.userId;
  const rows = await db.select().from(googleIntegrations).where(eq(googleIntegrations.userId, userId)).limit(1);
  if (rows[0]) {
    try {
      // Revoking the refresh token also invalidates its access tokens.
      const token = decryptSecret(rows[0].refreshTokenEnc);
      await axios.post("https://oauth2.googleapis.com/revoke", new URLSearchParams({ token }).toString(), {
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        timeout: 8000,
      });
    } catch {
      /* already revoked or unreachable: the local link is removed anyway */
    }
    await db.delete(googleIntegrations).where(eq(googleIntegrations.userId, userId));
  }
  res.json({ connected: false });
});

api.get("/integrations/google-calendar/events", authMiddleware, async (req: AuthRequest, res: Response) => {
  const timeMin = new Date(String(req.query.time_min || ""));
  const timeMax = new Date(String(req.query.time_max || ""));
  if (isNaN(timeMin.getTime()) || isNaN(timeMax.getTime()) || timeMax <= timeMin || timeMax.getTime() - timeMin.getTime() > 32 * 86400000) {
    return res.status(400).json({ detail: "Geçerli time_min / time_max gerekli (en fazla 32 gün)" });
  }
  try {
    const callGoogle = async (forceRefresh: boolean) => {
      const token = await getGcalAccessToken(req.user!.userId, forceRefresh);
      return axios.get("https://www.googleapis.com/calendar/v3/calendars/primary/events", {
        headers: { Authorization: `Bearer ${token}` },
        params: {
          timeMin: timeMin.toISOString(),
          timeMax: timeMax.toISOString(),
          singleEvents: true,
          orderBy: "startTime",
          maxResults: 100,
        },
        timeout: 10000,
      });
    };
    let data: any;
    try {
      ({ data } = await callGoogle(false));
    } catch (err: any) {
      // A rejected access token: refresh once and retry before asking the user.
      if (err?.response?.status !== 401) throw err;
      ({ data } = await callGoogle(true));
    }
    const items = Array.isArray(data?.items) ? data.items : [];
    res.json(
      items.map((item: any) => ({
        id: item.id,
        summary: item.summary || "İsimsiz Etkinlik",
        description: item.description,
        location: item.location,
        start: item.start || {},
        end: item.end || {},
        attendees: item.attendees,
        hangoutLink: item.hangoutLink,
        htmlLink: item.htmlLink,
        status: item.status,
      }))
    );
  } catch (err: any) {
    if (err instanceof GcalReconnectError) {
      return res.status(409).json({ detail: err.message, code: "reconnect_required" });
    }
    if (err?.response?.status === 401 || err?.response?.status === 403) {
      return res.status(409).json({ detail: "Google Takvim erişimi reddedildi; lütfen Ayarlar'dan yeniden bağlanın", code: "reconnect_required" });
    }
    res.status(502).json({ detail: "Google Takvim etkinlikleri alınamadı" });
  }
});

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
  if (!type || !["tags", "people", "locations", "categories", "stickers", "phrases"].includes(type)) {
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
    await db.update(stickers).set({ groupId: null }).where(and(eq(stickers.groupId, groupId), eq(stickers.userId, userId)));
    await db.update(phrases).set({ groupId: null }).where(and(eq(phrases.groupId, groupId), eq(phrases.userId, userId)));

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
    } else if (type === "stickers") {
      await db.update(stickers).set({ groupId: targetGroupId }).where(and(eq(stickers.stickerId, item_id), eq(stickers.userId, userId)));
    } else if (type === "phrases") {
      await db.update(phrases).set({ groupId: targetGroupId }).where(and(eq(phrases.phraseId, item_id), eq(phrases.userId, userId)));
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
// Areas (Alanlar) Endpoints — hierarchical, archivable knowledge areas
// ---------------------------------------------------------------------------
type AreaRow = typeof areas.$inferSelect;

function serializeArea(a: AreaRow, noteCount = 0) {
  return {
    area_id: a.areaId,
    user_id: a.userId,
    parent_id: a.parentId || null,
    name: a.name,
    description: a.description || "",
    color: a.color || null,
    order_index: a.orderIndex,
    archived: Boolean(a.archived),
    note_count: noteCount,
    created_at: a.createdAt.toISOString(),
    updated_at: a.updatedAt.toISOString(),
  };
}

/** Keeps only ids of areas that exist and belong to this user (deduplicated). */
async function sanitizeAreaIds(userId: string, raw: unknown): Promise<string[]> {
  if (!Array.isArray(raw)) return [];
  const wanted = Array.from(new Set(raw.filter((x): x is string => typeof x === "string" && x.length > 0)));
  if (wanted.length === 0) return [];
  const owned: AreaRow[] = await db.select().from(areas).where(eq(areas.userId, userId));
  const ownedIds = new Set(owned.map((a) => a.areaId));
  return wanted.filter((id) => ownedIds.has(id));
}

function collectDescendantIds(all: AreaRow[], rootId: string): string[] {
  const out: string[] = [];
  const stack = [rootId];
  while (stack.length) {
    const cur = stack.pop()!;
    for (const a of all) {
      if (a.parentId === cur && !out.includes(a.areaId)) {
        out.push(a.areaId);
        stack.push(a.areaId);
      }
    }
  }
  return out;
}

function collectAncestorIds(all: AreaRow[], startId: string): string[] {
  const byId = new Map(all.map((a) => [a.areaId, a]));
  const out: string[] = [];
  let cur = byId.get(startId)?.parentId || null;
  while (cur && !out.includes(cur)) {
    out.push(cur);
    cur = byId.get(cur)?.parentId || null;
  }
  return out;
}

async function areaNoteCounts(userId: string): Promise<Record<string, number>> {
  const rows: { areaIds: string[] | null }[] = await db
    .select({ areaIds: notes.areaIds })
    .from(notes)
    .where(eq(notes.userId, userId));
  const counts: Record<string, number> = {};
  for (const r of rows) {
    for (const id of r.areaIds || []) counts[id] = (counts[id] || 0) + 1;
  }
  return counts;
}

api.get("/areas", authMiddleware, async (req: AuthRequest, res: Response) => {
  const userId = req.user!.userId;
  try {
    const [rows, counts] = await Promise.all([
      db.select().from(areas).where(eq(areas.userId, userId)),
      areaNoteCounts(userId),
    ]);
    const list = (rows as AreaRow[])
      .sort((a, b) => a.orderIndex - b.orderIndex || a.name.localeCompare(b.name, "tr"))
      .map((a) => serializeArea(a, counts[a.areaId] || 0));
    res.json(list);
  } catch (err: any) {
    res.status(500).json({ detail: "Alanlar alınamadı", error: err.message });
  }
});

api.post("/areas", authMiddleware, async (req: AuthRequest, res: Response) => {
  const userId = req.user!.userId;
  const { name, parent_id, color, description } = req.body || {};
  const cleanName = typeof name === "string" ? name.trim() : "";
  if (!cleanName) {
    return res.status(400).json({ detail: "Alan adı zorunludur" });
  }
  if (cleanName.length > 80) {
    return res.status(400).json({ detail: "Alan adı en fazla 80 karakter olabilir" });
  }
  try {
    const all: AreaRow[] = await db.select().from(areas).where(eq(areas.userId, userId));
    let parentId: string | null = null;
    if (parent_id) {
      const parent = all.find((a) => a.areaId === parent_id);
      if (!parent) return res.status(404).json({ detail: "Üst alan bulunamadı" });
      parentId = parent.areaId;
    }
    const siblings = all.filter((a) => (a.parentId || null) === parentId);
    const areaId = genId("area");
    await db.insert(areas).values({
      areaId,
      userId,
      parentId,
      name: cleanName,
      description: typeof description === "string" ? description.trim() || null : null,
      color: typeof color === "string" && color ? color : null,
      orderIndex: siblings.length,
      archived: false,
    });
    const created = (await db.select().from(areas).where(eq(areas.areaId, areaId)).limit(1))[0];
    res.json(serializeArea(created, 0));
  } catch (err: any) {
    res.status(500).json({ detail: "Alan oluşturulamadı", error: err.message });
  }
});

api.put("/areas/:area_id", authMiddleware, async (req: AuthRequest, res: Response) => {
  const userId = req.user!.userId;
  const areaId = req.params.area_id;
  const { name, color, description, parent_id, order_index } = req.body || {};
  try {
    const all: AreaRow[] = await db.select().from(areas).where(eq(areas.userId, userId));
    const current = all.find((a) => a.areaId === areaId);
    if (!current) return res.status(404).json({ detail: "Alan bulunamadı" });

    const updateObj: any = { updatedAt: new Date() };
    if (name !== undefined) {
      const cleanName = String(name).trim();
      if (!cleanName) return res.status(400).json({ detail: "Alan adı boş olamaz" });
      if (cleanName.length > 80) return res.status(400).json({ detail: "Alan adı en fazla 80 karakter olabilir" });
      updateObj.name = cleanName;
    }
    if (color !== undefined) updateObj.color = color || null;
    if (description !== undefined) updateObj.description = description ? String(description).trim() : null;
    if (order_index !== undefined && Number.isFinite(Number(order_index))) updateObj.orderIndex = Number(order_index);
    if (parent_id !== undefined) {
      const newParent = parent_id || null;
      if (newParent) {
        if (newParent === areaId || collectDescendantIds(all, areaId).includes(newParent)) {
          return res.status(400).json({ detail: "Bir alan kendi alt alanının altına taşınamaz" });
        }
        if (!all.some((a) => a.areaId === newParent)) {
          return res.status(404).json({ detail: "Üst alan bulunamadı" });
        }
      }
      updateObj.parentId = newParent;
    }

    await db.update(areas).set(updateObj).where(and(eq(areas.areaId, areaId), eq(areas.userId, userId)));
    const updated = (await db.select().from(areas).where(eq(areas.areaId, areaId)).limit(1))[0];
    const counts = await areaNoteCounts(userId);
    res.json(serializeArea(updated, counts[areaId] || 0));
  } catch (err: any) {
    res.status(500).json({ detail: "Alan güncellenemedi", error: err.message });
  }
});

// Archive / unarchive. Archiving cascades to every sub-area; unarchiving also
// restores the sub-areas and any archived parents so the area becomes visible.
api.patch("/areas/:area_id/archive", authMiddleware, async (req: AuthRequest, res: Response) => {
  const userId = req.user!.userId;
  const areaId = req.params.area_id;
  try {
    const all: AreaRow[] = await db.select().from(areas).where(eq(areas.userId, userId));
    const current = all.find((a) => a.areaId === areaId);
    if (!current) return res.status(404).json({ detail: "Alan bulunamadı" });
    const archived = req.body?.archived !== undefined ? Boolean(req.body.archived) : !current.archived;

    const affected = [areaId, ...collectDescendantIds(all, areaId)];
    if (!archived) affected.push(...collectAncestorIds(all, areaId));

    for (const id of affected) {
      await db.update(areas).set({ archived, updatedAt: new Date() }).where(and(eq(areas.areaId, id), eq(areas.userId, userId)));
    }
    res.json({ ok: true, archived, affected_ids: affected });
  } catch (err: any) {
    res.status(500).json({ detail: "Alan arşiv durumu değiştirilemedi", error: err.message });
  }
});

// Permanent delete is only allowed for archived areas. Sub-areas move up to the
// deleted area's parent and notes simply lose the link (notes are never deleted).
api.delete("/areas/:area_id", authMiddleware, async (req: AuthRequest, res: Response) => {
  const userId = req.user!.userId;
  const areaId = req.params.area_id;
  try {
    const found = await db.select().from(areas).where(and(eq(areas.areaId, areaId), eq(areas.userId, userId))).limit(1);
    if (found.length === 0) return res.status(404).json({ detail: "Alan bulunamadı" });
    const current: AreaRow = found[0];
    if (!current.archived) {
      return res.status(400).json({ detail: "Silmeden önce alanı arşivleyin" });
    }

    await db.update(areas).set({ parentId: current.parentId || null, updatedAt: new Date() })
      .where(and(eq(areas.parentId, areaId), eq(areas.userId, userId)));

    const linked = await db.select({ noteId: notes.noteId, areaIds: notes.areaIds }).from(notes).where(eq(notes.userId, userId));
    for (const n of linked as { noteId: string; areaIds: string[] | null }[]) {
      if (n.areaIds && n.areaIds.includes(areaId)) {
        await db.update(notes).set({ areaIds: n.areaIds.filter((id) => id !== areaId) }).where(eq(notes.noteId, n.noteId));
      }
    }

    await db.delete(areas).where(and(eq(areas.areaId, areaId), eq(areas.userId, userId)));
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ detail: "Alan silinemedi", error: err.message });
  }
});

// Link / unlink areas on a note without creating a new note version.
// Allowed for archived notes too: it only changes organisation metadata.
api.patch("/notes/:note_id/areas", authMiddleware, async (req: AuthRequest, res: Response) => {
  const userId = req.user!.userId;
  const identifier = req.params.note_id;
  try {
    const found = await db.select().from(notes).where(
      and(or(eq(notes.noteId, identifier), eq(notes.slug, identifier)), eq(notes.userId, userId))
    ).limit(1);
    if (found.length === 0) return res.status(404).json({ detail: "Not bulunamadı" });
    const current = found[0];

    let next: string[] = Array.isArray(current.areaIds) ? [...current.areaIds] : [];
    const { area_ids, add, remove } = req.body || {};
    if (Array.isArray(area_ids)) next = area_ids;
    if (typeof add === "string") next.push(add);
    if (typeof remove === "string") next = next.filter((id) => id !== remove);
    const clean = await sanitizeAreaIds(userId, next);

    await db.update(notes).set({ areaIds: clean }).where(eq(notes.noteId, current.noteId));
    res.json({ note_id: current.noteId, area_ids: clean });
  } catch (err: any) {
    res.status(500).json({ detail: "Not alanları güncellenemedi", error: err.message });
  }
});

// ---------------------------------------------------------------------------
// Link titles: turn bare URLs in a note into [Page title](url) markdown links.
// ---------------------------------------------------------------------------
const BARE_URL_RE = /https?:\/\/[^\s<>()\[\]]+[^\s<>()\[\].,:;"'!?*_~]/g;

function isEmbedLink(url: string): boolean {
  return /(?:youtube\.com\/watch|youtu\.be\/|youtube\.com\/shorts|maps\.google\.|google\.[a-z.]+\/maps|goo\.gl\/maps|maps\.app\.goo\.gl)/i.test(url);
}

interface BareLink {
  line: number;
  start: number;
  end: number;
  url: string;
}

/** Finds URLs that have no title yet: raw URLs, <url> autolinks and [url](url) links. Code is skipped. */
function findBareLinks(markdown: string): BareLink[] {
  const out: BareLink[] = [];
  const lines = markdown.split("\n");
  let fence: string | null = null;
  const blank = (s: string) => " ".repeat(s.length);
  const plain = (s: string) => s.replace(/^https?:\/\//i, "").replace(/\/$/, "");

  lines.forEach((line, lineNo) => {
    const t = line.trim();
    const f = t.match(/^(```|~~~)/);
    if (f) {
      if (!fence) fence = f[1];
      else if (t.startsWith(fence)) fence = null;
      return;
    }
    if (fence) return;

    // Hide inline code so URLs inside it are never touched
    let masked = line.replace(/`[^`]*`/g, blank);

    // [label](url) where the label is just the URL (or empty); images are left alone
    masked = masked.replace(/(!?)\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g, (m: string, bang: string, label: string, href: string, offset: number) => {
      const lbl = String(label).trim();
      if (!bang && /^https?:\/\//i.test(href) && (!lbl || plain(lbl) === plain(href))) {
        out.push({ line: lineNo, start: offset, end: offset + m.length, url: href });
      }
      return blank(m);
    });
    // <https://...> autolinks
    masked = masked.replace(/<(https?:\/\/[^>\s]+)>/g, (m: string, href: string, offset: number) => {
      out.push({ line: lineNo, start: offset, end: offset + m.length, url: href });
      return blank(m);
    });
    // HTML tags (and URLs in their attributes) are left alone
    masked = masked.replace(/<[^>]*>/g, blank);

    const re = new RegExp(BARE_URL_RE.source, "g");
    let m: RegExpExecArray | null;
    while ((m = re.exec(masked)) !== null) {
      const prev = masked[m.index - 1];
      if (prev && /["'=(]/.test(prev)) continue;
      out.push({ line: lineNo, start: m.index, end: m.index + m[0].length, url: m[0] });
    }
  });
  return out.filter((l) => !isEmbedLink(l.url));
}

function escapeLinkTitle(title: string): string {
  return title
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 150)
    .replace(/([\\`*_\[\]<>#@|~])/g, "\\$1");
}

/** Returns the content with page titles filled in, or null when nothing could be titled. */
async function addLinkTitles(content: string): Promise<string | null> {
  const marker = content.search(/<!--\s*inkwell:comments:start\s*-->/i);
  const main = marker >= 0 ? content.slice(0, marker) : content;
  const rest = marker >= 0 ? content.slice(marker) : "";

  const links = findBareLinks(main);
  if (links.length === 0) return null;
  const urls = [...new Set(links.map((l) => l.url))].slice(0, 8);
  const previews = await Promise.all(urls.map((u) => getLinkPreview(u).catch(() => null)));
  const titles = new Map<string, string>();
  previews.forEach((p, i) => {
    if (p && p.has_title && p.title.trim()) titles.set(urls[i], escapeLinkTitle(p.title));
  });
  if (titles.size === 0) return null;

  const lines = main.split("\n");
  // Replace from the end of each line so earlier offsets stay valid
  [...links]
    .sort((a, b) => b.line - a.line || b.start - a.start)
    .forEach((l) => {
      const title = titles.get(l.url);
      if (!title) return;
      const s = lines[l.line];
      lines[l.line] = s.slice(0, l.start) + `[${title}](${l.url})` + s.slice(l.end);
    });
  return lines.join("\n") + rest;
}

// Fills in page titles for the note's untitled links. This is formatting only, so
// no new version is created, and the write is skipped if the note changed meanwhile.
api.post("/notes/:note_id/link-titles", authMiddleware, async (req: AuthRequest, res: Response) => {
  const userId = req.user!.userId;
  const identifier = req.params.note_id;
  try {
    const found = await db.select().from(notes).where(
      and(or(eq(notes.noteId, identifier), eq(notes.slug, identifier)), eq(notes.userId, userId))
    ).limit(1);
    if (found.length === 0) return res.status(404).json({ detail: "Not bulunamadı" });
    const current = found[0];
    const before = current.content || "";
    if (current.archived || current.isEncrypted) {
      return res.json({ note_id: current.noteId, changed: false, content: before });
    }

    const next = await addLinkTitles(before);
    if (next === null || next === before) {
      return res.json({ note_id: current.noteId, changed: false, content: before });
    }
    const updated = await db
      .update(notes)
      .set({ content: next })
      .where(and(eq(notes.noteId, current.noteId), eq(notes.userId, userId), eq(notes.content, before)))
      .returning({ noteId: notes.noteId });
    const changed = updated.length > 0;
    res.json({ note_id: current.noteId, changed, content: changed ? next : before });
  } catch (err: any) {
    res.status(500).json({ detail: "Link başlıkları alınamadı", error: err.message });
  }
});

// ---------------------------------------------------------------------------
// Notes Endpoints (Backed by Cloud SQL + Vector Embeddings)
// ---------------------------------------------------------------------------
api.post("/notes", authMiddleware, async (req: AuthRequest, res: Response) => {
  const userId = req.user!.userId;
  const { title, content, date, location_id, category_id, note_type_id, custom_fields, created_at, slug, is_encrypted, password_hash } = req.body || {};
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
      areaIds: await sanitizeAreaIds(userId, req.body?.area_ids),
      pinned: false,
      archived: false,
      isEncrypted: Boolean(is_encrypted),
      passwordHash: password_hash || null,
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
    await saveNoteVersion(userId, noteId, inserted, "Not oluşturuldu (v1)");

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
      area_ids: inserted.areaIds || [],
      pinned: inserted.pinned,
      archived: inserted.archived || false,
      is_encrypted: Boolean(inserted.isEncrypted),
      password_hash: inserted.passwordHash || null,
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
    filter: rawFilter,
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
      area_ids: n.areaIds || [],
      pinned: n.pinned,
      archived: n.archived || false,
      is_encrypted: Boolean(n.isEncrypted),
      password_hash: n.passwordHash || null,
      created_at: n.createdAt.toISOString(),
      updated_at: n.updatedAt.toISOString(),
    }));

    if (date && typeof date === "string") {
      const targetDate = date.slice(0, 10);
      filtered = filtered.filter((n) => {
        const noteDates = extractNoteDates(n);
        return noteDates.includes(targetDate) || n.date.startsWith(date);
      });
    }

    if (category_id && typeof category_id === "string") {
      filtered = filtered.filter((n) => n.category_id === category_id);
    }

    const areaFilter = req.query.area_id;
    if (areaFilter && typeof areaFilter === "string") {
      filtered = filtered.filter((n) => Array.isArray(n.area_ids) && n.area_ids.includes(areaFilter));
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

    // Quick filter across all notes (incomplete tasks, completed tasks, reminders, images, pinned)
    if (rawFilter && typeof rawFilter === "string" && rawFilter !== "all") {
      if (rawFilter === "incomplete_tasks") {
        filtered = filtered.filter((n) => /(^|\n)\s*- \[ \]/m.test(n.content));
      } else if (rawFilter === "completed_tasks") {
        filtered = filtered.filter((n) => /(^|\n)\s*- \[[xX]\]/m.test(n.content));
      } else if (rawFilter === "with_reminders") {
        filtered = filtered.filter((n) => n.content.includes("```reminder"));
      } else if (rawFilter === "with_images") {
        filtered = filtered.filter((n) => /!\[[^\]]*\]\([^)]+\)/.test(n.content));
      } else if (rawFilter === "pinned_only") {
        filtered = filtered.filter((n) => Boolean(n.pinned));
      }
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
    const rows = await db.select().from(notes).where(eq(notes.userId, userId));

    const counts: Record<string, number> = {};
    for (const r of rows) {
      const dates = extractNoteDates(r);
      for (const d of dates) {
        if (d.startsWith(prefix)) {
          counts[d] = (counts[d] || 0) + 1;
        }
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
      area_ids: n.areaIds || [],
      pinned: n.pinned,
      archived: n.archived || false,
      is_encrypted: Boolean(n.isEncrypted),
      password_hash: n.passwordHash || null,
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

    const { title, content, date, location_id, category_id, note_type_id, custom_fields, created_at, slug, archived, is_encrypted, password_hash } = req.body || {};

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
    if (req.body?.area_ids !== undefined) {
      updateData.areaIds = await sanitizeAreaIds(userId, req.body.area_ids);
    }
    if (is_encrypted !== undefined) {
      updateData.isEncrypted = Boolean(is_encrypted);
    }
    if (password_hash !== undefined) {
      updateData.passwordHash = password_hash;
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
    const changeSummary = req.body?.change_summary || "Not içeriği güncellendi";
    await saveNoteVersion(userId, noteId, updated, changeSummary);

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
      area_ids: updated.areaIds || [],
      pinned: updated.pinned,
      archived: updated.archived || false,
      is_encrypted: Boolean(updated.isEncrypted),
      password_hash: updated.passwordHash || null,
      created_at: updated.createdAt.toISOString(),
      updated_at: updated.updatedAt.toISOString(),
    });
  } catch (err: any) {
    res.status(500).json({ detail: "Not güncellenemedi", error: err.message });
  }
});

api.get("/notes/:note_id/versions", authMiddleware, async (req: AuthRequest, res: Response) => {
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
    const noteId = found[0].noteId;

    const list = await db
      .select()
      .from(noteVersions)
      .where(and(eq(noteVersions.noteId, noteId), eq(noteVersions.userId, userId)))
      .orderBy(desc(noteVersions.versionNumber));

    res.json(
      list.map((v) => ({
        version_id: v.versionId,
        note_id: v.noteId,
        user_id: v.userId,
        version_number: v.versionNumber,
        title: v.title,
        content: v.content,
        date: v.date,
        tags: v.tags || [],
        people: v.people || [],
        custom_fields: v.customFields || {},
        change_summary: v.changeSummary,
        is_encrypted: Boolean(v.isEncrypted),
        password_hash: v.passwordHash || null,
        created_at: v.createdAt ? v.createdAt.toISOString() : new Date().toISOString(),
      }))
    );
  } catch (err: any) {
    res.status(500).json({ detail: "Versiyonlar yüklenemedi", error: err.message });
  }
});

api.post("/notes/:note_id/versions/:version_id/restore", authMiddleware, async (req: AuthRequest, res: Response) => {
  const userId = req.user!.userId;
  const identifier = req.params.note_id;
  const versionId = req.params.version_id;
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

    if (current.archived) {
      return res.status(403).json({ detail: "Arşivlenmiş notlar geri yüklenemez." });
    }

    const targetVer = (
      await db
        .select()
        .from(noteVersions)
        .where(
          and(
            eq(noteVersions.versionId, versionId),
            eq(noteVersions.noteId, noteId),
            eq(noteVersions.userId, userId)
          )
        )
        .limit(1)
    )[0];

    if (!targetVer) {
      return res.status(404).json({ detail: "Versiyon bulunamadı" });
    }

    const tagsArr = targetVer.tags || extractTags(targetVer.content);
    const peopleArr = targetVer.people || extractPeople(targetVer.content);
    const embedding = await generateTextEmbedding(`${targetVer.title}\n${targetVer.content}`);

    const updateData: any = {
      title: targetVer.title,
      content: targetVer.content,
      date: targetVer.date,
      tags: tagsArr,
      people: peopleArr,
      customFields: targetVer.customFields || {},
      isEncrypted: Boolean(targetVer.isEncrypted),
      passwordHash: targetVer.passwordHash || null,
      updatedAt: new Date(),
    };
    if (embedding) {
      updateData.embedding = embedding;
    }

    await db.update(notes).set(updateData).where(eq(notes.noteId, noteId));
    await syncReminders(userId, noteId, targetVer.content);

    const updated = (await db.select().from(notes).where(eq(notes.noteId, noteId)).limit(1))[0];
    await saveNoteVersion(userId, noteId, updated, `v${targetVer.versionNumber} versiyonuna geri dönüldü`);

    res.json({
      note_id: updated.noteId,
      user_id: updated.userId,
      slug: updated.slug,
      title: updated.title,
      content: updated.content,
      date: updated.date,
      tags: updated.tags || [],
      people: updated.people || [],
      category_id: updated.categoryId,
      location_id: updated.locationId,
      note_type_id: updated.noteTypeId || "type_plain",
      custom_fields: updated.customFields || {},
      area_ids: updated.areaIds || [],
      pinned: updated.pinned,
      archived: updated.archived || false,
      is_encrypted: Boolean(updated.isEncrypted),
      password_hash: updated.passwordHash || null,
      created_at: updated.createdAt.toISOString(),
      updated_at: updated.updatedAt.toISOString(),
    });
  } catch (err: any) {
    res.status(500).json({ detail: "Versiyona dönülemedi", error: err.message });
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
      area_ids: updated.areaIds || [],
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
      area_ids: updated.areaIds || [],
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
        const regex = new RegExp(`(?<!\\S)#${escapeRegExp(oldName)}(?!\\w)`, "gui");
        for (const n of userNotes) {
          if (n.tags && n.tags.includes(oldName)) {
            const newContent = n.content.replace(regex, () => `#${newName}`);
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
        const regex = new RegExp(`(?<!\\S)@${escapeRegExp(oldName)}(?!\\w)`, "gui");
        for (const n of userNotes) {
          if (n.people && n.people.includes(oldName)) {
            const newContent = n.content.replace(regex, () => `@${newName}`);
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
// Stickers, Icons & Emoji Endpoints
// ---------------------------------------------------------------------------
api.get("/stickers", authMiddleware, async (req: AuthRequest, res: Response) => {
  const userId = req.user!.userId;
  const q = req.query.q ? String(req.query.q).toLowerCase() : "";
  try {
    const items = await db.select().from(stickers).where(eq(stickers.userId, userId)).orderBy(desc(stickers.createdAt));
    let filtered = items.map((s: any) => ({
      sticker_id: s.stickerId,
      user_id: s.userId,
      name: s.name,
      content: s.content,
      type: s.type,
      group_id: s.groupId,
      created_at: s.createdAt ? new Date(s.createdAt).toISOString() : new Date().toISOString(),
    }));
    if (q) {
      filtered = filtered.filter((s: any) => s.name.toLowerCase().includes(q) || s.content.toLowerCase().includes(q));
    }
    res.json(filtered);
  } catch (err: any) {
    res.status(500).json({ detail: "Sticker ve emojiler alınamadı", error: err.message });
  }
});

api.post("/stickers", authMiddleware, async (req: AuthRequest, res: Response) => {
  const userId = req.user!.userId;
  const { name, content, type, group_id } = req.body || {};

  if (!name || !name.trim()) {
    return res.status(400).json({ detail: "Sticker veya emoji adı zorunludur" });
  }
  if (!content || !content.trim()) {
    return res.status(400).json({ detail: "İçerik (emoji / simge / sticker) zorunludur" });
  }

  const stickerId = genId("stk");
  try {
    await db.insert(stickers).values({
      stickerId,
      userId,
      name: name.trim(),
      content: content.trim(),
      type: type || "emoji",
      groupId: group_id || null,
    });
    const created = (await db.select().from(stickers).where(eq(stickers.stickerId, stickerId)).limit(1))[0];
    res.json({
      sticker_id: created.stickerId,
      user_id: created.userId,
      name: created.name,
      content: created.content,
      type: created.type,
      group_id: created.groupId,
      created_at: created.createdAt ? new Date(created.createdAt).toISOString() : new Date().toISOString(),
    });
  } catch (err: any) {
    res.status(500).json({ detail: "Sticker kaydedilemedi", error: err.message });
  }
});

api.put("/stickers/:sticker_id", authMiddleware, async (req: AuthRequest, res: Response) => {
  const userId = req.user!.userId;
  const stickerId = req.params.sticker_id;
  const { name, content, type, group_id } = req.body || {};

  try {
    const found = await db.select().from(stickers).where(and(eq(stickers.stickerId, stickerId), eq(stickers.userId, userId))).limit(1);
    if (found.length === 0) {
      return res.status(404).json({ detail: "Sticker bulunamadı" });
    }

    const updateObj: any = {};
    if (name !== undefined) updateObj.name = name.trim();
    if (content !== undefined) updateObj.content = content.trim();
    if (type !== undefined) updateObj.type = type;
    if (group_id !== undefined) updateObj.groupId = group_id || null;

    if (Object.keys(updateObj).length > 0) {
      await db.update(stickers).set(updateObj).where(eq(stickers.stickerId, stickerId));
    }

    const updated = (await db.select().from(stickers).where(eq(stickers.stickerId, stickerId)).limit(1))[0];
    res.json({
      sticker_id: updated.stickerId,
      user_id: updated.userId,
      name: updated.name,
      content: updated.content,
      type: updated.type,
      group_id: updated.groupId,
      created_at: updated.createdAt ? new Date(updated.createdAt).toISOString() : new Date().toISOString(),
    });
  } catch (err: any) {
    res.status(500).json({ detail: "Sticker güncellenemedi", error: err.message });
  }
});

api.delete("/stickers/:sticker_id", authMiddleware, async (req: AuthRequest, res: Response) => {
  const userId = req.user!.userId;
  const stickerId = req.params.sticker_id;
  try {
    await db.delete(stickers).where(and(eq(stickers.stickerId, stickerId), eq(stickers.userId, userId)));
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ detail: "Sticker silinemedi", error: err.message });
  }
});

// ---------------------------------------------------------------------------
// Keywords & Max 120-char Phrases Endpoints
// ---------------------------------------------------------------------------
api.get("/phrases", authMiddleware, async (req: AuthRequest, res: Response) => {
  const userId = req.user!.userId;
  const q = req.query.q ? String(req.query.q).toLowerCase() : "";
  try {
    const items = await db.select().from(phrases).where(eq(phrases.userId, userId)).orderBy(desc(phrases.createdAt));
    let filtered = items.map((p: any) => ({
      phrase_id: p.phraseId,
      user_id: p.userId,
      name: p.name,
      phrase: p.phrase,
      group_id: p.groupId,
      created_at: p.createdAt ? new Date(p.createdAt).toISOString() : new Date().toISOString(),
    }));
    if (q) {
      filtered = filtered.filter((p: any) => p.name.toLowerCase().includes(q) || p.phrase.toLowerCase().includes(q));
    }
    res.json(filtered);
  } catch (err: any) {
    res.status(500).json({ detail: "Cümle ve anahtar sözcükler alınamadı", error: err.message });
  }
});

api.post("/phrases", authMiddleware, async (req: AuthRequest, res: Response) => {
  const userId = req.user!.userId;
  const { name, phrase, group_id } = req.body || {};

  if (!name || !name.trim()) {
    return res.status(400).json({ detail: "Anahtar sözcük / başlık zorunludur" });
  }
  if (!phrase || !phrase.trim()) {
    return res.status(400).json({ detail: "Cümle metni zorunludur" });
  }
  if (phrase.trim().length > 120) {
    return res.status(400).json({ detail: "Cümle en fazla 120 karakter olabilir" });
  }

  const phraseId = genId("phr");
  try {
    await db.insert(phrases).values({
      phraseId,
      userId,
      name: name.trim(),
      phrase: phrase.trim(),
      groupId: group_id || null,
    });
    const created = (await db.select().from(phrases).where(eq(phrases.phraseId, phraseId)).limit(1))[0];
    res.json({
      phrase_id: created.phraseId,
      user_id: created.userId,
      name: created.name,
      phrase: created.phrase,
      group_id: created.groupId,
      created_at: created.createdAt ? new Date(created.createdAt).toISOString() : new Date().toISOString(),
    });
  } catch (err: any) {
    res.status(500).json({ detail: "Cümle kaydedilemedi", error: err.message });
  }
});

api.put("/phrases/:phrase_id", authMiddleware, async (req: AuthRequest, res: Response) => {
  const userId = req.user!.userId;
  const phraseId = req.params.phrase_id;
  const { name, phrase, group_id } = req.body || {};

  try {
    const found = await db.select().from(phrases).where(and(eq(phrases.phraseId, phraseId), eq(phrases.userId, userId))).limit(1);
    if (found.length === 0) {
      return res.status(404).json({ detail: "Cümle bulunamadı" });
    }

    if (phrase && phrase.trim().length > 120) {
      return res.status(400).json({ detail: "Cümle en fazla 120 karakter olabilir" });
    }

    const updateObj: any = {};
    if (name !== undefined) updateObj.name = name.trim();
    if (phrase !== undefined) updateObj.phrase = phrase.trim();
    if (group_id !== undefined) updateObj.groupId = group_id || null;

    if (Object.keys(updateObj).length > 0) {
      await db.update(phrases).set(updateObj).where(eq(phrases.phraseId, phraseId));
    }

    const updated = (await db.select().from(phrases).where(eq(phrases.phraseId, phraseId)).limit(1))[0];
    res.json({
      phrase_id: updated.phraseId,
      user_id: updated.userId,
      name: updated.name,
      phrase: updated.phrase,
      group_id: updated.groupId,
      created_at: updated.createdAt ? new Date(updated.createdAt).toISOString() : new Date().toISOString(),
    });
  } catch (err: any) {
    res.status(500).json({ detail: "Cümle güncellenemedi", error: err.message });
  }
});

api.delete("/phrases/:phrase_id", authMiddleware, async (req: AuthRequest, res: Response) => {
  const userId = req.user!.userId;
  const phraseId = req.params.phrase_id;
  try {
    await db.delete(phrases).where(and(eq(phrases.phraseId, phraseId), eq(phrases.userId, userId)));
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ detail: "Cümle silinemedi", error: err.message });
  }
});

// ---------------------------------------------------------------------------
// Geocode (Photon/OSM proxy)
// ---------------------------------------------------------------------------
const CACHE_MAX_ENTRIES = 500;
function cacheSet<V>(cache: Map<string, V>, key: string, value: V) {
  if (cache.size >= CACHE_MAX_ENTRIES && !cache.has(key)) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(key, value);
}

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

    cacheSet(geocodeCache, cacheKey, { timestamp: Date.now(), data: out });
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
  if (!file && req.body && typeof req.body.dataBase64 === "string" && req.body.dataBase64) {
    const fileId = genId("file");
    const mime = typeof req.body.contentType === "string" ? req.body.contentType : "image/png";
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

  const fileId = genId("file");
  const contentType = file.mimetype || "application/octet-stream";
  const filename = file.originalname || "attachment";

  try {
    // 1. Save to database
    await db.insert(files).values({
      fileId,
      userId: req.user!.userId,
      originalFilename: filename,
      contentType: contentType,
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
      filename: filename,
      url: `/api/files/${fileId}`,
      size: file.size,
      content_type: contentType,
    });
  } catch (err: any) {
    res.status(500).json({ detail: "Dosya veritabanına yüklenemedi", error: err.message });
  }
};

api.post(
  "/uploads/image",
  authMiddleware,
  upload.fields([{ name: "file", maxCount: 1 }, { name: "image", maxCount: 1 }]),
  handleImageUpload
);

api.post(
  "/uploads/file",
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

// Only these types are rendered inline; everything else (HTML, SVG, JS, ...)
// is forced to download so uploaded files cannot run script on our origin.
const INLINE_SAFE_TYPES = /^(image\/(png|jpe?g|gif|webp|avif|bmp|x-icon)|application\/pdf|audio\/[\w.+-]+|video\/[\w.+-]+|text\/plain)$/i;
const FILE_ID_RE = /^file_[a-z0-9]+$/i;

function setFileResponseHeaders(res: Response, contentType: string, filename: string) {
  const ct = (contentType || "application/octet-stream").split(";")[0].trim().toLowerCase();
  const inline = INLINE_SAFE_TYPES.test(ct);
  res.setHeader("Content-Type", inline ? ct : "application/octet-stream");
  res.setHeader(
    "Content-Disposition",
    `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(filename)}`
  );
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Content-Security-Policy", "default-src 'none'; img-src 'self' data:; media-src 'self'; style-src 'unsafe-inline'; sandbox");
  res.setHeader("Cache-Control", "private, max-age=86400, immutable");
}

api.get("/files/:file_id", async (req: Request, res: Response) => {
  const fileId = req.params.file_id;
  // Reject anything that is not a generated file id (prevents ../ path traversal).
  if (!FILE_ID_RE.test(fileId)) {
    return res.status(404).json({ detail: "File not found" });
  }
  try {
    const diskPath = path.resolve(UPLOADS_DIR, fileId);
    if (path.dirname(diskPath) !== UPLOADS_DIR) {
      return res.status(404).json({ detail: "File not found" });
    }

    const found = await db.select().from(files).where(and(eq(files.fileId, fileId), eq(files.isDeleted, false))).limit(1);
    if (found.length === 0) {
      return res.status(404).json({ detail: "File not found" });
    }
    const file = found[0];
    setFileResponseHeaders(res, file.contentType, file.originalFilename || fileId);

    // Serve from persistent volume when available
    if (fs.existsSync(diskPath)) {
      return res.sendFile(diskPath);
    }

    // Fallback: Read from database and populate persistent disk cache
    const buffer = Buffer.from(file.dataBase64, "base64");
    try {
      fs.writeFileSync(diskPath, buffer);
    } catch {
      /* ignore */
    }
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

// SSRF guard: link previews may only reach public internet hosts.
function isPrivateAddress(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number);
    return (
      a === 0 || a === 10 || a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 198 && (b === 18 || b === 19)) ||
      a >= 224
    );
  }
  const v6 = ip.toLowerCase();
  if (v6.startsWith("::ffff:")) return isPrivateAddress(v6.slice(7));
  return (
    v6 === "::" || v6 === "::1" ||
    v6.startsWith("fc") || v6.startsWith("fd") ||
    v6.startsWith("fe8") || v6.startsWith("fe9") || v6.startsWith("fea") || v6.startsWith("feb") ||
    v6.startsWith("ff")
  );
}

async function assertPublicHttpUrl(raw: string): Promise<URL> {
  const u = new URL(raw);
  if (u.protocol !== "http:" && u.protocol !== "https:") throw new Error("Unsupported protocol");
  if (u.username || u.password) throw new Error("Credentials in URL not allowed");
  const hostname = u.hostname.replace(/^\[|\]$/g, "");
  const addrs = net.isIP(hostname)
    ? [{ address: hostname }]
    : await dns.lookup(hostname, { all: true, verbatim: true });
  if (addrs.length === 0 || addrs.some((a) => isPrivateAddress(a.address))) {
    throw new Error("Host not allowed");
  }
  return u;
}

async function fetchPublicHtml(startUrl: string): Promise<string> {
  let current = startUrl;
  for (let hop = 0; hop <= 5; hop++) {
    await assertPublicHttpUrl(current);
    const response = await axios.get(current, {
      timeout: 6000,
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
      maxRedirects: 0, // redirects are followed manually so each hop is re-validated
      maxContentLength: 2 * 1024 * 1024,
      responseType: "text",
      validateStatus: (s) => s >= 200 && s < 400,
    });
    if (response.status >= 300 && response.headers.location) {
      current = new URL(String(response.headers.location), current).toString();
      continue;
    }
    return typeof response.data === "string" ? response.data : "";
  }
  throw new Error("Too many redirects");
}

function pickFavicon($: cheerio.CheerioAPI, pageUrl: string): string {
  const candidates = $("link[rel]")
    .toArray()
    .map((el) => ({ rel: String($(el).attr("rel") || "").toLowerCase(), href: String($(el).attr("href") || "").trim() }))
    .filter((l) => l.href && /(^|\s)(icon|apple-touch-icon)(\s|$)/.test(l.rel) && !l.rel.includes("mask-icon"));
  // Prefer a plain "icon" over the (usually larger) apple-touch icon
  const best = candidates.find((l) => /(^|\s)icon(\s|$)/.test(l.rel)) || candidates[0];
  try {
    if (best) {
      if (/^data:image\//i.test(best.href)) return best.href.length < 20000 ? best.href : "";
      const abs = new URL(best.href, pageUrl);
      if (abs.protocol === "http:" || abs.protocol === "https:") return abs.toString();
    }
    return new URL("/favicon.ico", pageUrl).toString();
  } catch {
    return "";
  }
}

interface LinkPreviewData {
  url: string;
  title: string;
  description: string;
  image: string;
  site_name: string;
  favicon: string;
  /** true when the page itself provided a title (not just the host name fallback). */
  has_title: boolean;
}

async function getLinkPreview(url: string): Promise<LinkPreviewData> {
  const cached = linkCache.get(url);
  if (cached && Date.now() - cached.timestamp < LINK_TTL) return cached.data;

  let hostname = "";
  try {
    hostname = new URL(url).hostname;
  } catch {
    throw new Error("Invalid URL");
  }

  try {
    const html = await fetchPublicHtml(url);
    const $ = cheerio.load(typeof html === "string" ? html : "");
    const getMeta = (prop: string, name?: string) =>
      $(`meta[property="${prop}"]`).attr("content") ||
      $(`meta[name="${name || prop}"]`).attr("content") ||
      "";
    const clean = (s: string) => (s || "").replace(/\s+/g, " ").trim();

    const pageTitle = clean(getMeta("og:title", "twitter:title") || $("title").first().text());
    const description = clean(getMeta("og:description", "description") || getMeta("twitter:description"));
    const image = getMeta("og:image", "twitter:image") || getMeta("og:image:url");
    let absoluteImage = "";
    if (image) {
      try {
        const u = new URL(image, url);
        if (u.protocol === "http:" || u.protocol === "https:") absoluteImage = u.toString();
      } catch {}
    }

    const data: LinkPreviewData = {
      url,
      title: (pageTitle || hostname).slice(0, 200),
      description: description.slice(0, 300),
      image: absoluteImage,
      site_name: clean(getMeta("og:site_name")) || hostname,
      favicon: pickFavicon($, url),
      has_title: Boolean(pageTitle),
    };
    cacheSet(linkCache, url, { timestamp: Date.now(), data });
    return data;
  } catch {
    // Unreachable or blocked host (e.g. a private address): show the host name only.
    // No favicon guess, so the browser is never pointed at an internal address.
    return { url, title: hostname, description: "", image: "", site_name: hostname, favicon: "", has_title: false };
  }
}

api.get("/link-preview", authMiddleware, async (req: AuthRequest, res: Response) => {
  const url = String(req.query.url || "").trim();
  if (!url || !/^https?:\/\//i.test(url)) {
    return res.status(400).json({ detail: "Valid HTTP(S) URL is required" });
  }
  try {
    return res.json(await getLinkPreview(url));
  } catch {
    return res.status(502).json({ detail: "Link önizleme alınamadı" });
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
    app.use(
      express.static(distPath, {
        setHeaders: (res, filePath) => {
          const name = path.basename(filePath);
          if (name === "sw.js" || name === "index.html" || name === "manifest.webmanifest" || name === "offline.html") {
            // Always revalidate: a stale worker or shell would pin users to an old release
            res.setHeader("Cache-Control", "no-cache");
          } else if (filePath.includes(`${path.sep}assets${path.sep}`)) {
            res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
          }
          if (name === "manifest.webmanifest") res.setHeader("Content-Type", "application/manifest+json");
        },
      })
    );
    app.get("*", (req, res, next) => {
      if (req.path.startsWith("/api/")) {
        return next();
      }
      res.setHeader("Cache-Control", "no-cache");
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
