/**
 * Keeps the app shell the height of what the user can actually see.
 *
 * `100vh` on a phone is the *large* viewport — the height with the browser
 * toolbar hidden — so a shell sized to it hangs below the screen whenever the
 * toolbar is showing, taking the composer with it. `100dvh` fixes that, but not
 * the other half of the problem: on iOS the on-screen keyboard does not resize
 * the layout viewport at all, so `dvh` stays at its full value and the input
 * the user just tapped ends up underneath the keyboard.
 *
 * `visualViewport` is the only measurement that reflects both. It is published
 * as a custom property so layout stays in CSS, with `dvh` and then `vh` behind
 * it for browsers that lack the API.
 */

const PROPERTY = '--app-viewport-height';

function apply(height: number): void {
  if (!Number.isFinite(height) || height <= 0) return;
  document.documentElement.style.setProperty(PROPERTY, `${Math.round(height)}px`);
}

/**
 * Starts syncing the property. Returns a teardown for tests; the app itself
 * runs this for the lifetime of the page.
 */
export function trackAppViewportHeight(): () => void {
  if (typeof window === 'undefined' || typeof document === 'undefined') return () => {};

  const viewport = window.visualViewport;
  if (!viewport) {
    // No visualViewport: `dvh` in the stylesheet is already the best available
    // answer, so publishing a fixed innerHeight here would only make it worse.
    return () => {};
  }

  const update = () => {
    // Pinch-zoom also shrinks the visual viewport. Scaling back up by the zoom
    // factor keeps a zoomed-in user from having the whole shell collapse.
    apply(viewport.height * (viewport.scale || 1));
  };

  update();
  viewport.addEventListener('resize', update);
  viewport.addEventListener('scroll', update);
  window.addEventListener('orientationchange', update);

  return () => {
    viewport.removeEventListener('resize', update);
    viewport.removeEventListener('scroll', update);
    window.removeEventListener('orientationchange', update);
    document.documentElement.style.removeProperty(PROPERTY);
  };
}
