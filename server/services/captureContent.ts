// Builds an object's markdown from a capture plus accepted suggestions (pure).

const TAG_TOKEN = /^[\p{L}\p{N}_-]+$/u;

export function buildCaptureContent(
  cap: { rawText: string; rawUrl: string | null },
  file: { id: string; name: string; content_type: string } | null,
  extras: { tags?: string[]; people?: string[]; tasks?: string[] } = {}
): string {
  let content = cap.rawText.trim();
  if (cap.rawUrl && !content.includes(cap.rawUrl)) content = content ? `${cap.rawUrl}\n\n${content}` : cap.rawUrl;
  if (file) {
    const link = /^image\//.test(file.content_type) ? `![${file.name}](/api/files/${file.id})` : `[📎 ${file.name}](/api/files/${file.id})`;
    content = content ? `${content}\n\n${link}` : link;
  }
  const lower = content.toLocaleLowerCase("tr-TR");
  const missingTasks = (extras.tasks || []).filter((t) => !lower.includes(t.toLocaleLowerCase("tr-TR")));
  if (missingTasks.length) content += `\n\n## Görevler\n${missingTasks.map((t) => `- [ ] ${t}`).join("\n")}`;
  const tagTokens = (extras.tags || [])
    .map((t) => t.replace(/^#/, "").trim().toLocaleLowerCase("tr-TR").replace(/\s+/g, "-"))
    .filter((t) => TAG_TOKEN.test(t) && !new RegExp(`(^|\\s)#${t}(\\s|$)`, "iu").test(content));
  const personTokens = (extras.people || [])
    .map((p) => p.replace(/^@/, "").trim().toLocaleLowerCase("tr-TR"))
    .filter((p) => TAG_TOKEN.test(p) && !new RegExp(`(^|\\s)@${p}(\\s|$)`, "iu").test(content));
  const trailer = [...tagTokens.map((t) => `#${t}`), ...personTokens.map((p) => `@${p}`)];
  if (trailer.length) content += `\n\n${Array.from(new Set(trailer)).join(" ")}`;
  return content;
}

