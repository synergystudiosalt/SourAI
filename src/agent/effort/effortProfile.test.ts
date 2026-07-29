import { describe, expect, it } from 'vitest';
import {
  EFFORT_ORDER,
  EFFORT_PROFILES,
  isAgentReasoningEffort,
  resolveEffortProfile,
} from '@/functions/shared/effortProfile';

const ascending = EFFORT_ORDER.map((id) => EFFORT_PROFILES[id]);

describe('resolveEffortProfile', () => {
  it('returns the requested profile', () => {
    expect(resolveEffortProfile('ultracode').id).toBe('ultracode');
    expect(resolveEffortProfile('light').id).toBe('light');
  });

  it('falls back to standard for anything unrecognised', () => {
    for (const bad of [undefined, null, '', 'turbo', 42, {}, []]) {
      expect(resolveEffortProfile(bad).id).toBe('standard');
    }
  });

  it('never returns a profile whose id disagrees with its key', () => {
    for (const [key, profile] of Object.entries(EFFORT_PROFILES)) {
      expect(profile.id).toBe(key);
    }
  });
});

describe('isAgentReasoningEffort', () => {
  it('accepts every ordered id and rejects others', () => {
    for (const id of EFFORT_ORDER) expect(isAgentReasoningEffort(id)).toBe(true);
    expect(isAgentReasoningEffort('ULTRACODE')).toBe(false);
    expect(isAgentReasoningEffort('toString')).toBe(false);
  });
});

describe('effort ordering', () => {
  it('covers every profile exactly once', () => {
    expect([...EFFORT_ORDER].sort()).toEqual(Object.keys(EFFORT_PROFILES).sort());
  });

  // These are the invariants that make the slider mean something. If a future
  // edit makes a higher tier cheaper than a lower one, the control is lying.
  it.each([
    ['maxTurns', (p: (typeof ascending)[number]) => p.maxTurns],
    ['activeFileChars', (p: (typeof ascending)[number]) => p.context.activeFileChars],
    ['mentionedFileChars', (p: (typeof ascending)[number]) => p.context.mentionedFileChars],
    ['maxProjectFiles', (p: (typeof ascending)[number]) => p.context.maxProjectFiles],
    ['historyMessages', (p: (typeof ascending)[number]) => p.context.historyMessages],
  ])('%s increases with effort', (_name, read) => {
    const values = ascending.map(read);
    for (let i = 1; i < values.length; i++) {
      expect(values[i]).toBeGreaterThan(values[i - 1]);
    }
  });

  it('thinking budget never decreases as effort rises', () => {
    const values = ascending.map((p) => p.thinkingBudget);
    for (let i = 1; i < values.length; i++) {
      expect(values[i]).toBeGreaterThanOrEqual(values[i - 1]);
    }
  });

  it('temperature falls as effort rises, for more deterministic edits', () => {
    const values = ascending.map((p) => p.temperature);
    for (let i = 1; i < values.length; i++) {
      expect(values[i]).toBeLessThan(values[i - 1]);
    }
  });

  it('keeps temperature in the range every provider accepts', () => {
    for (const profile of ascending) {
      expect(profile.temperature).toBeGreaterThanOrEqual(0);
      expect(profile.temperature).toBeLessThanOrEqual(1);
    }
  });

  it('disables thinking only on the fastest tier', () => {
    expect(EFFORT_PROFILES.light.thinkingBudget).toBe(0);
    for (const id of EFFORT_ORDER.filter((x) => x !== 'light')) {
      expect(EFFORT_PROFILES[id].thinkingBudget).toBeGreaterThan(0);
    }
  });
});
