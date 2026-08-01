/**
 * Fetches a web page and reduces it to readable text for use as a notebook
 * source.
 *
 * The browser cannot do this itself: the app's CSP is `connect-src 'self'`, so
 * a cross-origin read has to happen server-side. That makes this endpoint a
 * request-forgery surface, so the URL is validated before anything is fetched
 * and the response is capped on the way back.
 */

export class WebSourceError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message);
    this.name = 'WebSourceError';
  }
}

/** Hard cap on bytes read from a remote page. */
export const WEB_SOURCE_MAX_BYTES = 2 * 1024 * 1024;
/** Hard cap on extracted text handed back to the client. */
export const WEB_SOURCE_MAX_CHARS = 400_000;
export const WEB_SOURCE_TIMEOUT_MS = 15_000;

const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  'localhost.localdomain',
  'ip6-localhost',
  'ip6-loopback',
  'metadata',
  'metadata.google.internal',
  'metadata.goog',
]);

function isPrivateIpv4(hostname: string): boolean {
  const parts = hostname.split('.');
  if (parts.length !== 4) return false;
  const octets = parts.map((part) => (/^\d{1,3}$/.test(part) ? Number(part) : NaN));
  if (octets.some((value) => !Number.isInteger(value) || value < 0 || value > 255)) return false;
  const [a, b] = octets;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127) ||
    a >= 224
  );
}

function isPrivateIpv6(hostname: string): boolean {
  const value = hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (!value.includes(':')) return false;
  return (
    value === '::' ||
    value === '::1' ||
    value.startsWith('fc') ||
    value.startsWith('fd') ||
    value.startsWith('fe80') ||
    value.startsWith('::ffff:')
  );
}

/**
 * Rejects anything that is not a public http(s) URL.
 *
 * DNS still resolves after this check, so a hostname pointing at a private
 * address is not caught here — but the literal-address and known-metadata
 * cases, which are what an unattended request-forgery attempt actually uses,
 * are.
 */
export function assertFetchableUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(String(raw).trim());
  } catch {
    throw new WebSourceError(400, 'That does not look like a valid URL.');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new WebSourceError(400, 'Only http and https links can be added as sources.');
  }
  if (url.username || url.password) {
    throw new WebSourceError(400, 'URLs with embedded credentials are not accepted.');
  }
  const hostname = url.hostname.toLowerCase();
  if (
    !hostname ||
    BLOCKED_HOSTNAMES.has(hostname) ||
    hostname.endsWith('.local') ||
    hostname.endsWith('.internal') ||
    isPrivateIpv4(hostname) ||
    isPrivateIpv6(hostname)
  ) {
    throw new WebSourceError(400, 'That host cannot be fetched as a source.');
  }
  return url;
}

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  mdash: '—',
  ndash: '–',
  hellip: '…',
  rsquo: '’',
  lsquo: '‘',
  ldquo: '“',
  rdquo: '”',
};

export function decodeEntities(text: string): string {
  return text
    .replace(/&#x([0-9a-f]+);/gi, (_match, hex) => safeCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_match, dec) => safeCodePoint(Number(dec)))
    .replace(/&([a-z]+);/gi, (match, name: string) => ENTITIES[name.toLowerCase()] ?? match);
}

function safeCodePoint(value: number): string {
  if (!Number.isFinite(value) || value < 0 || value > 0x10ffff) return '';
  try {
    return String.fromCodePoint(value);
  } catch {
    return '';
  }
}

/** Pulls the `<title>` out of a page, falling back to the first heading. */
export function extractTitle(html: string): string {
  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1];
  const heading = /<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(html)?.[1];
  const chosen = (title ?? heading ?? '').replace(/<[^>]*>/g, ' ');
  return decodeEntities(chosen).replace(/\s+/g, ' ').trim().slice(0, 200);
}

/**
 * Reduces HTML to plain text.
 *
 * Chrome-heavy elements are dropped whole rather than stripped of tags, so the
 * extracted source is the article rather than the navigation menu repeated
 * once per page.
 */
export function htmlToText(html: string): string {
  const withoutChrome = html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|noscript|template|svg|iframe|form)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<(nav|header|footer|aside)\b[\s\S]*?<\/\1>/gi, ' ');
  const withBreaks = withoutChrome
    .replace(/<\/(p|div|section|article|li|tr|h[1-6]|blockquote|pre)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<li\b[^>]*>/gi, '- ');
  return decodeEntities(withBreaks.replace(/<[^>]*>/g, ' '))
    .replace(/[ \t ]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/^[ \t]+|[ \t]+$/gm, '')
    .trim()
    .slice(0, WEB_SOURCE_MAX_CHARS);
}

async function readCapped(response: Response): Promise<string> {
  const body = response.body;
  if (!body) return (await response.text()).slice(0, WEB_SOURCE_MAX_BYTES);
  const reader = body.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: false });
  let received = 0;
  let text = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      text += decoder.decode(value, { stream: true });
      if (received >= WEB_SOURCE_MAX_BYTES) break;
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  return text + decoder.decode();
}

export interface FetchedWebSource {
  readonly url: string;
  readonly title: string;
  readonly content: string;
}

export async function fetchWebSource(
  rawUrl: string,
  fetchImpl: typeof fetch = fetch
): Promise<FetchedWebSource> {
  const url = assertFetchableUrl(rawUrl);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), WEB_SOURCE_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetchImpl(url.toString(), {
      method: 'GET',
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        // Some sites serve an interstitial to clients that send no UA at all.
        'User-Agent': 'Mozilla/5.0 (compatible; sour.ai Notebook/1.0)',
        Accept: 'text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.5',
      },
    });
  } catch (error) {
    throw new WebSourceError(
      502,
      (error as Error)?.name === 'AbortError'
        ? 'That page took too long to respond.'
        : 'That page could not be reached.'
    );
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    throw new WebSourceError(502, `That page returned HTTP ${response.status}.`);
  }

  // The final URL after redirects matters as much as the one asked for: a
  // public host that redirects to a private one would otherwise slip through.
  assertFetchableUrl(response.url || url.toString());

  const contentType = (response.headers.get('content-type') || '').toLowerCase();
  if (
    contentType &&
    !contentType.includes('text/html') &&
    !contentType.includes('text/plain') &&
    !contentType.includes('application/xhtml') &&
    !contentType.includes('application/json') &&
    !contentType.includes('text/markdown')
  ) {
    throw new WebSourceError(
      415,
      'Only web pages and plain text can be added by link. Download the file and upload it instead.'
    );
  }

  const raw = await readCapped(response);
  const isHtml = contentType.includes('html') || /<html[\s>]/i.test(raw);
  const content = isHtml ? htmlToText(raw) : raw.slice(0, WEB_SOURCE_MAX_CHARS).trim();
  if (!content) {
    throw new WebSourceError(422, 'No readable text could be extracted from that page.');
  }

  return {
    url: url.toString(),
    title: (isHtml ? extractTitle(raw) : '') || url.hostname + url.pathname.replace(/\/$/, ''),
    content,
  };
}
