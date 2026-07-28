import { describe, expect, it } from 'vitest';

import { workspacePath, workspaceRoot } from './path';

describe('workspacePath', () => {
  it.each([
    '/absolute',
    'C:/absolute',
    '../escape',
    'a/../escape',
    'a\\b',
    'a//b',
    'a/',
    '.sourai/manifest',
    '.sourai-internal/journal',
    'bad\u0000name',
  ])('rejects unsafe path %j', (value) => {
    expect(() => workspacePath(value)).toThrow(TypeError);
  });

  it('rejects non-canonical Unicode aliases', () => {
    expect(() => workspacePath('cafe\u0301.txt')).toThrow(/NFC/);
  });

  it('accepts canonical relative paths and an explicit root', () => {
    expect(workspacePath('src/café.ts')).toBe('src/café.ts');
    expect(workspaceRoot()).toBe('');
  });
});
