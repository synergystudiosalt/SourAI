import { parsePreviewLog, type PreviewLogEntry } from '../../security/previewIsolation';

type PreviewLogListener = (entry?: PreviewLogEntry) => void;
type PreviewMessage = Pick<MessageEvent, 'data' | 'source'>;
export type PreviewLogFramePriority = 'headless' | 'visible';

const MAX_STORED_ENTRIES = 200;

let entries: readonly PreviewLogEntry[] = [];
const listeners = new Set<PreviewLogListener>();
const registeredFrames = new Map<symbol, { priority: number; order: number }>();
let registrationOrder = 0;
let activeFrame: symbol | null = null;

function emitChange(entry?: PreviewLogEntry): void {
  for (const listener of listeners) listener(entry);
}

function selectActiveFrame(): void {
  let selected: { token: symbol; priority: number; order: number } | null = null;
  for (const [token, registration] of registeredFrames) {
    if (
      !selected ||
      registration.priority > selected.priority ||
      (registration.priority === selected.priority && registration.order > selected.order)
    ) {
      selected = { token, ...registration };
    }
  }
  activeFrame = selected?.token ?? null;
}

/**
 * Registers one iframe as a possible producer for the shared preview console.
 * A visible preview always wins over a headless collector, and only the winning
 * token is allowed to reset or append to the store.
 */
export function registerPreviewLogFrame(
  token: symbol,
  priority: PreviewLogFramePriority
): () => void {
  registeredFrames.set(token, {
    priority: priority === 'visible' ? 1 : 0,
    order: ++registrationOrder,
  });
  selectActiveFrame();

  return () => {
    registeredFrames.delete(token);
    selectActiveFrame();
  };
}

/** Returns the immutable log snapshot produced by the currently previewed source. */
export function getPreviewLogs(): readonly PreviewLogEntry[] {
  return entries;
}

/** Clears the prior document's output before a new preview source is submitted. */
export function resetPreviewLogs(frameToken?: symbol): void {
  if (frameToken && frameToken !== activeFrame) return;
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
  previewWindow: Window | null,
  frameToken?: symbol
): PreviewLogEntry | null {
  if (frameToken && frameToken !== activeFrame) return null;
  if (!previewWindow || event.source !== previewWindow) return null;
  const entry = parsePreviewLog(event.data);
  if (!entry) return null;

  entries = [...entries.slice(-(MAX_STORED_ENTRIES - 1)), entry];
  emitChange(entry);
  return entry;
}
