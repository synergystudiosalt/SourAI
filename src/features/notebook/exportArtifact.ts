/**
 * Downloads a studio output as a Word document or as an image.
 *
 * Both formats are built in the browser. A .docx is a ZIP of XML parts, and
 * JSZip is already a dependency, so a real Word file costs nothing extra; the
 * image is drawn on a canvas rather than rasterising the DOM, which keeps it
 * free of the app's chrome and independent of any CSP-restricted renderer.
 */

export interface ExportableArtifact {
  title: string;
  /** Prose form — flashcards and quizzes must be converted before they arrive. */
  text: string;
  kindLabel: string;
  notebookTitle?: string;
}

export type ExportFormat = 'docx' | 'png' | 'pptx';

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
    // Word rejects the document part outright if it contains a control
    // character, so they are dropped rather than escaped.
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
}

export function safeFileName(value: string, fallback = 'sour-ai-notebook'): string {
  const cleaned = value
    .replace(/[\u0000-\u001F<>:"/\\|?*]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
  return cleaned || fallback;
}

interface Block {
  kind: 'heading1' | 'heading2' | 'heading3' | 'bullet' | 'numbered' | 'paragraph';
  text: string;
}

/**
 * Reduces Markdown to the handful of block types both exporters can render.
 *
 * A full Markdown implementation is not the point here; headings, lists and
 * paragraphs are what the studio actually emits.
 */
export function toBlocks(markdown: string): Block[] {
  const blocks: Block[] = [];
  let paragraph: string[] = [];

  const flush = () => {
    if (paragraph.length === 0) return;
    blocks.push({ kind: 'paragraph', text: inline(paragraph.join(' ')) });
    paragraph = [];
  };

  for (const rawLine of String(markdown ?? '').split(/\r?\n/)) {
    const line = rawLine.trimEnd();
    if (!line.trim()) {
      flush();
      continue;
    }
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      flush();
      const level = heading[1].length;
      blocks.push({
        kind: level === 1 ? 'heading1' : level === 2 ? 'heading2' : 'heading3',
        text: inline(heading[2]),
      });
      continue;
    }
    const bullet = /^\s*[-*+]\s+(.*)$/.exec(line);
    if (bullet) {
      flush();
      blocks.push({ kind: 'bullet', text: inline(bullet[1]) });
      continue;
    }
    const numbered = /^\s*(\d+)[.)]\s+(.*)$/.exec(line);
    if (numbered) {
      flush();
      blocks.push({ kind: 'numbered', text: inline(`${numbered[1]}. ${numbered[2]}`) });
      continue;
    }
    if (/^\s*(---|\*\*\*|___)\s*$/.test(line)) {
      flush();
      continue;
    }
    paragraph.push(line.trim());
  }
  flush();
  return blocks;
}

