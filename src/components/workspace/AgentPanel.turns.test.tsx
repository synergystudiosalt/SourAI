import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { WorkspaceFileNode } from '../../types';
import { AgentPanel } from './AgentPanel';

function streamedTurn(text: string): Response {
  const body = new ReadableStream({
    start(controller) {
      controller.enqueue(
        new TextEncoder().encode(
          `data: ${JSON.stringify({ done: true, text })}\n\n`
        )
      );
      controller.close();
    },
  });
  return new Response(body, {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream' },
  });
}

function jsonTurn(text: string): Response {
  return new Response(JSON.stringify({ text }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

function renderPanel(files: WorkspaceFileNode[] = []): void {
  render(
    <AgentPanel
      isDarkMode={false}
      isCollapsed={false}
      onToggleCollapse={vi.fn()}
      projectId="turn-parity-test"
      projectName="Turn parity test"
      files={files}
      activeFile={null}
      onApplyOps={vi.fn().mockResolvedValue(true)}
      onOpenFile={vi.fn()}
    />
  );
}

function sendPrompt(): void {
  fireEvent.change(
    screen.getByPlaceholderText('Message Agent, @ for context, / for commands'),
    { target: { value: 'inspect the project' } }
  );
  fireEvent.click(screen.getByTitle('Send'));
}

const PROCESSING_ERROR = /invalid regular expression|unterminated character class/i;

describe('AgentPanel completed-turn parity', () => {
  it('surfaces a first-turn SSE processing failure instead of discarding the turn', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(streamedTurn('@@glob: ['));

    renderPanel();
    sendPrompt();

    expect(await screen.findByText(PROCESSING_ERROR)).toBeInTheDocument();
    expect(screen.queryByText(/returned no final answer/i)).not.toBeInTheDocument();
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
  });

  it('surfaces the same processing failure from a JSON tool-result turn', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(streamedTurn('@@readfile: src/a.ts'))
      .mockResolvedValueOnce(jsonTurn('@@glob: ['));

    renderPanel([
      {
        id: 'src/a.ts',
        name: 'a.ts',
        path: 'src/a.ts',
        type: 'file',
        content: 'export const value = 1;',
      },
    ]);
    sendPrompt();

    expect(await screen.findByText(PROCESSING_ERROR)).toBeInTheDocument();
    expect(screen.queryByText(/returned no final answer/i)).not.toBeInTheDocument();
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
  });
});
