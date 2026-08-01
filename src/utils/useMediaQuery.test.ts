import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useIsCompactViewport, useMediaQuery } from './useMediaQuery';

type Listener = () => void;

/** Installs a controllable `matchMedia` and returns a handle to flip it. */
function stubMatchMedia(initial: boolean) {
  const listeners = new Set<Listener>();
  let matches = initial;
  const original = window.matchMedia;
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    configurable: true,
    value: (query: string) =>
      ({
        get matches() {
          return matches;
        },
        media: query,
        addEventListener: (_event: string, listener: Listener) => listeners.add(listener),
        removeEventListener: (_event: string, listener: Listener) => listeners.delete(listener),
        addListener: (listener: Listener) => listeners.add(listener),
        removeListener: (listener: Listener) => listeners.delete(listener),
        dispatchEvent: () => false,
        onchange: null,
      }) as unknown as MediaQueryList,
  });
  return {
    set(next: boolean) {
      matches = next;
      for (const listener of [...listeners]) listener();
    },
    get listenerCount() {
      return listeners.size;
    },
    restore() {
      Object.defineProperty(window, 'matchMedia', {
        writable: true,
        configurable: true,
        value: original,
      });
    },
  };
}

describe('useMediaQuery', () => {
  let media: ReturnType<typeof stubMatchMedia> | null = null;

  afterEach(() => {
    media?.restore();
    media = null;
  });

  it('reports the current match', () => {
    media = stubMatchMedia(true);
    const { result } = renderHook(() => useMediaQuery('(max-width: 1023px)'));
    expect(result.current).toBe(true);
  });

  it('follows the query when the viewport changes', () => {
    media = stubMatchMedia(false);
    const { result } = renderHook(() => useIsCompactViewport());
    expect(result.current).toBe(false);

    act(() => media!.set(true));
    expect(result.current).toBe(true);
  });

  it('unsubscribes on unmount', () => {
    media = stubMatchMedia(false);
    const { unmount } = renderHook(() => useIsCompactViewport());
    expect(media.listenerCount).toBe(1);
    unmount();
    expect(media.listenerCount).toBe(0);
  });

  it('answers "not compact" where matchMedia does not exist', () => {
    // jsdom and SSR both land here. Answering `true` would collapse the
    // workspace to a single pane in every unit test that renders it.
    const original = window.matchMedia;
    // @ts-expect-error deliberately removing the API for this case
    delete window.matchMedia;
    try {
      const { result } = renderHook(() => useIsCompactViewport());
      expect(result.current).toBe(false);
    } finally {
      Object.defineProperty(window, 'matchMedia', {
        writable: true,
        configurable: true,
        value: original,
      });
    }
  });

  it('does not blow up when the browser only has the deprecated listener API', () => {
    media = stubMatchMedia(false);
    const list = window.matchMedia('(max-width: 1023px)') as unknown as Record<string, unknown>;
    const withoutModern = { ...list, addEventListener: undefined };
    vi.spyOn(window, 'matchMedia').mockReturnValue(withoutModern as unknown as MediaQueryList);

    const { result } = renderHook(() => useIsCompactViewport());
    expect(result.current).toBe(false);
  });
});
