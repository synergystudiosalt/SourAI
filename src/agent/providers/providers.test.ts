import { describe, expect, it, vi } from 'vitest';

import { containsSecret } from '../../security/redaction';
import { SourError } from '../../contracts/errors';
import { createBrowserFetchProvider } from './browserFetchProvider';
import { DeterministicFakeProvider } from './fakeProvider';
import { ProviderRegistry } from './registry';
import { providerId, type ProviderRequest, type ProviderStreamEvent } from './types';
import { createWebLlmProvider } from './webLlmProvider';

const request: ProviderRequest = {
  model: 'test',
  messages: [{ role: 'user', content: 'hello' }],
};

async function collect(iterable: AsyncIterable<ProviderStreamEvent>): Promise<ProviderStreamEvent[]> {
  const output: ProviderStreamEvent[] = [];
  for await (const event of iterable) output.push(event);
  return output;
}

describe('provider registry and deterministic provider', () => {
  it('registers providers and replays a deterministic script', async () => {
    const provider = new DeterministicFakeProvider([
      {
        events: [
          { type: 'text_delta', text: 'hello' },
          { type: 'completed', finishReason: 'stop' },
        ],
      },
    ]);
    const registry = new ProviderRegistry();
    registry.register(provider);

    expect(registry.get(providerId('fake'))).toBe(provider);
    await expect(
      collect(provider.stream(request, { signal: new AbortController().signal }))
    ).resolves.toEqual([
      { type: 'text_delta', text: 'hello' },
      { type: 'completed', finishReason: 'stop' },
    ]);
  });

  it('cancels deterministic streaming without yielding later events', async () => {
    vi.useFakeTimers();
    try {
      const provider = new DeterministicFakeProvider([
        {
          delayMs: 50,
          events: [{ type: 'text_delta', text: 'must not appear' }],
        },
      ]);
      const controller = new AbortController();
      const result = collect(provider.stream(request, { signal: controller.signal }));
      const rejected = expect(result).rejects.toMatchObject({ code: 'cancelled' });
      controller.abort();
      await vi.runAllTimersAsync();
      await rejected;
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('browser fetch provider', () => {
  it('fails closed when browser CORS support is not proven', async () => {
    const fetch = vi.fn();
    const provider = createBrowserFetchProvider({
      id: 'blocked',
      label: 'Blocked provider',
      endpoint: 'https://provider.example/v1/chat/completions',
      models: [{ id: 'm', label: 'M' }],
      browserSupport: { state: 'unknown', reason: 'Not verified.' },
      fetch,
    });

    await expect(
      collect(
        provider.stream(request, {
          credential: 'not-a-real-secret',
          signal: new AbortController().signal,
        })
      )
    ).rejects.toMatchObject({ code: 'provider_browser_unsupported' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('streams text, structured calls, and usage without emitting credentials', async () => {
    const secret = 'session-credential-unique-value';
    const body = [
      `data: ${JSON.stringify({ choices: [{ delta: { content: 'Hi' } }] })}\n`,
      `data: ${JSON.stringify({
        choices: [
          {
            delta: {
              tool_calls: [
                { index: 0, id: 'call-1', function: { name: 'read_file', arguments: '{"pa' } },
              ],
            },
          },
        ],
      })}\n`,
      `data: ${JSON.stringify({
        choices: [
          {
            delta: {
              tool_calls: [{ index: 0, function: { arguments: 'th":"src/a.ts"}' } }],
            },
          },
        ],
      })}\n`,
      `data: ${JSON.stringify({
        choices: [{}],
        usage: { prompt_tokens: 2, completion_tokens: 3, total_tokens: 5 },
      })}\n`,
      'data: [DONE]\n',
    ].join('');
    const fetch = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => {
      return new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new TextEncoder().encode(body));
            controller.close();
          },
        }),
        { status: 200 }
      );
    });
    const provider = createBrowserFetchProvider({
      id: 'cors-ok',
      label: 'CORS provider',
      endpoint: 'https://provider.example/v1/chat/completions',
      models: [{ id: 'test', label: 'Test' }],
      browserSupport: { state: 'supported', evidence: 'Vendor browser API documentation.' },
      fetch,
    });

    const events = await collect(
      provider.stream(request, {
        credential: secret,
        signal: new AbortController().signal,
      })
    );

    expect(events).toContainEqual({ type: 'text_delta', text: 'Hi' });
    expect(events).toContainEqual({
      type: 'tool_call',
      call: { id: 'call-1', name: 'read_file', arguments: { path: 'src/a.ts' } },
    });
    expect(events).toContainEqual({
      type: 'usage',
      usage: { inputTokens: 2, outputTokens: 3, totalTokens: 5 },
    });
    expect(JSON.stringify(events)).not.toContain(secret);
    expect(containsSecret(`value=${secret}`)).toBe(false);

    const init = fetch.mock.calls[0]?.[1];
    expect(init).toBeDefined();
    if (!init) throw new Error('Expected fetch request options.');
    expect((init.headers as Record<string, string>).authorization).toBe(`Bearer ${secret}`);
    expect(String(init.body)).not.toContain(secret);
  });

  it('normalizes and redacts provider error bodies', async () => {
    const secret = 'provider-error-canary-secret';
    const provider = createBrowserFetchProvider({
      id: 'cors-error',
      label: 'CORS provider',
      endpoint: 'https://provider.example/v1/chat/completions',
      models: [],
      browserSupport: { state: 'supported', evidence: 'Verified.' },
      fetch: async () => new Response(`invalid credential ${secret}`, { status: 401 }),
    });

    let error: unknown;
    try {
      await collect(
        provider.stream(request, {
          credential: secret,
          signal: new AbortController().signal,
        })
      );
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(SourError);
    expect(JSON.stringify(error)).not.toContain(secret);
    expect((error as Error).message).not.toContain(secret);
  });

  it('redacts a credential echoed in provider output before emitting it', async () => {
    const secret = 'provider-output-canary-secret';
    const body = `data: ${JSON.stringify({
      choices: [{ delta: { content: `echo ${secret}` } }],
    })}\n`;
    const provider = createBrowserFetchProvider({
      id: 'cors-echo',
      label: 'CORS provider',
      endpoint: 'https://provider.example/v1/chat/completions',
      models: [{ id: 'test', label: 'Test' }],
      browserSupport: { state: 'supported', evidence: 'Verified.' },
      fetch: async () => new Response(body, { status: 200 }),
    });

    const events = await collect(
      provider.stream(request, {
        credential: secret,
        signal: new AbortController().signal,
      })
    );
    expect(JSON.stringify(events)).not.toContain(secret);
    expect(events).toContainEqual({ type: 'text_delta', text: 'echo [redacted]' });
  });
});

describe('WebLLM provider', () => {
  it('does not load its engine until first supported run', async () => {
    const loadEngine = vi.fn(async () => ({
      async *stream() {
        yield { type: 'completed' as const, finishReason: 'stop' as const };
      },
    }));
    const provider = createWebLlmProvider({
      models: [{ id: 'local', label: 'Local' }],
      probe: () => ({ available: true }),
      loadEngine,
    });
    expect(loadEngine).not.toHaveBeenCalled();
    await collect(provider.stream(request, { signal: new AbortController().signal }));
    expect(loadEngine).toHaveBeenCalledOnce();
  });

  it('reports unsupported capability without loading model code', async () => {
    const loadEngine = vi.fn();
    const provider = createWebLlmProvider({
      models: [],
      probe: () => ({ available: false, reason: 'No WebGPU.' }),
      loadEngine,
    });
    await expect(
      collect(provider.stream(request, { signal: new AbortController().signal }))
    ).rejects.toMatchObject({ code: 'webllm_unsupported' });
    expect(loadEngine).not.toHaveBeenCalled();
  });
});
