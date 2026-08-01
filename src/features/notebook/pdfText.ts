/**
 * Full-document PDF reading for notebook sources.
 *
 * The chat attachment parser deliberately stops after five pages and renders
 * each one to a canvas, because there the PDF is a picture handed to a vision
 * model. A notebook source is the opposite: the whole document matters, and no
 * image is needed for a page that already carries text. Reusing that parser
 * silently truncated every PDF past page five, so grounded answers were drawn
 * from a fraction of the file.
 *
 * Pages that carry no text layer — scans, exported slides, photographed
 * documents — are reported rather than dropped, so the caller can have them
 * transcribed by the model (see `pdfOcr`). Text is joined with page markers so
 * a citation can still be traced to where in the document it came from.
 */

// Type-only, so pdfjs itself is still loaded lazily by `loadPdfjs`.
import type { PDFDocumentLoadingTask, PDFDocumentProxy } from 'pdfjs-dist';

import { loadPdfjs } from '../../utils/fileParser';

export const PDF_TEXT_LIMITS = Object.freeze({
  /** Generous: a book is a legitimate source, a runaway file is not. */
  maxPages: 1_500,
  maxCharacters: 1_000_000,
  maxBytes: 100 * 1024 * 1024,
  /** Longest edge of a rendered page image, in pixels, before transcription. */
  renderMaxDimension: 1_600,
  renderMaxPixels: 4_000_000,
});

export const PDF_TRUNCATION_NOTE =
  '\n\n[... document truncated: the rest exceeds the per-source limit ...]';

export class PdfTextError extends Error {
  constructor(
    message: string,
    readonly code: 'too_large' | 'unreadable' | 'no_text'
  ) {
    super(message);
    this.name = 'PdfTextError';
  }
}

export interface PdfPageText {
  page: number;
  text: string;
  /** True when the page has no text layer and needs transcription. */
  needsTranscription: boolean;
}

export interface PdfReadResult {
  pages: PdfPageText[];
  pageCount: number;
  truncated: boolean;
}

interface PdfTextItem {
  str?: unknown;
  hasEOL?: unknown;
}

/** Rebuilds readable lines from pdf.js text items. */
export function joinTextItems(items: readonly unknown[]): string {
  let out = '';
  for (const entry of items) {
    if (!entry || typeof entry !== 'object' || !('str' in entry)) continue;
    const item = entry as PdfTextItem;
    const value = typeof item.str === 'string' ? item.str : String(item.str ?? '');
    if (!value) {
      if (item.hasEOL) out += '\n';
      continue;
    }
    // pdf.js emits a run per style change, so a naive join with spaces breaks
    // words apart. Only insert one where neither side already has whitespace.
    if (out && !/\s$/.test(out) && !/^\s/.test(value)) out += ' ';
    out += value;
    if (item.hasEOL) out += '\n';
  }
  return out;
}

/**
 * A PDF held open across the text pass and any later transcription.
 *
 * Transcription is paced over minutes, and reopening the document for each
 * page would re-parse the whole file every time.
 */
export class PdfDocumentHandle {
  private constructor(
    private readonly task: PDFDocumentLoadingTask,
    private readonly document: PDFDocumentProxy,
    readonly pageCount: number
  ) {}

  static async open(file: Blob, name = 'document.pdf'): Promise<PdfDocumentHandle> {
    if (file.size > PDF_TEXT_LIMITS.maxBytes) {
      throw new PdfTextError(
        `${name} is larger than the ${Math.round(
          PDF_TEXT_LIMITS.maxBytes / (1024 * 1024)
        )} MB limit for a single source.`,
        'too_large'
      );
    }
    try {
      const pdfjs = await loadPdfjs();
      const data = new Uint8Array(await file.arrayBuffer());
      const task = pdfjs.getDocument({ data });
      const document = await task.promise;
      return new PdfDocumentHandle(task, document, document.numPages);
    } catch (error) {
      throw new PdfTextError(
        `${name} could not be opened as a PDF${
          (error as Error)?.message ? `: ${(error as Error).message}` : '.'
        }`,
        'unreadable'
      );
    }
  }

