// Phase 2b end-to-end checks: text from uploaded files (office locally,
// images by OCR), the note action and AI usage accounting. Run against a
// running server:
//   INKWELL_BASE_URL=http://localhost:3092 npm run test:api
// With AI_PROVIDER=mock the OCR and usage paths run; without a model the
// test checks that images explain why they have no text.
import { test, describe, before } from "node:test";
import assert from "node:assert/strict";
import { makeZip } from "./zipFixture";

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
  const email = `f_${Date.now()}_${Math.random().toString(36).slice(2, 7)}@example.test`;
  const r = await req("POST", "/auth/register", { email, password: "it-password-123", name: "F" });
  assert.equal(r.status, 200);
  return req;
}

type Req = Awaited<ReturnType<typeof client>>;

async function upload(req: Req, data: Buffer, filename: string, contentType: string): Promise<string> {
  const r = await req("POST", "/uploads/file", { dataBase64: data.toString("base64"), filename, contentType });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return r.body.file_id;
}

async function readyCapture(req: Req, captureId: string) {
  for (let i = 0; i < 80; i++) {
    const item = (await req("GET", "/inbox")).body.items.find((x: any) => x.capture_id === captureId);
    if (item && (item.status === "ready" || item.status === "failed")) return item;
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error("capture did not finish");
}

const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

describe("File text and AI usage API", { skip: !BASE }, () => {
  let a: Req;
  let b: Req;
  let model = false;
  before(async () => {
    a = await client();
    b = await client();
    model = Boolean((await a("GET", "/home")).body?.ai?.is_model);
  });

  test("a captured Word file is read locally and its text lands in the object", async () => {
    const docx = await makeZip({
      "word/document.xml": `<w:document><w:body><w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Proje Mavi</w:t></w:r></w:p><w:p><w:r><w:t>Teslim tarihi cuma #mavi</w:t></w:r></w:p></w:body></w:document>`,
    });
    const fileId = await upload(a, docx, "mavi.docx", DOCX);
    const cap = await a("POST", "/capture", { file_id: fileId, source: "file" });
    assert.equal(cap.status, 200, JSON.stringify(cap.body));
    const ready = await readyCapture(a, cap.body.capture.capture_id);
    assert.equal(ready.status, "ready");
    assert.equal(ready.file_text_method, "docx");
    assert.equal(ready.file_text, "# Proje Mavi\nTeslim tarihi cuma #mavi");
    assert.ok(ready.suggestion.tags.includes("mavi"), "tags come from the file's text");

    const acc = await a("POST", `/inbox/${ready.capture_id}/accept`, {});
    assert.equal(acc.status, 200, JSON.stringify(acc.body));
    const obj = (await a("GET", `/notes/${acc.body.object_id}`)).body;
    assert.match(obj.content, /\[📎 mavi\.docx\]\(\/api\/files\/file_[a-z0-9]+\)\n\n## Dosyadaki metin\n\n# Proje Mavi\nTeslim tarihi cuma #mavi/);
  });

  test("images: OCR with a model, an explanation without one", async () => {
    const png = Buffer.from("MOCK-OCR: Ayşe Kaya\nTasarım Müdürü\nayse@example.test");
    const fileId = await upload(a, png, "kartvizit.png", "image/png");
    const cap = await a("POST", "/capture", { file_id: fileId, source: "image" });
    const ready = await readyCapture(a, cap.body.capture.capture_id);
    assert.equal(ready.status, "ready");
    if (model) {
      assert.equal(ready.file_text_method, "ocr");
      assert.match(ready.file_text, /Ayşe Kaya\nTasarım Müdürü/);
    } else {
      assert.equal(ready.file_text, null);
      assert.equal(ready.file_text_method, "none");
      assert.match(ready.suggestion.file_text_note, /Yapay Zeka'dan Gemini ya da Claude/);
    }
  });

  test("note action reads attached files; other users' files are skipped", async () => {
    const own = await upload(a, Buffer.from("satır bir\nsatır iki"), "liste.txt", "text/plain");
    const foreign = await upload(b, Buffer.from("başkasının gizli metni"), "gizli.txt", "text/plain");
    const note = (await a("POST", "/notes", { title: "Ekli not", content: `[liste](/api/files/${own}) [x](/api/files/${foreign})` })).body;
    const r = await a("POST", `/objects/${note.note_id}/ai`, { action: "read_files" });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.text, "### liste.txt\n\nsatır bir\nsatır iki");
    assert.doesNotMatch(JSON.stringify(r.body), /gizli/);
    const empty = (await a("POST", "/notes", { title: "Boş", content: "dosya yok" })).body;
    const e = await a("POST", `/objects/${empty.note_id}/ai`, { action: "read_files" });
    assert.equal(e.body.warning, "Bu notta ekli dosya yok.");
  });

  test("audio: a transcript with a model, an explanation without one", async () => {
    const audio = Buffer.from("MOCK-SPEECH: Yarın saat onda Atlas toplantısı var.");
    const fileId = await upload(a, audio, "sesli-not.m4a", "application/octet-stream");
    const cap = await a("POST", "/capture", { file_id: fileId, source: "file" });
    const ready = await readyCapture(a, cap.body.capture.capture_id);
    assert.equal(ready.status, "ready");
    if (model) {
      assert.equal(ready.file_text_method, "transcript");
      assert.equal(ready.file_text, "Yarın saat onda Atlas toplantısı var.");
      const acc = await a("POST", `/inbox/${ready.capture_id}/accept`, {});
      assert.equal(acc.status, 200, JSON.stringify(acc.body));
      const obj = (await a("GET", `/notes/${acc.body.object_id}`)).body;
      assert.match(obj.content, /\n\n## Ses dökümü\n\nYarın saat onda Atlas toplantısı var\./);
    } else {
      assert.equal(ready.file_text, null);
      assert.equal(ready.file_text_method, "none");
      assert.match(ready.suggestion.file_text_note, /Gemini ya da OpenAI/);
    }
    // Silence: no speech, no text
    const quiet = await upload(a, Buffer.from("RIFF....WAVEfmt "), "sessiz.wav", "audio/wav");
    const q = await readyCapture(a, (await a("POST", "/capture", { file_id: quiet, source: "file" })).body.capture.capture_id);
    assert.equal(q.file_text, null);
    if (model) assert.equal(q.suggestion.file_text_note, "Ses dosyasında konuşma bulunamadı.");
  });

  test("model calls are recorded per user in ai_runs", async () => {
    const u = await a("GET", "/ai/usage?days=7");
    assert.equal(u.status, 200);
    if (model) {
      const ocr = u.body.by_task.find((t: any) => t.task === "file_text");
      assert.ok(ocr && ocr.calls >= 1, JSON.stringify(u.body.by_task));
      assert.ok(u.body.by_task.some((t: any) => t.task === "capture"));
      assert.ok(u.body.by_task.some((t: any) => t.task === "transcribe"), "transcriptions are recorded");
      assert.ok(u.body.input_tokens > 0);
      assert.equal(u.body.failed, 0);
    } else {
      assert.equal(u.body.calls, 0, "without a model nothing is recorded");
    }
    const other = (await b("GET", "/ai/usage")).body;
    assert.equal(other.calls, 0, "usage is per user");
    assert.equal((await fetch(`${BASE}/api/ai/usage`)).status, 401);
  });
});
