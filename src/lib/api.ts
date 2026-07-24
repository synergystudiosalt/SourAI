// On Cloudflare Pages, Pages Functions are at /api/*
// For local dev, the backend is at localhost:3000
// For custom deployment, set VITE_API_BASE env var
// On Cloudflare Pages, Pages Functions are at /api/*
// For local dev, the backend is at localhost:3000
// For custom deployment, set VITE_API_BASE env var
const API_BASE = import.meta.env.VITE_API_BASE ?? '';

const normalizePath = (path: string) => (path.startsWith('/') ? path : `/${path}`);

export const apiUrl = (path: string) => {
  const normalized = normalizePath(path);
  if (!API_BASE) return normalized;
  return `${API_BASE.replace(/\/$/, '')}${normalized}`;
};
