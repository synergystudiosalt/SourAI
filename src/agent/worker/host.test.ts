import { describe, expect, it, vi } from 'vitest';

import { AGENT_COMMAND_VERSION } from '../../contracts/commands';
import { ContextScope } from '../context/scope';
import { buildWorkspaceSnapshot } from '../context/snapshot';
import { DeterministicFakeProvider } from '../providers/fakeProvider';
import { MemoryEventSink } from '../replay';
import { createAgentComposition } from '../composition';
import { startAgentWorkerHost } from './host';
import type { AgentWorkerResponse, WorkerMessagePort } from './protocol';

const digest = async (bytes: Uint8Array) =>
  bytes.byteLength.toString(16).padStart(64, '0').slice(0, 64);

class FakePort implements WorkerMessagePort {
  readonly sent: AgentWorkerResponse[] = [];
  readonly #listeners = new Set<(event: MessageEvent<unknown>) => void>();

  postMessage(message: AgentWorkerResponse): void {
    this.sent.push(message);
  }

  addEventListener(_type: 'message', listener: (event: MessageEvent<unknown>) => void): void {
    this.#listeners.add(listener);
  }

  removeEventListener(_type: 'message', listener: (event: MessageEvent<unknown>) => void): void {
    this.#listeners.delete(listener);
  }

  send(data: unknown): void {
    for (const listener of [...this.#listeners]) listener({ data } as MessageEvent<unknown>);
  }

  of<T extends AgentWorkerResponse['kind']>(kind: T) {
    return this.sent.filter((message) => message.kind === kind) as Extract<
      AgentWorkerResponse,
      { kind: T }
    >[];
  }
}

async function initPayload(overrides: Record<string, unknown> = {}) {
  return {
    projectId: 'project-1',
    providerId: 'demo-echo',
    modelId: 'deterministic-v1',
    snapshot: await buildWorkspaceSnapshot(
      'project-1',
      1,
      [
        { path: 'src/app.ts', content: 'export const a = 1;', isLoaded: true },
        { path: '.env', content: 'API_KEY=secret-canary', isLoaded: true },
      ],
      ContextScope.projectDefault(),
      undefined,
      digest
    ),
    scope: ContextScope.projectDefault().toConfig(),
    contextPaths: ['src/app.ts'],
    ...overrides,
  };
}

const startCommand = (message = 'hello') => ({
  kind: 'command',
  command: {
    version: AGENT_COMMAND_VERSION,
    type: 'run.start',
    requestId: crypto.randomUUID(),
    createdAt: Date.now(),
    projectId: 'project-1',
    threadId: 'thread-1',
    input: { message, mode: 'ask' },
  },
});

describe('startAgentWorkerHost', () => {
  it('rejects commands until it has been configured', async () => {
    const port = new FakePort();
    startAgentWorkerHost(port, { sink: new MemoryEventSink() });

    port.send(startCommand());

    expect(port.of('command.rejected')[0]?.error.code).toBe('worker_not_initialized');
    expect(port.of('worker.ready')).toHaveLength(0);
  });

  it('reports capabilities once configured, and runs a command afterwards', async () => {
    const port = new FakePort();
    const sink = new MemoryEventSink();
    startAgentWorkerHost(port, { sink });

    port.send({ kind: 'init', init: await initPayload() });

    const ready = port.of('worker.ready')[0];
    expect(ready?.capabilities.toolNames).toContain('read_file');
    expect(ready?.capabilities.mutation.available).toBe(false);
    expect(ready?.capabilities.provider.detail).toMatch(/Demo provider/);

    port.send(startCommand());
    await vi.waitFor(() => expect(port.of('command.accepted')).toHaveLength(1));
    await vi.waitFor(() =>
      expect(port.of('event').some((message) => message.event.type === 'run.completed')).toBe(true)
    );
  });

  it('degrades with a stated reason when the init payload is unusable', async () => {
    const port = new FakePort();
    startAgentWorkerHost(port, { sink: new MemoryEventSink() });

    port.send({ kind: 'init', init: await initPayload({ snapshot: { version: 99 } }) });

    expect(port.of('worker.ready')).toHaveLength(0);
    expect(port.of('worker.degraded')[0]?.error.code).toBe('worker_init_failed');
  });

  it('names an unknown provider instead of falling back to a stand-in', async () => {
    const port = new FakePort();
    startAgentWorkerHost(port, { sink: new MemoryEventSink() });

    port.send({ kind: 'init', init: await initPayload({ providerId: 'not-real' }) });

    expect(port.of('worker.degraded')[0]?.error.message).toMatch(/not part of this build/);
  });

  it('refuses to reconfigure while a run is active', async () => {
    const port = new FakePort();
    const provider = new DeterministicFakeProvider([
      { events: [{ type: 'text_delta', text: 'hi' }], delayMs: 50 },
    ]);
    startAgentWorkerHost(port, {
      sink: new MemoryEventSink(),
      compose: (input) => createAgentComposition({ ...input, provider, modelId: 'fake-model' }),
    });

    port.send({ kind: 'init', init: await initPayload() });
    port.send(startCommand());
    await vi.waitFor(() =>
      expect(port.of('event').some((message) => message.event.type === 'run.created')).toBe(true)
    );

    port.send({ kind: 'init', init: await initPayload() });
    expect(port.of('worker.degraded')[0]?.error.code).toBe('worker_busy');
  });

  it('keeps a per-request credential out of the events it emits', async () => {
    const port = new FakePort();
    const sink = new MemoryEventSink();
    startAgentWorkerHost(port, { sink });

    port.send({ kind: 'init', init: await initPayload() });
    port.send({ ...startCommand(), credential: 'sk-canary-worker' });

    await vi.waitFor(() =>
      expect(port.of('event').some((message) => message.event.type === 'run.completed')).toBe(true)
    );
    expect(JSON.stringify(port.sent)).not.toContain('sk-canary-worker');
    expect(JSON.stringify(port.sent)).not.toContain('secret-canary');
  });
});
