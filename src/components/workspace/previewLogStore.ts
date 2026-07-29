import { parsePreviewLog, type PreviewLogEntry } from '../../security/previewIsolation';

type PreviewLogListener = () => void;
type PreviewMessage = Pick<MessageEvent, 'data' | 'source'>;

const MAX_STORED_ENTRIES = 200;

let entries: readonly PreviewLogEntry[] = [];
const listeners = new Set<PreviewLogListener>();

function emitChange(): void {
  for (const listener of listeners) listener();
}

/** Returns the immutable log snapshot produced by the currently previewed source. */
export function getPreviewLogs(): readonly PreviewLogEntry[] {
  return entries;
}

/** Clears the prior document's output before a new preview source is submitted. */
export function resetPreviewLogs(): void {
  entries = [];
  emitChange();
}

export function subscribeToPreviewLogs(listener: PreviewLogListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Accepts output only from the active sandbox browsing context.
 *
 * Sandboxed previews have an opaque origin (`null`), so origin checks cannot
 * distinguish our frame from another opaque frame. Window identity can.
 */
export function collectPreviewMessage(
  event: PreviewMessage,
  previewWindow: Window | null
): PreviewLogEntry | null {
  if (!previewWindow || event.source !== previewWindow) return null;
  const entry = parsePreviewLog(event.data);
  if (!entry) return null;

  entries = [...entries.slice(-(MAX_STORED_ENTRIES - 1)), entry];
  emitChange();
  return entry;
}
