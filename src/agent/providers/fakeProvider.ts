import { cancelled } from '../../contracts/errors';
import type {
  AgentProvider,
  ProviderDescriptor,
  ProviderRequest,
  ProviderRunOptions,
  ProviderStreamEvent,
} from './types';
import { providerId } from './types';

export interface FakeProviderScript {
  readonly events: readonly ProviderStreamEvent[];
  readonly delayMs?: number;
}

export class DeterministicFakeProvider implements AgentProvider {
  readonly descriptor: ProviderDescriptor;
  readonly requests: ProviderRequest[] = [];
  #scripts: FakeProviderScript[];

  constructor(scripts: readonly FakeProviderScript[], id = 'fake') {
    this.#scripts = [...scripts];
    this.descriptor = Object.freeze({
      id: providerId(id),
      label: 'Deterministic fake provider',
      capabilities: Object.freeze({
        streaming: true,
        structuredToolCalls: true,
        cancellation: true,
        usage: true,
        localExecution: true,
        browser: Object.freeze({ state: 'supported' as const, evidence: 'In-memory test provider.' }),
      }),
      models: Object.freeze([{ id: 'fake-model', label: 'Fake model' }]),
    });
  }

  async *stream(
    request: ProviderRequest,
    options: ProviderRunOptions
  ): AsyncIterable<ProviderStreamEvent> {
    this.requests.push(structuredClone(request));
    const script = this.#scripts.shift();
    if (!script) {
      throw new Error('No deterministic provider script remains.');
    }

    for (const event of script.events) {
      if (options.signal.aborted) throw cancelled('Provider stream');
      if (script.delayMs) await abortableDelay(script.delayMs, options.signal);
      if (options.signal.aborted) throw cancelled('Provider stream');
      yield structuredClone(event);
    }
  }
}

function abortableDelay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(cancelled('Provider stream'));
      },
      { once: true }
    );
  });
}

