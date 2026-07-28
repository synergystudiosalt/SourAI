import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { APP_CONTENT_SECURITY_POLICY, onRequest } from '@/functions/_middleware';
import { PREVIEW_RESPONSE_POLICY } from './previewIsolation';

const ROOT = path.resolve(__dirname, '../..');

function run(next: () => Promise<Response>): Promise<Response> {
  return onRequest({ next } as never) as Promise<Response>;
}

describe('app Content-Security-Policy', () => {
  it('applies the strict policy to an ordinary response', async () => {
    const response = await run(async () => new Response('<html></html>'));
    expect(response.headers.get('Content-Security-Policy')).toBe(APP_CONTENT_SECURITY_POLICY);
    expect(APP_CONTENT_SECURITY_POLICY).toContain("script-src 'self'");
  });

  // Two CSP headers are intersected, not replaced. If the middleware layered
  // the app policy over the preview's, script-src 'self' would win and every
  // runtime CDN would be blocked again.
  it('leaves a response that already chose its own policy alone', async () => {
    const response = await run(
      async () =>
        new Response('<html></html>', {
          headers: { 'Content-Security-Policy': PREVIEW_RESPONSE_POLICY },
        })
    );
    expect(response.headers.get('Content-Security-Policy')).toBe(PREVIEW_RESPONSE_POLICY);
    expect(response.headers.get('Content-Security-Policy')).not.toContain("script-src 'self'");
  });

  it('preserves status and other headers', async () => {
    const response = await run(
      async () =>
        new Response('nope', { status: 404, statusText: 'Not Found', headers: { 'X-Test': 'kept' } })
    );
    expect(response.status).toBe(404);
    expect(response.headers.get('X-Test')).toBe('kept');
    expect(response.headers.get('Content-Security-Policy')).toBe(APP_CONTENT_SECURITY_POLICY);
  });

  it('allows the form post that loads the preview frame', () => {
    // The preview is mounted by POSTing a form to /api/preview, which
    // form-action governs, and framed from the same origin.
    expect(APP_CONTENT_SECURITY_POLICY).toContain("form-action 'self'");
    expect(APP_CONTENT_SECURITY_POLICY).toContain("frame-src 'self'");
  });

  it('is not also declared in _headers, which would apply as a second policy', () => {
    const headers = readFileSync(path.join(ROOT, 'public/_headers'), 'utf8');
    const declarations = headers
      .split('\n')
      .filter((line) => !line.trim().startsWith('#'))
      .filter((line) => /content-security-policy/i.test(line));
    expect(declarations).toEqual([]);
  });
});
