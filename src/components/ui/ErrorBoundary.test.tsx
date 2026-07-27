import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SourError } from '../../contracts/errors';
import { SECRET_CANARIES, expectNoSecrets } from '../../test/assertions';
import { ErrorBoundary } from './ErrorBoundary';

/** Throws on first render, then renders normally once `shouldThrow` flips. */
const Boom: React.FC<{ error: unknown }> = ({ error }) => {
  throw error;
};

let consoleError: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  // React logs caught render errors; silence it so the run output stays useful.
  consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  consoleError.mockRestore();
});

describe('ErrorBoundary', () => {
  it('renders children when nothing throws', () => {
    render(
      <ErrorBoundary>
        <p>all good</p>
      </ErrorBoundary>
    );
    expect(screen.getByText('all good')).toBeInTheDocument();
  });

  it('shows a recoverable panel with the normalized code and category', () => {
    render(
      <ErrorBoundary label="Agent panel">
        <Boom error={new Error('renderer exploded')} />
      </ErrorBoundary>
    );

    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('Agent panel stopped responding');
    expect(alert).toHaveTextContent('renderer exploded');
    expect(alert).toHaveTextContent('runtime · render_failed');
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });

  it('preserves a SourError thrown from a child instead of re-wrapping it', () => {
    render(
      <ErrorBoundary>
        <Boom
          error={
            new SourError({
              code: 'storage_quota_exceeded',
              message: 'There is no space left for this project.',
              causeCategory: 'storage',
              userAction: 'Free up space in Settings → Storage.',
            })
          }
        />
      </ErrorBoundary>
    );

    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('storage · storage_quota_exceeded');
    expect(alert).toHaveTextContent('Free up space in Settings → Storage.');
  });

  it('never displays a credential that reached it through an error message', () => {
    render(
      <ErrorBoundary>
        <Boom error={new Error(`provider rejected ${SECRET_CANARIES.openai}`)} />
      </ErrorBoundary>
    );

    const alert = screen.getByRole('alert');
    expect(alert.textContent ?? '').not.toContain(SECRET_CANARIES.openai);
    expectNoSecrets(alert.textContent, 'ErrorBoundary panel');
  });

  it('copies redacted details rather than the raw error', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });

    render(
      <ErrorBoundary>
        <Boom error={new Error(`failed using key ${SECRET_CANARIES.google}`)} />
      </ErrorBoundary>
    );

    await userEvent.click(screen.getByRole('button', { name: 'Copy error details' }));

    expect(writeText).toHaveBeenCalledTimes(1);
    expectNoSecrets(writeText.mock.calls[0][0], 'clipboard payload');
  });

  it('reports the error to onError without letting a throwing handler escape', () => {
    const onError = vi.fn(() => {
      throw new Error('handler is broken');
    });

    expect(() =>
      render(
        <ErrorBoundary onError={onError}>
          <Boom error={new Error('inner')} />
        </ErrorBoundary>
      )
    ).not.toThrow();

    expect(onError).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  it('clears the error when a reset key changes', () => {
    const { rerender } = render(
      <ErrorBoundary resetKeys={['project-a']}>
        <Boom error={new Error('inner')} />
      </ErrorBoundary>
    );
    expect(screen.getByRole('alert')).toBeInTheDocument();

    rerender(
      <ErrorBoundary resetKeys={['project-b']}>
        <p>recovered</p>
      </ErrorBoundary>
    );
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByText('recovered')).toBeInTheDocument();
  });

  it('supports a custom fallback', () => {
    render(
      <ErrorBoundary fallback={(error) => <p>custom: {error.code}</p>}>
        <Boom error={new Error('inner')} />
      </ErrorBoundary>
    );
    expect(screen.getByText('custom: render_failed')).toBeInTheDocument();
  });
});
