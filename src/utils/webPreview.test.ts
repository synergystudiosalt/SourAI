import { describe, expect, it } from 'vitest';

import type { WorkspaceFileNode } from '../types';
import { buildPreviewDocument, usesEsModules } from './webPreview';

const file = (path: string, content: string): WorkspaceFileNode => ({
  id: path,
  name: path.split('/').pop() || path,
  path,
  type: 'file',
  content,
  isLoaded: true,
});

describe('buildPreviewDocument plain HTML inlining', () => {
  it('inlines nested scripts in their original order', () => {
    const entry = file(
      'index.html',
      '<script src="vehicles/car.js"></script><script src="./ui/hud.js"></script><script src="/scenes/city.js"></script>'
    );
    const output = buildPreviewDocument(
      [
        entry,
        file('vehicles/car.js', 'window.order.push("car");'),
        file('ui/hud.js', 'window.order.push("hud");'),
        file('scenes/city.js', 'window.order.push("city");'),
      ],
      entry
    );

    expect(output).not.toContain('src="vehicles/car.js"');
    expect(output.indexOf('push("car")')).toBeLessThan(output.indexOf('push("hud")'));
    expect(output.indexOf('push("hud")')).toBeLessThan(output.indexOf('push("city")'));
  });

  it('follows transitive JavaScript and CSS references', () => {
    const entry = file(
      'pages/index.html',
      '<link rel="stylesheet" href="../styles/main.css"><script src="../js/main.js"></script>'
    );
    const output = buildPreviewDocument(
      [
        entry,
        file('styles/main.css', '@import "./theme/colors.css"; body { color: var(--ink); }'),
        file('styles/theme/colors.css', ':root { --ink: navy; }'),
        file('js/main.js', 'import "./helpers/setup.js";\nwindow.ready = true;'),
        file('js/helpers/setup.js', 'window.setup = true;'),
      ],
      entry
    );

    expect(output).toContain('--ink: navy');
    expect(output).toContain('window.setup = true');
    expect(output.indexOf('window.setup = true')).toBeLessThan(output.indexOf('window.ready = true'));
    expect(output).not.toContain('@import');
  });

  it('terminates cycles and inlines each file once', () => {
    const entry = file('index.html', '<script src="a.js"></script><script src="b.js"></script>');
    const output = buildPreviewDocument(
      [
        entry,
        file('a.js', 'import "./b.js";\nwindow.aMarker = 1;'),
        file('b.js', 'import "./a.js";\nwindow.bMarker = 1;'),
      ],
      entry
    );

    expect(output.match(/window\.aMarker/g)).toHaveLength(1);
    expect(output.match(/window\.bMarker/g)).toHaveLength(1);
  });

  it('leaves external CDN scripts untouched', () => {
    const entry = file('index.html', '<script src="https://cdn.jsdelivr.net/npm/three"></script>');
    const output = buildPreviewDocument([entry], entry);

    expect(output).toContain('src="https://cdn.jsdelivr.net/npm/three"');
  });

  it('replaces a missing local file with a visible comment', () => {
    const entry = file('index.html', '<script src="./missing.js"></script>');
    const output = buildPreviewDocument([entry], entry);

    expect(output).toContain('<!-- Missing local file: missing.js -->');
    expect(output).not.toContain('src="./missing.js"');
  });

  it('bundles ES modules in dependency order at the original module script position', () => {
    const entry = file(
      'index.html',
      [
        '<script src="https://cdn.example.com/three.min.js"></script>',
        '<script type="importmap">{"imports":{"three":"https://cdn.example.com/three.module.js"}}</script>',
        '<script type="module" src="src/main.js"></script>',
      ].join('')
    );
    const output = buildPreviewDocument(
      [
        entry,
        file(
          'src/main.js',
          [
            "import * as THREE_MODULE from 'three';",
            "import { Ground } from './world/ground.js';",
            'window.moduleResult = new Ground().value() + (THREE_MODULE === window.THREE ? 0 : 100);',
          ].join('\n')
        ),
        file(
          'src/world/ground.js',
          [
            "import * as THREE from 'three';",
            "import { BaseGround } from './base-ground.js';",
            'export class Ground extends BaseGround { value() { return super.value() + (THREE === window.THREE ? 1 : 100); } }',
          ].join('\n')
        ),
        file('src/world/base-ground.js', 'export class BaseGround { value() { return 41; } }'),
      ],
      entry
    );

    const doc = new DOMParser().parseFromString(output, 'text/html');
    const scripts = Array.from(doc.querySelectorAll('script'));
    const bundle = scripts.find((script) => script.textContent?.includes('src/main.js (entry)'));

    expect(bundle).toBeDefined();
    expect(bundle?.hasAttribute('src')).toBe(false);
    expect(bundle?.hasAttribute('type')).toBe(false);
    expect(bundle?.textContent).not.toMatch(/(^|\n)\s*(?:import|export)\s/m);
    expect(bundle?.textContent).toContain('class Ground extends BaseGround');
    expect(bundle?.textContent).toContain('const THREE_MODULE = window.THREE;');
    expect(bundle?.textContent?.indexOf('src/world/base-ground.js')).toBeLessThan(
      bundle?.textContent?.indexOf('src/world/ground.js') ?? -1
    );
    expect(bundle?.textContent?.indexOf('src/world/ground.js')).toBeLessThan(
      bundle?.textContent?.indexOf('src/main.js') ?? -1
    );

    const cdnScript = scripts.find((script) => script.src.includes('three.min.js'));
    const importMap = scripts.find((script) => script.type === 'importmap');
    expect(cdnScript?.getAttribute('src')).toBe('https://cdn.example.com/three.min.js');
    expect(importMap?.textContent).toContain('three.module.js');
    expect(output.indexOf('three.min.js')).toBeLessThan(output.indexOf('src/main.js (entry)'));
    expect(output.indexOf('three.module.js')).toBeLessThan(output.indexOf('src/main.js (entry)'));

    const previewWindow = { THREE: { name: 'classic global' }, moduleResult: 0 };
    new Function('window', bundle?.textContent || '')(previewWindow);
    expect(previewWindow.moduleResult).toBe(42);
  });

  it('isolates module scopes and hoists identical global aliases once', () => {
    const entry = file('index.html', '<script type="module" src="src/main.js"></script>');
    const output = buildPreviewDocument(
      [
        entry,
        file(
          'src/main.js',
          [
            "import { left } from './left.js';",
            "import { right } from './right.js';",
            "window.collisionResult = left + ':' + right;",
          ].join('\n')
        ),
        file(
          'src/left.js',
          [
            'const THREE = window.THREE;',
            "export const value = 'left';",
            "export const left = value + '-' + THREE.name;",
          ].join('\n')
        ),
        file(
          'src/right.js',
          [
            'const THREE = window.THREE;',
            "export const value = 'right';",
            "export const right = value + '-' + THREE.name;",
          ].join('\n')
        ),
      ],
      entry
    );

    const doc = new DOMParser().parseFromString(output, 'text/html');
    const bundleSource = doc.querySelector('script')?.textContent || '';
    const previewWindow = { THREE: { name: 'three' }, collisionResult: '' };

    expect(() => new Function('window', bundleSource)).not.toThrow();
    expect(bundleSource.match(/const THREE = window\.THREE;/g)).toHaveLength(1);
    new Function('window', bundleSource)(previewWindow);
    expect(previewWindow.collisionResult).toBe('left-three:right-three');
  });

  it('keeps exported names linked to importers in dependency-first order', () => {
    const entry = file('index.html', '<script type="module" src="main.js"></script>');
    const output = buildPreviewDocument(
      [
        entry,
        file(
          'main.js',
          [
            "import { value as firstValue } from './first.js';",
            "import { value as secondValue } from './second.js';",
            "window.linkedResult = firstValue + ':' + secondValue;",
          ].join('\n')
        ),
        file('first.js', "window.executionOrder.push('first');\nexport const value = 'one';"),
        file('second.js', "window.executionOrder.push('second');\nexport const value = 'two';"),
      ],
      entry
    );

    const doc = new DOMParser().parseFromString(output, 'text/html');
    const bundleSource = doc.querySelector('script')?.textContent || '';
    const previewWindow = { executionOrder: [] as string[], linkedResult: '' };

    new Function('window', bundleSource)(previewWindow);
    expect(previewWindow.linkedResult).toBe('one:two');
    expect(previewWindow.executionOrder).toEqual(['first', 'second']);
    expect(bundleSource.indexOf('// ── first.js')).toBeLessThan(bundleSource.indexOf('// ── main.js'));
    expect(bundleSource.indexOf('// ── second.js')).toBeLessThan(bundleSource.indexOf('// ── main.js'));
  });

  it('detects module syntax in a JavaScript entry even without type="module"', () => {
    const entry = file('index.html', '<script src="main.js"></script>');
    const main = file('main.js', 'export const answer = 42;\nwindow.answer = answer;');

    expect(usesEsModules([entry, main], entry)).toBe(true);

    const output = buildPreviewDocument([entry, main], entry);
    const doc = new DOMParser().parseFromString(output, 'text/html');
    const bundle = doc.querySelector('script');
    const previewWindow = { answer: 0 };

    expect(bundle?.textContent).toContain('const answer = 42;');
    expect(bundle?.textContent).not.toContain('export const');
    new Function('window', bundle?.textContent || '')(previewWindow);
    expect(previewWindow.answer).toBe(42);
  });

  it('keeps the classic-script path byte-identical when no modules are present', () => {
    const entry = file(
      'index.html',
      '<!DOCTYPE html><html><head><meta charset="utf-8"></head><body><script src="main.js"></script></body></html>'
    );
    const source = 'window.classicRuns = (window.classicRuns || 0) + 1;';
    const output = buildPreviewDocument([entry, file('main.js', source)], entry);

    expect(usesEsModules([entry, file('main.js', source)], entry)).toBe(false);
    expect(output).toBe(
      '<!DOCTYPE html>\n<html><head><meta charset="utf-8"></head><body><script>'
        + source
        + '</script></body></html>'
    );
    expect(output).not.toContain('main.js (entry)');
  });

  // Hoisting matched a prefix: given `const X = window.X || Fallback;` it
  // lifted `const X = window.X` and left `|| Fallback;` behind — a
  // SyntaxError that stopped the entire bundle from parsing. A guarded
  // fallback is a plain declaration, not an alias.
  it('does not lift a window alias out of a guarded fallback', () => {
    const entry = file(
      'index.html',
      '<!DOCTYPE html><html><body><script type="module" src="main.js"></script></body></html>'
    );
    const main = file(
      'main.js',
      [
        "import * as THREE_MODULE from 'three';",
        'const THREE = window.THREE || THREE_MODULE;',
        'window.__scene = new THREE.Scene();',
      ].join('\n')
    );

    const output = buildPreviewDocument([entry, main], entry);
    const bundle = [...output.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)]
      .map((m) => m[1])
      .find((s) => s.includes('__scene'));

    expect(bundle).toBeDefined();
    // The whole point: it has to parse.
    expect(() => new Function(bundle as string)).not.toThrow();
    expect(bundle).not.toMatch(/^\s*\|\|/m);
    expect(bundle).toContain('window.THREE || THREE_MODULE');
  });

  it('still hoists a plain window alias', () => {
    const entry = file(
      'index.html',
      '<!DOCTYPE html><html><body><script type="module" src="main.js"></script></body></html>'
    );
    const main = file('main.js', ['const T = window.THREE;', 'window.__r = T.REVISION;'].join('\n'));

    const bundle = buildPreviewDocument([entry, main], entry);
    expect(bundle).toContain('const T = window.THREE;');
    // Lifted to the bundle prologue, ahead of the module closure.
    expect(bundle.indexOf('const T = window.THREE;')).toBeLessThan(bundle.indexOf('window.__r'));
  });

});
