import { describe, expect, it } from 'vitest';

import { parseAgentResponse } from '../../utils/agentProtocol';
import {
  ChatRunController,
  CONTINUE_AFTER_REASONING,
  FINISH_WITH_EXISTING_RESULTS,
  LAST_TURN_NOTICE,
  MAX_AUTO_RETRIES,
  MIN_RETRY_GAP_MS,
  RETRIES_EXHAUSTED,
  RETRY_ATTEMPT_NOTICE,
  retryGapMs,
  lastTurnNotice,
  NO_PROGRESS_RESPONSE,
  RETRY_AFTER_EMPTY,
  SILENT_MODEL_RESPONSE,
  UNRESOLVED_WORKSPACE_REQUEST,
} from './chatRunController';

describe('ChatRunController', () => {
  it('filters repeated requests and grants only one bounded recovery turn', () => {
    const controller = new ChatRunController();
    expect(controller.filter(parseAgentResponse('@@readfile: src/a.ts')).newRequestCount).toBe(1);
    const repeated = controller.filter(parseAgentResponse('@@readfile: src/a.ts'));
    expect(repeated.repeatedRequestCount).toBe(1);
    expect(controller.consumeRecovery(1, 2, 6)).toBe(FINISH_WITH_EXISTING_RESULTS);
    expect(controller.consumeRecovery(1, 3, 6)).toBeNull();
  });

  it('never disguises an empty terminal result as a useful answer', () => {
    const controller = new ChatRunController();
    expect(controller.finalText('', 2, false)).toBe('Changes are ready for review.');
    expect(controller.finalText('', 0, true)).toMatch(/exhausted/i);
    expect(controller.finalText('Done.', 0, false)).toBe('Done.');
  });

  it('reports when every workspace request failed to resolve', () => {
    const controller = new ChatRunController();
    controller.recordWorkspaceRequest('index.html', false);
    controller.recordWorkspaceRequest('src/main.js', false);

    expect(controller.finalText('', 0, false)).toBe(
      UNRESOLVED_WORKSPACE_REQUEST(['index.html', 'src/main.js'], 2, 2)
    );
  });

  it('keeps the genuinely silent terminal message when no request was issued', () => {
    expect(new ChatRunController().finalText('', 0, false)).toBe(
      SILENT_MODEL_RESPONSE
    );
  });

  it('does not call a tied run mostly unresolved', () => {
    const controller = new ChatRunController();
    controller.recordWorkspaceRequest('missing.ts', false);
    controller.recordWorkspaceRequest('src/App.tsx', true);

    expect(controller.finalText('', 0, false)).toBe(SILENT_MODEL_RESPONSE);
  });

  it('reports counts and several paths when most workspace requests fail', () => {
    const controller = new ChatRunController();
    controller.recordWorkspaceRequest('src/App.tsx', true);
    controller.recordWorkspaceRequest('package.json', true);
    for (const path of [
      'missing/a.ts',
      'missing/b.ts',
      'missing/c.ts',
      'missing/d.ts',
      'missing/e.ts',
      'missing/f.ts',
      'missing/g.ts',
      'missing/h.ts',
    ]) {
      controller.recordWorkspaceRequest(path, false);
    }

    const result = controller.finalText('', 0, false);
    expect(result).toContain('8 of 10 workspace requests could not be resolved');
    expect(result).toContain('"missing/a.ts"');
    expect(result).toContain('"missing/b.ts"');
    expect(result).toContain('"missing/c.ts"');
  });

  it('leaves a fully resolved run unchanged', () => {
    const controller = new ChatRunController();
    controller.recordWorkspaceRequest('src/App.tsx', true);
    controller.recordWorkspaceRequest('package.json', true);

    expect(controller.finalText('', 0, false)).toBe(SILENT_MODEL_RESPONSE);
  });

  it('grants one bounded continuation when a turn ends after reasoning only', () => {
    const controller = new ChatRunController();
    expect(controller.consumeIncomplete(true, '', 0, 1, 6)).toBe(
      CONTINUE_AFTER_REASONING
    );
    expect(controller.consumeIncomplete(true, '', 0, 2, 6)).toBeNull();
    expect(new ChatRunController().consumeIncomplete(false, '', 0, 1, 6)).toBeNull();
    expect(new ChatRunController().consumeIncomplete(true, 'Done.', 0, 1, 6)).toBeNull();
  });
});

describe('stalled runs', () => {
  const productive = (c: ChatRunController) => c.recordTurnOutcome(true);
  const dead = (c: ChatRunController) => c.recordTurnOutcome(false);

  it('is not stalled while turns keep producing something', () => {
    const controller = new ChatRunController();
    for (let i = 0; i < 10; i++) productive(controller);
    expect(controller.stalled).toBe(false);
  });

  it('stalls only after consecutive dead turns', () => {
    const controller = new ChatRunController();
    dead(controller);
    expect(controller.stalled).toBe(false);
    dead(controller);
    expect(controller.stalled).toBe(true);
  });

  // A model that recovers must not be punished for one wasted turn.
  it('resets the count when a turn produces something', () => {
    const controller = new ChatRunController();
    dead(controller);
    productive(controller);
    dead(controller);
    expect(controller.stalled).toBe(false);
  });

  it('warns the model on its final turn so the work is not discarded', () => {
    expect(lastTurnNotice(0, 6)).toBeNull();
    expect(lastTurnNotice(4, 6)).toBeNull();
    expect(lastTurnNotice(5, 6)).toBe(LAST_TURN_NOTICE);
    expect(lastTurnNotice(6, 6)).toBe(LAST_TURN_NOTICE);
    expect(LAST_TURN_NOTICE).toMatch(/final turn/i);
  });

  it('reports lost progress rather than a spent budget', () => {
    const controller = new ChatRunController();
    dead(controller);
    dead(controller);
    expect(controller.finalText('', 0, false)).toBe(NO_PROGRESS_RESPONSE);
    // Even when the turn cap was also reached, the cause was the stall.
    expect(controller.finalText('', 0, true)).toBe(NO_PROGRESS_RESPONSE);
  });

  it('never overrides real work', () => {
    const controller = new ChatRunController();
    dead(controller);
    dead(controller);
    expect(controller.finalText('Here is the answer.', 0, false)).toBe('Here is the answer.');
    expect(controller.finalText('', 3, false)).toBe('Changes are ready for review.');
  });
});

