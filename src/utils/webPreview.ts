import { WorkspaceFileNode } from '../types';
import { getParentPath, listFiles } from './workspaceFs';

/**
 * Builds a self-contained, previewable HTML document for simple client-side
 * web projects (HTML + CSS + JS) by inlining local stylesheet/script
 * references so the whole thing can be rendered in a sandboxed iframe via
 * `srcDoc` with no server round-trip. External (http/https) resources are
 * left untouched so CDNs still work.
 */

function isExternalRef(href: string): boolean {
  return /^([a-z]+:)?\/\//i.test(href) || href.startsWith('data:') || href.startsWith('mailto:') || href.startsWith('#');
}

function resolveRelativePath(fromPath: string, relativeHref: string): string {
  const cleanHref = relativeHref.split('#')[0].split('?')[0];
  const baseDir = getParentPath(fromPath);
  const parts = baseDir ? baseDir.split('/') : [];
  for (const part of cleanHref.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') parts.pop();
    else parts.push(part);
  }
  return parts.join('/');
}

/** Picks the best HTML file to preview: the active file if it's HTML, else index.html, else the first HTML file found. */
export function findHtmlEntry(tree: WorkspaceFileNode[], preferredPath?: string): WorkspaceFileNode | null {
  const files = listFiles(tree).filter((f) => /\.html?$/i.test(f.name));
  if (files.length === 0) return null;
  if (preferredPath) {
    const preferred = files.find((f) => f.path === preferredPath);
    if (preferred) return preferred;
  }
  const rootIndex = files.find((f) => f.path.toLowerCase() === 'index.html');
  return rootIndex || files[0];
}

// ---------------------------------------------------------------------------
// Broader "web-compatible" preview support: beyond full HTML documents, the
// workspace can also live-preview standalone Markdown and SVG files (which
// render fine directly in a browser/web-container without any build step).
// ---------------------------------------------------------------------------

export type PreviewKind = 'html' | 'markdown' | 'svg';

const PREVIEW_EXTENSION_KIND: Record<string, PreviewKind> = {
  html: 'html',
  htm: 'html',
  md: 'markdown',
  markdown: 'markdown',
  svg: 'svg',
};

/** Returns the preview mode for a filename, or null if it isn't directly previewable. */
export function getPreviewKind(name: string): PreviewKind | null {
  const ext = name.split('.').pop()?.toLowerCase() || '';
  return PREVIEW_EXTENSION_KIND[ext] ?? null;
}

/**
 * Picks the best file to preview across every supported web-compatible
 * format (HTML, Markdown, SVG): the active file if it's previewable, else
 * index.html, else the first previewable file found.
 */
export function findPreviewEntry(tree: WorkspaceFileNode[], preferredPath?: string): WorkspaceFileNode | null {
  const files = listFiles(tree).filter((f) => getPreviewKind(f.name) !== null);
  if (files.length === 0) return null;
  if (preferredPath) {
    const preferred = files.find((f) => f.path === preferredPath);
    if (preferred) return preferred;
  }
  const rootIndex = files.find((f) => f.path.toLowerCase() === 'index.html');
  return rootIndex || files[0];
}

export function buildPreviewDocument(tree: WorkspaceFileNode[], entry: WorkspaceFileNode): string {
  const files = listFiles(tree);
  const findByPath = (p: string) => files.find((f) => f.path === p);

  let doc: Document;
  try {
    doc = new DOMParser().parseFromString(entry.content || '', 'text/html');
  } catch {
    return entry.content || '';
  }

  doc.querySelectorAll('link[rel="stylesheet"]').forEach((link) => {
    const href = link.getAttribute('href');
    if (!href || isExternalRef(href)) return;
    const cssFile = findByPath(resolveRelativePath(entry.path, href));
    if (cssFile) {
      const style = doc.createElement('style');
      style.textContent = cssFile.content || '';
      link.replaceWith(style);
    }
  });

  doc.querySelectorAll('script[src]').forEach((script) => {
    const src = script.getAttribute('src');
    if (!src || isExternalRef(src)) return;
    const jsFile = findByPath(resolveRelativePath(entry.path, src));
    if (jsFile) {
      const inline = doc.createElement('script');
      const type = script.getAttribute('type');
      if (type) inline.setAttribute('type', type);
      inline.textContent = jsFile.content || '';
      script.replaceWith(inline);
    }
  });

  return `<!DOCTYPE html>\n${doc.documentElement.outerHTML}`;
}
