import { WorkspaceFileNode } from '../types';
import { getParentPath, listFiles } from './workspaceFs';

/**
 * Preview builder for the workspace. Supports:
 *  - Plain HTML (CSS/JS inlining)
 *  - React/JSX/TSX (Babel standalone compilation + import resolution)
 *  - Markdown & SVG
 */

function isExternalRef(href: string): boolean {
  return /^([a-z]+:)?\/\//i.test(href) || href.startsWith('data:') || href.startsWith('mailto:') || href.startsWith('#');
}

export function resolveRelativePath(fromPath: string, relativeHref: string): string {
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

// ---------------------------------------------------------------------------
// Preview kind detection
// ---------------------------------------------------------------------------

export type PreviewKind = 'html' | 'markdown' | 'svg' | 'react';

const PLAIN_EXTENSION_KIND: Record<string, 'html' | 'markdown' | 'svg'> = {
  html: 'html', htm: 'html',
  md: 'markdown', markdown: 'markdown',
  svg: 'svg',
};

export function getPreviewKind(name: string): PreviewKind | null {
  const ext = name.split('.').pop()?.toLowerCase() || '';
  if (PLAIN_EXTENSION_KIND[ext]) return PLAIN_EXTENSION_KIND[ext];
  if (['jsx', 'tsx', 'js', 'ts'].includes(ext)) return 'react';
  return null;
}

// ---------------------------------------------------------------------------
// HTML entry detection
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// React project detection
// ---------------------------------------------------------------------------

const BARE_IMPORT_MAP: Record<string, string> = {
  'react': 'https://esm.sh/react@18.3.1',
  'react-dom': 'https://esm.sh/react-dom@18.3.1',
  'react-dom/client': 'https://esm.sh/react-dom@18.3.1/client',
  'react/jsx-runtime': 'https://esm.sh/react@18.3.1/jsx-runtime',
  'react/jsx-dev-runtime': 'https://esm.sh/react@18.3.1/jsx-dev-runtime',
  'react-dom/server': 'https://esm.sh/react-dom@18.3.1/server',
  'react-router-dom': 'https://esm.sh/react-router-dom@6.28.0',
  'react-router': 'https://esm.sh/react-router@6.28.0',
  'framer-motion': 'https://esm.sh/framer-motion@11.15.0',
  'lucide-react': 'https://esm.sh/lucide-react@0.460.0',
  'clsx': 'https://esm.sh/clsx@2.1.1',
  'tailwind-merge': 'https://esm.sh/tailwind-merge@2.6.0',
  'zustand': 'https://esm.sh/zustand@5.0.2',
};

/** Detect if the project is a React app based on file extensions and content. */
export function isReactProject(files: WorkspaceFileNode[]): boolean {
  const hasJsxTsx = files.some((f) => /\.(jsx|tsx)$/i.test(f.path));
  if (hasJsxTsx) return true;
  const htmlFiles = files.filter((f) => /\.html?$/i.test(f.path));
  for (const f of htmlFiles) {
    if (f.content && /react/i.test(f.content)) return true;
  }
  const jsFiles = files.filter((f) => /\.(js|ts)$/i.test(f.path));
  for (const f of jsFiles) {
    if (f.content && /from\s+['"]react['"]/.test(f.content)) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// In-browser React bundler
// ---------------------------------------------------------------------------

const IMPORT_RE = /(?:^|\n)\s*(?:import\s+(?:(?:\{[^}]*\}|\*\s+as\s+\w+|\w+)(?:\s*,\s*(?:\{[^}]*\}|\w+))?\s+from\s+)?['"]([^'"]+)['"]|import\s*\(['"]([^'"]+)['"]\))/g;
const CSS_IMPORT_RE = /(?:^|\n)\s*import\s+['"]([^'"]+\.css)['"];?\s*/g;

function resolveFileExtension(files: WorkspaceFileNode[], basePath: string): WorkspaceFileNode | null {
  const extensions = ['', '.tsx', '.jsx', '.ts', '.js', '.json'];
  for (const ext of extensions) {
    const found = files.find((f) => f.path === basePath + ext);
    if (found) return found;
  }
  return null;
}

/** Walk all imports starting from entry and collect source files in dependency order. */
function collectModules(
  files: WorkspaceFileNode[],
  entryPath: string,
  visited = new Set<string>(),
  modules: WorkspaceFileNode[] = []
): WorkspaceFileNode[] {
  if (visited.has(entryPath)) return modules;
  visited.add(entryPath);

  const file = files.find((f) => f.path === entryPath);
  if (!file || !file.content) return modules;

  modules.push(file);

  // Find all import specifiers
  const importSpecifiers: string[] = [];
  let m: RegExpExecArray | null;

  const specRe = /(?:import\s+(?:(?:\{[^}]*\}|\*\s+as\s+\w+|\w+)(?:\s*,\s*(?:\{[^}]*\}|\w+))?\s+from\s+)?['"]([^'"]+)['"]|import\s*\(['"]([^'"]+)['"]\))/g;
  while ((m = specRe.exec(file.content))) {
    const spec = m[1] || m[2];
    if (spec) importSpecifiers.push(spec);
  }

  for (const spec of importSpecifiers) {
    if (BARE_IMPORT_MAP[spec]) continue; // CDN — skip
    if (spec.endsWith('.css')) continue; // CSS — handled separately
    if (spec.startsWith('.')) {
      const resolved = resolveRelativePath(entryPath, spec);
      const resolvedFile = resolveFileExtension(files, resolved);
      if (resolvedFile) {
        collectModules(files, resolvedFile.path, visited, modules);
      }
    }
  }

  return modules;
}

/** Transform a single module's source: replace bare imports with global refs, strip CSS imports. */
function transformModuleSource(source: string): string {
  let out = source;

  // Strip CSS imports
  out = out.replace(CSS_IMPORT_RE, '\n');

  // Replace bare imports with global variable references
  // import React from 'react'          →  const React = window.React;
  // import { useState } from 'react'   →  const { useState } = window.React;
  // import * as React from 'react'      →  const React = window.React;
  // import ReactDOM from 'react-dom/client' → const ReactDOM = window.ReactDOM.createRoot;

  out = out.replace(
    /(?:^|\n)\s*import\s+(\w+(?:\s*,\s*\{[^}]*\})?)\s+from\s+['"]([^'"]+)['"];?\s*/g,
    (_match: string, bindings: string, specifier: string) => {
      if (BARE_IMPORT_MAP[specifier]) {
        // Check for destructured import like: React, { useState }
        const parts = bindings.split(',').map((s: string) => s.trim());
        const statements: string[] = [];
        for (const part of parts) {
          if (part.startsWith('{')) {
            // Named import: { useState, useEffect } → const { useState, useEffect } = window.React;
            statements.push(`const ${part} = window.${specifier === 'react' ? 'React' : specifier === 'react-dom/client' ? 'ReactDOM' : specifier === 'react-dom' ? 'ReactDOM' : 'React'};`);
          } else if (part.startsWith('*')) {
            // Namespace import: * as React → const React = window.React;
            const name = part.replace('* as ', '').trim();
            statements.push(`const ${name} = window.${specifier === 'react' ? 'React' : specifier === 'react-dom/client' ? 'ReactDOM' : 'React'};`);
          } else {
            // Default import: React → const React = window.React;
            const globalName = specifier === 'react-dom/client' ? 'ReactDOM'
              : specifier === 'react-dom' ? 'ReactDOM'
              : specifier === 'react' ? 'React'
              : specifier;
            statements.push(`const ${part} = window.${globalName};`);
          }
        }
        return '\n' + statements.join('\n') + '\n';
      }
      return _match; // Leave non-bare imports for module resolution
    }
  );

  // Handle: import 'some-package' (side-effect imports)
  out = out.replace(
    /(?:^|\n)\s*import\s+['"]([^'"]+)['"];?\s*/g,
    (_match: string, specifier: string) => {
      if (BARE_IMPORT_MAP[specifier]) return '\n';
      return _match;
    }
  );

  // Handle: export default / export const / export function
  // Convert to plain assignments so they're in scope for the parent
  out = out.replace(/export\s+default\s+/g, 'var __default__ = ');
  out = out.replace(/export\s+(?:const|let|var|function)\s+/g, '$1 ');

  return out;
}

