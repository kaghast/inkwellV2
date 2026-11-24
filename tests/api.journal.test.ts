// Phase 2.5b/c end-to-end checks: monthly log, future log, migration,
// collections and the index. Run against a running server:
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
  const email = `j_${Date.now()}_${Math.random().toString(36).slice(2, 7)}@example.test`;
  const r = await req("POST", "/auth/register", { email, password: "it-password-123", name: "J" });
  assert.equal(r.status, 200);
  return req;
}

describe("Journal API", { skip: !BASE }, () => {
  let a: Awaited<ReturnType<typeof client>>;
  let b: Awaited<ReturnType<typeof client>>;
  before(async () => {
    a = await client();
    b = await client();
  });

  test("monthly log: one page per month, calendar from daily notes", async () => {
    const m1 = await a("POST", "/journal/month", { month: "2031-05" });
    assert.equal(m1.status, 200, JSON.stringify(m1.body));
    assert.equal(m1.body.created, true);
    const m2 = await a("POST", "/journal/month", { month: "2031-05" });
    assert.equal(m2.body.note_id, m1.body.note_id, "ensure is idempotent");
    assert.equal((await a("POST", "/journal/month", { month: "2031-13" })).status, 400);

    await a("POST", "/today/log", { date: "2031-05-07", text: "o Diş hekimi 10:00" });
    await a("POST", "/today/log", { date: "2031-05-07", text: ". ilaç al" });
    const v = (await a("GET", "/journal/month?month=2031-05")).body;
    assert.equal(v.days.length, 31);
    const d7 = v.days.find((d: any) => d.date === "2031-05-07");
    assert.deepEqual(d7.events, ["Diş hekimi 10:00"]);
    assert.equal(d7.open, 1);
    assert.equal(v.monthly.note_id, m1.body.note_id);
    assert.equal((await b("GET", "/journal/month?month=2031-05")).body.monthly, null, "other users see nothing");

    const log = await a("POST", "/journal/log", { note_id: m1.body.note_id, text: "! vergi beyannamesi", section: "Görevler" });
    assert.equal(log.status, 200);
    assert.match(log.body.content, /## Görevler\n\n- \[ \] ! vergi beyannamesi\n\n## Notlar/);
    assert.equal((await b("POST", "/journal/log", { note_id: m1.body.note_id, text: "x" })).status, 404);
  });

  test("migration: carry to today, schedule to a month, cancel; originals are kept", async () => {
    await a("POST", "/today/log", { date: "2031-06-01", text: ". eski görev bir" });
    await a("POST", "/today/log", { date: "2031-06-01", text: ". eski görev iki" });
    await a("POST", "/today/log", { date: "2031-06-02", text: ". eski görev üç" });
    const list = (await a("GET", "/journal/migration?date=2031-06-03")).body.tasks;
    const texts = list.map((t: any) => t.text);
    assert.ok(texts.includes("eski görev bir") && texts.includes("eski görev üç"));
    assert.equal((await b("GET", "/journal/migration?date=2031-06-03")).body.tasks.length, 0);

    const one = list.find((t: any) => t.text === "eski görev bir");
    const moved = await a("POST", "/journal/migrate", { note_id: one.note_id, task_index: one.task_index, action: "today", date: "2031-06-03" });
    assert.equal(moved.status, 200, JSON.stringify(moved.body));
    const src = (await a("GET", `/notes/${one.note_id}`)).body.content;
    assert.match(src, /- \[>\] eski görev bir → \[\[Günlük not · 2031-06-03\]\]/);
    const today = (await a("GET", "/today?date=2031-06-03")).body;
    assert.match(today.daily_note.content, /- \[ \] eski görev bir/);
    assert.ok(today.tasks.some((t: any) => t.text === "eski görev bir"));
    // The same task cannot be migrated twice
    assert.equal((await a("POST", "/journal/migrate", { note_id: one.note_id, task_index: one.task_index, action: "today", date: "2031-06-03" })).status, 409);

    const two = list.find((t: any) => t.text === "eski görev iki");
    const sched = await a("POST", "/journal/migrate", { note_id: two.note_id, task_index: two.task_index, action: "month", month: "2031-09", date: "2031-06-03" });
    assert.equal(sched.status, 200, JSON.stringify(sched.body));
    assert.match((await a("GET", `/notes/${two.note_id}`)).body.content, /- \[<\] eski görev iki → \[\[Aylık kayıt · 2031-09\]\]/);
    const future = (await a("GET", "/journal/future?from=2031-07&months=6")).body.months;
    assert.equal(future.length, 6);
    const sep = future.find((m: any) => m.month === "2031-09");
    assert.ok(sep.items.some((i: any) => i.text === "eski görev iki" && i.state === "open"));
    assert.equal((await a("POST", "/journal/migrate", { note_id: two.note_id, task_index: 0, action: "month", date: "2031-06-03" })).status, 400, "month is required");

    const three = list.find((t: any) => t.text === "eski görev üç");
    assert.equal((await b("POST", "/journal/migrate", { note_id: three.note_id, task_index: three.task_index, action: "cancel", date: "2031-06-03" })).status, 404);
    const c = await a("POST", "/journal/migrate", { note_id: three.note_id, task_index: three.task_index, action: "cancel", date: "2031-06-03" });
    assert.equal(c.status, 200);
    assert.match((await a("GET", `/notes/${three.note_id}`)).body.content, /- \[-\] eski görev üç/);
    const after = (await a("GET", "/journal/migration?date=2031-06-03")).body.tasks.map((t: any) => t.text);
    assert.ok(!after.includes("eski görev bir") && !after.includes("eski görev iki") && !after.includes("eski görev üç"));
  });

  test("collections: create, list entries, linked notes, isolation, index", async () => {
    const c = await a("POST", "/journal/collections", { title: "Okunacak kitaplar", description: "2031 listesi" });
    assert.equal(c.status, 200, JSON.stringify(c.body));
    assert.equal((await a("POST", "/journal/collections", { title: " " })).status, 400);
    await a("POST", "/journal/log", { note_id: c.body.note_id, text: "- Sapiens", section: "Liste" });
    await a("POST", "/journal/log", { note_id: c.body.note_id, text: ". Dune'u bitir", section: "Liste" });
    const book = (await a("POST", "/notes", { title: "Sapiens notlarım", content: "#kitap" })).body;
    await a("POST", "/relations", { source_id: book.note_id, target_id: c.body.note_id, relation_type: "part_of" });

    const detail = (await a("GET", `/journal/collections/${c.body.note_id}`)).body;
    assert.match(detail.content, /^2031 listesi\n\n## Liste\n\n- Sapiens\n- \[ \] Dune'u bitir\n$/);
    assert.deepEqual(detail.linked.map((l: any) => l.title), ["Sapiens notlarım"]);
    const list = (await a("GET", "/journal/collections")).body;
    const mine = list.find((x: any) => x.note_id === c.body.note_id);
    assert.equal(mine.items, 2);
    assert.equal(mine.open, 1);
    assert.equal(mine.linked, 1);
    assert.equal((await b("GET", `/journal/collections/${c.body.note_id}`)).status, 404);
    assert.equal((await b("GET", "/journal/collections")).body.length, 0);
    assert.equal((await a("GET", `/journal/collections/${book.note_id}`)).status, 404, "only collection objects");

    const idx = (await a("GET", "/journal/index")).body;
    assert.ok(idx.months.some((m: any) => m.month === "2031-05" && m.monthly_id && m.days >= 1));
    assert.ok(idx.collections.some((x: any) => x.title === "Okunacak kitaplar"));
    assert.ok(idx.tags.some((t: any) => t.tag === "kitap"));
    assert.equal((await b("GET", "/journal/index")).body.collections.length, 0);
  });
});

describe("Habits, mood and monthly review API", { skip: !BASE }, () => {
  let a: Awaited<ReturnType<typeof client>>;
  let b: Awaited<ReturnType<typeof client>>;
  let mock = false;
  before(async () => {
    a = await client();
    b = await client();
    mock = (await a("GET", "/home")).body.ai.provider === "mock";
  });

  test("habits: create, tick days, streaks, archive, delete, isolation", async () => {
    const h = await a("POST", "/journal/habits", { name: "Okuma" });
    assert.equal(h.status, 200, JSON.stringify(h.body));
    assert.equal((await a("POST", "/journal/habits", { name: "  " })).status, 400);
    for (const d of ["2031-07-08", "2031-07-09", "2031-07-10"]) {
      assert.equal((await a("PUT", `/journal/habits/${h.body.habit_id}/days/${d}`, { done: true })).status, 200);
    }
    await a("PUT", `/journal/habits/${h.body.habit_id}/days/2031-07-10`, { done: true }); // idempotent
    let m = (await a("GET", "/journal/habits?month=2031-07&today=2031-07-10")).body;
    let row = m.habits.find((x: any) => x.habit_id === h.body.habit_id);
    assert.deepEqual(row.done_days, ["2031-07-08", "2031-07-09", "2031-07-10"]);
    assert.equal(row.current, 3);
    assert.equal(m.days.length, 31);
    await a("PUT", `/journal/habits/${h.body.habit_id}/days/2031-07-09`, { done: false });
    row = (await a("GET", "/journal/habits?month=2031-07&today=2031-07-10")).body.habits[0];
    assert.equal(row.current, 1);
    assert.equal(row.longest, 1);
    assert.equal((await a("PUT", `/journal/habits/${h.body.habit_id}/days/2031-7-1`, { done: true })).status, 400);

    assert.equal((await b("PUT", `/journal/habits/${h.body.habit_id}/days/2031-07-11`, { done: true })).status, 404);
    assert.equal((await b("GET", "/journal/habits?month=2031-07")).body.habits.length, 0);
    assert.equal((await b("DELETE", `/journal/habits/${h.body.habit_id}`)).status, 404);

    await a("PUT", `/journal/habits/${h.body.habit_id}`, { archived: true });
    assert.equal((await a("GET", "/journal/habits?month=2031-07")).body.habits.length, 0, "archived habits are hidden");
    assert.equal((await a("GET", "/journal/habits?month=2031-07&all=1")).body.habits[0].done_days.length, 2, "history kept");
    assert.equal((await a("DELETE", `/journal/habits/${h.body.habit_id}`)).status, 200);
    assert.equal((await a("GET", "/journal/habits?month=2031-07&all=1")).body.habits.length, 0);
  });

  test("mood and energy: 1–5, partial updates, clearing", async () => {
    assert.equal((await a("PUT", "/journal/ratings/2031-07-10", { mood: 4 })).status, 200);
    await a("PUT", "/journal/ratings/2031-07-10", { energy: 2 });
    let r = (await a("GET", "/journal/habits?month=2031-07")).body.ratings;
    assert.deepEqual(r, [{ day: "2031-07-10", mood: 4, energy: 2 }]);
    await a("PUT", "/journal/ratings/2031-07-10", { mood: null });
    r = (await a("GET", "/journal/habits?month=2031-07")).body.ratings;
    assert.deepEqual(r, [{ day: "2031-07-10", mood: null, energy: 2 }]);
    assert.equal((await a("PUT", "/journal/ratings/2031-07-10", { mood: 6 })).status, 400);
    assert.equal((await b("GET", "/journal/habits?month=2031-07")).body.ratings.length, 0);
  });

  test("monthly review: counts from the month, cited narrative only with a model, locked notes left out", async () => {
    await a("POST", "/today/log", { date: "2031-08-02", text: ". vergi beyannamesi" });
    await a("POST", "/today/log", { date: "2031-08-02", text: "o Kardeşimin düğünü" });
    const t = (await a("GET", "/journal/migration?date=2031-08-03")).body.tasks.find((x: any) => x.text === "vergi beyannamesi");
    await a("POST", "/journal/migrate", { note_id: t.note_id, task_index: t.task_index, action: "today", date: "2031-08-03" });
    const t2 = (await a("GET", "/journal/migration?date=2031-08-04")).body.tasks.find((x: any) => x.text === "vergi beyannamesi");
    await a("POST", "/journal/migrate", { note_id: t2.note_id, task_index: t2.task_index, action: "today", date: "2031-08-04" });
    await a("POST", "/notes", { title: "Gizli günlük", content: "- [ ] gizli görev", note_type_id: "type_daily", date: "2031-08-05T09:00:00", is_encrypted: true, password_hash: "x" });

    const r = await a("POST", "/journal/review", { month: "2031-08", today: "2031-08-31" });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const f = r.body.facts;
    assert.equal(f.days_logged, 3);
    assert.equal(f.tasks.migrated, 2);
    assert.equal(f.tasks.open, 1, "the locked note's task is not counted");
    assert.equal(f.events, 1);
    assert.deepEqual(f.postponed, [{ text: "vergi beyannamesi", times: 2 }]);
    assert.ok(!r.body.sources.some((s: any) => s.title === "Gizli günlük"));
    if (mock) {
      assert.equal(r.body.mode, "review");
      assert.match(r.body.review, /\[\d+\]/);
      assert.ok(r.body.citations.length >= 1);
    } else {
      assert.equal(r.body.mode, "facts_only");
      assert.equal(r.body.review, null);
    }
    const empty = await b("POST", "/journal/review", { month: "2031-08" });
    assert.equal(empty.body.mode, "empty");
    assert.equal((await a("POST", "/journal/review", { month: "2031-8" })).status, 400);
  });
});
