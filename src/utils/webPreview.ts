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

export type PreviewKind = 'html' | 'markdown' | 'svg';

const PLAIN_EXTENSION_KIND: Record<string, 'html' | 'markdown' | 'svg'> = {
  html: 'html', htm: 'html',
  md: 'markdown', markdown: 'markdown',
  svg: 'svg',
};

export function getPreviewKind(name: string): PreviewKind | null {
  const ext = name.split('.').pop()?.toLowerCase() || '';
  return PLAIN_EXTENSION_KIND[ext] ?? null;
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

const BARE_IMPORT_GLOBALS: Record<string, string> = {
  'react': 'React',
  'react-dom': 'ReactDOM',
  'react-dom/client': 'ReactDOM',
  'three': 'THREE',
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

function hasTopLevelModuleSyntax(source: string): boolean {
  return /(?:^|\n)\s*(?:import\s+|export\s+)/m.test(source);
}

/** Detect module scripts declared by the HTML or used by one of its local entry scripts. */
export function usesEsModules(files: WorkspaceFileNode[], entryFile: WorkspaceFileNode): boolean {
  if (!/\.html?$/i.test(entryFile.path)) {
    return hasTopLevelModuleSyntax(entryFile.content || '');
  }

  let doc: Document;
  try {
    doc = new DOMParser().parseFromString(entryFile.content || '', 'text/html');
  } catch {
    return /<script\b[^>]*\btype\s*=\s*(['"])module\1/i.test(entryFile.content || '');
  }

  return Array.from(doc.querySelectorAll('script')).some((script) => {
    if (script.getAttribute('type')?.toLowerCase() === 'module') return true;

    const src = script.getAttribute('src');
    if (!src || isExternalRef(src)) {
      return !src && hasTopLevelModuleSyntax(script.textContent || '');
    }

    const resolvedPath = resolveRelativePath(src.startsWith('/') ? '' : entryFile.path, src);
    const scriptFile = resolveFileExtension(files, resolvedPath);
    return hasTopLevelModuleSyntax(scriptFile?.content || '');
  });
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

  modules.push(file);
  return modules;
}

/** Transform a single module's source: replace bare imports with global refs, strip all imports/exports. */
function transformModuleSource(source: string): string {
  let out = source;

  // Strip CSS imports
  out = out.replace(CSS_IMPORT_RE, '\n');

  // Step 1: Replace bare (non-relative) named/default imports with global variable refs.
  //   import React from 'react'            → const React = window.React;
  //   import { useState } from 'react'     → const { useState } = window.React;
  //   import ReactDOM from 'react-dom/client' → const ReactDOM = window.ReactDOM;
  //   import * as R from 'react'            → const R = window.React;
  const bareImportRe = /(?:^|\n)\s*import\s+(?:(\w+(?:\s*,\s*\{[^}]*\})?|\{[^}]*\}|\*\s+as\s+\w+)\s+from\s+)?['"]([^'"]+)['"];?/gm;
  out = out.replace(bareImportRe, (_match: string, bindings: string | undefined, specifier: string) => {
    if (!specifier.startsWith('.') && (BARE_IMPORT_MAP[specifier] || BARE_IMPORT_GLOBALS[specifier])) {
      if (!bindings) return '\n'; // side-effect import like `import 'react'`
      const globalName = BARE_IMPORT_GLOBALS[specifier] || specifier;
      const globalRef = /^[A-Za-z_$][\w$]*$/.test(globalName)
        ? `window.${globalName}`
        : `window[${JSON.stringify(globalName)}]`;
      // Named imports: { useState, useEffect }
      if (bindings.startsWith('{')) {
        const destructuring = bindings.replace(/\s+as\s+/g, ': ');
        return `\nvar ${destructuring} = ${globalRef};\n`;
      }
      // Namespace: * as R
      if (bindings.startsWith('*')) {
        const name = bindings.replace('* as ', '').trim();
        return `\nvar ${name} = ${globalRef};\n`;
      }
      // Default: React
      return `\nvar ${bindings} = ${globalRef};\n`;
    }
    return '\n'; // strip ALL other imports (relative, CSS, unknown)
  });

  // Strip: import 'some-package' (side-effect only)
  out = out.replace(/(?:^|\n)\s*import\s*['"][^'"]+['"];?\s*/gm, '\n');

  // Strip: export ...
  out = out.replace(/export\s+default\s+/g, 'var __default__ = ');
  out = out.replace(/export\s+(const|let|var|function|class)\s+/g, '$1 ');
  out = out.replace(/export\s+\{[^}]*\};?\s*/g, '');
  out = out.replace(/export\s+/g, '');

  return out;
}


type PlainModuleAlias = { localName: string; globalRef: string };
type PlainModuleExport = { exportedName: string; localName: string };

function uniqueBundleName(base: string, sources: string): string {
  let name = base;
  while (new RegExp('\\b' + name + '\\b').test(sources)) name += '_';
  return name;
}

function parseImportBindings(bindings: string): Array<{ importedName: string; localName: string }> {
  return bindings
    .replace(/^\{|\}$/g, '')
    .split(',')
    .map((binding) => binding.trim())
    .filter(Boolean)
    .map((binding) => {
      const parts = binding.split(/\s+as\s+/);
      return { importedName: parts[0].trim(), localName: (parts[1] || parts[0]).trim() };
    });
}

function transformPlainModule(
  source: string,
  modulePath: string,
  files: WorkspaceFileNode[],
  registryName: string,
): { source: string; aliases: PlainModuleAlias[]; exports: PlainModuleExport[] } {
  const aliases: PlainModuleAlias[] = [];
  const moduleExports: PlainModuleExport[] = [];
  const addExport = (exportedName: string, localName: string) => {
    if (!moduleExports.some((item) => item.exportedName === exportedName)) {
      moduleExports.push({ exportedName, localName });
    }
  };

  // Treat hand-written top-level window aliases exactly like aliases generated
  // from bare imports. Requiring the declaration at column zero avoids lifting
  // a declaration out of a nested block.
  //
  // The trailing lookahead requires the statement to END at the global
  // reference. Without it the pattern matched a prefix: given
  // `const THREE = window.THREE || THREE_MODULE;` it lifted
  // `const THREE = window.THREE` and left `|| THREE_MODULE;` behind, a
  // SyntaxError that killed the entire bundle. A guarded fallback like that is
  // a plain declaration, not an alias, and belongs inside the module closure
  // where it cannot collide with another module's.
  let out = source.replace(
    /(^|\n)const\s+([A-Za-z_$][\w$]*)\s*=\s*(window(?:\.[A-Za-z_$][\w$]*|\[(?:'[^']*'|"[^"]*")\]))[ \t]*;?[ \t]*(?=\r?\n|$)/g,
    (_match, lineStart: string, localName: string, globalRef: string) => {
      aliases.push({ localName, globalRef });
      return lineStart;
    }
  );
  out = out.replace(CSS_IMPORT_RE, '\n');

  const importRe = /(^|\n)\s*import\s+(?:(.*?)\s+from\s+)?['"]([^'"]+)['"]\s*;?/gm;
  out = out.replace(importRe, (_match, lineStart: string, rawBindings: string | undefined, specifier: string) => {
    const bindings = rawBindings?.trim();
    if (!bindings || specifier.endsWith('.css')) return lineStart;

    if (!specifier.startsWith('.')) {
      if (!BARE_IMPORT_MAP[specifier] && !BARE_IMPORT_GLOBALS[specifier]) return lineStart;
      const globalName = BARE_IMPORT_GLOBALS[specifier] || specifier;
      const globalRef = /^[A-Za-z_$][\w$]*$/.test(globalName)
        ? 'window.' + globalName
        : 'window[' + JSON.stringify(globalName) + ']';
      if (bindings.startsWith('{')) {
        for (const binding of parseImportBindings(bindings)) {
          aliases.push({ localName: binding.localName, globalRef: globalRef + '.' + binding.importedName });
        }
      } else if (bindings.startsWith('*')) {
        aliases.push({ localName: bindings.replace(/^\*\s+as\s+/, '').trim(), globalRef });
      } else {
        const combined = bindings.match(/^([A-Za-z_$][\w$]*)\s*,\s*(\{[\s\S]*\})$/);
        if (combined) {
          aliases.push({ localName: combined[1], globalRef });
          for (const binding of parseImportBindings(combined[2])) {
            aliases.push({ localName: binding.localName, globalRef: globalRef + '.' + binding.importedName });
          }
        } else {
          aliases.push({ localName: bindings, globalRef });
        }
      }
      return lineStart;
    }

    const resolved = resolveFileExtension(files, resolveRelativePath(modulePath, specifier));
    if (!resolved) return lineStart;
    const dependency = registryName + '[' + JSON.stringify(resolved.path) + ']';
    if (bindings.startsWith('{')) {
      const properties = parseImportBindings(bindings)
        .map((binding) => binding.importedName === binding.localName
          ? binding.importedName
          : binding.importedName + ': ' + binding.localName)
        .join(', ');
      return lineStart + 'const { ' + properties + ' } = ' + dependency + ';';
    }
    if (bindings.startsWith('*')) {
      return lineStart + 'const ' + bindings.replace(/^\*\s+as\s+/, '').trim() + ' = ' + dependency + ';';
    }
    const combined = bindings.match(/^([A-Za-z_$][\w$]*)\s*,\s*(\{[\s\S]*\})$/);
    if (combined) {
      const properties = parseImportBindings(combined[2])
        .map((binding) => binding.importedName === binding.localName
          ? binding.importedName
          : binding.importedName + ': ' + binding.localName)
        .join(', ');
      return lineStart + 'const ' + combined[1] + ' = ' + dependency + '.default;\nconst { '
        + properties + ' } = ' + dependency + ';';
    }
    return lineStart + 'const ' + bindings + ' = ' + dependency + '.default;';
  });

  const defaultName = uniqueBundleName('__sourPreviewDefault', out);
  out = out.replace(/export\s+default\s+(async\s+)?function\s+([A-Za-z_$][\w$]*)/g,
    (_match, asyncKeyword: string | undefined, localName: string) => {
      addExport('default', localName);
      return (asyncKeyword || '') + 'function ' + localName;
    });
  out = out.replace(/export\s+default\s+class\s+([A-Za-z_$][\w$]*)/g, (_match, localName: string) => {
    addExport('default', localName);
    return 'class ' + localName;
  });
  out = out.replace(/export\s+default\s+/g, () => {
    addExport('default', defaultName);
    return 'const ' + defaultName + ' = ';
  });
  out = out.replace(/export\s+(const|let|var|function|class)\s+([A-Za-z_$][\w$]*)/g,
    (_match, declaration: string, localName: string) => {
      addExport(localName, localName);
      return declaration + ' ' + localName;
    });
  out = out.replace(/export\s*\{([^}]*)\}\s*;?/g, (_match, bindings: string) => {
    for (const binding of bindings.split(',').map((item: string) => item.trim()).filter(Boolean)) {
      const parts = binding.split(/\s+as\s+/);
      addExport((parts[1] || parts[0]).trim(), parts[0].trim());
    }
    return '';
  });
  out = out.replace(/export\s+/g, '');

  return { source: out, aliases, exports: moduleExports };
}

function bundlePlainEsModules(
  modules: WorkspaceFileNode[],
  files: WorkspaceFileNode[],
  entryPath: string,
): string {
  const registryName = uniqueBundleName(
    '__sourPreviewModules',
    modules.map((module) => module.content || '').join('\n')
  );
  const transformed = modules.map((module) => ({
    module,
    result: transformPlainModule(module.content || '', module.path, files, registryName),
  }));
  const refsByAlias = new Map<string, Set<string>>();
  for (const item of transformed) {
    for (const alias of item.result.aliases) {
      const refs = refsByAlias.get(alias.localName) || new Set<string>();
      refs.add(alias.globalRef);
      refsByAlias.set(alias.localName, refs);
    }
  }
  const hoisted = new Map<string, string>();
  for (const [localName, refs] of refsByAlias) {
    if (refs.size === 1) hoisted.set(localName, Array.from(refs)[0]);
  }

  const lines = [
    '(function(' + registryName + ') {',
    ...Array.from(hoisted, ([localName, globalRef]) => 'const ' + localName + ' = ' + globalRef + ';'),
  ];
  for (const item of transformed) {
    const localAliases = item.result.aliases
      .filter((alias) => !hoisted.has(alias.localName))
      .filter((alias, index, all) => all.findIndex((candidate) =>
        candidate.localName === alias.localName && candidate.globalRef === alias.globalRef) === index)
      .map((alias) => 'const ' + alias.localName + ' = ' + alias.globalRef + ';')
      .join('\n');
    const exported = item.result.exports
      .map((binding) => JSON.stringify(binding.exportedName) + ': ' + binding.localName)
      .join(', ');
    lines.push(
      '// ── ' + item.module.path + (item.module.path === entryPath ? ' (entry)' : '') + ' ──',
      registryName + '[' + JSON.stringify(item.module.path) + '] = (function() {',
      localAliases,
      item.result.source,
      'return { ' + exported + ' };',
      '})();'
    );
  }
  lines.push(
    "})(window[Symbol.for('sour.webPreview.modules')] || "
      + "(window[Symbol.for('sour.webPreview.modules')] = Object.create(null)));"
  );
  return lines.join('\n');
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
  bundleScript.setAttribute('data-presets', 'typescript,react');
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
  const inlinedPaths = new Set<string>();
  const bundledModulePaths = new Set<string>();
  const modulesInUse = usesEsModules(files, entry);

  const missingComment = (path: string) => `<!-- Missing local file: ${path} -->`;
  const resolveLocalPath = (fromPath: string, ref: string) =>
    resolveRelativePath(ref.startsWith('/') ? '' : fromPath, ref);

  const inlineCss = (source: string, fromPath: string): string =>
    source.replace(
      /@import\s+(?:url\(\s*)?(?:(['"])([^'"]+)\1|([^'")\s]+))\s*\)?\s*;/gi,
      (match: string, _quote: string | undefined, quotedRef: string | undefined, bareRef: string | undefined) => {
        const ref = quotedRef || bareRef;
        if (!ref || isExternalRef(ref)) return match;
        return inlineLocalFile(ref, fromPath, 'css');
      }
    );

  const inlineJavaScript = (source: string, fromPath: string): string =>
    source.replace(
      /(^|\n)([ \t]*import\s+(?:(?:[\w$*{}\s,]+\s+from\s+)?['"]([^'"]+)['"])\s*;?)/g,
      (match: string, lineStart: string, _statement: string, ref: string) => {
        if (isExternalRef(ref)) return match;
        return `${lineStart}${inlineLocalFile(ref, fromPath, 'script')}`;
      }
    );

  function inlineLocalFile(ref: string, fromPath: string, kind: 'css' | 'script'): string {
    const resolvedPath = resolveLocalPath(fromPath, ref);
    const file = findByPath(resolvedPath);
    if (!file) return missingComment(resolvedPath);
    if (inlinedPaths.has(resolvedPath)) return '';

    // Mark before descending so A -> B -> A cycles terminate, and so a later
    // HTML reference cannot execute a dependency for a second time.
    inlinedPaths.add(resolvedPath);
    const source = file.content || '';
    return kind === 'css'
      ? inlineCss(source, resolvedPath)
      : inlineJavaScript(source, resolvedPath);
  }

  let doc: Document;
  try {
    doc = new DOMParser().parseFromString(entry.content || '', 'text/html');
  } catch {
    return entry.content || '';
  }

  doc.querySelectorAll('style').forEach((style) => {
    style.textContent = inlineCss(style.textContent || '', entry.path);
  });

  doc.querySelectorAll('link[rel="stylesheet"]').forEach((link) => {
    const href = link.getAttribute('href');
    if (!href || isExternalRef(href)) return;
    const resolvedPath = resolveLocalPath(entry.path, href);
    if (!findByPath(resolvedPath)) {
      link.replaceWith(doc.createComment(` Missing local file: ${resolvedPath} `));
      return;
    }
    const style = doc.createElement('style');
    style.textContent = inlineLocalFile(href, entry.path, 'css');
    link.replaceWith(style);
  });

  doc.querySelectorAll('script[src]').forEach((script) => {
    const src = script.getAttribute('src');
    if (!src || isExternalRef(src)) return;
    const resolvedPath = resolveLocalPath(entry.path, src);
    const exactScriptFile = findByPath(resolvedPath);
    const moduleEntryFile = resolveFileExtension(files, resolvedPath);
    const isModuleEntry = modulesInUse && Boolean(moduleEntryFile) && (
      script.getAttribute('type')?.toLowerCase() === 'module'
      || hasTopLevelModuleSyntax(moduleEntryFile?.content || '')
    );
    if (isModuleEntry && moduleEntryFile) {
      const modules = collectModules(files, moduleEntryFile.path, bundledModulePaths);
      const bundledJs = bundlePlainEsModules(modules, files, moduleEntryFile.path);

      script.removeAttribute('src');
      script.removeAttribute('type');
      script.textContent = bundledJs;
      return;
    }

    if (!exactScriptFile) {
      script.replaceWith(doc.createComment(` Missing local file: ${resolvedPath} `));
      return;
    }

    script.removeAttribute('src');
    script.textContent = inlineLocalFile(src, entry.path, 'script');
  });

  return `<!DOCTYPE html>\n${doc.documentElement.outerHTML}`;
}
