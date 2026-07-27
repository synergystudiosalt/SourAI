import '@testing-library/jest-dom/vitest';

import { randomUUID } from 'node:crypto';

import { cleanup } from '@testing-library/react';
import { afterEach, beforeEach, vi } from 'vitest';

import { resetFlagCacheForTests } from '../features/flags';
import { clearRegisteredSecrets } from '../security/redaction';
import {
  ClientPersistence,
  setClientPersistenceForTests,
} from '../storage/clientPersistence';
import { InMemoryStorageDatabase } from '../storage/testing/inMemoryDatabase';

/**
 * Global test environment.
 *
 * Two rules are enforced here rather than repeated in every spec:
 *
 *  1. No test may reach the network by accident. `fetch` throws unless a test
 *     stubs it deliberately. This is how the "no SourAI backend" architecture
 *     stays enforced at the unit level as well as in the E2E network trace.
 *  2. No test may inherit local state from another. Storage, flag caches, and
 *     registered secrets are reset between tests.
 */

// ── jsdom gaps that component code legitimately relies on ──────────────────

if (!('matchMedia' in window)) {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: (query: string): MediaQueryList =>
      ({
        matches: false,
        media: query,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false,
      }) as unknown as MediaQueryList,
  });
}

if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = function scrollIntoView(): void {};
}

if (!('ResizeObserver' in globalThis)) {
  class TestResizeObserver {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }
  Object.defineProperty(globalThis, 'ResizeObserver', { writable: true, value: TestResizeObserver });
}

if (!('IntersectionObserver' in globalThis)) {
  class TestIntersectionObserver {
    readonly root = null;
    readonly rootMargin = '';
    readonly thresholds: readonly number[] = [];
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
    takeRecords(): IntersectionObserverEntry[] {
      return [];
    }
  }
  Object.defineProperty(globalThis, 'IntersectionObserver', { writable: true, value: TestIntersectionObserver });
}

if (typeof globalThis.crypto?.randomUUID !== 'function') {
  // jsdom exposes `crypto.getRandomValues` but not always `randomUUID`.
  Object.defineProperty(globalThis.crypto, 'randomUUID', { writable: true, value: randomUUID });
}

// ── Network guard ───────────────────────────────────────────────────────────

/** Records every blocked request so a test can assert on the attempt. */
export const blockedRequests: string[] = [];

function networkGuard(input: RequestInfo | URL): never {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  blockedRequests.push(url);
  throw new Error(
    `Unexpected network request to "${url}" in a unit test. ` +
      'Stub it with vi.stubGlobal("fetch", ...) if the request is the thing under test.'
  );
}

beforeEach(() => {
  blockedRequests.length = 0;
  vi.stubGlobal('fetch', vi.fn(networkGuard));
  setClientPersistenceForTests(new ClientPersistence(new InMemoryStorageDatabase()));
});

// ── Isolation ───────────────────────────────────────────────────────────────

afterEach(() => {
  cleanup();
  try {
    window.localStorage.clear();
    window.sessionStorage.clear();
  } catch {
    // Storage may be unavailable in a hardened environment; nothing to clear.
  }
  resetFlagCacheForTests();
  clearRegisteredSecrets();
  setClientPersistenceForTests(null);
});
