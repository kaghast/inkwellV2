/**
 * Mindmap Data Structure & Markdown Serializer / Parser
 */

export interface MindmapNode {
  id: string;
  text: string;
  children: MindmapNode[];
  color?: string;
  collapsed?: boolean;
  notes?: string;
}

const DEFAULT_COLORS = [
  "#3b82f6", // Blue
  "#10b981", // Emerald
  "#8b5cf6", // Purple
  "#f59e0b", // Amber
  "#ec4899", // Pink
  "#06b6d4", // Cyan
  "#f97316", // Orange
  "#6366f1", // Indigo
];

export function getRandomBranchColor(index: number): string {
  return DEFAULT_COLORS[index % DEFAULT_COLORS.length];
}

function genNodeId(): string {
  return "node_" + Math.random().toString(36).slice(2, 9);
}

/**
 * Parses markdown into a hierarchical Mindmap tree.
 * Supports:
 * 1. Headings (# Root, ## Child, ### Grandchild)
 * 2. Nested lists (- Root,   - Child,     - Grandchild)
 * 3. ```mindmap ... ``` JSON or outline blocks
 */
export function parseMindmapMarkdown(content: string, defaultRootTitle = "Ana Konu"): MindmapNode {
  if (!content || !content.trim()) {
    return {
      id: genNodeId(),
      text: defaultRootTitle,
      color: DEFAULT_COLORS[0],
      children: [
        { id: genNodeId(), text: "Fikir 1", color: DEFAULT_COLORS[1], children: [] },
        { id: genNodeId(), text: "Fikir 2", color: DEFAULT_COLORS[2], children: [] },
      ],
    };
  }

  // Check if explicit ```mindmap JSON exists
  const jsonMatch = content.match(/```mindmap\s*([\s\S]*?)```/);
  if (jsonMatch && jsonMatch[1]) {
    try {
      const parsed = JSON.parse(jsonMatch[1]);
      if (parsed && typeof parsed === "object" && parsed.text) {
        return ensureNodeIds(parsed);
      }
    } catch {
      // Fallback to text parsing
    }
  }

  // Strip code fences if any
  const cleanContent = content.replace(/```(?:mindmap|markdown)?/g, "").trim();
  const lines = cleanContent.split(/\r?\n/).filter((l) => l.trim().length > 0);

  if (lines.length === 0) {
    return {
      id: genNodeId(),
      text: defaultRootTitle,
      color: DEFAULT_COLORS[0],
      children: [],
    };
  }

  // Parse lines into flat items with level
  interface FlatItem {
    level: number;
    text: string;
    color?: string;
  }

  const items: FlatItem[] = [];

  for (const line of lines) {
    // Check heading: # Level 1, ## Level 2
    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      items.push({
        level: headingMatch[1].length - 1,
        text: headingMatch[2].trim(),
      });
      continue;
    }

    // Check list item: - Item,   * Item, 1. Item
    const listMatch = line.match(/^([ \t]*)(?:[-*+]|\d+\.)\s+(.+)$/);
    if (listMatch) {
      const indent = listMatch[1].replace(/\t/g, "  ").length;
      const level = Math.floor(indent / 2);
      items.push({
        level: level + 1, // List items under root
        text: listMatch[2].trim(),
      });
      continue;
    }

    // Plain text line
    items.push({
      level: 0,
      text: line.trim(),
    });
  }

  if (items.length === 0) {
    return { id: genNodeId(), text: defaultRootTitle, children: [] };
  }

  // Root node is first level 0 item or defaultRootTitle
  const rootText = items[0].level === 0 ? items[0].text : defaultRootTitle;
  const root: MindmapNode = {
    id: genNodeId(),
    text: rootText,
    color: DEFAULT_COLORS[0],
    children: [],
  };

  const stack: { node: MindmapNode; level: number }[] = [{ node: root, level: 0 }];
  const startIndex = items[0].level === 0 ? 1 : 0;

  for (let i = startIndex; i < items.length; i++) {
    const item = items[i];
    const targetLevel = Math.max(1, item.level);

    // Pop from stack until top of stack is parent
    while (stack.length > 1 && stack[stack.length - 1].level >= targetLevel) {
      stack.pop();
    }

    const parent = stack[stack.length - 1].node;
    const branchColor =
      parent === root
        ? getRandomBranchColor(parent.children.length)
        : parent.color || DEFAULT_COLORS[0];

    const newNode: MindmapNode = {
      id: genNodeId(),
      text: item.text,
      color: branchColor,
      children: [],
    };

    parent.children.push(newNode);
    stack.push({ node: newNode, level: targetLevel });
  }

  return root;
}

function ensureNodeIds(node: any, level = 0, parentColor?: string): MindmapNode {
  const color = node.color || (level === 0 ? DEFAULT_COLORS[0] : parentColor || getRandomBranchColor(0));
  const clean: MindmapNode = {
    id: node.id || genNodeId(),
    text: node.text || "Düğüm",
    color,
    collapsed: Boolean(node.collapsed),
    notes: node.notes,
    children: [],
  };

  if (Array.isArray(node.children)) {
    clean.children = node.children.map((child: any, idx: number) => {
      const branchColor = level === 0 ? getRandomBranchColor(idx) : color;
      return ensureNodeIds(child, level + 1, branchColor);
    });
  }

  return clean;
}

/**
 * Serializes Mindmap tree to clean, standard Markdown hierarchy.
 */
export function serializeMindmapMarkdown(root: MindmapNode): string {
  if (!root) return "";

  const lines: string[] = [];

  function traverse(node: MindmapNode, depth: number) {
    if (depth === 0) {
      lines.push(`# ${node.text || "Ana Konu"}`);
    } else if (depth === 1) {
      lines.push(`\n## ${node.text || "Alt Dal"}`);
    } else {
      const indent = "  ".repeat(depth - 1);
      lines.push(`${indent}- ${node.text || "Madde"}`);
    }

    if (Array.isArray(node.children) && !node.collapsed) {
      node.children.forEach((child) => traverse(child, depth + 1));
    }
  }

  traverse(root, 0);
  return lines.join("\n").trim();
}

