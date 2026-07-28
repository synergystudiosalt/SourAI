/**
 * Wraps untrusted project markup in a preview-only security boundary.
 *
 * The iframe sandbox allows project scripts but keeps them in an opaque origin
 * without storage, opener, popup, form, or top-navigation privileges. This
 * document CSP separately blocks arbitrary network requests while allowing
 * inline project code and the three runtime CDNs used by the preview builders.
 * Keeping the builder free of React/browser state lets Playwright exercise the
 * exact production policy.
 */
function indexOfAsciiMetaTag(source: string, fromIndex: number): number {
  const expected = [0x3c, 0x6d, 0x65, 0x74, 0x61]; // "<meta"
  for (let index = fromIndex; index <= source.length - expected.length; index++) {
    let matches = true;
    for (let offset = 0; offset < expected.length; offset++) {
      const code = source.charCodeAt(index + offset);
      const asciiLower = code >= 0x41 && code <= 0x5a ? code + 0x20 : code;
      if (asciiLower !== expected[offset]) {
        matches = false;
        break;
      }
    }
    if (matches) return index;
  }
  return -1;
}

export function stripUntrustedMetaElements(source: string): string {
  let output = '';
  let cursor = 0;

  while (cursor < source.length) {
    const candidate = indexOfAsciiMetaTag(source, cursor);
    if (candidate === -1) {
      output += source.slice(cursor);
      break;
    }

    const boundary = source[candidate + 5];
    if (boundary !== undefined && !/[\t\n\f\r />]/.test(boundary)) {
      output += source.slice(cursor, candidate + 5);
      cursor = candidate + 5;
      continue;
    }

    // Rename the tag instead of deleting source bytes. Deletion can join two
    // previously separate fragments into new markup; inserting `x-` leaves
    // every surrounding byte in place and turns the element into an inert
    // custom element. HTML character references are not re-tokenized as tag
    // openers, and an actual meta tag name is necessarily the contiguous ASCII
    // sequence matched above.
    output += `${source.slice(cursor, candidate)}<x-meta`;
    cursor = candidate + 5;
  }

  return output;
}

export function buildSandboxedPreviewDocument(source: string): string {
  const policy = [
    "default-src 'none'",
    "base-uri 'none'",
    "connect-src 'none'",
    "frame-src 'none'",
    "form-action 'none'",
    "img-src data: blob:",
    "media-src data: blob:",
    "font-src data:",
    "style-src 'unsafe-inline'",
    "script-src 'unsafe-inline' https://cdnjs.cloudflare.com https://unpkg.com https://esm.sh",
    "worker-src 'none'",
  ].join('; ');

  return [
    '<!doctype html><html><head>',
    `<meta http-equiv="Content-Security-Policy" content="${policy}">`,
    '<meta name="referrer" content="no-referrer">',
    '</head><body>',
    stripUntrustedMetaElements(source),
    '</body></html>',
  ].join('');
}
