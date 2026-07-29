import { describe, expect, it } from 'vitest';
import {
  buildSandboxedPreviewDocument,
  parsePreviewLog,
  PREVIEW_DOCUMENT_POLICY,
  PREVIEW_LOG_MESSAGE,
} from './previewIsolation';

describe('preview console bridge', () => {
  const doc = buildSandboxedPreviewDocument('<p>project</p>');

  it('is injected ahead of the project markup', () => {
    // A syntax error or a throw during initial evaluation is the failure most
    // worth reporting, and it happens before any project code could report it.
    expect(doc.indexOf(PREVIEW_LOG_MESSAGE)).toBeLessThan(doc.indexOf('<p>project</p>'));
  });

  it('reports uncaught errors and rejections, not just console calls', () => {
    expect(doc).toContain("addEventListener('error'");
    expect(doc).toContain("addEventListener('unhandledrejection'");
  });

  it('runs under the preview CSP, which allows inline script', () => {
    expect(PREVIEW_DOCUMENT_POLICY).toContain("script-src 'unsafe-inline'");
  });

  it('caps how much it can send, so a logging loop cannot flood the parent', () => {
    expect(doc).toMatch(/SENT\+\+>CAP/);
  });

  it('does not weaken the sandbox: no same-origin, no network directives added', () => {
    expect(PREVIEW_DOCUMENT_POLICY).toContain("connect-src 'none'");
    expect(doc).not.toContain('allow-same-origin');
  });
});

describe('parsePreviewLog', () => {
  it('accepts a well-formed entry', () => {
    expect(parsePreviewLog({ type: PREVIEW_LOG_MESSAGE, level: 'error', text: 'boom' })).toEqual({
      level: 'error',
      text: 'boom',
    });
  });

  it('ignores unrelated page traffic', () => {
    for (const bad of [null, undefined, 'string', 42, {}, { type: 'other' }]) {
      expect(parsePreviewLog(bad)).toBeNull();
    }
  });

  it('rejects an unknown level rather than trusting the frame', () => {
    expect(parsePreviewLog({ type: PREVIEW_LOG_MESSAGE, level: 'exec', text: 'x' })).toBeNull();
  });

  it('tolerates a missing text field', () => {
    expect(parsePreviewLog({ type: PREVIEW_LOG_MESSAGE, level: 'warn' })).toEqual({
      level: 'warn',
      text: '',
    });
  });
});
