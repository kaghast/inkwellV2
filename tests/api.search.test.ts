// Full-text search in SQL (Phase 2, migration 011): candidates come from the
// generated `notes.search_tsv` column. Run against a running server:
//   INKWELL_BASE_URL=http://localhost:3092 npm run test:api
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
  const email = `s_${Date.now()}_${Math.random().toString(36).slice(2, 7)}@example.test`;
  const r = await req("POST", "/auth/register", { email, password: "it-password-123", name: "S" });
  assert.equal(r.status, 200);
  return req;
}

describe("Search in SQL", { skip: !BASE }, () => {
  let a: Awaited<ReturnType<typeof client>>;
  let b: Awaited<ReturnType<typeof client>>;
  const ids: Record<string, string> = {};
  const titles = async (req: typeof a, q: string) =>
    ((await req("GET", `/search?q=${encodeURIComponent(q)}`)).body.objects as any[]).map((o) => o.title);

  before(async () => {
    a = await client();
    b = await client();
    const mk = async (k: string, body: Record<string, unknown>) => {
      const r = await a("POST", "/notes", body);
      assert.equal(r.status, 200, JSON.stringify(r.body));
      ids[k] = r.body.note_id;
    };
    await mk("city", { title: "İstanbul gezisi", content: "Kadıköy ve Üsküdar arasında vapur." });
    await mk("meet", { title: "Pazartesi notları", content: "Kuzgunluk toplantısında bütçe konuşuldu." });
    await mk("code", { title: "Betik", content: "Açıklama.\n\n```\nzebrakod = 1\n```\n\n<!-- yorumkelime -->" });
    await mk("lock", { title: "Kilitli kasa", content: "gizlikelime burada", is_encrypted: true, password_hash: "x" });
    await mk("typed", { title: "Haftalık senk", content: "", note_type_id: "type_meeting" });
  });

  test("Turkish letters fold both ways", async () => {
    assert.ok((await titles(a, "istanbul")).includes("İstanbul gezisi"));
    assert.ok((await titles(a, "ISTANBUL")).includes("İstanbul gezisi"));
    assert.ok((await titles(a, "uskudar")).includes("İstanbul gezisi"));
    assert.ok((await titles(a, "Üsküdar vapur")).includes("İstanbul gezisi"));
  });

  test("a word finds its suffixed forms, and every word must match", async () => {
    assert.ok((await titles(a, "kuzgunluk toplantı")).includes("Pazartesi notları"));
    assert.ok(!(await titles(a, "kuzgunluk istanbul")).includes("Pazartesi notları"));
  });

  test("code blocks and comments are not searched; locked notes only by title", async () => {
    assert.deepEqual(await titles(a, "zebrakod"), []);
    assert.deepEqual(await titles(a, "yorumkelime"), []);
    assert.ok((await titles(a, "betik")).includes("Betik"));
    assert.deepEqual(await titles(a, "gizlikelime"), []);
    const locked = (await a("GET", "/search?q=kasa")).body.objects.find((o: any) => o.id === ids.lock);
    assert.ok(locked, "the title of a locked note is searchable");
    assert.equal(locked.snippet, "Parola kilitli not");
  });

  test("the object type's name matches", async () => {
    const r = (await a("GET", "/search?q=toplant%C4%B1&type_id=type_meeting")).body.objects;
    assert.ok(r.some((o: any) => o.id === ids.typed));
  });

  test("edits are searchable at once; other users see nothing", async () => {
    await a("PUT", `/notes/${ids.meet}`, { title: "Pazartesi notları", content: "Yeni konu: albatros göçü." });
    assert.ok((await titles(a, "albatros")).includes("Pazartesi notları"));
    assert.ok(!(await titles(a, "kuzgunluk")).includes("Pazartesi notları"));
    assert.deepEqual(await titles(b, "albatros"), []);
    assert.deepEqual(await titles(b, "istanbul"), []);
  });

  test("empty and punctuation-only queries return nothing", async () => {
    const r = await a("GET", "/search?q=%20%2E%2E%26%7C");
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.objects, []);
  });

  test("Ask finds a note by a suffixed word through the SQL candidates", async () => {
    const r = await a("POST", "/ask", { question: "Albatros göçü ne zaman konuşuldu?" });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.ok(r.body.sources.some((s: any) => s.note_id === ids.meet));
    const foreign = await b("POST", "/ask", { question: "Albatros göçü?" });
    assert.equal(foreign.body.sources.length, 0);
  });
});
