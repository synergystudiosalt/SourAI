import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { AgentWorkspace } from './AgentWorkspace';
import type { WorkspaceFileNode } from '../../types';

const files: WorkspaceFileNode[] = [
  {
    id: 'src/app.ts',
    name: 'app.ts',
    path: 'src/app.ts',
    type: 'file',
    content: 'export const value = 1;',
    isLoaded: true,
  },
  {
    id: '.env',
    name: '.env',
    path: '.env',
    type: 'file',
    content: 'API_KEY=super-secret-value',
    isLoaded: true,
  },
];

function renderPanel(onRun = vi.fn().mockResolvedValue(undefined)) {
  render(
    <AgentWorkspace
      projectId="project-1"
      projectName="Project"
      files={files}
      activeFile={{ path: 'src/app.ts', content: 'export const value = 1;' }}
      isDarkMode={false}
      onRun={onRun}
    />
  );
  return onRun;
}

const selectDemoProvider = () => {
  fireEvent.change(screen.getByLabelText('Model provider'), { target: { value: 'demo-echo' } });
};

describe('AgentWorkspace', () => {
  it('requires an explicit provider choice before a run can start', async () => {
    const onRun = renderPanel();

    expect(screen.getByPlaceholderText('Choose a provider to begin')).toBeDisabled();
    expect(screen.getByTitle('Run agent')).toBeDisabled();

    selectDemoProvider();

    await waitFor(() => expect(screen.getByTitle('Run agent')).toBeEnabled());
    expect(onRun).not.toHaveBeenCalled();
  });

  it('submits a structured run with the chosen provider, model, and profile', async () => {
    const onRun = renderPanel();
    selectDemoProvider();

    fireEvent.click(screen.getByRole('button', { name: 'plan' }));
    // The workspace snapshot settles asynchronously before context is known.
    await screen.findByText(/1 file\(s\)/);
    await waitFor(() => screen.getByPlaceholderText('Message agent in plan mode'));
    fireEvent.change(screen.getByPlaceholderText('Message agent in plan mode'), {
      target: { value: 'Inspect this file' },
    });
    fireEvent.click(screen.getByTitle('Run agent'));

    await waitFor(() =>
      expect(onRun).toHaveBeenCalledWith({
        message: 'Inspect this file',
        mode: 'plan',
        providerId: 'demo-echo',
        modelId: 'deterministic-v1',
        contextPaths: ['src/app.ts'],
      })
    );
  });

  it('never renders workspace file contents in the panel', async () => {
    renderPanel();
    selectDemoProvider();
    await waitFor(() => expect(screen.getByTitle('Run agent')).toBeEnabled());
    expect(document.body.textContent).not.toContain('export const value = 1;');
    expect(document.body.textContent).not.toContain('super-secret-value');
  });

  it('discloses exactly which files leave the browser, excluding credential paths', async () => {
    renderPanel();
    selectDemoProvider();

    const toggle = await screen.findByText(/file\(s\).*this browser/);
    fireEvent.click(toggle);

    expect(await screen.findByText('src/app.ts')).toBeInTheDocument();
    expect(screen.queryByText('.env')).not.toBeInTheDocument();
    expect(screen.getByText(/credential-shaped paths/)).toBeInTheDocument();
  });

  it('asks for a session credential before a BYOK provider can run', async () => {
    renderPanel();
    fireEvent.change(screen.getByLabelText('Model provider'), { target: { value: 'openrouter' } });

    await waitFor(() =>
      expect(screen.getByPlaceholderText('Add an API key for this session')).toBeDisabled()
    );
    expect(screen.getByTitle('Run agent')).toBeDisabled();
    expect(screen.getByText(/Sends data to openrouter.ai/)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/API key/), { target: { value: 'sk-test-value' } });

    await waitFor(() => expect(screen.getByTitle('Run agent')).toBeEnabled());
    expect(document.body.innerHTML).not.toContain('sk-test-value');
  });

  it('requires host approval before a custom endpoint becomes runnable', async () => {
    renderPanel();
    fireEvent.change(screen.getByLabelText('Model provider'), {
      target: { value: 'openai-compatible' },
    });

    fireEvent.change(screen.getByLabelText('Custom endpoint URL'), {
      target: { value: 'http://insecure.example/v1/chat/completions' },
    });
    fireEvent.change(screen.getByLabelText('Custom model id'), { target: { value: 'some-model' } });
    fireEvent.click(screen.getByRole('button', { name: 'Approve this destination' }));

    expect(await screen.findByText('Custom endpoints must use https.')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Custom endpoint URL'), {
      target: { value: 'https://models.example/v1/chat/completions' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Approve this destination' }));

    expect(await screen.findByText(/Approved destination: models.example/)).toBeInTheDocument();
  });
});
