import { afterEach, describe, expect, it } from 'vitest';

import { trackAppViewportHeight } from './appViewport';

const PROPERTY = '--app-viewport-height';

type Handler = () => void;

/** Stands in for `window.visualViewport`, which jsdom does not implement. */
function stubVisualViewport(height: number, scale = 1) {
  const handlers = new Map<string, Set<Handler>>();
  const viewport = {
    height,
    width: 375,
    scale,
    offsetTop: 0,
    addEventListener(type: string, handler: Handler) {
      if (!handlers.has(type)) handlers.set(type, new Set());
      handlers.get(type)!.add(handler);
    },
    removeEventListener(type: string, handler: Handler) {
      handlers.get(type)?.delete(handler);
    },
  };
  Object.defineProperty(window, 'visualViewport', {
    configurable: true,
    writable: true,
    value: viewport,
  });
  return {
    viewport,
    resizeTo(next: number) {
      viewport.height = next;
      for (const handler of handlers.get('resize') ?? []) handler();
    },
    listenerCount() {
      return [...handlers.values()].reduce((total, set) => total + set.size, 0);
    },
  };
}

describe('trackAppViewportHeight', () => {
  afterEach(() => {
    document.documentElement.style.removeProperty(PROPERTY);
    Object.defineProperty(window, 'visualViewport', {
      configurable: true,
      writable: true,
      value: undefined,
    });
  });

  it('publishes the visible height immediately', () => {
    stubVisualViewport(640);
    const stop = trackAppViewportHeight();
    expect(document.documentElement.style.getPropertyValue(PROPERTY)).toBe('640px');
    stop();
  });

  it('follows the viewport shrinking, which is what the keyboard does', () => {
    // On iOS the keyboard changes neither `vh` nor `dvh`; this is the only
    // signal that the composer is about to be covered.
    const media = stubVisualViewport(844);
    const stop = trackAppViewportHeight();
    media.resizeTo(508);
    expect(document.documentElement.style.getPropertyValue(PROPERTY)).toBe('508px');
    stop();
  });

  it('does not collapse the shell when the user pinch-zooms', () => {
    // Zooming shrinks the visual viewport without hiding anything, so the
    // reported height is scaled back up.
    stubVisualViewport(400, 2);
    const stop = trackAppViewportHeight();
    expect(document.documentElement.style.getPropertyValue(PROPERTY)).toBe('800px');
    stop();
  });

  it('leaves the stylesheet in charge where visualViewport is unavailable', () => {
    // Without the API, `dvh` in the stylesheet is the best answer available —
    // publishing a stale innerHeight here would override it with something worse.
    const stop = trackAppViewportHeight();
    expect(document.documentElement.style.getPropertyValue(PROPERTY)).toBe('');
    stop();
  });

  it('detaches its listeners and its property on teardown', () => {
    const media = stubVisualViewport(700);
    const stop = trackAppViewportHeight();
    expect(media.listenerCount()).toBeGreaterThan(0);
    stop();
    expect(media.listenerCount()).toBe(0);
    expect(document.documentElement.style.getPropertyValue(PROPERTY)).toBe('');
  });
});
