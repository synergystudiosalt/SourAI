const normalizePath = (path: string) => (path.startsWith('/') ? path : `/${path}`);

// All API requests are same-origin Cloudflare Pages Function requests.
// Keeping this local prevents deployments from accidentally targeting a stale
// development server or exposing a second backend configuration.
export const apiUrl = (path: string) => normalizePath(path);
