import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { Root } from './Root';
import { blockedRequests } from './test/setup';

/**
 * Critical-flow smoke tests for the application as it exists today.
 *
 * These are the baseline guard for the whole migration: every phase must keep
 * the home screen usable, the workspace openable, and — crucially — must not
 * introduce a network request where there was none. The `blockedRequests`
 * assertions are the unit-level counterpart to the end-to-end network trace
 * that proves the finished app talks to no SourAI backend.
 */

describe('application shell', () => {
  it('renders the home screen without touching the network', async () => {
    render(<Root />);

    expect(await screen.findByPlaceholderText('How can I help you today?')).toBeInTheDocument();
    expect(screen.getByText(/sour\.ai can make mistakes/i)).toBeInTheDocument();
    expect(blockedRequests).toEqual([]);
  });

  it('mounts inside an error boundary contract — a normal render produces no alert', () => {
    render(<Root />);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('uses the production root error boundary when its child throws', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const Broken = () => {
      throw new Error('root child failed');
    };
    try {
      render(
        <Root>
          <Broken />
        </Root>
      );
      expect(screen.getByRole('alert')).toHaveTextContent('root child failed');
      expect(screen.getByRole('alert')).toHaveTextContent('sour.ai stopped responding');
    } finally {
      consoleError.mockRestore();
    }
  });

  it('opens the code workspace and shows its entry points', async () => {
    const user = userEvent.setup();
    render(<Root />);

    await user.click(screen.getByTitle('sour.ai IDE'));

    expect(await screen.findByText('Welcome back to sour.ai')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /New File/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Open Project/ })).toBeInTheDocument();
    expect(blockedRequests).toEqual([]);
  });

  it('disables local folder access honestly when the browser cannot do it', async () => {
    // jsdom has no File System Access API, which is the same situation as
    // Firefox and Safari. The control must be disabled and explain itself
    // rather than failing after the user commits to the action.
    const user = userEvent.setup();
    render(<Root />);
    await user.click(screen.getByTitle('sour.ai IDE'));

    const openProject = await screen.findByRole('button', { name: /Open Project/ });
    expect(openProject).toBeDisabled();
    expect(openProject).toHaveAttribute(
      'title',
      'Opening real folders needs a Chromium-based browser (Chrome or Edge).'
    );
  });

  it('creates a virtual project locally, with no request and no server round trip', async () => {
    const user = userEvent.setup();
    render(<Root />);
    await user.click(screen.getByTitle('sour.ai IDE'));
    await user.click(await screen.findByRole('button', { name: /New File/ }));

    // The file exists in the explorer and is open as a tab.
    const explorer = await screen.findAllByText('untitled.txt');
    expect(explorer.length).toBeGreaterThan(0);
    expect(blockedRequests).toEqual([]);
  });

  it('persists nothing about a conversation to a server — chat state is local React state', async () => {
    const user = userEvent.setup();
    render(<Root />);

    const input = await screen.findByPlaceholderText('How can I help you today?');
    await user.type(input, 'hello');

    // Typing alone must never reach the network (no autocomplete, no telemetry,
    // no edit-prediction request without explicit consent).
    expect(blockedRequests).toEqual([]);
  });

  it('runs chat locally without calling a SourAI API', async () => {
    const user = userEvent.setup();
    render(<Root />);
    await user.type(await screen.findByPlaceholderText('How can I help you today?'), 'hello');
    await user.click(screen.getByTitle('Send Prompt'));

    expect(await screen.findByText('hello', { exact: true })).toBeInTheDocument();
    expect(blockedRequests).toEqual([]);
  });
});

describe('conversation history', () => {
  it('lists existing conversations in the sidebar drawer', async () => {
    const user = userEvent.setup();
    render(<Root />);

    await user.click(screen.getByTitle('Chat Sessions'));
    const search = await screen.findByPlaceholderText('Search chats...');
    expect(search).toBeInTheDocument();

    const drawer = search.closest('div')?.parentElement ?? document.body;
    expect(within(drawer.parentElement ?? document.body).getByText(/Quantum Computing Overview/)).toBeInTheDocument();
  });
});
