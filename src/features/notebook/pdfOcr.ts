/**
 * Transcribes the pages of a PDF that carry no text layer.
 *
 * A scanned document is a legitimate source; it just has no text to extract.
 * Each such page is rendered locally and sent to the vision model, which reads
 * it back as text.
 *
 * Requests are paced rather than issued in parallel. A 200-page scan is 200
 * multimodal calls, and firing those as fast as the browser can would exhaust
 * the shared provider keys in seconds — for this user and for everyone else on
 * the deployment. One page per interval keeps a long document in the
 * background where it belongs, and the job reports progress and is cancellable
 * so nobody has to sit and watch it.
 */

import { transcribePdfPage } from './api';
import { PdfDocumentHandle } from './pdfText';

/** Gap between transcription requests. Deliberately slow; see above. */
export const OCR_PAGE_INTERVAL_MS = 60_000;

export interface OcrProgress {
  /** Pages transcribed so far, successful or not. */
  completed: number;
  total: number;
  /** The page currently being read. */
  page: number;
  /** Milliseconds until the job is expected to finish. */
  estimatedRemainingMs: number;
}

export interface OcrPageResult {
  page: number;
  text: string;
}

export interface TranscribeOptions {
  handle: PdfDocumentHandle;
  pages: readonly number[];
  signal?: AbortSignal;
  /** Called after each page, so the source can grow as the job runs. */
  onPage: (result: OcrPageResult) => void;
  onProgress?: (progress: OcrProgress) => void;
  intervalMs?: number;
}

export interface TranscribeSummary {
  transcribed: number;
  blank: number;
  failed: number;
  cancelled: boolean;
}

class Cancelled extends Error {
  constructor() {
    super('Transcription cancelled');
    this.name = 'Cancelled';
  }
}

function wait(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Cancelled());
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new Cancelled());
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * Runs the paced transcription.
 *
 * Resolves with a summary rather than throwing on cancellation: a half-read
 * document is still a usable source, and the pages already transcribed have
 * been handed to `onPage` as they arrived.
 */
export async function transcribePdfPages(
  options: TranscribeOptions
): Promise<TranscribeSummary> {
  const { handle, pages, signal, onPage, onProgress } = options;
  const interval = options.intervalMs ?? OCR_PAGE_INTERVAL_MS;
  const summary: TranscribeSummary = { transcribed: 0, blank: 0, failed: 0, cancelled: false };

  for (let index = 0; index < pages.length; index++) {
    if (signal?.aborted) {
      summary.cancelled = true;
      break;
    }
    const page = pages[index];
    onProgress?.({
      completed: index,
      total: pages.length,
      page,
      estimatedRemainingMs: (pages.length - index) * interval,
    });

    try {
      const image = await handle.renderPage(page);
      if (!image) {
        summary.failed++;
      } else {
        const reply = await transcribePdfPage({ image, page, signal });
        const text = reply.text.trim();
        if (text) {
          summary.transcribed++;
          onPage({ page, text });
        } else {
          summary.blank++;
        }
      }
    } catch (error) {
      if ((error as Error)?.name === 'AbortError' || error instanceof Cancelled) {
        summary.cancelled = true;
        break;
      }
      // One unreadable page must not abandon the other 199.
      console.error(`[sour.ai] Could not transcribe page ${page}`, error);
      summary.failed++;
    }

    // The pace applies between requests, not after the last one.
    if (index < pages.length - 1) {
      try {
        await wait(interval, signal);
      } catch {
        summary.cancelled = true;
        break;
      }
    }
  }

  onProgress?.({
    completed: pages.length,
    total: pages.length,
    page: pages[pages.length - 1] ?? 0,
    estimatedRemainingMs: 0,
  });
  return summary;
}

/** "about 12 min left", for a progress row that is going to be on screen a while. */
export function formatRemaining(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return 'finishing';
  // Rounding first would turn 30 seconds into "about 1 min", which reads as an
  // overestimate of something that is nearly done.
  if (ms < 60_000) return 'less than a minute left';
  const minutes = Math.round(ms / 60_000);
  if (minutes >= 60) {
    const hours = Math.floor(minutes / 60);
    const rest = minutes % 60;
    return rest ? `about ${hours} hr ${rest} min left` : `about ${hours} hr left`;
  }
  return `about ${minutes} min left`;
}
