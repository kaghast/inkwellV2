// Template plans: which objects and relations a template creates (pure).
import { CARD_TYPE_ID, DAILY_TYPE_ID } from "../../src/lib/objectTypes";

export interface TemplateInput {
  title?: string;
  date?: string;
  people?: string[];
  project?: string;
  tasks?: string[];
  questions?: string[];
  papers?: string[];
  goal?: string;
  space_id?: string | null;
}

interface PlannedObject {
  ref: string;
  title: string;
  type_id: string | null;
  content: string;
  custom_fields?: Record<string, any>;
  /** Reuse an existing object of this type with the same title instead of creating one. */
  reuse?: boolean;
}

interface PlannedRelation {
  from: string;
  to: string;
  type: string;
}

export interface TemplatePlan {
  objects: PlannedObject[];
  relations: PlannedRelation[];
  primary: string;
}

export const TEMPLATES = [
  { key: "daily", name: "Günlük not", description: "Bugünün notu: plan, notlar, yansıma", fields: ["date"] },
  { key: "meeting", name: "Toplantı", description: "Toplantı + katılımcı kişiler + bağlı proje", fields: ["title", "date", "people", "project"] },
  { key: "project", name: "Proje", description: "Proje + görev kartları", fields: ["title", "goal", "tasks"] },
  { key: "research", name: "Araştırma", description: "Araştırma projesi + sorular + makaleler", fields: ["title", "questions", "papers"] },
] as const;

export type TemplateKey = (typeof TEMPLATES)[number]["key"];

const clean = (list?: string[]) => Array.from(new Set((list || []).map((s) => s.trim()).filter(Boolean))).slice(0, 30);

export function dailyContent(date: string): string {
  return `## Plan\n\n## Notlar\n\n## Yansıma\n- Bugün ne iyi gitti?\n- Neyi farklı yapardım?\n`;
}

export function planTemplate(key: TemplateKey, input: TemplateInput, today: string): TemplatePlan {
  const date = input.date && /^\d{4}-\d{2}-\d{2}$/.test(input.date) ? input.date : today;
  switch (key) {
    case "daily":
      return { objects: [{ ref: "daily", title: `Günlük not · ${date}`, type_id: DAILY_TYPE_ID, content: dailyContent(date) }], relations: [], primary: "daily" };
    case "meeting": {
      const title = input.title?.trim() || `Toplantı · ${date}`;
      const people = clean(input.people);
      const objects: PlannedObject[] = [
        {
          ref: "meeting",
          title,
          type_id: "type_meeting",
          content: `## Gündem\n\n## Notlar\n\n## Kararlar\n\n## Aksiyonlar\n`,
        },
        ...people.map((p, i) => ({ ref: `person${i}`, title: p, type_id: "type_person", content: "", reuse: true })),
      ];
      const relations: PlannedRelation[] = people.map((_, i) => ({ from: `person${i}`, to: "meeting", type: "attended" }));
      if (input.project?.trim()) {
        objects.push({ ref: "project", title: input.project.trim(), type_id: "type_project", content: "", reuse: true, custom_fields: { status: "Devam ediyor" } });
        relations.push({ from: "meeting", to: "project", type: "part_of" });
      }
      return { objects, relations, primary: "meeting" };
    }
    case "project": {
      const title = input.title?.trim() || "Yeni proje";
      const tasks = clean(input.tasks);
      return {
        objects: [
          {
            ref: "project",
            title,
            type_id: "type_project",
            content: `## Hedef\n${input.goal?.trim() || ""}\n\n## Kapsam\n\n## Riskler\n\n## Günlük\n`,
            custom_fields: { status: "Planlanıyor", ...(input.goal?.trim() ? { goal: input.goal.trim() } : {}) },
          },
          ...tasks.map((t, i) => ({ ref: `task${i}`, title: t, type_id: CARD_TYPE_ID, content: `Proje: [[${title}]]`, custom_fields: { kanban_column: "todo" } })),
        ],
        relations: tasks.map((_, i) => ({ from: `task${i}`, to: "project", type: "part_of" })),
        primary: "project",
      };
    }
    case "research": {
      const title = input.title?.trim() || "Yeni araştırma";
      const questions = clean(input.questions);
      const papers = clean(input.papers);
      return {
        objects: [
          {
            ref: "project",
            title,
            type_id: "type_project",
            content: `## Amaç\n\n## Yöntem\n\n## Bulgular\n\n## Açık sorular\n`,
            custom_fields: { status: "Devam ediyor" },
          },
          {
            ref: "questions",
            title: `${title} · Araştırma soruları`,
            type_id: null,
            content: questions.length ? questions.map((q) => `- [ ] ${q}`).join("\n") : "",
          },
          ...papers.map((p, i) => ({ ref: `paper${i}`, title: p, type_id: "type_paper", content: "", reuse: true, custom_fields: { reading_status: "Okunacak" } })),
        ],
        relations: [
          { from: "questions", to: "project", type: "part_of" },
          ...papers.map((_, i) => ({ from: `paper${i}`, to: "project", type: "part_of" })),
        ],
        primary: "project",
      };
    }
  }
}


// ---------------------------------------------------------------------------
// User-editable template text (Settings > Şablonlar)
// ---------------------------------------------------------------------------
export interface TemplateOverride {
  title_template?: string | null;
  content_template?: string | null;
}

export const PLACEHOLDERS = ["{{tarih}}", "{{başlık}}"] as const;

/** Fill {{tarih}} and {{başlık}} (also {{baslik}}). */
export function fillTemplate(text: string, vars: { date: string; title: string }): string {
  return (text || "").replace(/\{\{\s*tarih\s*\}\}/gi, vars.date).replace(/\{\{\s*ba[şs]l[ıi]k\s*\}\}/gi, vars.title);
}

/** The built-in defaults shown in Settings, as editable text. */
export function builtinDefaults(key: TemplateKey): { title_template: string; content_template: string } {
  const sample = planTemplate(key, { title: "{{başlık}}" }, "{{tarih}}");
  const primary = sample.objects.find((o) => o.ref === sample.primary)!;
  const title = key === "daily" ? "Günlük not · {{tarih}}" : key === "meeting" ? "Toplantı · {{tarih}}" : key === "project" ? "Yeni proje" : "Yeni araştırma";
  return { title_template: title, content_template: primary.content };
}

/** Apply a user's override to the primary object of a built-in plan. */
export function withOverride(plan: TemplatePlan, override: TemplateOverride | null, vars: { date: string; typedTitle?: string }): TemplatePlan {
  if (!override) return plan;
  return {
    ...plan,
    objects: plan.objects.map((o) => {
      if (o.ref !== plan.primary) return o;
      const title = vars.typedTitle?.trim() || (override.title_template ? fillTemplate(override.title_template, { date: vars.date, title: "" }).trim() : "") || o.title;
      const content = override.content_template != null ? fillTemplate(override.content_template, { date: vars.date, title }) : o.content;
      return { ...o, title, content };
    }),
  };
}
