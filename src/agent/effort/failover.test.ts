import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  generateWithGroq,
  isRetryableError,
  parseRetryAfter,
  ProviderHttpError,
  streamText,
  withContinuation,
  withGeminiContinuation,
} from '@/functions/shared/ai';

const KEYS = ['key-a', 'key-b'];

/** Minimal SSE body in the OpenAI-compatible shape. */
function sseStream(chunks: string[]): Response {
  const body = new ReadableStream({
    start(controller) {
      const encode = (s: string) => new TextEncoder().encode(s);
      for (const c of chunks) controller.enqueue(encode(c));
      controller.close();
    },
  });
  return new Response(body, { status: 200 });
}

const token = (t: string) =>
  `data: ${JSON.stringify({ choices: [{ delta: { content: t } }] })}\n\n`;

function rateLimited(retryAfter?: string): Response {
  return new Response(JSON.stringify({ error: { message: 'rate limit' } }), {
    status: 429,
    headers: retryAfter ? { 'retry-after': retryAfter } : {},
  });
}

async function collect(gen: AsyncGenerator<string>): Promise<string> {
  let out = '';
  for await (const t of gen) out += t;
  return out;
}

afterEach(() => vi.unstubAllGlobals());

describe('parseRetryAfter', () => {
  it('reads delay-seconds', () => {
    expect(parseRetryAfter('2')).toBe(2000);
    expect(parseRetryAfter('0')).toBe(0);
  });

  it('ignores absent or unparseable values', () => {
    expect(parseRetryAfter(null)).toBeUndefined();
    expect(parseRetryAfter('soon')).toBeUndefined();
  });
});

describe('isRetryableError', () => {
  it('retries rate limits, upstream faults, and rejected keys', () => {
    for (const status of [408, 429, 500, 502, 503, 504, 401, 403]) {
      expect(isRetryableError(new ProviderHttpError(status, ''))).toBe(true);
    }
  });

  it('does not burn keys on a malformed request', () => {
    for (const status of [400, 404, 422]) {
      expect(isRetryableError(new ProviderHttpError(status, ''))).toBe(false);
    }
  });

  it('retries network faults, which carry no status', () => {
    expect(isRetryableError(new TypeError('network down'))).toBe(true);
  });
});

describe('withContinuation', () => {
  it('keeps the original turns and appends the partial output', () => {
    const base = [{ role: 'user', content: 'write a poem' }];
    const next = withContinuation(base, 'Roses are red,');

    expect(next).toHaveLength(2);
    expect(next[0]).toEqual(base[0]);
    expect(next[1].role).toBe('user');
    expect(next[1].content).toContain('Roses are red,');
    expect(next[1].content).toMatch(/Do not repeat/i);
  });

  it('produces the Gemini parts shape', () => {
    const next = withGeminiContinuation([{ role: 'user', parts: [{ text: 'hi' }] }], 'Half a');
    expect(next).toHaveLength(2);
    expect(next[1].parts[0].text).toContain('Half a');
  });
});

describe('key failover', () => {
  it('moves to the next key when the first is rate limited', async () => {
    const seen: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: any) => {
      seen.push(init.headers.Authorization);
      if (seen.length === 1) return rateLimited();
      return new Response(JSON.stringify({ choices: [{ message: { content: 'done' } }] }), { status: 200 });
    }));

    await expect(generateWithGroq(KEYS, [{ role: 'user', content: 'hi' }], 'sys', 'm')).resolves.toBe('done');
    expect(seen).toHaveLength(2);
    expect(seen[0]).not.toBe(seen[1]);
  });

  it('gives up immediately on a malformed request instead of burning every key', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ error: 'bad model' }), { status: 404 })
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      generateWithGroq(KEYS, [{ role: 'user', content: 'hi' }], 'sys', 'm')
    ).rejects.toThrow(/404/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('mid-stream rate limit', () => {
  it('continues instead of replaying text the client already has', async () => {
    const bodies: any[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: any) => {
      const body = JSON.parse(init.body);
      bodies.push(body);
      if (bodies.length === 1) {
        // Two tokens, then the provider reports a limit mid-stream.
        return sseStream([
          token('Hello '),
          token('world'),
          `data: ${JSON.stringify({ error: { status: 429, message: 'tokens per minute' } })}\n\n`,
        ]);
      }
      return sseStream([token(' and goodbye'), 'data: [DONE]\n\n']);
    }));

    const out = await collect(
      streamText({
        geminiKeys: [],
        groqKeys: KEYS,
        contents: [],
        plainMessages: [{ role: 'user', content: 'greet' }],
        systemInstruction: 'sys',
        route: { provider: 'groq', model: 'm' },
      })
    );

    // The already-delivered prefix appears exactly once.
    expect(out).toBe('Hello world and goodbye');
    expect(out.match(/Hello/g)).toHaveLength(1);

    // The retry asked the model to continue, carrying the partial text.
    const retryMessages = bodies[1].messages;
    const last = retryMessages[retryMessages.length - 1];
    expect(last.content).toContain('Hello world');
    expect(last.content).toMatch(/Do not repeat/i);
  });

  it('retries from scratch when the limit lands before any output', async () => {
    const bodies: any[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: any) => {
      bodies.push(JSON.parse(init.body));
      if (bodies.length === 1) return rateLimited('0');
      return sseStream([token('full answer'), 'data: [DONE]\n\n']);
    }));

    const out = await collect(
      streamText({
        geminiKeys: [],
        groqKeys: KEYS,
        contents: [],
        plainMessages: [{ role: 'user', content: 'greet' }],
        systemInstruction: 'sys',
        route: { provider: 'groq', model: 'm' },
      })
    );

    expect(out).toBe('full answer');
    // No continuation turn was added, since nothing had been emitted.
    expect(bodies[1].messages).toHaveLength(2); // system + user
  });
});
