import { describe, expect, it } from 'vitest';

import { parseAgentResponse } from '../../utils/agentProtocol';
import {
  ChatRunController,
  CONTINUE_AFTER_REASONING,
  FINISH_WITH_EXISTING_RESULTS,
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
