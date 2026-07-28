/**
 * Applies the app's Content-Security-Policy.
 *
 * This lives here rather than in `public/_headers` because /api/preview must
 * serve a *different* policy: the live preview needs the runtime CDNs that the
 * app itself must never be allowed to load.
 *
 * A `_headers` rule matching `/*` would apply to that response as well. Two
 * CSP headers are enforced as an intersection, not a replacement, so the app's
 * `script-src 'self'` would silently win and the preview would be blocked
 * again — the exact failure this replaced. Rather than depend on how Pages
 * merges `_headers` with Function responses, the policy is set in one place
 * and never overwrites a policy a Function has already chosen.
 *
 * Everything else stays in `_headers`; those headers are identical everywhere,
 * so duplicating them is harmless in a way a second CSP is not.
 */
export const APP_CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  // Needed so the preview frame can be POSTed to /api/preview.
  "form-action 'self'",
  "script-src 'self'",
  "script-src-attr 'none'",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self' data:",
  "img-src 'self' data: blob: https:",
  "media-src 'self' data: blob:",
  "connect-src 'self'",
  "worker-src 'self' blob:",
  "frame-src 'self' blob:",
  "manifest-src 'self'",
].join('; ');

export const onRequest: PagesFunction = async (context) => {
  const response = await context.next();

  // A Function that set its own policy knows what it needs; do not layer a
  // second one on top of it.
  if (response.headers.has('Content-Security-Policy')) return response;

  const headers = new Headers(response.headers);
  headers.set('Content-Security-Policy', APP_CONTENT_SECURITY_POLICY);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
};