/**
 * Serializes Mindmap tree to code block with JSON backup for complex properties
 */
export function serializeMindmapCodeBlock(root: MindmapNode): string {
  return "```mindmap\n" + JSON.stringify(root, null, 2) + "\n```";
}

/**
 * Node mutation helpers
 */
export function addChildNode(root: MindmapNode, parentId: string, text = "Yeni Fikir"): MindmapNode {
  const cloned = JSON.parse(JSON.stringify(root)) as MindmapNode;

  function findAndAdd(node: MindmapNode): boolean {
    if (node.id === parentId) {
      const color = node === cloned ? getRandomBranchColor(node.children.length) : node.color;
      node.children.push({
        id: genNodeId(),
        text,
        color,
        children: [],
      });
      return true;
    }
    for (const child of node.children) {
      if (findAndAdd(child)) return true;
    }
    return false;
  }

  findAndAdd(cloned);
  return cloned;
}

export function addSiblingNode(root: MindmapNode, targetId: string, text = "Yeni Dal"): MindmapNode {
  if (root.id === targetId) {
    // Sibling of root -> add child to root
    return addChildNode(root, targetId, text);
  }

  const cloned = JSON.parse(JSON.stringify(root)) as MindmapNode;

  function findParentAndAdd(node: MindmapNode): boolean {
    const idx = node.children.findIndex((c) => c.id === targetId);
    if (idx !== -1) {
      const color = node === cloned ? getRandomBranchColor(node.children.length) : node.color;
      node.children.splice(idx + 1, 0, {
        id: genNodeId(),
        text,
        color,
        children: [],
      });
      return true;
    }
    for (const child of node.children) {
      if (findParentAndAdd(child)) return true;
    }
    return false;
  }

  findParentAndAdd(cloned);
  return cloned;
}

export function updateNodeText(root: MindmapNode, nodeId: string, newText: string): MindmapNode {
  const cloned = JSON.parse(JSON.stringify(root)) as MindmapNode;

  function update(node: MindmapNode): boolean {
    if (node.id === nodeId) {
      node.text = newText;
      return true;
    }
    for (const child of node.children) {
      if (update(child)) return true;
    }
    return false;
  }

  update(cloned);
  return cloned;
}

export function updateNodeColor(root: MindmapNode, nodeId: string, newColor: string): MindmapNode {
  const cloned = JSON.parse(JSON.stringify(root)) as MindmapNode;

  function update(node: MindmapNode): boolean {
    if (node.id === nodeId) {
      node.color = newColor;
      // Propagate color to subchildren if desired
      const applyColor = (n: MindmapNode) => {
        n.color = newColor;
        n.children.forEach(applyColor);
      };
      node.children.forEach(applyColor);
      return true;
    }
    for (const child of node.children) {
      if (update(child)) return true;
    }
    return false;
  }

  update(cloned);
  return cloned;
}

export function deleteNode(root: MindmapNode, nodeId: string): MindmapNode {
  if (root.id === nodeId) {
    // Reset root text
    return { ...root, text: "Ana Konu", children: [] };
  }

  const cloned = JSON.parse(JSON.stringify(root)) as MindmapNode;

  function remove(node: MindmapNode): boolean {
    const idx = node.children.findIndex((c) => c.id === nodeId);
    if (idx !== -1) {
      node.children.splice(idx, 1);
      return true;
    }
    for (const child of node.children) {
      if (remove(child)) return true;
    }
    return false;
  }

  remove(cloned);
  return cloned;
}

export function toggleNodeCollapse(root: MindmapNode, nodeId: string): MindmapNode {
  const cloned = JSON.parse(JSON.stringify(root)) as MindmapNode;

  function toggle(node: MindmapNode): boolean {
    if (node.id === nodeId) {
      node.collapsed = !node.collapsed;
      return true;
    }
    for (const child of node.children) {
      if (toggle(child)) return true;
    }
    return false;
  }

  toggle(cloned);
  return cloned;
}