  async readText(pageNumber: number): Promise<string> {
    const page = await this.document.getPage(pageNumber);
    try {
      const content = await page.getTextContent();
      return joinTextItems(content.items).replace(/[ \t]+\n/g, '\n').trim();
    } finally {
      // Without this each page's operator list is retained for the lifetime of
      // the document, which is what turns a long PDF into a memory spike.
      page.cleanup();
    }
  }

  /** Renders one page to a JPEG data URL for the transcription model. */
  async renderPage(pageNumber: number): Promise<string | null> {
    const page = await this.document.getPage(pageNumber);
    try {
      const base = page.getViewport({ scale: 1 });
      const longest = Math.max(base.width, base.height);
      const scale = longest > 0 ? Math.min(2, PDF_TEXT_LIMITS.renderMaxDimension / longest) : 1;
      const viewport = page.getViewport({ scale: Math.max(scale, 0.1) });
      const pixels = viewport.width * viewport.height;
      if (!Number.isFinite(pixels) || pixels <= 0 || pixels > PDF_TEXT_LIMITS.renderMaxPixels) {
        return null;
      }
      const canvas = document.createElement('canvas');
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      const context = canvas.getContext('2d');
      if (!context) return null;
      // Scans are usually black on white; an opaque backing keeps transparent
      // regions from rendering as black and swallowing the text.
      context.fillStyle = '#FFFFFF';
      context.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvasContext: context, viewport, canvas } as never).promise;
      return canvas.toDataURL('image/jpeg', 0.82);
    } catch {
      return null;
    } finally {
      page.cleanup();
    }
  }

  async close(): Promise<void> {
    await this.task.destroy().catch(() => {});
  }
}

/**
 * Reads the text layer of every page.
 *
 * Pages with no text are recorded with `needsTranscription` rather than
 * dropped: a scanned document is a legitimate source, it just needs a
 * different reader.
 */
export async function readPdfPages(handle: PdfDocumentHandle): Promise<PdfReadResult> {
  const readable = Math.min(handle.pageCount, PDF_TEXT_LIMITS.maxPages);
  const pages: PdfPageText[] = [];
  let characters = 0;
  let truncated = readable < handle.pageCount;

  for (let pageNumber = 1; pageNumber <= readable; pageNumber++) {
    if (characters >= PDF_TEXT_LIMITS.maxCharacters) {
      truncated = true;
      break;
    }
    const text = await handle.readText(pageNumber);
    const room = PDF_TEXT_LIMITS.maxCharacters - characters;
    const clipped = text.length > room ? text.slice(0, room) : text;
    if (clipped.length < text.length) truncated = true;
    characters += clipped.length;
    pages.push({ page: pageNumber, text: clipped, needsTranscription: clipped.trim().length === 0 });
  }

  return { pages, pageCount: handle.pageCount, truncated };
}

/** Assembles page texts into the stored source body. */
export function composePdfText(pages: readonly PdfPageText[], truncated = false): string {
  const body = pages
    .filter((page) => page.text.trim())
    .map((page) => `[Page ${page.page}]\n${page.text.trim()}`)
    .join('\n\n')
    .trim();
  return truncated && body ? body + PDF_TRUNCATION_NOTE : body;
}

export interface ExtractPdfOptions {
  /** Reports progress of the text pass. */
  onProgress?: (pagesRead: number, pageCount: number) => void;
}

export interface ExtractedPdf extends PdfReadResult {
  text: string;
  /** Page numbers still needing model transcription, in order. */
  pendingPages: number[];
  handle: PdfDocumentHandle;
}

/**
 * Opens a PDF and reads every text-bearing page.
 *
 * The handle is returned still open, because any page that needs transcription
 * has to be rendered from the same document. Callers must `close()` it.
 */
export async function extractPdf(
  file: File | Blob,
  name = 'document.pdf',
  options: ExtractPdfOptions = {}
): Promise<ExtractedPdf> {
  const handle = await PdfDocumentHandle.open(file, name);
  try {
    const result = await readPdfPages(handle);
    options.onProgress?.(result.pages.length, result.pageCount);
    return {
      ...result,
      text: composePdfText(result.pages, result.truncated),
      pendingPages: result.pages.filter((page) => page.needsTranscription).map((page) => page.page),
      handle,
    };
  } catch (error) {
    await handle.close();
    throw error;
  }
}
