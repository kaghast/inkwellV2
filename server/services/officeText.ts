// Plain text from Office Open XML files (DOCX, PPTX, XLSX) and text files,
// read locally: no model call, nothing leaves the server. Pure functions over
// the file bytes, unit tested.
import { readZipTexts } from "../lib/zip";

export const MAX_FILE_TEXT = 60000;

const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const PPTX = "application/vnd.openxmlformats-officedocument.presentationml.presentation";
const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

export type LocalKind = "text" | "docx" | "pptx" | "xlsx";

/** Which local reader handles this file, by MIME type or extension. */
export function localKind(mime: string, name: string): LocalKind | null {
  const ext = (name.match(/\.([a-z0-9]+)$/i)?.[1] || "").toLowerCase();
  if (mime === DOCX || ext === "docx") return "docx";
  if (mime === PPTX || ext === "pptx") return "pptx";
  if (mime === XLSX || ext === "xlsx") return "xlsx";
  if (/^text\//.test(mime) || ["txt", "md", "markdown", "csv", "tsv", "json", "log"].includes(ext) || mime === "application/json") return "text";
  return null;
}

export function decodeXml(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&amp;/g, "&");
}

/** Text of one paragraph-like element: runs, tabs and line breaks. */
function runsText(xml: string, ns: "w" | "a"): string {
  let out = "";
  const re = new RegExp(`<${ns}:t(?:\\s[^>]*)?>([\\s\\S]*?)</${ns}:t>|<${ns}:tab\\s*/>|<${ns}:br\\s*/>`, "g");
  for (const m of xml.matchAll(re)) {
    if (m[1] !== undefined) out += decodeXml(m[1]);
    else out += m[0].includes("tab") ? "\t" : "\n";
  }
  return out;
}

export function docxText(documentXml: string): string {
  const lines: string[] = [];
  const body = documentXml.replace(/<w:(?:del|instrText)\b[\s\S]*?<\/w:(?:del|instrText)>/g, "");
  for (const m of body.matchAll(/<w:p\b[^>]*?(?:\/>|>([\s\S]*?)<\/w:p>)/g)) {
    const inner = m[1] || "";
    const text = runsText(inner, "w").trim();
    if (!text) {
      if (lines.length && lines[lines.length - 1] !== "") lines.push("");
      continue;
    }
    const style = inner.match(/<w:pStyle\s+w:val="([^"]+)"/)?.[1] || "";
    const level = style.match(/^(?:Heading|Başlık|Baslik)\s*([1-6])$/i)?.[1] || (/^Title$/i.test(style) ? "1" : "");
    if (level) lines.push(`${"#".repeat(Number(level))} ${text}`);
    else if (/<w:numPr>/.test(inner)) lines.push(`- ${text}`);
    else lines.push(text);
  }
  return tidy(lines.join("\n"));
}

export function pptxText(slides: Map<string, string>): string {
  const ordered = [...slides.entries()]
    .map(([name, xml]) => ({ n: Number(name.match(/slide(\d+)\.xml$/)?.[1] || 0), xml }))
    .filter((s) => s.n > 0)
    .sort((a, b) => a.n - b.n);
  const parts: string[] = [];
  for (const s of ordered) {
    const paras = Array.from(s.xml.matchAll(/<a:p\b[^>]*?(?:\/>|>([\s\S]*?)<\/a:p>)/g))
      .map((m) => runsText(m[1] || "", "a").trim())
      .filter(Boolean);
    if (paras.length) parts.push(`## Slayt ${s.n}\n\n${paras.join("\n")}`);
  }
  return tidy(parts.join("\n\n"));
}

function sharedStrings(xml: string | undefined): string[] {
  if (!xml) return [];
  return Array.from(xml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)).map((m) =>
    Array.from(m[1].matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g))
      .map((t) => decodeXml(t[1]))
      .join("")
  );
}

const MAX_ROWS = 400;

export function xlsxText(files: Map<string, string>): string {
  const strings = sharedStrings(files.get("xl/sharedStrings.xml"));
  const names = Array.from((files.get("xl/workbook.xml") || "").matchAll(/<sheet\b[^>]*\bname="([^"]*)"/g)).map((m) => decodeXml(m[1]));
  const sheets = [...files.entries()]
    .map(([name, xml]) => ({ n: Number(name.match(/^xl\/worksheets\/sheet(\d+)\.xml$/)?.[1] || 0), xml }))
    .filter((s) => s.n > 0)
    .sort((a, b) => a.n - b.n);
  const parts: string[] = [];
  for (const s of sheets) {
    const rows: string[] = [];
    for (const r of s.xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
      if (rows.length >= MAX_ROWS) break;
      const cells = Array.from(r[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)).map((c) => {
        const attrs = c[1];
        const inner = c[2] || "";
        const t = attrs.match(/\bt="([^"]+)"/)?.[1];
        if (t === "inlineStr") return decodeXml(inner.match(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/)?.[1] || "");
        const v = inner.match(/<v>([\s\S]*?)<\/v>/)?.[1];
        if (v === undefined) return "";
        if (t === "s") return strings[Number(v)] ?? "";
        if (t === "b") return v === "1" ? "DOĞRU" : "YANLIŞ";
        return decodeXml(v);
      });
      while (cells.length && !cells[cells.length - 1].trim()) cells.pop();
      if (cells.some((c) => c.trim())) rows.push(cells.map((c) => c.replace(/\s+/g, " ").trim()).join(" | "));
    }
    if (rows.length) parts.push(`## ${names[s.n - 1] || `Sayfa ${s.n}`}\n\n${rows.join("\n")}`);
  }
  return tidy(parts.join("\n\n"));
}

function tidy(s: string): string {
  return s
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, MAX_FILE_TEXT);
}

/** Reads a supported file locally; throws on a corrupt archive. */
export function readLocalText(kind: LocalKind, data: Buffer): string {
  if (kind === "text") {
    const s = data.toString("utf8").replace(/^﻿/, "");
    // Binary content mislabelled as text is not useful as a note
    if (/\u0000/.test(s.slice(0, 4096))) return "";
    return tidy(s);
  }
  if (kind === "docx") {
    const f = readZipTexts(data, (n) => n === "word/document.xml");
    return docxText(f.get("word/document.xml") || "");
  }
  if (kind === "pptx") return pptxText(readZipTexts(data, (n) => /^ppt\/slides\/slide\d+\.xml$/.test(n)));
  return xlsxText(readZipTexts(data, (n) => n === "xl/sharedStrings.xml" || n === "xl/workbook.xml" || /^xl\/worksheets\/sheet\d+\.xml$/.test(n)));
}

/** File ids linked from a note's markdown ("/api/files/<id>"), in order, without duplicates. */
export function fileIdsInContent(content: string): string[] {
  const ids = Array.from((content || "").matchAll(/\/api\/files\/([A-Za-z0-9_-]+)/g)).map((m) => m[1]);
  return Array.from(new Set(ids));
}
