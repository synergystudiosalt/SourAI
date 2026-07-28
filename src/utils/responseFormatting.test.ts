import { describe, expect, it } from 'vitest';

import { splitThinkingAndText } from '../../functions/shared/responseFormatting';

describe('splitThinkingAndText', () => {
  it('separates reasoning from the user-facing answer', () => {
    expect(
      splitThinkingAndText(
        '<thinking>Inspecting the workspace.</thinking>\n\nThe fix is ready.'
      )
    ).toEqual({
      thinking: 'Inspecting the workspace.',
      text: 'The fix is ready.',
    });
  });

  it('recovers reasoning closed with the wrong model-generated tag', () => {
    expect(splitThinkingAndText('<thinking>Improving the UI.</index>')).toEqual({
      thinking: 'Improving the UI.',
      text: '',
    });
  });
});
