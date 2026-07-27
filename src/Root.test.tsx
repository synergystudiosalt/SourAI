import { act } from '@testing-library/react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { SECRET_CANARIES, expectNoSecrets } from './test/assertions';
import { Root as AppRoot, rootErrorHandlers } from './Root';

function Boom(): never {
  throw new Error(`render failed with ${SECRET_CANARIES.openai}`);
}

function serializeConsoleCalls(calls: unknown[][]): string {
  return calls
    .flat()
    .map((value) => {
      if (value instanceof Error) return `${value.name}: ${value.message}\n${value.stack ?? ''}`;
      if (typeof value === 'string') return value;
      try {
        return JSON.stringify(value);
      } catch {
        return String(value);
      }
    })
    .join('\n');
}

let mountedRoot: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(async () => {
  if (mountedRoot) {
    await act(async () => mountedRoot?.unmount());
  }
  container?.remove();
  mountedRoot = null;
  container = null;
});

describe('React root error reporting', () => {
  it('replaces React default caught-error logging with redacted data only', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    container = document.createElement('div');
    document.body.appendChild(container);
    mountedRoot = createRoot(container, rootErrorHandlers);

    try {
      await act(async () => {
        mountedRoot?.render(
          <AppRoot>
            <Boom />
          </AppRoot>
        );
      });

      expect(container).toHaveTextContent('stopped responding');
      expect(consoleError).toHaveBeenCalled();
      expectNoSecrets(serializeConsoleCalls(consoleError.mock.calls), 'all React caught-error console arguments');
    } finally {
      consoleError.mockRestore();
    }
  });

  it('redacts uncaught and recoverable root reports', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      rootErrorHandlers.onUncaughtError?.(
        new Error(`uncaught ${SECRET_CANARIES.google}`),
        { componentStack: '' }
      );
      rootErrorHandlers.onRecoverableError?.(
        new Error(`recoverable ${SECRET_CANARIES.groq}`),
        { componentStack: '' }
      );

      expect(consoleError).toHaveBeenCalledTimes(2);
      expectNoSecrets(serializeConsoleCalls(consoleError.mock.calls), 'all React root console arguments');
    } finally {
      consoleError.mockRestore();
    }
  });
});
