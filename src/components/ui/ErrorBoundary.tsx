import React from 'react';

import { normalizeError, type SourError } from '../../contracts/errors';

interface ErrorBoundaryProps {
  children: React.ReactNode;
  /** Shown instead of the default panel. Receives the normalized error. */
  fallback?: (error: SourError, reset: () => void) => React.ReactNode;
  /** Human-readable name of the region, used in the default panel copy. */
  label?: string;
  /** Notified on every caught error. Must not throw. */
  onError?: (error: SourError, componentStack: string) => void;
  /**
   * When any value in this list changes, the boundary resets itself. Lets a
   * route or project switch clear a stuck error without a full reload.
   */
  resetKeys?: readonly unknown[];
}

interface ErrorBoundaryState {
  error: SourError | null;
}

function keysChanged(a: readonly unknown[] | undefined, b: readonly unknown[] | undefined): boolean {
  if (a === b) return false;
  if (!a || !b || a.length !== b.length) return true;
  return a.some((value, index) => !Object.is(value, b[index]));
}

/**
 * Catches render-phase errors and shows a recoverable, honest failure panel.
 *
 * Everything displayed here has been through `normalizeError`, so the message
 * and details are already secret-redacted. The raw `cause` is intentionally
 * neither rendered nor copied.
 */
export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: unknown): ErrorBoundaryState {
    return { error: normalizeError(error, { code: 'render_failed', causeCategory: 'runtime' }) };
  }

  componentDidUpdate(prevProps: ErrorBoundaryProps): void {
    if (this.state.error && keysChanged(prevProps.resetKeys, this.props.resetKeys)) {
      this.reset();
    }
  }

  componentDidCatch(error: unknown, info: React.ErrorInfo): void {
    const normalized = normalizeError(error, { code: 'render_failed', causeCategory: 'runtime' });
    // Keep the raw error in the console for local debugging only. It is never
    // persisted, exported, or sent anywhere.
    console.error('[sour.ai] Render error', error);
    try {
      this.props.onError?.(normalized, info.componentStack ?? '');
    } catch (handlerError) {
      console.error('[sour.ai] ErrorBoundary onError handler threw', handlerError);
    }
  }

  reset = (): void => {
    this.setState({ error: null });
  };

  render(): React.ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;
    if (this.props.fallback) return this.props.fallback(error, this.reset);
    return <DefaultErrorPanel error={error} label={this.props.label} onReset={this.reset} />;
  }
}

const DefaultErrorPanel: React.FC<{ error: SourError; label?: string; onReset: () => void }> = ({
  error,
  label,
  onReset,
}) => {
  const [copied, setCopied] = React.useState(false);

  const report = React.useMemo(
    () => JSON.stringify({ ...error.toData(), release: import.meta.env.VITE_RELEASE_SHA ?? 'dev' }, null, 2),
    [error]
  );

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(report);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div
      role="alert"
      className="flex h-full w-full flex-col items-center justify-center gap-4 p-8 text-center text-[#1c1b1a] dark:text-[#f0efe6]"
    >
      <div className="max-w-md space-y-3">
        <h2 className="text-base font-semibold">
          {label ? `${label} stopped responding` : 'Something stopped responding'}
        </h2>
        <p className="text-sm leading-relaxed text-[#706c62] dark:text-[#a09d98]">{error.message}</p>
        {error.userAction && (
          <p className="text-sm leading-relaxed text-[#706c62] dark:text-[#a09d98]">{error.userAction}</p>
        )}
        <p className="font-mono text-[11px] text-[#8c887d] dark:text-[#666]">
          {error.causeCategory} · {error.code}
        </p>
      </div>

      <div className="flex flex-wrap items-center justify-center gap-2">
        <button
          type="button"
          onClick={onReset}
          className="rounded-lg bg-[#1c1b1a] px-3 py-1.5 text-xs font-medium text-white dark:bg-[#f0efe6] dark:text-[#1c1b1a]"
        >
          Try again
        </button>
        <button
          type="button"
          onClick={handleCopy}
          className="rounded-lg border border-[#e2dec0] px-3 py-1.5 text-xs font-medium dark:border-[#383836]"
        >
          {copied ? 'Copied' : 'Copy error details'}
        </button>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="rounded-lg border border-[#e2dec0] px-3 py-1.5 text-xs font-medium dark:border-[#383836]"
        >
          Reload
        </button>
      </div>

      <p className="max-w-md text-[11px] leading-relaxed text-[#8c887d] dark:text-[#666]">
        Your local projects and conversations are unaffected. Copied details are secret-redacted before they leave this
        screen.
      </p>
    </div>
  );
};
