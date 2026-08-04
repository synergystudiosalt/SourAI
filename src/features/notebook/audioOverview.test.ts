import { describe, expect, it } from 'vitest';

import { MAX_AUDIO_TRANSCRIPT_CHARS, transcriptForSpeech } from './audioOverview';

describe('transcriptForSpeech', () => {
  it('removes citations and Markdown before sending the transcript to Groq', () => {
    expect(transcriptForSpeech('## Overview\n- **Focus** matters [1].')).toBe('Overview Focus matters .');
  });

  it('never sends more than the endpoint limit', () => {
    expect(transcriptForSpeech(`A complete sentence. ${'word '.repeat(1000)}`).length)
      .toBeLessThanOrEqual(MAX_AUDIO_TRANSCRIPT_CHARS);
  });
});
