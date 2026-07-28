/**
 * Serves the live preview as a real navigation instead of an iframe `srcdoc`.
 *
 * Why this exists: `about:srcdoc` documents inherit the embedding page's CSP.
 * The app ships a deliberately strict `script-src 'self'`, so a srcdoc preview
 * could never load a runtime library however permissive its own meta policy
 * was — the inherited policy had already excluded every CDN. A document
 * fetched from a URL uses the policy on its own response, so the app keeps its
 * strict policy and the preview gets the one it needs.
 *
 * The body is caller-supplied HTML echoed from our own origin, which would be
 * reflected XSS on its own. `PREVIEW_RESPONSE_POLICY` starts with
 * `sandbox allow-scripts`, forcing an opaque origin however the URL is
 * reached, so the response can never touch app storage, cookies, or DOM.
 */
import { PREVIEW_RESPONSE_POLICY } from '../../src/security/previewIsolation';

/** Same-origin document loads only; blocks hot-linking this as an HTML host. */
function isAllowedInitiator(request: Request): boolean {
  const site = request.headers.get('sec-fetch-site');
  // Browsers that send the header must report same-origin. Older ones omit it,
  // and the sandbox directive still contains the response either way.
  return site === null || site === 'same-origin';
}

export const onRequest: PagesFunction = async (context) => {
  const { request } = context;

  if (request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }
  if (!isAllowedInitiator(request)) {
    return new Response('Forbidden', { status: 403 });
  }

  let html = '';
  try {
    const form = await request.formData();
    const value = form.get('html');
    html = typeof value === 'string' ? value : '';
  } catch {
    return new Response('Bad request', { status: 400 });
  }

  return new Response(html, {
    status: 200,
    headers: {
      'Content-Type': 'text/html;charset=utf-8',
      'Content-Security-Policy': PREVIEW_RESPONSE_POLICY,
      'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff',
      // Never let a generated preview be cached and replayed.
      'Cache-Control': 'no-store',
    },
  });
};
