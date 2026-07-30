import { describe, expect, it } from 'vitest';

import type { WorkspaceFileNode } from '../types';
import { buildPreviewDocument } from './webPreview';

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
});
