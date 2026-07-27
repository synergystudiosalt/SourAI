import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { WorkspaceFileNode } from '../types';
import {
  SandboxedPreviewFrame,
  WorkspaceMarkdownImage,
  buildSandboxedPreviewDocument,
  getRenameBlockReason,
} from './CodeWorkspace';
import { stripUntrustedMetaElements } from '../security/previewIsolation';

describe('CodeWorkspace preview security', () => {
  it('keeps active HTML and SVG content in a script-disabled opaque sandbox', () => {
    const source = '<svg onload="window.parent.__pwned=true"><script>window.parent.__pwned=true</script></svg>';
    const { container } = render(<SandboxedPreviewFrame source={source} title="safe preview" />);

    const frame = screen.getByTitle('safe preview');
    expect(frame).toHaveAttribute('sandbox', '');
    expect(frame.getAttribute('sandbox')).not.toContain('allow-same-origin');
    expect(frame.getAttribute('sandbox')).not.toContain('allow-scripts');
    expect(frame).toHaveAttribute('referrerpolicy', 'no-referrer');
    expect(container.querySelector('svg')).toBeNull();
    const document = frame.getAttribute('srcdoc') ?? '';
    expect(document).toContain('Content-Security-Policy');
    expect(document).toContain("default-src 'none'");
    expect(document).toContain("connect-src 'none'");
    expect(document).toContain('img-src data: blob:');
    expect(document.indexOf('Content-Security-Policy')).toBeLessThan(document.indexOf(source));
    expect(document).toContain(source);
  });

  it('wraps passive network payloads behind a restrictive preview CSP', () => {
    const source =
      '<style>body{background:url(https://tracker.example/css)}</style>' +
      '<img src="https://tracker.example/image"><svg><image href="https://tracker.example/svg"/></svg>';
    const document = buildSandboxedPreviewDocument(source);

    expect(document).toContain("default-src 'none'");
    expect(document).not.toContain('img-src https:');
    expect(document.indexOf('Content-Security-Policy')).toBeLessThan(document.indexOf('tracker.example'));
  });

  it('removes every untrusted meta element without matching similarly named elements', () => {
    const source = [
      '<MeTa data-note="quoted > value" http-equiv="refresh" content="0;url=https://tracker.example">',
      '<metadata>kept</metadata>',
      '<meta charset="utf-8">',
      '<p>safe body</p>',
      '<me<meta charset=x>ta http-equiv="refresh" content="0;url=https://tracker.example/mutated">',
      '<meta<meta charset=x> http-equiv="refresh" content="0;url=https://tracker.example/boundary">',
      'İ<META http-equiv="refresh" content="0;url=https://tracker.example/unicode-index">',
      '<meta name="truncated"',
    ].join('');

    const stripped = stripUntrustedMetaElements(source);
    expect(stripped).toContain('<metadata>kept</metadata>');
    expect(stripped).toContain('<p>safe body</p>');
    expect(stripped).not.toMatch(/<meta(?:[\t\n\f\r />]|$)/i);
    const document = buildSandboxedPreviewDocument(source);
    expect(document).toContain('<metadata>kept</metadata>');
    const parsed = new DOMParser().parseFromString(document, 'text/html');
    expect(parsed.body.querySelector('meta')).toBeNull();
  });

  it('does not request a remote Markdown image until the user opts in', () => {
    render(<WorkspaceMarkdownImage src="https://tracker.example/pixel.png" alt="tracking pixel" />);

    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Load remote image from tracker\.example/i }));
    const image = screen.getByRole('img', { name: 'tracking pixel' });
    expect(image).toHaveAttribute('src', 'https://tracker.example/pixel.png');
    expect(image).toHaveAttribute('referrerpolicy', 'no-referrer');
  });
});

describe('CodeWorkspace rename preflight', () => {
  const tree: WorkspaceFileNode[] = [
    { id: 'a.txt', name: 'a.txt', path: 'a.txt', type: 'file', content: 'a', isLoaded: true },
    { id: 'b.txt', name: 'b.txt', path: 'b.txt', type: 'file', content: 'b', isLoaded: true },
    {
      id: 'src',
      name: 'src',
      path: 'src',
      type: 'folder',
      children: [{ id: 'src/index.ts', name: 'index.ts', path: 'src/index.ts', type: 'file' }],
    },
  ];

  it('blocks collisions and malformed or self renames before filesystem mutation', () => {
    expect(getRenameBlockReason(tree, 'a.txt', 'b.txt')).toMatch(/already exists/i);
    expect(getRenameBlockReason(tree, 'a.txt', 'B.TXT')).toMatch(/already exists/i);
    expect(getRenameBlockReason(tree, 'a.txt', 'a.txt')).toMatch(/different name/i);
    expect(getRenameBlockReason(tree, 'a.txt', '../outside.txt')).toMatch(/path separators/i);
    expect(getRenameBlockReason(tree, 'src', 'src')).toMatch(/different name/i);
  });

  it('allows a collision-free sibling rename', () => {
    expect(getRenameBlockReason(tree, 'a.txt', 'renamed.txt')).toBeNull();
  });
});
