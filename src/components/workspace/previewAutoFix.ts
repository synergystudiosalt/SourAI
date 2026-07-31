import type { PreviewLogEntry } from '../../security/previewIsolation';
import { subscribeToPreviewLogs } from './previewLogStore';

export const PREVIEW_RUNTIME_SETTLE_MS = 1_500;
export const MAX_PREVIEW_AUTO_FIX_ATTEMPTS = 2;
export const MAX_PREVIEW_ERRORS_PER_TURN = 5;
export const MAX_PREVIEW_ERROR_CHARS = 700;

export type PreviewRuntimeWaitResult = 'error' | 'timeout' | 'aborted';

/**
 * Waits for the preview to settle, but releases the caller as soon as a newly
 * collected error arrives. Warnings and ordinary console output do not shorten
 * the window because a later asynchronous runtime failure may still follow.
 */
export function waitForPreviewRuntimeError(
  timeoutMs = PREVIEW_RUNTIME_SETTLE_MS,
  signal?: AbortSignal
): Promise<PreviewRuntimeWaitResult> {
  return new Promise((resolve) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const finish = (result: PreviewRuntimeWaitResult) => {
      if (settled) return;
      settled = true;
      if (timer !== undefined) clearTimeout(timer);
      unsubscribe();
      signal?.removeEventListener('abort', handleAbort);
      resolve(result);
    };
    const handleAbort = () => finish('aborted');
    const unsubscribe = subscribeToPreviewLogs((entry) => {
      if (entry?.level === 'error') finish('error');
    });

    if (signal?.aborted) {
      finish('aborted');
      return;
    }
    signal?.addEventListener('abort', handleAbort, { once: true });
    timer = setTimeout(() => finish('timeout'), timeoutMs);
  });
}

export type PreviewAutoFixDecision =
  | { readonly kind: 'none' }
  | {
      readonly kind: 'follow-up';
      readonly attempt: number;
      readonly errors: readonly string[];
      readonly prompt: string;
    }
  | {
      readonly kind: 'limit-reached';
      readonly errors: readonly string[];
      readonly message: string;
    };

const errorTexts = (entries: readonly PreviewLogEntry[]): string[] => {
  const unique = new Set<string>();
  for (const entry of entries) {
    if (entry.level !== 'error') continue;
    const text = entry.text.trim();
    if (text) unique.add(text);
  }
  return [...unique];
};

const displayErrors = (errors: readonly string[]): string[] =>
  errors
    .slice(0, MAX_PREVIEW_ERRORS_PER_TURN)
    .map((text) =>
      text.length > MAX_PREVIEW_ERROR_CHARS
        ? `${text.slice(0, MAX_PREVIEW_ERROR_CHARS - 1)}…`
        : text
    );

const errorList = (errors: readonly string[]): string =>
  errors.map((error) => `- ${error}`).join('\n');

/**
 * Tracks runtime-repair attempts for one user-authored message.
 *
 * Kept outside React so filtering, deduplication, and the request cap can be
 * verified without mounting the workspace or making provider requests.
 */
export class PreviewAutoFixLoop {
  private attempts = 0;
  private readonly reported = new Set<string>();

  beginUserMessage(): void {
    this.attempts = 0;
    this.reported.clear();
  }

  afterApply(
    beforeApply: readonly PreviewLogEntry[],
    afterApply: readonly PreviewLogEntry[]
  ): PreviewAutoFixDecision {
    const previousErrors = new Set(errorTexts(beforeApply));
    const newErrors = errorTexts(afterApply).filter(
      (text) => !previousErrors.has(text) && !this.reported.has(text)
    );
    if (newErrors.length === 0) return { kind: 'none' };

    // Remember every new error, including entries omitted from the request-size
    // cap, so a refreshed preview cannot make an old error look new again.
    for (const error of newErrors) this.reported.add(error);
    const errors = displayErrors(newErrors);

    if (this.attempts >= MAX_PREVIEW_AUTO_FIX_ATTEMPTS) {
      return {
        kind: 'limit-reached',
        errors,
        message: [
          `**Automatic runtime repair stopped after ${MAX_PREVIEW_AUTO_FIX_ATTEMPTS} attempts.**`,
          '',
          'The preview still reports these runtime errors:',
          errorList(errors),
          '',
          'The errors are shown here instead of starting another automatic agent turn.',
        ].join('\n'),
      };
    }

    this.attempts += 1;
    return {
      kind: 'follow-up',
      attempt: this.attempts,
      errors,
      prompt: [
        `[Automatic runtime repair · attempt ${this.attempts}/${MAX_PREVIEW_AUTO_FIX_ATTEMPTS}]`,
        '',
        'The preview ran after the applied changes and reported these new runtime errors:',
        errorList(errors),
        '',
        'Fix the runtime errors in the generated project. Inspect the relevant files and return the necessary corrected file operations.',
      ].join('\n'),
    };
  }
}
