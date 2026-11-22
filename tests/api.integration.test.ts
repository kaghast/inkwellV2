// End-to-end API checks against a running server.
// Run: INKWELL_BASE_URL=http://localhost:3088 INKWELL_ADMIN_PASSWORD=... npm run test:api
// Skipped when INKWELL_BASE_URL is not set. Creates its own throwaway user so
// it never touches existing accounts' data.
import { test, describe, before } from "node:test";
import assert from "node:assert/strict";

const BASE = process.env.INKWELL_BASE_URL;

class Client {
  cookie = "";
  constructor(private base: string) {}
  async req(method: string, path: string, body?: unknown) {
    const res = await fetch(`${this.base}/api${path}`, {
      method,
      headers: { "Content-Type": "application/json", ...(this.cookie ? { Cookie: this.cookie } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const set = res.headers.getSetCookie?.() || [];
    if (set.length) {
      const jar = new Map(this.cookie.split("; ").filter(Boolean).map((c) => c.split("=") as [string, string]));
      for (const c of set) {
        const [kv] = c.split(";");
        const [k, ...v] = kv.split("=");
        jar.set(k, v.join("="));
      }
      this.cookie = Array.from(jar.entries()).map(([k, v]) => `${k}=${v}`).join("; ");
    }
    const text = await res.text();
    let json: any = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = text;
    }
    return { status: res.status, body: json };
  }
}

async function register(base: string) {
  const c = new Client(base);
  const email = `it_${Date.now()}_${Math.random().toString(36).slice(2, 7)}@example.test`;
  const r = await c.req("POST", "/auth/register", { email, password: "it-password-123", name: "IT" });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return c;
}

async function waitFor<T>(fn: () => Promise<T | null>, ms = 15000): Promise<T> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const v = await fn();
    if (v) return v;
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error("timed out");
}

describe("Phase 1 API", { skip: !BASE }, () => {
  let a: Client;
  let b: Client;
  before(async () => {
    a = await register(BASE!);
    b = await register(BASE!);
  });

  test("new users get a personal workspace with a default space", async () => {
    const r = await a.req("GET", "/workspace");
    assert.equal(r.status, 200);
    assert.equal(r.body.role, "owner");
    assert.equal(r.body.spaces.length, 1);
    assert.equal(r.body.spaces[0].is_default, true);
  });

  test("object types include the built-in Object Types 2.0", async () => {
    const r = await a.req("GET", "/note-types");
    const ids = r.body.map((t: any) => t.type_id);
    for (const id of ["type_plain", "type_card", "type_paper", "type_meeting", "type_person", "type_project"]) assert.ok(ids.includes(id), id);
    const paper = r.body.find((t: any) => t.type_id === "type_paper");
    assert.ok(paper.fields.some((f: any) => f.id === "doi"));
    const del = await a.req("DELETE", "/note-types/type_paper");
    assert.equal(del.status, 400);
  });

  test("wikilinks become relations and backlinks, and follow edits", async () => {
    const target = (await a.req("POST", "/notes", { title: "Proje Atlas", content: "Ana proje #atlas" })).body;
    assert.ok(target.space_id, "new notes land in the default space");
    const src = (await a.req("POST", "/notes", { title: "Plan", content: "Bu hafta [[Proje Atlas]] üzerinde çalış" })).body;
    let rel = await a.req("GET", `/objects/${target.note_id}/relations`);
    assert.equal(rel.body.backlinks.length, 1);
    assert.equal(rel.body.backlinks[0].object.note_id, src.note_id);
    assert.equal(rel.body.backlinks[0].origin, "wikilink");
    const del = await a.req("DELETE", `/relations/${rel.body.backlinks[0].relation_id}`);
    assert.equal(del.status, 400, "wikilink relations are removed by editing the text");
    await a.req("PUT", `/notes/${src.note_id}`, { title: "Plan", content: "Bağlantı kaldırıldı" });
    rel = await a.req("GET", `/objects/${target.note_id}/relations`);
    assert.equal(rel.body.backlinks.length, 0);
  });

  test("typed manual relations, custom relation types and tenant isolation", async () => {
    const person = (await a.req("POST", "/notes", { title: "Ayşe Yılmaz", content: "", note_type_id: "type_person" })).body;
    const project = (await a.req("POST", "/notes", { title: "Kitap projesi", content: "", note_type_id: "type_project" })).body;
    const r = await a.req("POST", "/relations", { source_id: person.note_id, target_id: project.note_id, relation_type: "works_on" });
    assert.equal(r.status, 200);
    const rels = await a.req("GET", `/objects/${project.note_id}/relations`);
    assert.equal(rels.body.incoming[0].label, "üzerinde çalışan");
    const reserved = await a.req("POST", "/relations", { source_id: person.note_id, target_id: project.note_id, relation_type: "links_to" });
    assert.equal(reserved.status, 400);
    const custom = await a.req("POST", "/relation-types", { label: "mentor", inverse_label: "mentee" });
    assert.equal(custom.status, 200);
    const r2 = await a.req("POST", "/relations", { source_id: person.note_id, target_id: project.note_id, relation_type: custom.body.type_key });
    assert.equal(r2.status, 200);

    // Another user can neither read nor link to these objects
    assert.equal((await b.req("GET", `/objects/${project.note_id}/relations`)).status, 404);
    const own = (await b.req("POST", "/notes", { title: "B's note", content: "" })).body;
    assert.equal((await b.req("POST", "/relations", { source_id: own.note_id, target_id: project.note_id })).status, 404);
    assert.equal((await b.req("DELETE", `/relations/${r.body.relation_id}`)).status, 404);
    assert.equal((await b.req("POST", "/relations", { source_id: own.note_id, target_id: own.note_id, relation_type: custom.body.type_key })).status, 400);
    const spacesA = (await a.req("GET", "/spaces")).body;
    assert.equal((await b.req("PUT", `/spaces/${spacesA[0].space_id}`, { name: "hijack" })).status, 404);
    assert.equal((await b.req("PATCH", `/objects/${own.note_id}/space`, { space_id: spacesA[0].space_id })).status, 404);
    const search = await b.req("GET", "/search?q=Kitap");
    assert.equal(search.body.objects.length, 0);
  });

  test("capture → inbox → accept creates a typed, related object", async () => {
    await a.req("POST", "/notes", { title: "Proje Atlas", content: "#atlas" });
    const cap = await a.req("POST", "/capture", { text: "Yarın Ayşe ile Proje Atlas toplantısı\n- [ ] Sunumu hazırla\n#atlas" });
    assert.equal(cap.status, 200);
    assert.equal(cap.body.capture.status, "new");
    const ready = await waitFor(async () => {
      const r = await a.req("GET", "/inbox");
      const item = r.body.items.find((i: any) => i.capture_id === cap.body.capture.capture_id);
      return item && item.status === "ready" ? item : null;
    });
    assert.equal(ready.suggestion.type_id, "type_meeting");
    assert.deepEqual(ready.suggestion.tasks, ["Sunumu hazırla"]);
    assert.ok(ready.suggestion.tags.includes("atlas"));
    assert.equal(ready.suggestion.dates.length, 1);
    assert.ok(ready.suggestion.related.some((x: any) => /Proje Atlas/.test(x.reason)));

    const acc = await a.req("POST", `/inbox/${ready.capture_id}/accept`, { title: "Atlas toplantısı" });
    assert.equal(acc.status, 200, JSON.stringify(acc.body));
    const note = (await a.req("GET", `/notes/${acc.body.object_id}`)).body;
    assert.equal(note.title, "Atlas toplantısı");
    assert.equal(note.note_type_id, "type_meeting");
    const rels = (await a.req("GET", `/objects/${acc.body.object_id}/relations`)).body;
    assert.ok(rels.outgoing.some((r: any) => r.origin === "capture"));
    const again = await a.req("POST", `/inbox/${ready.capture_id}/accept`, {});
    assert.equal(again.status, 409);
  });

  test("save without AI, reject and direct capture keep the raw text", async () => {
    const c1 = (await a.req("POST", "/capture", { text: "ham düşünce" })).body.capture;
    const raw = await a.req("POST", `/inbox/${c1.capture_id}/save-raw`);
    assert.equal(raw.status, 200);
    assert.equal((await a.req("GET", `/notes/${raw.body.object_id}`)).body.content, "ham düşünce");
    const c2 = (await a.req("POST", "/capture", { text: "istemiyorum" })).body.capture;
    await waitFor(async () => ((await a.req("GET", "/inbox")).body.items.find((i: any) => i.capture_id === c2.capture_id)?.status === "ready" ? true : null));
    const rej = await a.req("POST", `/inbox/${c2.capture_id}/reject`);
    assert.equal(rej.body.capture.resolution, "rejected");
    assert.equal(rej.body.capture.raw_text, "istemiyorum");
    const direct = await a.req("POST", "/capture", { text: "Süt al", mode: "direct", type_id: "type_card" });
    const card = (await a.req("GET", `/notes/${direct.body.object_id}`)).body;
    assert.equal(card.note_type_id, "type_card");
    assert.equal(card.custom_fields.kanban_column, "todo");
    assert.equal((await a.req("POST", "/capture", { text: "   " })).status, 400);
    assert.equal((await b.req("POST", `/inbox/${c1.capture_id}/reject`)).status, 404);
  });

  test("Today creates one daily note and links that day's captures to it", async () => {
    const d1 = (await a.req("POST", "/today/daily-note", {})).body;
    const d2 = (await a.req("POST", "/today/daily-note", {})).body;
    assert.equal(d1.note_id, d2.note_id);
    assert.equal(d2.created, false);
    const c = (await a.req("POST", "/capture", { text: "günün fikri", mode: "direct" })).body;
    const rels = (await a.req("GET", `/objects/${d1.note_id}/relations`)).body;
    assert.ok(rels.outgoing.some((r: any) => r.relation_type === "captured_on" && r.object.note_id === c.object_id));
    const t = (await a.req("GET", "/today")).body;
    assert.equal(t.daily_note.note_id, d1.note_id);
    assert.ok(t.captures.length >= 1);
    assert.ok(t.tasks.some((x: any) => typeof x.task_index === "number"));
  });

  test("templates create connected objects and reuse existing people", async () => {
    const m = await a.req("POST", "/templates/meeting/apply", { title: "Haftalık senk", people: ["Ayşe Yılmaz", "Mehmet"], project: "Kitap projesi" });
    assert.equal(m.status, 200, JSON.stringify(m.body));
    assert.equal(m.body.relations, 3);
    assert.ok(m.body.reused.length >= 2, "existing person and project are reused");
    const rels = (await a.req("GET", `/objects/${m.body.primary_id}/relations`)).body;
    assert.equal(rels.incoming.filter((r: any) => r.relation_type === "attended").length, 2);
    const p = await a.req("POST", "/templates/project/apply", { title: "Site yenileme", tasks: ["Tasarım", "Geliştirme"] });
    assert.equal(p.body.created.length, 3);
    assert.equal((await a.req("POST", "/templates/nope/apply", {})).status, 404);
  });

  test("search ranks titles first and filters by type", async () => {
    const r = await a.req("GET", "/search?q=atlas");
    assert.equal(r.status, 200);
    assert.ok(r.body.objects.length >= 1);
    assert.match(r.body.objects[0].title, /atlas/i);
    const typed = await a.req("GET", "/search?q=atlas&type_id=type_meeting");
    assert.ok(typed.body.objects.every((o: any) => o.type_id === "type_meeting"));
  });

  test("spaces: create, move object, archive rules", async () => {
    const s = await a.req("POST", "/spaces", { name: "Araştırma", color: "#22c55e" });
    assert.equal(s.status, 200);
    const n = (await a.req("POST", "/notes", { title: "Okuma listesi", content: "", space_id: s.body.space_id })).body;
    assert.equal(n.space_id, s.body.space_id);
    const list = (await a.req("GET", `/notes?space_id=${s.body.space_id}`)).body;
    assert.equal(list.length, 1);
    const def = (await a.req("GET", "/workspace")).body.default_space_id;
    assert.equal((await a.req("PUT", `/spaces/${def}`, { archived: true })).status, 400);
    assert.equal((await a.req("PUT", `/spaces/${s.body.space_id}`, { archived: true })).status, 200);
    assert.equal((await a.req("POST", "/notes", { title: "x", content: "", space_id: s.body.space_id })).status, 400);
  });

  test("home reports activation progress from real data", async () => {
    const h = (await a.req("GET", "/home")).body;
    assert.ok(h.activation.objects >= 5);
    assert.ok(h.activation.relations >= 2);
    assert.ok(h.activation.captures >= 1);
    assert.equal(typeof h.inbox.open, "number");
    assert.equal(h.ai.provider, h.ai.is_model ? h.ai.provider : "heuristic");
  });

  test("validation errors do not leak internals", async () => {
    const r = await a.req("POST", "/relations", { source_id: 5 });
    assert.equal(r.status, 400);
    assert.equal(r.body.detail, "Geçersiz istek");
    assert.equal((await new Client(BASE!).req("GET", "/inbox")).status, 401);
  });
});
