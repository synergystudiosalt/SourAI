import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { AgentPanel } from './AgentPanel';

const fence = String.fromCharCode(96).repeat(3);

function streamedTurn(text: string): Response {
  const body = new ReadableStream({
    start(controller) {
      controller.enqueue(
        new TextEncoder().encode(
          'data: ' + JSON.stringify({ done: true, text }) + '\n\n'
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

function renderPanel(projectId: string): void {
  render(
    <AgentPanel
      isDarkMode={false}
      isCollapsed={false}
      onToggleCollapse={vi.fn()}
      projectId={projectId}
      projectName="Raw response test"
      files={[]}
      activeFile={null}
      onApplyOps={vi.fn().mockResolvedValue(true)}
      onOpenFile={vi.fn()}
    />
  );
}

function send(text: string): void {
  fireEvent.change(
    screen.getByPlaceholderText('Message Agent, @ for context, / for commands'),
    { target: { value: text } }
  );
  fireEvent.click(screen.getByTitle('Send'));
}

describe('AgentPanel raw model response diagnostics', () => {
  it('attaches raw output only to an empty terminal result and omits it from later provider history', async () => {
    const raw = [
      '@@readfile: missing/a.ts',
      '@@readfile: missing/b.ts',
      '@@readfile: missing/c.ts',
    ].join('\n');
    const payloads: Array<{ messages: Array<{ role: string; content: string }> }> = [];
    let request = 0;
    vi.mocked(fetch).mockImplementation(async (_input, init) => {
      payloads.push(JSON.parse(String(init?.body)));
      request += 1;
      if (request === 1) return streamedTurn(raw);
      if (request === 2 || request === 3) return jsonTurn(raw);
      return streamedTurn('A successful follow-up answer.');
    });
    renderPanel('raw-terminal-history');

    send('inspect the missing files');

    expect(
      await screen.findByText(/3 of 3 workspace requests could not be resolved/i)
    ).toBeInTheDocument();
    const rawToggle = screen.getByRole('button', {
      name: 'Raw model response (for diagnosis)',
    });
    expect(screen.queryByText('@@readfile: missing/a.ts')).not.toBeInTheDocument();
    fireEvent.click(rawToggle);
    expect(screen.getByText(/@@readfile: missing\/a\.ts/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Apply changes' })).not.toBeInTheDocument();

    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(3));
    send('continue without those files');

    expect(await screen.findByText('A successful follow-up answer.')).toBeInTheDocument();
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(4));
    const followUpHistory = JSON.stringify(payloads[3].messages);
    expect(followUpHistory).not.toContain('@@readfile: missing/a.ts');
    expect(followUpHistory).not.toContain('@@readfile: missing/b.ts');
    expect(followUpHistory).not.toContain('@@readfile: missing/c.ts');
  });

  it('leaves a successful answer exactly as before, without raw diagnostics', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(streamedTurn('Successful answer.'));
    renderPanel('raw-success');

    send('answer normally');

    expect(await screen.findByText('Successful answer.')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Raw model response (for diagnosis)' })
    ).not.toBeInTheDocument();
  });

  it('does not attach raw diagnostics when the model produced a file operation', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      streamedTurn([
        fence + 'ts path="src/new.ts"',
        'export const created = true;',
        fence,
      ].join('\n'))
    );
    renderPanel('raw-file-operation');

    send('create the file');

    expect(await screen.findByRole('button', { name: 'Apply changes' })).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Raw model response (for diagnosis)' })
    ).not.toBeInTheDocument();
  });
});
