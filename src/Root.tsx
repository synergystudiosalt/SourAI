import { StrictMode, useEffect, useState, type ReactNode } from 'react';
import type { RootOptions } from 'react-dom/client';

import App from './App';
import { ErrorBoundary } from './components/ui/ErrorBoundary';
import { normalizeError } from './contracts/errors';
import { getClientPersistence } from './storage/clientPersistence';

export interface RootProps {
  /** Test/integration seam; production renders the application by default. */
  children?: ReactNode;
}

function reportRootError(label: string, code: string, error: unknown): void {
  console.error(
    label,
    normalizeError(error, {
      code,
      causeCategory: 'runtime',
      message: 'The application encountered an unexpected rendering error.',
    }).toData()
  );
}

/**
 * Replaces React 19's default raw-error console reporters. React invokes these
 * independently of an ErrorBoundary, so every root path must normalize before
 * writing anything to the console.
 */
export const rootErrorHandlers: RootOptions = {
  onCaughtError(error) {
    reportRootError('[sour.ai] React caught error', 'react_caught_error', error);
  },
  onUncaughtError(error) {
    reportRootError('[sour.ai] React uncaught error', 'react_uncaught_error', error);
  },
  onRecoverableError(error) {
    reportRootError('[sour.ai] React recoverable error', 'react_recoverable_error', error);
  },
};

function StorageBoot() {
  const [status, setStatus] = useState<'loading' | 'ready' | 'failed'>(
    import.meta.env.MODE === 'test' ? 'ready' : 'loading'
  );
  useEffect(() => {
    if (status === 'ready') return;
    let cancelled = false;
    void getClientPersistence()
      .then(() => {
        if (!cancelled) setStatus('ready');
      })
      .catch((error) => {
        console.error(
          '[sour.ai] Local storage bootstrap failed',
          normalizeError(error, {
            code: 'storage_bootstrap_failed',
            causeCategory: 'storage',
            message: 'SourAI could not open its private browser storage.',
          }).toData()
        );
        if (!cancelled) setStatus('failed');
      });
    return () => {
      cancelled = true;
    };
  }, [status]);
  if (status === 'ready') return <App />;
  return (
    <main className="flex h-screen items-center justify-center bg-[#faf9f6] p-6 text-sm text-[#706c62]">
      {status === 'loading'
        ? 'Opening your private browser workspace…'
        : 'Private browser storage is unavailable. Check site storage permissions and reload.'}
    </main>
  );
}

/** The exact application root mounted by main.tsx. */
export function Root({ children }: RootProps) {
  return (
    <StrictMode>
      <ErrorBoundary label="sour.ai">{children ?? <StorageBoot />}</ErrorBoundary>
    </StrictMode>
  );
}
