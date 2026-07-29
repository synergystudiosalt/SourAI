import { describe, expect, it } from 'vitest';
import type { PreviewLogEntry } from '../../security/previewIsolation';
import {
  MAX_PREVIEW_AUTO_FIX_ATTEMPTS,
  PreviewAutoFixLoop,
} from './previewAutoFix';

const entry = (level: PreviewLogEntry['level'], text: string): PreviewLogEntry => ({ level, text });

describe('PreviewAutoFixLoop', () => {
  it('starts a follow-up only for new error-level entries and deduplicates them', () => {
    const loop = new PreviewAutoFixLoop();

    expect(
      loop.afterApply([], [
        entry('warn', 'warning'),
        entry('log', 'log'),
        entry('info', 'info'),
      ])
    ).toEqual({ kind: 'none' });

    const decision = loop.afterApply([], [entry('error', 'boom'), entry('error', 'boom')]);
    expect(decision.kind).toBe('follow-up');
    if (decision.kind !== 'follow-up') throw new Error('Expected an automatic follow-up');
    expect(decision.errors).toEqual(['boom']);
    expect(decision.prompt).toContain('Automatic runtime repair · attempt 1/2');
  });

  it('does not report an error that existed before apply or one already reported', () => {
    const loop = new PreviewAutoFixLoop();
    const boom = entry('error', 'boom');

    expect(loop.afterApply([boom], [boom])).toEqual({ kind: 'none' });
    expect(loop.afterApply([], [boom]).kind).toBe('follow-up');
    // An iframe source reset can make the store empty; the per-user-message
    // reported set still prevents the same text from buying another request.
    expect(loop.afterApply([], [boom])).toEqual({ kind: 'none' });
  });

  it('caps automatic turns at two attempts per user message', () => {
    const loop = new PreviewAutoFixLoop();

    expect(loop.afterApply([], [entry('error', 'first')]).kind).toBe('follow-up');
    expect(loop.afterApply([], [entry('error', 'second')]).kind).toBe('follow-up');
    const stopped = loop.afterApply([], [entry('error', 'third')]);

    expect(stopped.kind).toBe('limit-reached');
    if (stopped.kind !== 'limit-reached') throw new Error('Expected the attempt limit');
    expect(stopped.message).toContain(
      `Automatic runtime repair stopped after ${MAX_PREVIEW_AUTO_FIX_ATTEMPTS} attempts`
    );
  });

  it('does nothing when the refreshed preview console is clean', () => {
    const loop = new PreviewAutoFixLoop();
    expect(loop.afterApply([entry('error', 'old failure')], [])).toEqual({ kind: 'none' });
  });

  it('resets the attempt budget for a new user-authored message', () => {
    const loop = new PreviewAutoFixLoop();
    loop.afterApply([], [entry('error', 'first')]);
    loop.afterApply([], [entry('error', 'second')]);
    loop.beginUserMessage();
    expect(loop.afterApply([], [entry('error', 'first')]).kind).toBe('follow-up');
  });
});