/** Strips the inline markers; the exporters carry no character styling. */
function inline(value: string): string {
  return value
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/(^|[^*])\*(?!\s)([^*]+?)\*/g, '$1$2')
    .replace(/`([^`]+)`/g, '$1')
    .trim();
}

// ── Word ────────────────────────────────────────────────────────────────────

const DOCX_STYLE: Record<Block['kind'], { size: number; bold: boolean; before: number }> = {
  heading1: { size: 32, bold: true, before: 240 },
  heading2: { size: 26, bold: true, before: 220 },
  heading3: { size: 23, bold: true, before: 200 },
  paragraph: { size: 21, bold: false, before: 80 },
  bullet: { size: 21, bold: false, before: 40 },
  numbered: { size: 21, bold: false, before: 40 },
};

function paragraphXml(block: Block): string {
  const style = DOCX_STYLE[block.kind];
  const indent =
    block.kind === 'bullet' || block.kind === 'numbered'
      ? '<w:ind w:left="360" w:hanging="180"/>'
      : '';
  const text = block.kind === 'bullet' ? `• ${block.text}` : block.text;
  return (
    `<w:p><w:pPr><w:spacing w:before="${style.before}" w:after="60" w:line="276" w:lineRule="auto"/>${indent}</w:pPr>` +
    `<w:r><w:rPr>${style.bold ? '<w:b/>' : ''}<w:sz w:val="${style.size}"/></w:rPr>` +
    `<w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r></w:p>`
  );
}

export function buildDocumentXml(artifact: ExportableArtifact): string {
  const heading = paragraphXml({ kind: 'heading1', text: artifact.title });
  const subtitle = paragraphXml({
    kind: 'paragraph',
    text: artifact.notebookTitle
      ? `${artifact.kindLabel} · ${artifact.notebookTitle}`
      : artifact.kindLabel,
  });
  const body = toBlocks(artifact.text).map(paragraphXml).join('');
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
    `<w:body>${heading}${subtitle}${body}` +
    '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/>' +
    '<w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134"/></w:sectPr>' +
    '</w:body></w:document>'
  );
}

const CONTENT_TYPES_XML =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
  '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
  '<Default Extension="xml" ContentType="application/xml"/>' +
  '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
  '</Types>';

const ROOT_RELS_XML =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
  '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
  '</Relationships>';

export async function buildDocx(artifact: ExportableArtifact): Promise<Blob> {
  const { default: JSZip } = await import('jszip');
  const zip = new JSZip();
  zip.file('[Content_Types].xml', CONTENT_TYPES_XML);
  zip.file('_rels/.rels', ROOT_RELS_XML);
  zip.file('word/document.xml', buildDocumentXml(artifact));
  return zip.generateAsync({
    type: 'blob',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  });
}

// ── Image ───────────────────────────────────────────────────────────────────

const IMAGE_WIDTH = 1240;
const IMAGE_PADDING = 72;
const IMAGE_MAX_HEIGHT = 20_000;

interface DrawnLine {
  text: string;
  font: string;
  lineHeight: number;
  spaceBefore: number;
  indent: number;
}

/** Lays the blocks out at a fixed width so the height can be measured first. */
function layout(
  context: CanvasRenderingContext2D,
  blocks: readonly Block[],
  maxWidth: number
): DrawnLine[] {
  const styles: Record<Block['kind'], { font: string; height: number; before: number; indent: number }> = {
    heading1: { font: '600 34px Georgia, serif', height: 46, before: 26, indent: 0 },
    heading2: { font: '600 25px Georgia, serif', height: 36, before: 22, indent: 0 },
    heading3: { font: '600 21px Georgia, serif', height: 31, before: 18, indent: 0 },
    paragraph: { font: '17px system-ui, sans-serif', height: 28, before: 12, indent: 0 },
    bullet: { font: '17px system-ui, sans-serif', height: 28, before: 6, indent: 26 },
    numbered: { font: '17px system-ui, sans-serif', height: 28, before: 6, indent: 26 },
  };

  const lines: DrawnLine[] = [];
  for (const block of blocks) {
    const style = styles[block.kind];
    context.font = style.font;
    const text = block.kind === 'bullet' ? `•  ${block.text}` : block.text;
    const words = text.split(/\s+/).filter(Boolean);
    let current = '';
    let first = true;
    const available = maxWidth - style.indent;

    for (const word of words) {
      const candidate = current ? `${current} ${word}` : word;
      if (context.measureText(candidate).width <= available || !current) {
        current = candidate;
        continue;
      }
      lines.push({
        text: current,
        font: style.font,
        lineHeight: style.height,
        spaceBefore: first ? style.before : 0,
        indent: style.indent,
      });
      first = false;
      current = word;
    }
    if (current) {
      lines.push({
        text: current,
        font: style.font,
        lineHeight: style.height,
        spaceBefore: first ? style.before : 0,
        indent: style.indent,
      });
    }
  }
  return lines;
}

export async function buildImage(artifact: ExportableArtifact): Promise<Blob> {
  const blocks: Block[] = [
    { kind: 'heading1', text: artifact.title },
    {
      kind: 'paragraph',
      text: artifact.notebookTitle
        ? `${artifact.kindLabel} · ${artifact.notebookTitle}`
        : artifact.kindLabel,
    },
    ...toBlocks(artifact.text),
  ];

  const measure = document.createElement('canvas').getContext('2d');
  if (!measure) throw new Error('This browser cannot render the image export.');
  const contentWidth = IMAGE_WIDTH - IMAGE_PADDING * 2;
  const lines = layout(measure, blocks, contentWidth);

  const height = Math.min(
    IMAGE_MAX_HEIGHT,
    Math.max(
      420,
      lines.reduce((total, line) => total + line.spaceBefore + line.lineHeight, 0) +
        IMAGE_PADDING * 2 +
        40
    )
  );

  const canvas = document.createElement('canvas');
  canvas.width = IMAGE_WIDTH;
  canvas.height = Math.ceil(height);
  const context = canvas.getContext('2d');
  if (!context) throw new Error('This browser cannot render the image export.');

  context.fillStyle = '#fbfcfd';
  context.fillRect(0, 0, canvas.width, canvas.height);
  // A rule down the left edge, matching the app's boxy chrome.
  context.fillStyle = '#4776d5';
  context.fillRect(0, 0, 6, canvas.height);

  let y = IMAGE_PADDING;
  context.textBaseline = 'top';
  for (const line of lines) {
    y += line.spaceBefore;
    if (y + line.lineHeight > canvas.height - IMAGE_PADDING / 2) break;
    context.font = line.font;
    context.fillStyle = line.font.includes('Georgia') ? '#16181d' : '#2b3038';
    context.fillText(line.text, IMAGE_PADDING + line.indent, y);
    y += line.lineHeight;
  }

  context.font = '13px system-ui, sans-serif';
  context.fillStyle = '#78828e';
  context.fillText('Generated with sour.ai', IMAGE_PADDING, canvas.height - IMAGE_PADDING / 2);

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('The image could not be encoded.'))),
      'image/png'
    );
  });
}

// ── Download ────────────────────────────────────────────────────────────────

export function saveBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.rel = 'noopener noreferrer';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  // Revoked on the next tick so the download has taken the reference.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

export async function downloadArtifact(
  artifact: ExportableArtifact,
  format: ExportFormat
): Promise<void> {
  const base = safeFileName(artifact.title);
  if (format === 'pptx') {
    const { buildPptx } = await import('./presentation');
    saveBlob(await buildPptx(artifact.text, artifact.title, artifact.notebookTitle), `${base}.pptx`);
    return;
  }
  if (format === 'docx') {
    saveBlob(await buildDocx(artifact), `${base}.docx`);
    return;
  }
  saveBlob(await buildImage(artifact), `${base}.png`);
}
