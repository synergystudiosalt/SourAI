import { describe, expect, it } from 'vitest';

import {
  MAX_PROJECT_MEMORY_PROMPT_CHARS,
  normalizeProjectMemoryEntry,
  selectProjectMemory,
} from './projectMemory';

describe('project memory', () => {
  it('normalizes keys and redacts credentials before persistence or prompting', () => {
    expect(
      normalizeProjectMemoryEntry(
        ' API Architecture ',
        'Uses Authorization: Bearer secret-value and REST routes.'
      )
    ).toEqual({
      key: 'api_architecture',
      value: 'Uses Authorization: Bearer [redacted] and REST routes.',
    });
  });

  it('ranks query-relevant facts ahead of unrelated memory', () => {
    const selected = selectProjectMemory(
      {
        styling: 'Uses CSS modules.',
        testing: 'Run npm test with Vitest.',
        database_schema: 'PostgreSQL users and sessions tables.',
      },
      'please add database session persistence'
    );
    expect(selected[0].key).toBe('database_schema');
  });

  it('keeps automatic memory context inside its prompt budget', () => {
    const memory = Object.fromEntries(
      Array.from({ length: 100 }, (_, index) => [`fact_${index}`, 'x'.repeat(1000)])
    );
    const selected = selectProjectMemory(memory, '');
    const size = selected.reduce((total, entry) => total + entry.key.length + entry.value.length + 4, 0);
    expect(size).toBeLessThanOrEqual(MAX_PROJECT_MEMORY_PROMPT_CHARS);
  });
});
