// Ask Inkwell: answer a question only from the user's own objects.
// retrieve -> numbered sources -> model answer with [n] citations ->
// citations validated against the retrieved set. Without a model the user
// still gets the matching sources (never an invented answer).
import { activeProvider } from "../ai";
import { retrieve, type RetrievalFilters } from "./retrieval";
import { checkCitations } from "./retrievalRank";
import { recordEvent } from "./analytics";
import { friendlyAiError } from "./aiSettings";
import { ASK_SYSTEM, buildAskPrompt } from "./askPrompt";

export { buildAskPrompt };

export interface AskResult {
  question: string;
  answer: string | null;
  mode: "answer" | "sources_only" | "no_sources";
  provider: string | null;
  semantic: boolean;
  citations: Array<{ n: number; note_id: string; slug?: string | null; title: string; snippet: string }>;
  sources: Array<{ n: number; note_id: string; slug?: string | null; title: string; type_name: string; date: string; snippet: string; signals: { text: number; semantic: number; relation: number } }>;
  warning: string | null;
}

export async function ask(userId: string, question: string, filters: RetrievalFilters = {}): Promise<AskResult> {
  const { chunks, semantic } = await retrieve(userId, question, filters, { limit: 8 });
  await recordEvent(userId, "first_ai_query", {}, { once: true });
  const sources = chunks.map((c, i) => ({
    n: i + 1,
    note_id: c.note_id,
    slug: c.slug,
    title: c.title,
    type_name: c.type_name,
    date: c.date,
    snippet: c.text.replace(/\s+/g, " ").slice(0, 280),
    signals: c.signals,
  }));
  const base = { question, semantic, sources };
  if (chunks.length === 0) {
    return { ...base, answer: "Notlarında bununla ilgili bir bilgi bulamadım.", mode: "no_sources", provider: null, citations: [], warning: null };
  }
  const { provider } = await activeProvider(userId);
  if (!provider.isModel) {
    return {
      ...base,
      answer: null,
      mode: "sources_only",
      provider: null,
      citations: [],
      warning: "Yapay zeka etkin değil; yalnızca ilgili notlar listelendi. Ayarlar > Yapay Zeka'dan etkinleştirebilirsin.",
    };
  }
  let raw: string;
  try {
    raw = await provider.generate({ system: ASK_SYSTEM, prompt: buildAskPrompt(question, chunks), maxTokens: 1500 });
  } catch (e) {
    return { ...base, answer: null, mode: "sources_only", provider: provider.label, citations: [], warning: `Yapay zeka yanıt veremedi: ${friendlyAiError(e)}` };
  }
  const check = checkCitations(raw, chunks.length);
  const citations = check.used.map((n) => ({ n, note_id: chunks[n - 1].note_id, slug: chunks[n - 1].slug, title: chunks[n - 1].title, snippet: sources[n - 1].snippet }));
  let warning: string | null = null;
  if (check.removed.length) warning = "Yanıtta notlarına dayanmayan kaynak numaraları vardı; bunlar kaldırıldı.";
  else if (check.uncitedSentences > 0 && citations.length === 0) warning = "Bu yanıt hiçbir nota dayandırılmadı; dikkatle değerlendir.";
  else if (check.uncitedSentences > 0) warning = `${check.uncitedSentences} cümle bir kaynağa dayandırılmadı.`;
  return { ...base, answer: check.answer, mode: "answer", provider: provider.label, citations, warning };
}
