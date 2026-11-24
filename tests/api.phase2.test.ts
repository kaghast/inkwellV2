// Phase 2 end-to-end checks: Ask Inkwell, AI actions, Graph 2.0.
// Run against a server started with AI_PROVIDER=mock (deterministic test model):
//   INKWELL_BASE_URL=http://localhost:3092 npm run test:api
// Without the mock provider only the "no model" behaviour is checked.
import { test, describe, before } from "node:test";
import assert from "node:assert/strict";

const BASE = process.env.INKWELL_BASE_URL;

async function client() {
  let cookie = "";
  const req = async (method: string, path: string, body?: unknown) => {
    const res = await fetch(`${BASE}/api${path}`, {
      method,
      headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const set = res.headers.getSetCookie?.() || [];
    if (set.length) cookie = set.map((c) => c.split(";")[0]).join("; ");
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null };
  };
  const email = `p2_${Date.now()}_${Math.random().toString(36).slice(2, 7)}@example.test`;
  const r = await req("POST", "/auth/register", { email, password: "it-password-123", name: "P2" });
  assert.equal(r.status, 200);
  return req;
}

describe("Phase 2 API", { skip: !BASE }, () => {
  let a: Awaited<ReturnType<typeof client>>;
  let b: Awaited<ReturnType<typeof client>>;
  let mock = false;
  const ids: Record<string, string> = {};

  before(async () => {
    a = await client();
    b = await client();
    mock = (await a("GET", "/home")).body.ai.provider === "mock";
    const mk = async (k: string, title: string, content: string, extra: Record<string, unknown> = {}) => {
      ids[k] = (await a("POST", "/notes", { title, content, ...extra })).body.note_id;
    };
    await mk("budget", "Atlas bütçe toplantısı", "Atlas projesinin bütçesi 40.000 TL olarak onaylandı. Teslim tarihi Mart sonu.\n\n- [ ] Tedarikçiyle görüş");
    await mk("design", "Atlas tasarım notları", "Arayüz için koyu tema seçildi. Bütçe kısıtı nedeniyle animasyonlar azaltıldı.");
    await mk("other", "Alışveriş listesi", "Süt, ekmek, peynir");
    await mk("secret", "Gizli Atlas planı", "Atlas için gizli bütçe detayı", { is_encrypted: true, password_hash: "x" });
    await mk("mush1", "Mantar yetiştirme", "miselyum substrat nem sıcaklık kontrolü ve havalandırma ".repeat(4));
    await mk("mush2", "Ekşi maya denemesi", "miselyum değil ama substrat gibi un, nem ve sıcaklık kontrolü fermantasyon ".repeat(4));
  });

  test("ask retrieves the user's own notes and never locked or foreign ones", async () => {
    const r = await a("POST", "/ask", { question: "Atlas bütçesi ne kadar?" });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const srcIds = r.body.sources.map((s: any) => s.note_id);
    assert.ok(srcIds.includes(ids.budget));
    assert.ok(!srcIds.includes(ids.secret), "locked notes are never retrieved");
    assert.ok(!srcIds.includes(ids.other));
    const foreign = await b("POST", "/ask", { question: "Atlas bütçesi ne kadar?" });
    assert.equal(foreign.body.sources.length, 0, "another user's notes are invisible");
    assert.equal(foreign.body.mode, "no_sources");
  });

  test("ask answers with validated citations (mock model) or sources only", async () => {
    const r = await a("POST", "/ask", { question: "Atlas bütçesi ne kadar?" });
    if (!mock) {
      assert.equal(r.body.mode, "sources_only");
      assert.equal(r.body.answer, null);
      return;
    }
    assert.equal(r.body.mode, "answer");
    assert.match(r.body.answer, /\[1\]/);
    assert.ok(r.body.citations.length >= 1);
    assert.equal(r.body.citations[0].note_id, r.body.sources[0].note_id);
  });

  test("ask filters restrict the scope", async () => {
    const r = await a("POST", "/ask", { question: "Atlas", filters: { date_from: "2099-01-01" } });
    assert.equal(r.body.sources.length, 0);
    const bad = await a("POST", "/ask", { question: "x" });
    assert.equal(bad.status, 400);
  });

  test("find_related works without a model and excludes the note itself", async () => {
    const r = await a("POST", `/objects/${ids.budget}/ai`, { action: "find_related" });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const rel = r.body.related.map((x: any) => x.note_id);
    assert.ok(rel.includes(ids.design));
    assert.ok(!rel.includes(ids.budget));
    assert.ok(!rel.includes(ids.secret));
  });

  test("model actions: summarize, tags; append creates a version", async () => {
    const r = await a("POST", `/objects/${ids.budget}/ai`, { action: "summarize" });
    if (!mock) {
      assert.equal(r.status, 400);
      return;
    }
    assert.equal(r.status, 200);
    assert.ok(r.body.text.length > 0);
    const tags = await a("POST", `/objects/${ids.budget}/ai`, { action: "generate_tags" });
    assert.ok(Array.isArray(tags.body.items));
    const before = (await a("GET", `/notes/${ids.budget}/versions`)).body.length;
    const ap = await a("POST", `/objects/${ids.budget}/append`, { text: "## Özet\n\nEklenen metin #atlas" });
    assert.equal(ap.status, 200);
    const note = (await a("GET", `/notes/${ids.budget}`)).body;
    assert.match(note.content, /Eklenen metin #atlas$/);
    assert.ok(note.tags.includes("atlas"));
    assert.equal((await a("GET", `/notes/${ids.budget}/versions`)).body.length, before + 1);
  });

  test("locked notes and foreign notes are refused by AI actions and append", async () => {
    assert.equal((await a("POST", `/objects/${ids.secret}/ai`, { action: "find_related" })).status, 400);
    assert.equal((await a("POST", `/objects/${ids.secret}/append`, { text: "x" })).status, 400);
    assert.equal((await b("POST", `/objects/${ids.budget}/ai`, { action: "find_related" })).status, 404);
    assert.equal((await b("POST", `/objects/${ids.budget}/append`, { text: "x" })).status, 404);
    assert.equal((await a("POST", `/objects/${ids.budget}/ai`, { action: "nope" })).status, 400);
  });

  test("graph relations list typed relations only for the owner", async () => {
    await a("POST", "/relations", { source_id: ids.design, target_id: ids.budget, relation_type: "part_of" });
    const g = await a("GET", "/graph/relations");
    assert.ok(g.body.relations.some((r: any) => r.relation_type === "part_of" && r.label === "parçası"));
    assert.equal((await b("GET", "/graph/relations")).body.relations.length, 0);
  });

  test("unexpected connections need a model and only return explained pairs", async () => {
    const r = await a("POST", "/graph/unexpected");
    assert.equal(r.status, 200);
    if (!mock) {
      assert.equal(r.body.available, false);
      return;
    }
    assert.equal(r.body.available, true);
    for (const p of r.body.pairs) {
      assert.match(p.explanation, /\[[12]\]/);
      assert.notEqual(p.a.note_id, ids.secret);
    }
    assert.ok(r.body.pairs.some((p: any) => [p.a.note_id, p.b.note_id].sort().join() === [ids.mush1, ids.mush2].sort().join()));
  });

  test("templates: own templates CRUD + apply, built-in override, hide and reset, isolation", async () => {
    const created = await a("POST", "/templates", {
      name: "Kitap özeti",
      note_type_id: "type_book",
      title_template: "Özet · {{tarih}}",
      content_template: "# {{başlık}}\n\nOkuma tarihi: {{tarih}}\n- [ ] Ana fikir",
    });
    assert.equal(created.status, 200, JSON.stringify(created.body));
    const tid = created.body.id;
    const applied = await a("POST", `/templates/${tid}/apply`, { title: "Sapiens" });
    assert.equal(applied.status, 200);
    const note = (await a("GET", `/notes/${applied.body.primary_id}`)).body;
    assert.equal(note.title, "Sapiens");
    assert.equal(note.note_type_id, "type_book");
    assert.match(note.content, /^# Sapiens\n\nOkuma tarihi: \d{4}-\d{2}-\d{2}/);
    const untitled = (await a("GET", `/notes/${(await a("POST", `/templates/${tid}/apply`, {})).body.primary_id}`)).body;
    assert.match(untitled.title, /^Özet · \d{4}-\d{2}-\d{2}$/);
    assert.equal((await a("PUT", `/templates/${tid}`, { name: "Kitap notu" })).body.name, "Kitap notu");
    assert.equal((await b("PUT", `/templates/${tid}`, { name: "x" })).status, 404);
    assert.equal((await b("POST", `/templates/${tid}/apply`, {})).status, 404);
    assert.equal((await a("POST", "/templates", { name: "Günlük?", note_type_id: "type_daily" })).status, 400);

    await a("PUT", "/templates/meeting", { content_template: "## Özel gündem {{tarih}}" });
    const m = await a("POST", "/templates/meeting/apply", { title: "Haftalık" });
    const mnote = (await a("GET", `/notes/${m.body.primary_id}`)).body;
    assert.match(mnote.content, /^## Özel gündem \d{4}-/);
    assert.equal(mnote.title, "Haftalık");
    await a("PUT", "/templates/meeting", { hidden: true });
    assert.ok(!(await a("GET", "/templates")).body.some((t: any) => t.id === "meeting"));
    assert.ok((await a("GET", "/templates?all=1")).body.find((t: any) => t.id === "meeting").hidden);
    await a("DELETE", "/templates/meeting");
    const reset = (await a("GET", "/templates")).body.find((t: any) => t.id === "meeting");
    assert.equal(reset.customized, false);
    assert.equal(reset.hidden, false);
    assert.equal((await a("DELETE", `/templates/${tid}`)).status, 200);
    assert.equal((await a("DELETE", `/templates/${tid}`)).status, 404);
  });

  test("journal: rapid log into the daily note, task states, isolation", async () => {
    const date = "2031-03-04";
    const t1 = await a("POST", "/today/log", { date, text: ". ! raporu bitir" });
    assert.equal(t1.status, 200, JSON.stringify(t1.body));
    assert.equal(t1.body.line, "- [ ] ! raporu bitir");
    await a("POST", "/today/log", { date, text: "o Ayşe ile kahve #sosyal" });
    await a("POST", "/today/log", { date, text: "fikir: haftalık gözden geçirme", kind: "note" });
    assert.equal((await a("POST", "/today/log", { date, text: ". " })).status, 400);
    const note = (await a("GET", `/notes/${t1.body.note_id}`)).body;
    assert.match(note.content, /^## Kayıt\n\n- \[ \] ! raporu bitir\n- \[o\] Ayşe ile kahve #sosyal\n- fikir: haftalık gözden geçirme\n\n## Yansıma/);
    assert.ok(note.tags.includes("sosyal"));
    assert.equal((await a("GET", `/today?date=${date}`)).body.daily_note.note_id, t1.body.note_id);

    const moved = await a("PATCH", `/notes/${t1.body.note_id}/tasks`, { index: 0, state: "migrated" });
    assert.equal(moved.status, 200);
    assert.match(moved.body.content, /- \[>\] ! raporu bitir/);
    assert.equal((await a("GET", `/today?date=${date}`)).body.tasks.length, 0, "a migrated task is not open");
    assert.equal((await a("PATCH", `/notes/${t1.body.note_id}/tasks`, { index: 0, checked: false })).body.content.includes("- [ ] ! raporu"), true);
    assert.equal((await a("PATCH", `/notes/${t1.body.note_id}/tasks`, { index: 0, state: "nope" })).status, 400);
    assert.equal((await b("PATCH", `/notes/${t1.body.note_id}/tasks`, { index: 0, state: "done" })).status, 404);
    const other = await b("POST", "/today/log", { date, text: "b'nin kaydı" });
    assert.notEqual(other.body.note_id, t1.body.note_id);
  });

  test("ai settings accept anthropic and reject a provider switch without a key", async () => {
    const s = await a("GET", "/ai/settings");
    assert.ok(s.body.providers.some((p: any) => p.id === "anthropic"));
    assert.equal((await a("PUT", "/ai/settings", { provider: "openai" })).status, 400);
  });
});
