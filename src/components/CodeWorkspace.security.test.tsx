import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { WorkspaceFileNode } from '../types';
import {
  SandboxedPreviewFrame,
  WorkspaceMarkdownImage,
  buildSandboxedPreviewDocument,
  dedupeWorkspaceTabs,
  getRenameBlockReason,
  openSafePreviewInNewTab,
} from './CodeWorkspace';
import {
  PREVIEW_LOG_MESSAGE,
  PREVIEW_RESPONSE_POLICY,
  PREVIEW_SCRIPT_SOURCES,
  stripUntrustedMetaElements,
} from '../security/previewIsolation';
import { getPreviewLogs, resetPreviewLogs } from './workspace/previewLogStore';

describe('CodeWorkspace preview security', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    resetPreviewLogs();
    delete (URL as unknown as Record<string, unknown>).createObjectURL;
    delete (URL as unknown as Record<string, unknown>).revokeObjectURL;
  });

  it('runs project scripts inside an opaque sandbox without same-origin privileges', () => {
    const submit = vi.spyOn(HTMLFormElement.prototype, 'submit').mockImplementation(() => undefined);
    const source = '<svg onload="window.parent.__pwned=true"><script>window.parent.__pwned=true</script></svg>';
    const { container } = render(<SandboxedPreviewFrame source={source} title="safe preview" />);

    const frame = screen.getByTitle('safe preview');
    expect(frame).toHaveAttribute('sandbox', 'allow-scripts');
    expect(frame.getAttribute('sandbox')).not.toContain('allow-same-origin');
    expect(frame).toHaveAttribute('referrerpolicy', 'no-referrer');
    expect(container.querySelector('svg')).toBeNull();

    // Loaded as a real navigation, not srcdoc: a srcdoc document inherits the
    // app's strict script-src and could never reach a runtime CDN.
    expect(frame).not.toHaveAttribute('srcdoc');
    const form = container.querySelector('form');
    expect(form?.method).toBe('post');
    expect(form?.getAttribute('action')).toBe('/api/preview');
    expect(form?.getAttribute('target')).toBe(frame.getAttribute('name'));
    expect(submit).toHaveBeenCalled();

    const document = container.querySelector<HTMLInputElement>('input[name="html"]')?.value ?? '';
    expect(document).toContain('Content-Security-Policy');
    expect(document).toContain("default-src 'none'");
    expect(document).toContain("connect-src 'none'");
    expect(document).toContain('img-src data: blob:');
    expect(document.indexOf('Content-Security-Policy')).toBeLessThan(document.indexOf(source));
    expect(document).toContain(source);
  });

  it('accepts messages only from its iframe and resets entries when source changes', () => {
    vi.spyOn(HTMLFormElement.prototype, 'submit').mockImplementation(() => undefined);
    const { rerender } = render(<SandboxedPreviewFrame source="first" title="runtime preview" />);
    const frame = screen.getByTitle('runtime preview') as HTMLIFrameElement;
    const data = { type: PREVIEW_LOG_MESSAGE, level: 'error', text: 'first failure' };

    window.dispatchEvent(new MessageEvent('message', { data, source: window }));
    expect(getPreviewLogs()).toEqual([]);

    window.dispatchEvent(
      new MessageEvent('message', { data, source: frame.contentWindow })
    );
    expect(getPreviewLogs()).toEqual([{ level: 'error', text: 'first failure' }]);

    rerender(<SandboxedPreviewFrame source="second" title="runtime preview" />);
    expect(getPreviewLogs()).toEqual([]);
  });

  it('allows the runtime CDNs the preview builders actually use', () => {
    const document = buildSandboxedPreviewDocument('<p>x</p>');
    for (const origin of PREVIEW_SCRIPT_SOURCES) {
      expect(document).toContain(origin);
    }
    // jsdelivr is the default for three.js and was previously omitted.
    expect(document).toContain('https://cdn.jsdelivr.net');
    expect(document).toContain("style-src 'unsafe-inline' https://fonts.googleapis.com");
    expect(document).toContain('font-src data: https://fonts.gstatic.com');
    expect(document).toContain("connect-src 'none'");
  });

  it('forces an opaque origin on the served response, however the URL is reached', () => {
    // The endpoint echoes caller-supplied HTML from our own origin, so without
    // this a direct navigation would be reflected XSS against the app.
    expect(PREVIEW_RESPONSE_POLICY.startsWith('sandbox allow-scripts')).toBe(true);
    expect(PREVIEW_RESPONSE_POLICY).toContain("default-src 'none'");
    expect(PREVIEW_RESPONSE_POLICY).toContain("connect-src 'none'");
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

  it('opens a CSP-restricted preview in a separate tab via the preview endpoint', () => {
    // A blob: document inherits the creating page's CSP just like srcdoc, so
    // the previous blob-URL route blocked every runtime CDN as well.
    let submitted: HTMLFormElement | null = null;
    const submit = vi
      .spyOn(HTMLFormElement.prototype, 'submit')
      .mockImplementation(function (this: HTMLFormElement) {
        submitted = this;
      });

    openSafePreviewInNewTab('<script>window.opener.pwned=true</script><p>Preview</p>');

    expect(submit).toHaveBeenCalledOnce();
    const form = submitted as HTMLFormElement | null;
    expect(form).not.toBeNull();
    if (!form) throw new Error('Preview form was not submitted');
    expect(form.method).toBe('post');
    expect(form.getAttribute('action')).toBe('/api/preview');
    expect(form.target).toBe('_blank');

    const field = form.querySelector<HTMLInputElement>('input[name="html"]');
    expect(field?.value).toContain("default-src 'none'");
    expect(field?.value).toContain('<p>Preview</p>');
    // The form is removed again, leaving no stray markup in the app DOM.
    expect(document.body.contains(form)).toBe(false);
  });
});

describe('CodeWorkspace editor tabs', () => {
  it('keeps one tab per normalized path and preserves active and dirty state', () => {
    expect(
      dedupeWorkspaceTabs(
        [
          { path: 'game.js', isDirty: false },
          { path: './game.js', isDirty: true },
          { path: 'style.css', isDirty: false },
          { path: 'STYLE.CSS', isDirty: true },
        ],
        './game.js'
      )
    ).toEqual([
      { path: './game.js', isDirty: true },
      { path: 'style.css', isDirty: true },
    ]);
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
