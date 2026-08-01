import { describe, expect, it, vi } from 'vitest';

import {
  assertFetchableUrl,
  extractTitle,
  fetchWebSource,
  htmlToText,
  WebSourceError,
} from '../../../functions/shared/webSource';

describe('assertFetchableUrl', () => {
  it('accepts ordinary public web pages', () => {
    expect(assertFetchableUrl('https://example.com/a').host).toBe('example.com');
    expect(assertFetchableUrl('http://example.com').protocol).toBe('http:');
  });

  it.each([
    'http://localhost:8788/admin',
    'http://127.0.0.1/',
    'http://169.254.169.254/latest/meta-data/',
    'http://10.0.0.5/',
    'http://192.168.1.1/',
    'http://172.16.0.9/',
    'http://[::1]/',
    'http://router.local/',
    'http://metadata.google.internal/',
  ])('refuses to fetch %s', (url) => {
    // Link import is a server-side fetch on the user's behalf; without this the
    // endpoint would read the deployment's own private network.
    expect(() => assertFetchableUrl(url)).toThrow(WebSourceError);
  });

  it('refuses non-http schemes and embedded credentials', () => {
    expect(() => assertFetchableUrl('file:///etc/passwd')).toThrow(WebSourceError);
    expect(() => assertFetchableUrl('ftp://example.com/x')).toThrow(WebSourceError);
    expect(() => assertFetchableUrl('https://user:pass@example.com')).toThrow(WebSourceError);
  });
});

describe('htmlToText', () => {
  it('drops scripts, styles and page chrome', () => {
    const text = htmlToText(
      `<html><head><style>.a{color:red}</style><script>alert(1)</script></head>
       <body><nav>Home About</nav><article><p>Real content.</p></article>
       <footer>© 2026</footer></body></html>`
    );

    expect(text).toContain('Real content.');
    expect(text).not.toContain('alert(1)');
    expect(text).not.toContain('color:red');
    expect(text).not.toContain('Home About');
    expect(text).not.toContain('2026');
  });

  it('keeps block structure and decodes entities', () => {
    const text = htmlToText('<p>Tom &amp; Jerry</p><ul><li>One</li><li>Two</li></ul>');
    expect(text).toContain('Tom & Jerry');
    expect(text).toContain('- One');
    expect(text).toContain('- Two');
  });
});

describe('extractTitle', () => {
  it('prefers the document title and falls back to the first heading', () => {
    expect(extractTitle('<title>A &amp; B</title>')).toBe('A & B');
    expect(extractTitle('<h1>Heading only</h1>')).toBe('Heading only');
    expect(extractTitle('<p>none</p>')).toBe('');
  });
});

describe('fetchWebSource', () => {
  const htmlResponse = (body: string, url = 'https://example.com/article') =>
    new Response(body, {
      status: 200,
      headers: { 'content-type': 'text/html; charset=utf-8' },
    });

  it('returns the page title and readable text', async () => {
    const stub = vi.fn(async () =>
      htmlResponse('<title>Deep Work</title><body><p>Focus is a skill.</p></body>')
    );

    const source = await fetchWebSource('https://example.com/article', stub as unknown as typeof fetch);

    expect(source.title).toBe('Deep Work');
    expect(source.content).toContain('Focus is a skill.');
  });

  it('rejects a binary response instead of importing bytes as text', async () => {
    const stub = vi.fn(
      async () =>
        new Response('%PDF-1.7', { status: 200, headers: { 'content-type': 'application/pdf' } })
    );

    await expect(
      fetchWebSource('https://example.com/a.pdf', stub as unknown as typeof fetch)
    ).rejects.toThrow(/Only web pages and plain text/);
  });

  it('reports an upstream failure rather than storing an error page', async () => {
    const stub = vi.fn(async () => new Response('nope', { status: 404 }));

    await expect(
      fetchWebSource('https://example.com/missing', stub as unknown as typeof fetch)
    ).rejects.toThrow(/HTTP 404/);
  });
});
