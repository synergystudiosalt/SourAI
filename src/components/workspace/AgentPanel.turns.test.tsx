import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { WorkspaceFileNode } from '../../types';
import { AgentPanel } from './AgentPanel';
import { PREVIEW_LOG_MESSAGE } from '../../security/previewIsolation';
import { collectPreviewMessage, getPreviewLogs, resetPreviewLogs } from './previewLogStore';

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
  afterEach(() => resetPreviewLogs());

  it('shows an unresolved-workspace terminal result with an example path', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(
        streamedTurn('@@readfile: missing.ts qualification="inspect file"')
      )
      .mockResolvedValueOnce(jsonTurn(''));

    renderPanel();
    sendPrompt();

    expect(
      await screen.findByText(/workspace requests could not be resolved/i)
    ).toHaveTextContent('missing.ts');
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
  });

  it('keeps the genuinely silent terminal result when no request was issued', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(streamedTurn(''));

    renderPanel();
    sendPrompt();

    expect(
      await screen.findByText(
        'The model returned no final answer after completing its workspace checks.'
      )
    ).toBeInTheDocument();
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
  });

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

  it('reports stall when duplicate tool requests persist past a recovery nudge', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(streamedTurn('@@readfile: src/a.ts'))
      .mockResolvedValueOnce(jsonTurn('@@readfile: src/a.ts'))
      .mockResolvedValueOnce(jsonTurn('@@readfile: src/a.ts'));

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

    expect(
      await screen.findByText(/stopped making progress/i)
    ).toBeInTheDocument();
    expect(screen.queryByText(/returned no final answer/i)).not.toBeInTheDocument();
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(3));
  });

  it('labels and sends a runtime-error follow-up collected with the preview pane closed', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(
        streamedTurn('Created the fix.\n\n```ts path="src/a.ts"\nexport const value = 2;\n```')
      )
      .mockResolvedValueOnce(streamedTurn('The runtime error is fixed.'));

    const previewWindow = {} as Window;
    const onApplyOps = vi.fn().mockResolvedValue(true);
    const onCollectPreviewLogsAfterApply = vi.fn().mockImplementation(async () => {
      collectPreviewMessage(
        {
          source: previewWindow,
          data: {
            type: PREVIEW_LOG_MESSAGE,
            level: 'error',
            text: 'THREE.BufferGeometry.computeBoundingSphere(): Computed radius is NaN',
          },
        },
        previewWindow
      );
      return getPreviewLogs();
    });

    render(
      <AgentPanel
        isDarkMode={false}
        isCollapsed={false}
        onToggleCollapse={vi.fn()}
        projectId="runtime-follow-up-test"
        projectName="Runtime follow-up test"
        files={[
          {
            id: 'src/a.ts',
            name: 'a.ts',
            path: 'src/a.ts',
            type: 'file',
            content: 'export const value = 1;',
          },
        ]}
        activeFile={null}
        onApplyOps={onApplyOps}
        onCollectPreviewLogsAfterApply={onCollectPreviewLogsAfterApply}
        onOpenFile={vi.fn()}
      />
    );
    sendPrompt();

    fireEvent.click(await screen.findByRole('button', { name: 'Apply changes' }));

    await waitFor(() => expect(onApplyOps).toHaveBeenCalledOnce());
    expect(onCollectPreviewLogsAfterApply).toHaveBeenCalledOnce();
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    expect(
      screen.getByText((content) =>
        content.includes('Automatic runtime repair · attempt 1/2')
      )
    ).toBeInTheDocument();

    const payload = JSON.parse(String(vi.mocked(fetch).mock.calls[1][1]?.body));
    expect(payload.messages.at(-1)?.content).toContain('Computed radius is NaN');
  });
});
