// Text from a user's uploaded file. Office and text files are read locally;
// images and PDFs need a model with vision (OCR), which is recorded in
// ai_runs like every other model call. Never throws for an unreadable file:
// the result says why there is no text.
import { and, eq } from "drizzle-orm";
import { db, files } from "../../src/db/index";
import { activeProvider } from "../ai";
import { AiUnavailableError } from "../ai/types";
import { AccessError } from "./workspaces";
import { friendlyAiError } from "./aiSettings";
import { localKind, readLocalText, MAX_FILE_TEXT } from "./officeText";
export { fileIdsInContent } from "./officeText";

export type FileTextMethod = "text" | "docx" | "pptx" | "xlsx" | "ocr" | "none";

export interface FileTextResult {
  file_id: string;
  name: string;
  content_type: string;
  text: string;
  method: FileTextMethod;
  provider: string | null;
  /** Why there is no text, in Turkish (only when text is empty). */
  note: string | null;
}

const ocrTypes = (mime: string) => /^image\//.test(mime) || mime === "application/pdf";

export async function readFileText(userId: string, fileId: string): Promise<FileTextResult> {
  const r = await db
    .select()
    .from(files)
    .where(and(eq(files.fileId, fileId), eq(files.userId, userId), eq(files.isDeleted, false)))
    .limit(1);
  const f = r[0];
  if (!f) throw new AccessError(404, "Dosya bulunamadı");
  const base = { file_id: f.fileId, name: f.originalFilename, content_type: f.contentType, provider: null as string | null };
  const data = Buffer.from(f.dataBase64, "base64");

  const kind = localKind(f.contentType, f.originalFilename);
  if (kind) {
    try {
      const text = readLocalText(kind, data);
      return { ...base, text, method: kind, note: text ? null : "Dosyada metin yok." };
    } catch {
      return { ...base, text: "", method: "none", note: "Dosya okunamadı; bozuk ya da desteklenmeyen bir biçimde olabilir." };
    }
  }

  if (!ocrTypes(f.contentType)) return { ...base, text: "", method: "none", note: "Bu dosya türünden metin okunamıyor." };

  const { provider } = await activeProvider(userId);
  if (!provider.isModel || !provider.readFile) {
    return { ...base, text: "", method: "none", note: "Görsel ve PDF'teki metni okumak için Ayarlar > Yapay Zeka'dan Gemini ya da Claude'u etkinleştir." };
  }
  if (provider.canRead && !provider.canRead(f.contentType, data.length)) {
    return { ...base, text: "", method: "none", provider: provider.label, note: `${provider.label} bu dosyayı okuyamıyor (tür ya da boyut sınırı).` };
  }
  try {
    const text = (await provider.readFile({ data, mime: f.contentType, name: f.originalFilename })).slice(0, MAX_FILE_TEXT);
    return { ...base, text, method: "ocr", provider: provider.label, note: text ? null : "Dosyada okunabilir metin bulunamadı." };
  } catch (e) {
    if (e instanceof AiUnavailableError) return { ...base, text: "", method: "none", note: "Yapay zeka etkin değil." };
    return { ...base, text: "", method: "none", provider: provider.label, note: `Metin okunamadı: ${friendlyAiError(e)}` };
  }
}

export const METHOD_LABEL: Record<FileTextMethod, string> = {
  text: "metin dosyası",
  docx: "Word belgesi",
  pptx: "sunum",
  xlsx: "tablo",
  ocr: "OCR",
  none: "okunamadı",
};
