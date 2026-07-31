import { describe, expect, it } from 'vitest';

import { modelDisplayName } from './AgentPanel';

describe('selected model display name', () => {
  it('removes only the trailing version number from built-in model labels', () => {
    expect(modelDisplayName('sour-omni-flash')).toBe('Omni-Flash');
    expect(modelDisplayName('sour-intelligence')).toBe('Intelligence');
    expect(modelDisplayName('sour-velocity')).toBe('Velocity');
    expect(modelDisplayName('sour-lumen')).toBe('Lumen');
    expect(modelDisplayName('sour-overdrive')).toBe('Overdrive');
  });

  it('keeps custom and unknown fallbacks readable', () => {
    expect(modelDisplayName('custom_example')).toBe('API');
    expect(modelDisplayName('future-model')).toBe('future-model');
  });
});
