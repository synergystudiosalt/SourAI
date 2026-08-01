/**
 * Parses a nested Markdown bullet list into a mind-map tree.
 *
 * The model returns an outline rather than a graph format because an outline is
 * the one structure every provider produces reliably; the shape is recovered
 * here from indentation.
 */

export interface MindMapNode {
  id: string;
  label: string;
  children: MindMapNode[];
}

const BULLET = /^(\s*)(?:[-*+]|\d+[.)])\s+(.*)$/;
const HEADING = /^(#{1,6})\s+(.*)$/;

function clean(text: string): string {
  return text
    .replace(/\[(\d{1,2})\]/g, '')
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/[*_`]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Builds the tree from indentation depth.
 *
 * Indentation is normalised by rank rather than by character count: models mix
 * two-space and four-space nesting inside a single reply, and counting spaces
 * would read the second style as a much deeper branch than it is.
 */
export function parseMindMap(markdown: string, rootLabel = 'Notebook'): MindMapNode {
  const lines = String(markdown ?? '').split(/\r?\n/);
  const entries: { indent: number; label: string }[] = [];

  for (const line of lines) {
    if (!line.trim()) continue;
    const heading = HEADING.exec(line);
    if (heading) {
      // A heading always outranks a bullet, however the bullet is indented, so
      // headings are ranked below zero rather than by their own character count.
      const label = clean(heading[2]);
      if (label) entries.push({ indent: heading[1].length - 100, label });
      continue;
    }
    const bullet = BULLET.exec(line);
    if (!bullet) continue;
    const label = clean(bullet[2]);
    if (!label) continue;
    entries.push({ indent: bullet[1].replace(/\t/g, '  ').length, label });
  }

  const ranks = [...new Set(entries.map((entry) => entry.indent))].sort((a, b) => a - b);
  const rankOf = (indent: number) => ranks.indexOf(indent);

  let counter = 0;
  const nextId = () => `mind-${counter++}`;
  const root: MindMapNode = { id: nextId(), label: rootLabel, children: [] };
  const stack: { depth: number; node: MindMapNode }[] = [{ depth: -1, node: root }];

  for (const entry of entries) {
    const depth = rankOf(entry.indent);
    while (stack.length > 1 && stack[stack.length - 1].depth >= depth) stack.pop();
    const node: MindMapNode = { id: nextId(), label: entry.label, children: [] };
    stack[stack.length - 1].node.children.push(node);
    stack.push({ depth, node });
  }

  // A single top-level bullet is the central concept the prompt asks for, so
  // it becomes the root instead of hanging one level below a synthetic one.
  if (root.children.length === 1) {
    const only = root.children[0];
    return only.children.length > 0 ? only : root;
  }
  return root;
}

export function countMindMapNodes(node: MindMapNode): number {
  return 1 + node.children.reduce((total, child) => total + countMindMapNodes(child), 0);
}

export function collectMindMapIds(node: MindMapNode, into: string[] = []): string[] {
  into.push(node.id);
  for (const child of node.children) collectMindMapIds(child, into);
  return into;
}

/** Flattens a mind map back to an indented outline, for copy-to-clipboard. */
export function mindMapToOutline(node: MindMapNode, depth = 0): string {
  const line = `${'  '.repeat(depth)}- ${node.label}`;
  return [line, ...node.children.map((child) => mindMapToOutline(child, depth + 1))].join('\n');
}
