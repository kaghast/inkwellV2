/**
 * HTML to Markdown converter utility for Inkwell.
 * Transforms pasted HTML content (links, headings, bold, italic, lists, blockquotes, tables, code, etc.)
 * into clean, formatted Markdown.
 */

export function isUrl(str: string): boolean {
  if (!str) return false;
  const trimmed = str.trim();
  return /^https?:\/\/[^\s/$.?#].[^\s]*$/i.test(trimmed);
}

export function htmlToMarkdown(htmlString: string): string {
  if (!htmlString || !htmlString.trim()) return "";

  // Check if it's running in browser environment with DOMParser
  if (typeof DOMParser === "undefined") {
    return htmlString;
  }

  const parser = new DOMParser();
  const doc = parser.parseFromString(htmlString, "text/html");

  // Remove unwanted elements: script, style, meta, head, noscript, svg
  const unwanted = doc.querySelectorAll("script, style, meta, head, noscript, svg, link");
  unwanted.forEach((el) => el.remove());

  function processNode(node: Node, listContext?: { type: "ul" | "ol"; index: number }): string {
    if (node.nodeType === Node.TEXT_NODE) {
      return node.textContent || "";
    }

    if (node.nodeType !== Node.ELEMENT_NODE) {
      return "";
    }

    const el = node as HTMLElement;
    const tag = el.tagName.toLowerCase();

    // Helper to get text of children
    const getChildrenText = (ctx?: { type: "ul" | "ol"; index: number }) => {
      let result = "";
      for (let i = 0; i < el.childNodes.length; i++) {
        result += processNode(el.childNodes[i], ctx);
      }
      return result;
    };

    switch (tag) {
      case "h1":
        return `\n\n# ${getChildrenText().trim()}\n\n`;
      case "h2":
        return `\n\n## ${getChildrenText().trim()}\n\n`;
      case "h3":
        return `\n\n### ${getChildrenText().trim()}\n\n`;
      case "h4":
        return `\n\n#### ${getChildrenText().trim()}\n\n`;
      case "h5":
        return `\n\n##### ${getChildrenText().trim()}\n\n`;
      case "h6":
        return `\n\n###### ${getChildrenText().trim()}\n\n`;

      case "b":
      case "strong": {
        const text = getChildrenText().trim();
        return text ? `**${text}**` : "";
      }

      case "i":
      case "em": {
        const text = getChildrenText().trim();
        return text ? `*${text}*` : "";
      }

      case "s":
      case "del":
      case "strike": {
        const text = getChildrenText().trim();
        return text ? `~~${text}~~` : "";
      }

      case "code": {
        // If code is inside pre, pre handles it
        if (el.parentElement && el.parentElement.tagName.toLowerCase() === "pre") {
          return el.textContent || "";
        }
        const text = el.textContent || "";
        return text ? `\`${text}\`` : "";
      }

      case "pre": {
        const codeEl = el.querySelector("code");
        const lang = codeEl ? (codeEl.className.match(/language-(\w+)/)?.[1] || "") : "";
        const codeText = el.textContent || "";
        return "\n\n```" + lang + "\n" + codeText.replace(/^\n+|\n+$/g, "") + "\n```\n\n";
      }

      case "blockquote": {
        const content = getChildrenText().trim();
        const lines = content.split("\n").map((line) => `> ${line}`).join("\n");
        return `\n\n${lines}\n\n`;
      }

      case "a": {
        const href = el.getAttribute("href");
        const text = getChildrenText().trim();
        if (!href || href === "#" || href.startsWith("javascript:")) {
          return text;
        }
        if (!text || text === href) {
          return `[${href}](${href})`;
        }
        return `[${text}](${href})`;
      }

      case "img": {
        const src = el.getAttribute("src") || "";
        const alt = el.getAttribute("alt") || el.getAttribute("title") || "Görsel";
        if (!src) return "";
        return `![${alt}](${src})`;
      }

      case "ul": {
        let itemsText = "";
        let idx = 0;
        for (let i = 0; i < el.childNodes.length; i++) {
          const child = el.childNodes[i];
          if (child.nodeType === Node.ELEMENT_NODE && (child as HTMLElement).tagName.toLowerCase() === "li") {
            idx++;
            itemsText += processNode(child, { type: "ul", index: idx });
          }
        }
        return `\n\n${itemsText.trim()}\n\n`;
      }

      case "ol": {
        let itemsText = "";
        let idx = 0;
        for (let i = 0; i < el.childNodes.length; i++) {
          const child = el.childNodes[i];
          if (child.nodeType === Node.ELEMENT_NODE && (child as HTMLElement).tagName.toLowerCase() === "li") {
            idx++;
            itemsText += processNode(child, { type: "ol", index: idx });
          }
        }
        return `\n\n${itemsText.trim()}\n\n`;
      }

      case "li": {
        const checkbox = el.querySelector('input[type="checkbox"]') as HTMLInputElement | null;
        let prefix = listContext?.type === "ol" ? `${listContext.index}. ` : "- ";
        if (checkbox) {
          prefix = checkbox.checked ? "- [x] " : "- [ ] ";
        }
        const text = getChildrenText().trim();
        return `${prefix}${text}\n`;
      }

      case "table": {
        return processTable(el);
      }

      case "hr":
        return "\n\n---\n\n";

      case "br":
        return "\n";

      case "p":
        return `\n\n${getChildrenText().trim()}\n\n`;

      case "div":
      case "section":
      case "article":
        return `\n${getChildrenText()}\n`;

      default:
        return getChildrenText(listContext);
    }
  }

  function processTable(tableEl: HTMLElement): string {
    const rows = Array.from(tableEl.querySelectorAll("tr"));
    if (rows.length === 0) return "";

    const matrix: string[][] = [];

    rows.forEach((row) => {
      const cells = Array.from(row.querySelectorAll("th, td"));
      const rowData = cells.map((cell) => cell.textContent?.trim().replace(/\|/g, "\\|") || "");
      if (rowData.length > 0) {
        matrix.push(rowData);
      }
    });

    if (matrix.length === 0) return "";

    const maxCols = Math.max(...matrix.map((r) => r.length));
    if (maxCols === 0) return "";

    // Normalize rows to same column count
    const normalized = matrix.map((r) => {
      const copy = [...r];
      while (copy.length < maxCols) copy.push("");
      return copy;
    });

    let markdown = "\n\n";
    const headerRow = normalized[0];
    markdown += `| ${headerRow.join(" | ")} |\n`;
    markdown += `| ${headerRow.map(() => "---").join(" | ")} |\n`;

    for (let i = 1; i < normalized.length; i++) {
      markdown += `| ${normalized[i].join(" | ")} |\n`;
    }
    markdown += "\n";

    return markdown;
  }

  const rawMarkdown = processNode(doc.body);

  // Collapse excessive newlines (3+ -> 2)
  return rawMarkdown
    .replace(/\r\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Smart paste handler: Checks clipboardData for images, HTML, or URLs.
 * Returns the converted markdown text or null if default paste should proceed.
 */
export function handleClipboardPaste(
  clipboardData: DataTransfer,
  selectedText: string = ""
): { type: "image" | "markdown" | "url_selection" | "default"; content?: string; file?: File } {
  // 1. Check for image
  const items = clipboardData.items;
  for (let i = 0; i < items.length; i++) {
    if (items[i].type.startsWith("image/")) {
      const file = items[i].getAsFile();
      if (file) {
        return { type: "image", file };
      }
    }
  }

  const plainText = clipboardData.getData("text/plain") || "";
  const htmlData = clipboardData.getData("text/html") || "";

  // 2. Selected text + URL paste -> turn selected text into link [selected](url)
  if (selectedText.trim() && isUrl(plainText)) {
    return {
      type: "url_selection",
      content: `[${selectedText.trim()}](${plainText.trim()})`,
    };
  }

  // 3. HTML content to Markdown
  if (htmlData && htmlData.trim()) {
    // Check if HTML has formatting or links
    const converted = htmlToMarkdown(htmlData);
    if (converted && converted.trim()) {
      // If converted markdown contains markdown markup or is distinct from plain text
      const hasMarkdownMarkup =
        /\[[^\]]+\]\([^)]+\)/.test(converted) || // links [text](url)
        /\*\*[^*]+\*\*/.test(converted) || // bold
        /\*[^*]+\*/.test(converted) || // italic
        /^#+\s/m.test(converted) || // headers
        /^[-*+]\s/m.test(converted) || // list
        /^\d+\.\s/m.test(converted) || // ordered list
        /^>\s/m.test(converted) || // blockquote
        /\|.*\|/.test(converted) || // tables
        /```/.test(converted) || // code blocks
        /`[^`]+`/.test(converted); // inline code

      if (hasMarkdownMarkup || isUrl(plainText)) {
        // If plain text is a URL and converted is a link, prefer converted link
        return { type: "markdown", content: converted };
      }
    }
  }

  // 4. Plain text link paste: if plaintext is a single URL, we can keep it as URL or link
  if (isUrl(plainText)) {
    return { type: "markdown", content: plainText.trim() };
  }

  return { type: "default" };
}
