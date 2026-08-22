// Embedded Note Comments model, parser, serializer and helper functions
// Comments are embedded directly into note markdown content.

export interface NoteComment {
  id: string;
  author: string;
  authorId?: string;
  authorPicture?: string;
  createdAt: string; // ISO date string
  updatedAt?: string; // ISO date string
  content: string; // Markdown text (link, bold, italic, paragraph)
}

const COMMENTS_START = "<!-- inkwell:comments:start -->";
const COMMENTS_END = "<!-- inkwell:comments:end -->";
const COMMENT_HEADER_RE = /<!--\s*comment:id=([^,]+),author=([^,]+),date=([^,>]+)(?:,updated=([^,>]+))?(?:,authorId=([^,>]+))?\s*-->/i;

function formatDateForDisplay(isoString: string): string {
  try {
    const d = new Date(isoString);
    if (isNaN(d.getTime())) return isoString;
    return d.toLocaleString("tr-TR", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return isoString;
  }
}

/**
 * Extracts pure note content (without comment block) and structured comments list
 */
export function extractCommentsFromContent(rawContent: string): {
  mainContent: string;
  comments: NoteComment[];
} {
  if (!rawContent || !rawContent.includes(COMMENTS_START)) {
    return { mainContent: rawContent || "", comments: [] };
  }

  const startIndex = rawContent.indexOf(COMMENTS_START);
  const endIndex = rawContent.indexOf(COMMENTS_END);

  let mainContent = rawContent.substring(0, startIndex).trimEnd();
  if (endIndex !== -1) {
    const afterComments = rawContent.substring(endIndex + COMMENTS_END.length).trim();
    if (afterComments) {
      mainContent = `${mainContent}\n\n${afterComments}`.trim();
    }
  }

  const commentBlock = endIndex !== -1
    ? rawContent.substring(startIndex + COMMENTS_START.length, endIndex)
    : rawContent.substring(startIndex + COMMENTS_START.length);

  const comments: NoteComment[] = [];
  const rawParts = commentBlock.split(/(?=<!--\s*comment:id=)/gi);

  for (const part of rawParts) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const match = trimmed.match(COMMENT_HEADER_RE);
    if (!match) continue;

    const id = match[1].trim();
    const author = decodeURIComponent(match[2].trim());
    const createdAt = match[3].trim();
    const updatedAt = match[4] ? match[4].trim() : undefined;
    const authorId = match[5] ? match[5].trim() : undefined;

    let commentBody = trimmed.replace(COMMENT_HEADER_RE, "").trim();
    commentBody = commentBody
      .replace(/^>\s*(?:\*\*[^*]+\*\*\s*•\s*|💬\s*)?\*[^*]+\*(?:\s*\*\([^*]+\)\*)?\s*\n+/i, "")
      .replace(/^>\s?/gm, "")
      .trim();

    comments.push({
      id,
      author,
      authorId,
      createdAt,
      updatedAt,
      content: commentBody,
    });
  }

  return { mainContent, comments };
}

/**
 * Embeds comments into the main note content using standard markdown block
 */
export function embedCommentsIntoContent(
  mainContent: string,
  comments: NoteComment[]
): string {
  const cleanMain = mainContent.trim();
  if (!comments || comments.length === 0) {
    return cleanMain;
  }

  let block = `${COMMENTS_START}\n\n---\n### 💬 Yorumlar (${comments.length})\n\n`;

  for (const c of comments) {
    const safeAuthor = encodeURIComponent(c.author || "Kullanıcı");
    const dateFormatted = formatDateForDisplay(c.createdAt);
    const updatedTag = c.updatedAt ? `,updated=${c.updatedAt}` : "";
    const authorIdTag = c.authorId ? `,authorId=${c.authorId}` : "";

    block += `<!-- comment:id=${c.id},author=${safeAuthor},date=${c.createdAt}${updatedTag}${authorIdTag} -->\n`;
    block += `> 💬 *${dateFormatted}*${c.updatedAt ? " *(düzenlendi)*" : ""}\n`;
    const quotedContent = c.content
      .split("\n")
      .map((line) => `> ${line}`)
      .join("\n");
    block += `${quotedContent}\n\n`;
  }

  block += COMMENTS_END;

  if (!cleanMain) {
    return block;
  }
  return `${cleanMain}\n\n${block}`;
}

/**
 * Adds a new comment to raw note content and returns updated markdown
 */
export function addCommentToNote(
  rawContent: string,
  newComment: {
    author: string;
    authorId?: string;
    authorPicture?: string;
    content: string;
  }
): string {
  const { mainContent, comments } = extractCommentsFromContent(rawContent);
  const nowIso = new Date().toISOString();
  const id = `cmt_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

  const createdComment: NoteComment = {
    id,
    author: newComment.author || "Kullanıcı",
    authorId: newComment.authorId,
    authorPicture: newComment.authorPicture,
    createdAt: nowIso,
    content: newComment.content.trim(),
  };

  const updatedComments = [...comments, createdComment];
  return embedCommentsIntoContent(mainContent, updatedComments);
}

/**
 * Updates an existing comment inside raw note content
 */
export function updateCommentInNote(
  rawContent: string,
  commentId: string,
  newText: string
): string {
  const { mainContent, comments } = extractCommentsFromContent(rawContent);
  const updatedComments = comments.map((c) => {
    if (c.id === commentId) {
      return {
        ...c,
        content: newText.trim(),
        updatedAt: new Date().toISOString(),
      };
    }
    return c;
  });

  return embedCommentsIntoContent(mainContent, updatedComments);
}

/**
 * Deletes a comment from raw note content
 */
export function deleteCommentFromNote(
  rawContent: string,
  commentId: string
): string {
  const { mainContent, comments } = extractCommentsFromContent(rawContent);
  const updatedComments = comments.filter((c) => c.id !== commentId);
  return embedCommentsIntoContent(mainContent, updatedComments);
}
