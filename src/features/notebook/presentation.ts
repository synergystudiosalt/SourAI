import type PptxGenJS from 'pptxgenjs';

export interface PresentationSlide {
  title: string;
  bullets: string[];
}

export interface PresentationOutline {
  title: string;
  slides: PresentationSlide[];
}

function cleanInline(value: string): string {
  return value
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/[*_`]/g, '')
    .trim();
}

/** Parses the constrained Markdown emitted by the presentation prompt. */
export function parsePresentation(markdown: string, fallbackTitle = 'Presentation'): PresentationOutline {
  let title = fallbackTitle;
  const slides: PresentationSlide[] = [];
  let current: PresentationSlide | null = null;

  for (const rawLine of String(markdown ?? '').split(/\r?\n/)) {
    const line = rawLine.trim();
    const deckTitle = /^#\s+(.+)$/.exec(line);
    if (deckTitle && !line.startsWith('##')) {
      title = cleanInline(deckTitle[1]) || title;
      continue;
    }
    const slideTitle = /^##\s+(?:Slide\s+\d+\s*:\s*)?(.+)$/i.exec(line);
    if (slideTitle) {
      current = { title: cleanInline(slideTitle[1]) || `Slide ${slides.length + 1}`, bullets: [] };
      slides.push(current);
      continue;
    }
    const bullet = /^[-*+]\s+(.+)$/.exec(line);
    if (bullet && current) current.bullets.push(cleanInline(bullet[1]));
  }

  if (slides.length === 0) {
    const fallbackBullets = markdown
      .split(/\r?\n/)
      .map(cleanInline)
      .filter(Boolean)
      .slice(0, 5);
    slides.push({ title: 'Overview', bullets: fallbackBullets });
  }
  return { title, slides };
}

const NAVY = '172033';
const BLUE = '4776D5';
const INK = '16181D';
const MUTED = '667085';
const PAPER = 'F7F9FC';

export async function buildPptx(markdown: string, artifactTitle: string, notebookTitle?: string): Promise<Blob> {
  const { default: PptxGenJSConstructor } = await import('pptxgenjs');
  const pptx: PptxGenJS = new PptxGenJSConstructor();
  const outline = parsePresentation(markdown, artifactTitle);

  pptx.layout = 'LAYOUT_WIDE';
  pptx.author = 'sour.ai';
  pptx.company = 'sour.ai';
  pptx.subject = notebookTitle ? `Generated from ${notebookTitle}` : 'Notebook presentation';
  pptx.title = outline.title;

  const cover = pptx.addSlide();
  cover.background = { color: NAVY };
  cover.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 0.18, h: 7.5, fill: { color: BLUE }, line: { color: BLUE } });
  cover.addText(outline.title, {
    x: 0.85, y: 2.2, w: 11.5, h: 1.4, fontFace: 'Aptos Display', fontSize: 30,
    bold: true, color: 'FFFFFF', margin: 0, breakLine: false,
  });
  cover.addText(notebookTitle ? `${notebookTitle}  ·  Generated with sour.ai` : 'Generated with sour.ai', {
    x: 0.88, y: 4.05, w: 10.8, h: 0.35, fontFace: 'Aptos', fontSize: 11, color: 'A9B7D0', margin: 0,
  });

  outline.slides.forEach((item, index) => {
    const slide = pptx.addSlide();
    slide.background = { color: PAPER };
    slide.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 13.333, h: 0.12, fill: { color: BLUE }, line: { color: BLUE } });
    slide.addText(item.title, {
      x: 0.75, y: 0.55, w: 11.8, h: 0.65, fontFace: 'Aptos Display', fontSize: 24,
      bold: true, color: INK, margin: 0,
    });
    slide.addShape(pptx.ShapeType.line, { x: 0.75, y: 1.35, w: 11.8, h: 0, line: { color: 'D8DFEA', width: 1 } });
    const bullets = item.bullets.length ? item.bullets : ['Add supporting detail here.'];
    slide.addText(
      bullets.map((text) => ({ text, options: { bullet: { indent: 20 }, hanging: 4, breakLine: true } })),
      {
        x: 0.95, y: 1.65, w: 11.25, h: 4.8, fontFace: 'Aptos', fontSize: 19,
        color: INK, breakLine: false, margin: 0.08, paraSpaceAfter: 15, valign: 'middle',
        fit: 'shrink',
      }
    );
    slide.addText(`${index + 1}`, { x: 11.95, y: 6.9, w: 0.55, h: 0.25, fontFace: 'Aptos', fontSize: 9, color: MUTED, align: 'right', margin: 0 });
    slide.addText('sour.ai', { x: 0.75, y: 6.9, w: 1.2, h: 0.25, fontFace: 'Aptos', fontSize: 9, color: MUTED, margin: 0 });
  });

  const generated = (await pptx.write({ outputType: 'blob' })) as Blob;
  return new Blob([generated], {
    type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  });
}