/** Resolve a CSS @import or link to an inline <style> block. */
function resolveCssImports(
  source: string,
  fromPath: string,
  files: WorkspaceFileNode[]
): string {
  return source.replace(CSS_IMPORT_RE, (_match: string, cssPath: string) => {
    const resolved = resolveRelativePath(fromPath, cssPath);
    const cssFile = files.find((f) => f.path === resolved);
    if (cssFile && cssFile.content) {
      return `\n<style>/* ${cssPath} */\n${cssFile.content}\n</style>\n`;
    }
    return _match;
  });
}

/** Build a self-contained HTML document that compiles + runs a React app in-browser. */
export function buildReactPreview(
  tree: WorkspaceFileNode[],
  entryFile: WorkspaceFileNode,
): string {
  const files = listFiles(tree);
  const indexHtml = findHtmlEntry(tree);

  // Find the React entry point: if entryFile is HTML, find the main JS/JSX;
  // if entryFile is JS/JSX/TS/TSX, use it directly.
  let jsEntry: WorkspaceFileNode | null = null;
  let htmlContent = '';

  if (/\.html?$/i.test(entryFile.path)) {
    htmlContent = entryFile.content || '';
    // Look for script src in the HTML
    const scriptMatch = htmlContent.match(/<script[^>]*src=["']([^"']+)[""]/i);
    if (scriptMatch) {
      const resolved = resolveRelativePath(entryFile.path, scriptMatch[1]);
      jsEntry = resolveFileExtension(files, resolved);
    }
    if (!jsEntry) {
      // Fallback: find main.tsx/main.jsx/index.tsx/index.jsx/src/main.* etc.
      const candidates = ['src/main', 'src/index', 'main', 'index'];
      for (const c of candidates) {
        jsEntry = resolveFileExtension(files, c);
        if (jsEntry) break;
      }
    }
  } else {
    jsEntry = entryFile;
    // Generate a minimal HTML shell
    const rootIndex = findHtmlEntry(tree);
    htmlContent = rootIndex?.content || '<!DOCTYPE html><html><head></head><body><div id="root"></div></body></html>';
  }

  if (!jsEntry || !jsEntry.content) {
    return '<html><body><p style="font-family:sans-serif;color:#888;padding:2rem">No entry point found. Create a main.tsx or index.html.</p></body></html>';
  }

  // Collect all modules in dependency order
  const modules = collectModules(files, jsEntry.path);

  // Build the import map for bare specifiers
  const importMapEntries: Record<string, string> = {};
  const usedBareSpecs = new Set<string>();
  for (const mod of modules) {
    if (!mod.content) continue;
    let m2: RegExpExecArray | null;
    const bareRe = /from\s+['"]([^'"]+)['"]/g;
    while ((m2 = bareRe.exec(mod.content))) {
      const spec = m2[1];
      if (BARE_IMPORT_MAP[spec]) usedBareSpecs.add(spec);
    }
  }
  for (const spec of usedBareSpecs) {
    importMapEntries[spec] = BARE_IMPORT_MAP[spec];
  }

  // Bundle modules
  const bundledLines: string[] = [];
  for (const mod of modules) {
    const isEntry = mod.path === jsEntry.path;
    const transformed = transformModuleSource(mod.content || '');
    bundledLines.push(`// ── ${mod.path} ${isEntry ? '(entry)' : ''} ──\n(function(){\n${transformed}\n})();`);
  }

  const bundledJs = bundledLines.join('\n\n');

  // Resolve CSS imports from entry HTML
  let finalHtml = resolveCssImports(htmlContent, entryFile.path, files);

  // Also inline any CSS files referenced in the HTML
  let doc: Document;
  try {
    doc = new DOMParser().parseFromString(finalHtml, 'text/html');
  } catch {
    doc = new DOMParser().parseFromString('<!DOCTYPE html><html><body><div id="root"></div></body></html>', 'text/html');
  }

  // Inline local stylesheets
  doc.querySelectorAll('link[rel="stylesheet"]').forEach((link) => {
    const href = link.getAttribute('href');
    if (!href || isExternalRef(href)) return;
    const resolved = resolveRelativePath(entryFile.path, href);
    const cssFile = files.find((f) => f.path === resolved);
    if (cssFile && cssFile.content) {
      const style = doc.createElement('style');
      style.textContent = cssFile.content;
      link.replaceWith(style);
    }
  });

  // Replace local script tags with bundled version
  doc.querySelectorAll('script[src]').forEach((script) => {
    const src = script.getAttribute('src');
    if (!src || isExternalRef(src)) return;
    script.removeAttribute('src');
    script.setAttribute('type', 'text/babel');
    script.setAttribute('data-type', 'module');
    script.textContent = '// bundled — see compiled output';
  });

  // Inject Babel standalone + import map + bundled modules
  const head = doc.head || doc.getElementsByTagName('head')[0];

  const importMapScript = doc.createElement('script');
  importMapScript.type = 'importmap';
  importMapScript.textContent = JSON.stringify({ imports: importMapEntries }, null, 2);
  head.appendChild(importMapScript);

  const babelScript = doc.createElement('script');
  babelScript.src = 'https://unpkg.com/@babel/standalone@7.26.4/babel.min.js';
  head.appendChild(babelScript);

  const bundleScript = doc.createElement('script');
  bundleScript.type = 'text/babel';
  bundleScript.setAttribute('data-type', 'module');
  bundleScript.textContent = bundledJs;
  doc.body.appendChild(bundleScript);

  // Add a root div if not present
  if (!doc.getElementById('root')) {
    const rootDiv = doc.createElement('div');
    rootDiv.id = 'root';
    doc.body.insertBefore(rootDiv, doc.body.firstChild);
  }

  return `<!DOCTYPE html>\n${doc.documentElement.outerHTML}`;
}

// ---------------------------------------------------------------------------
// Plain HTML preview (existing)
// ---------------------------------------------------------------------------

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
