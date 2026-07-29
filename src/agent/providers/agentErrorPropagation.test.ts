import { afterEach, describe, expect, it, vi } from 'vitest';

import { onRequest } from '@/functions/api/agent';

const ENV = {
  MISTRAL_API_KEYS: 'mistral-secret-value',
  GEMINI_API_KEYS: 'gemini-secret-value',
  GROQ_API_KEYS: 'groq-secret-value',
};

const SECRETS = Object.values(ENV);

function echoedSecret(url: string, init: RequestInit): string {
  if (url.includes('googleapis.com')) return 'gemini-secret-value';
  const authorization = (init.headers as Record<string, string>).Authorization || '';
  return authorization.replace(/^Bearer /, '');
}

function mockProviderFailures(): void {
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
    const secret = echoedSecret(url, init);
    return new Response(JSON.stringify({
      error: {
        message: `Request too large for tokens per minute (TPM): Limit 8000, Requested 9599; key=${secret}`,
      },
    }), { status: 413 });
  }));
}

async function callAgent(stream: boolean): Promise<Response> {
  const request = new Request('https://example.test/api/agent', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messages: [{ role: 'user', content: 'write code' }],
      model: 'sour-omni-flash',
      stream,
    }),
  });
  return onRequest({ request, env: ENV } as any);
}

afterEach(() => vi.unstubAllGlobals());

describe('/api/agent provider error propagation', () => {
  it('returns structured provider diagnostics in the JSON error response', async () => {
    mockProviderFailures();
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const response = await callAgent(false);
    const body = await response.json() as any;

    expect(response.status).toBe(502);
    expect(body.error).toMatchObject({
      code: 'agent_provider_failed',
      provider: 'groq',
      model: 'llama-3.3-70b-versatile',
      status: 413,
      providerMessage: expect.stringContaining('Limit 8000, Requested 9599'),
      keyIndex: 1,
      keyCount: 1,
      keysTried: 1,
      keyBudget: 1,
      attempts: 1,
    });
    expect(body.error.failures.map((failure: any) => failure.provider)).toEqual([
      'mistral',
      'gemini',
      'groq',
    ]);
    const serialized = JSON.stringify(body);
    for (const secret of SECRETS) expect(serialized).not.toContain(secret);
  });

  it('emits the same structured diagnostics in the SSE error event', async () => {
    mockProviderFailures();
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const response = await callAgent(true);
    const text = await response.text();
    const payload = text
      .split('\n')
      .find((line) => line.startsWith('data: '));
    const event = JSON.parse((payload || '').slice(6));

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toContain('text/event-stream');
    expect(event.error).toMatchObject({
      code: 'agent_provider_failed',
      provider: 'groq',
      status: 413,
      keysTried: 1,
      attempts: 1,
    });
    expect(event.error.failures).toHaveLength(3);
    for (const secret of SECRETS) expect(text).not.toContain(secret);
  });
});
