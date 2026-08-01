import { useEffect, useState } from 'react';

/**
 * Subscribes to a CSS media query from React.
 *
 * Layout that can be expressed in CSS should stay in CSS. This exists for the
 * cases where a measurement has to reach JavaScript — panels whose width is
 * animated as an inline style, where a Tailwind breakpoint class would be
 * overridden by the style attribute and silently lose.
 *
 * Queries are written so that `false` is the desktop answer. Environments
 * without a real `matchMedia` (jsdom, SSR) then render the full layout rather
 * than a collapsed one that no test asked for.
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
    return window.matchMedia(query).matches;
  });

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const list = window.matchMedia(query);
    const update = () => setMatches(list.matches);
    update();
    // Safari below 14 only has the deprecated listener API.
    if (typeof list.addEventListener === 'function') {
      list.addEventListener('change', update);
      return () => list.removeEventListener('change', update);
    }
    list.addListener(update);
    return () => list.removeListener(update);
  }, [query]);

  return matches;
}

/** True on viewports too narrow for a multi-column workspace. */
export function useIsCompactViewport(): boolean {
  return useMediaQuery('(max-width: 1023px)');
}
