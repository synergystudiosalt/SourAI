import { describe, expect, it } from 'vitest';

import { parseAgentResponse } from '../../utils/agentProtocol';
import {
  ChatRunController,
  CONTINUE_AFTER_REASONING,
  FINISH_WITH_EXISTING_RESULTS,
  LAST_TURN_NOTICE,
  lastTurnNotice,
  NO_PROGRESS_RESPONSE,
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
      UNRESOLVED_WORKSPACE_REQUEST('index.html')
    );
  });

  it('keeps the genuinely silent terminal message when no request was issued', () => {
    expect(new ChatRunController().finalText('', 0, false)).toBe(
      SILENT_MODEL_RESPONSE
    );
  });

  it('does not call the whole run unresolved when any workspace request succeeds', () => {
    const controller = new ChatRunController();
    controller.recordWorkspaceRequest('missing.ts', false);
    controller.recordWorkspaceRequest('src/App.tsx', true);

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