describe('empty response retry', () => {
  it('grants one retry after workspace reads resolved but model returned nothing', () => {
    const controller = new ChatRunController();
    controller.recordWorkspaceRequest('src/App.tsx', true);
    // Empty response: no text, no ops, no reasoning, no requests
    const retry = controller.consumeEmptyRetry('', 0, false, 0, 2, 6);
    expect(retry).toBe(RETRY_AFTER_EMPTY);
  });

  it('only fires once', () => {
    const controller = new ChatRunController();
    controller.recordWorkspaceRequest('src/App.tsx', true);
    expect(controller.consumeEmptyRetry('', 0, false, 0, 2, 6)).toBe(RETRY_AFTER_EMPTY);
    expect(controller.consumeEmptyRetry('', 0, false, 0, 3, 6)).toBeNull();
  });

  it('does not fire when no workspace reads were resolved', () => {
    const controller = new ChatRunController();
    // No resolved workspace requests
    expect(controller.consumeEmptyRetry('', 0, false, 0, 1, 6)).toBeNull();
  });

  it('does not fire when model already produced display text', () => {
    const controller = new ChatRunController();
    controller.recordWorkspaceRequest('src/App.tsx', true);
    expect(controller.consumeEmptyRetry('Some answer', 0, false, 0, 2, 6)).toBeNull();
  });

  it('does not fire when model produced operations', () => {
    const controller = new ChatRunController();
    controller.recordWorkspaceRequest('src/App.tsx', true);
    expect(controller.consumeEmptyRetry('', 3, false, 0, 2, 6)).toBeNull();
  });

  it('does not fire when model produced reasoning (consumeIncomplete handles that)', () => {
    const controller = new ChatRunController();
    controller.recordWorkspaceRequest('src/App.tsx', true);
    expect(controller.consumeEmptyRetry('', 0, true, 0, 2, 6)).toBeNull();
  });

  it('does not fire when model made new requests', () => {
    const controller = new ChatRunController();
    controller.recordWorkspaceRequest('src/App.tsx', true);
    expect(controller.consumeEmptyRetry('', 0, false, 2, 2, 6)).toBeNull();
  });

  it('does not fire on the last turn', () => {
    const controller = new ChatRunController();
    controller.recordWorkspaceRequest('src/App.tsx', true);
    expect(controller.consumeEmptyRetry('', 0, false, 0, 6, 6)).toBeNull();
  });
});

describe('auto retry', () => {
  const spent = (c: ChatRunController) => {
    c.consumeRecovery(1, 1, 12);
    c.consumeIncomplete(true, '', 0, 1, 12);
  };

  it('resends up to the cap, then stops', () => {
    const controller = new ChatRunController();
    spent(controller);
    expect(controller.consumeAutoRetry('', 0, 0, 1, 12)).toBe(1);
    expect(controller.consumeAutoRetry('', 0, 0, 2, 12)).toBe(2);
    expect(controller.consumeAutoRetry('', 0, 0, 3, 12)).toBe(3);
    expect(controller.consumeAutoRetry('', 0, 0, 4, 12)).toBe(4);
    expect(controller.consumeAutoRetry('', 0, 0, 5, 12)).toBeNull();
  });

  it('never fires when the turn produced something', () => {
    const controller = new ChatRunController();
    expect(controller.consumeAutoRetry('Here you go.', 0, 0, 1, 12)).toBeNull();
    expect(controller.consumeAutoRetry('', 2, 0, 1, 12)).toBeNull();
  });

  it('does not fire with no turns left', () => {
    expect(new ChatRunController().consumeAutoRetry('', 0, 0, 12, 12)).toBeNull();
  });

  it('reports being out of service once the resends are spent', () => {
    const controller = new ChatRunController();
    for (let i = 0; i < MAX_AUTO_RETRIES; i++) controller.consumeAutoRetry('', 0, 0, i, 12);
    const text = controller.finalText('', 0, false);
    expect(text).toBe(RETRIES_EXHAUSTED(MAX_AUTO_RETRIES));
    expect(text).toMatch(/out of service|rate limited/i);
  });

  it('still prefers a real answer over the retry message', () => {
    const controller = new ChatRunController();
    for (let i = 0; i < MAX_AUTO_RETRIES; i++) controller.consumeAutoRetry('', 0, 0, i, 12);
    expect(controller.finalText('Done.', 0, false)).toBe('Done.');
    expect(controller.finalText('', 4, false)).toBe('Changes are ready for review.');
  });

  it('paces every resend at a fixed 15-second interval', () => {
    expect(retryGapMs(100)).toBe(MIN_RETRY_GAP_MS);
    expect(retryGapMs(6439)).toBe(15_000);
    expect(retryGapMs(9339)).toBe(15_000);
  });

  it('counts up for the progress label', () => {
    expect(RETRY_ATTEMPT_NOTICE(2, 3)).toContain('(2/3)');
  });
});
