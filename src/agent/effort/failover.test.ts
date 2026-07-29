import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  AgentProviderError,
  buildOpenAICompatibleBody,
  continueChatMessages,
  continueGeminiContents,
  createKeyPicker,
  generateText,
  generateWithGroq,
  isRetryableError,
  MODEL_ROUTES,
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

describe('prefill continuation', () => {
  const BASE = [{ role: 'user', content: 'write a poem' }];

  it('continues a trailing assistant turn on OpenAI-compatible routes', () => {
    const next = continueChatMessages(BASE, 'Roses are red,', 'openai');
    expect(next[next.length - 1]).toEqual({ role: 'assistant', content: 'Roses are red,' });
  });

  it('flags the turn as a prefix for Mistral, which otherwise replies to it', () => {
    const next = continueChatMessages(BASE, 'Roses are red,', 'mistral');
    expect(next[next.length - 1]).toEqual({
      role: 'assistant',
      content: 'Roses are red,',
      prefix: true,
    });
  });

  it('carries the prefix flag into the request body', () => {
    const body = buildOpenAICompatibleBody(
      'mistral-small-latest',
      continueChatMessages(BASE, 'half a thought', 'mistral'),
      'sys',
      undefined,
      null
    );
    const last = (body.messages as any[])[(body.messages as any[]).length - 1];
    expect(last).toEqual({ role: 'assistant', content: 'half a thought', prefix: true });
  });

  it('falls back to a written instruction where prefill is unsupported', () => {
    const next = continueChatMessages(BASE, 'Roses are red,', null);
    const last = next[next.length - 1];
    expect(last.role).toBe('user');
    expect(last.content).toMatch(/Do not repeat/i);
    expect(last.prefix).toBeUndefined();
  });

  it('resumes Gemini by instruction, since neither route continues a model turn', () => {
    const contents = [{ role: 'user', parts: [{ text: 'hi' }] }];
    const next = continueGeminiContents(contents, 'Half a', null);
    expect(next[next.length - 1].role).toBe('user');
    expect(next[next.length - 1].parts[0].text).toMatch(/Do not repeat/i);
  });
});

describe('route prefill capability', () => {
  it('matches the modes each provider actually accepts', () => {
    expect(MODEL_ROUTES['sour-omni-flash'].prefill).toBe('mistral');
    expect(MODEL_ROUTES['sour-intelligence'].prefill).toBe('openai');
    expect(MODEL_ROUTES['sour-overclock'].prefill).toBe('openai');
    // Gemini dropped assistant prefill; both routes resume by instruction.
    expect(MODEL_ROUTES['sour-ultra'].prefill).toBeNull();
    expect(MODEL_ROUTES['sour-overcode'].prefill).toBeNull();
  });

  it('only marks Mistral routes with the mistral mode', () => {
    for (const route of Object.values(MODEL_ROUTES)) {
      if (route.prefill === 'mistral') expect(route.provider).toBe('mistral');
      if (route.provider === 'gemini') expect(route.prefill ?? null).toBeNull();
    }
  });
});

// Pages gives each request a Worker isolate and module state is per-isolate,
// so a cold isolate re-runs this initialiser. A fixed start of 0 meant every
// isolate began at keys[0] and a 37-key list behaved like a 1-key list.
describe('key picker start offset', () => {
  const KEY_LIST = Array.from({ length: 8 }, (_, i) => `k${i}`);

  it('does not start every isolate on the same key', () => {
    const firstKeys = new Set<string>();
    for (let isolate = 0; isolate < KEY_LIST.length; isolate++) {
      // Each iteration stands in for a fresh isolate importing the module.
      vi.spyOn(Math, 'random').mockReturnValue(isolate / KEY_LIST.length);
      firstKeys.add(createKeyPicker()(KEY_LIST)!);
    }
    expect(firstKeys.size).toBe(KEY_LIST.length);
  });

  it('still rotates through the whole list from wherever it starts', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const pick = createKeyPicker();
    const seen = KEY_LIST.map(() => pick(KEY_LIST));
    expect(new Set(seen).size).toBe(KEY_LIST.length);
  });

  it('returns null when no keys are configured', () => {
    expect(createKeyPicker()([])).toBeNull();
  });


  it('keeps independent cursors for independent providers', () => {
    vi.spyOn(Math, 'random')
      .mockReturnValueOnce(0.125)
      .mockReturnValueOnce(0.75);
    const providerA = createKeyPicker();
    const providerB = createKeyPicker();

    expect(providerA(KEY_LIST)).toBe('k1');
    expect(providerA(KEY_LIST)).toBe('k2');
    expect(providerB(KEY_LIST)).toBe('k6');
    expect(providerB(KEY_LIST)).toBe('k7');
  });
});

describe('retry budget', () => {
  // 37 Gemini keys previously meant 74 sequential calls for one request, which
  // outruns the Worker wall clock and reads as a timeout rather than an error.
  it('caps keys tried per request and retries the same bounded subset', async () => {
    const many = Array.from({ length: 37 }, (_, i) => `k${i}`);
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => rateLimited('0'));
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      generateWithGroq(many, [{ role: 'user', content: 'hi' }], 'sys', 'm')
    ).rejects.toThrow(/429/);

    // 8 keys per round, 2 rounds — not 16 distinct keys from the 37-key list.
    expect(fetchMock).toHaveBeenCalledTimes(16);
    const used = fetchMock.mock.calls.map(([, init]) =>
      (init.headers as Record<string, string>).Authorization
    );
    expect(new Set(used.slice(0, 8)).size).toBe(8);
    expect(used.slice(8)).toEqual(used.slice(0, 8));
  });

  it('still uses every key when the list is short', async () => {
    const fetchMock = vi.fn(async () => rateLimited());
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      generateWithGroq(KEYS, [{ role: 'user', content: 'hi' }], 'sys', 'm')
    ).rejects.toThrow(/429/);

    expect(fetchMock).toHaveBeenCalledTimes(KEYS.length * 2);
  });
});

describe('key failover', () => {
  it('moves to the next key when the first is rate limited', async () => {
    const seen: string[] = [];
    const urls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: any) => {
      urls.push(url);
      seen.push(init.headers.Authorization);
      if (seen.length === 1) return rateLimited();
      return new Response(JSON.stringify({ choices: [{ message: { content: 'done' } }] }), { status: 200 });
    }));

    await expect(generateWithGroq(KEYS, [{ role: 'user', content: 'hi' }], 'sys', 'm')).resolves.toBe('done');
    expect(seen).toHaveLength(2);
    expect(seen[0]).not.toBe(seen[1]);
    expect(urls).toEqual([
      'https://api.groq.com/openai/v1/chat/completions',
      'https://api.groq.com/openai/v1/chat/completions',
    ]);
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


  it('never retries a key rejected with 401 in a later round', async () => {
    const seen: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: any) => {
      seen.push(init.headers.Authorization);
      return new Response(JSON.stringify({ error: { message: 'invalid credential' } }), {
        status: 401,
      });
    }));

    let thrown: unknown;
    try {
      await generateWithGroq(KEYS, [{ role: 'user', content: 'hi' }], 'sys', 'm');
    } catch (error) {
      thrown = error;
    }

    expect(seen).toHaveLength(KEYS.length);
    expect(new Set(seen).size).toBe(KEYS.length);
    expect(thrown).toBeInstanceOf(AgentProviderError);
    expect((thrown as AgentProviderError).details).toMatchObject({
      status: 401,
      keysTried: 2,
      attempts: 2,
    });
  });

  it('reports the provider response and key/attempt diagnostics without key values', async () => {
    const secret = 'gsk_abcdefghijklmnopqrstuvwxyz1234';
    vi.stubGlobal('fetch', vi.fn(async () =>
      new Response(JSON.stringify({
        error: { message: `Request too large for TPM; credential ${secret}` },
      }), { status: 413 })
    ));

    let thrown: unknown;
    try {
      await generateWithGroq([secret], [{ role: 'user', content: 'hi' }], 'sys', 'model-x');
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(AgentProviderError);
    const failure = (thrown as AgentProviderError).details;
    expect(failure).toMatchObject({
      provider: 'groq',
      model: 'model-x',
      status: 413,
      keyIndex: 1,
      keyCount: 1,
      keysTried: 1,
      keyBudget: 1,
      attempts: 1,
    });
    expect(failure.providerMessage).toContain('Request too large for TPM');
    expect(JSON.stringify(failure)).not.toContain(secret);
  });
});

describe('provider fallback key routing', () => {
  const base = {
    contents: [{ role: 'user', parts: [{ text: 'hi' }] }],
    plainMessages: [{ role: 'user', content: 'hi' }],
    systemInstruction: 'sys',
    route: { provider: 'mistral' as const, model: 'primary-model' },
    mistralKeys: ['mistral-only-key'],
    geminiKeys: ['gemini-only-key'],
    groqKeys: ['groq-only-key'],
  };

  function providerFor(url: string): string {
    if (url.includes('mistral.ai')) return 'mistral';
    if (url.includes('googleapis.com')) return 'gemini';
    if (url.includes('groq.com')) return 'groq';
    return 'unknown';
  }

  it('passes each provider its own key through generateText fallbacks', async () => {
    const calls: { provider: string; url: string; authorization?: string }[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: any) => {
      const provider = providerFor(url);
      calls.push({ provider, url, authorization: init.headers.Authorization });
      if (provider !== 'groq') {
        return new Response(JSON.stringify({ error: { message: 'request too large' } }), { status: 413 });
      }
      return new Response(JSON.stringify({ choices: [{ message: { content: 'fallback worked' } }] }), { status: 200 });
    }));

    await expect(generateText(base)).resolves.toBe('fallback worked');
    expect(calls.map((call) => call.provider)).toEqual(['mistral', 'gemini', 'groq']);
    expect(calls[0].authorization).toBe('Bearer mistral-only-key');
    expect(calls[1].url).toContain('key=gemini-only-key');
    expect(calls[2].authorization).toBe('Bearer groq-only-key');
  });

  it('passes each provider its own key through streamText fallbacks', async () => {
    const calls: { provider: string; url: string; authorization?: string }[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: any) => {
      const provider = providerFor(url);
      calls.push({ provider, url, authorization: init.headers.Authorization });
      if (provider !== 'groq') {
        return new Response(JSON.stringify({ error: { message: 'request too large' } }), { status: 413 });
      }
      return new Response(JSON.stringify({ choices: [{ message: { content: 'stream fallback worked' } }] }), { status: 200 });
    }));

    await expect(collect(streamText(base))).resolves.toBe('stream fallback worked');
    expect(calls.map((call) => call.provider)).toEqual(['mistral', 'gemini', 'groq']);
    expect(calls[0].authorization).toBe('Bearer mistral-only-key');
    expect(calls[1].url).toContain('key=gemini-only-key');
    expect(calls[2].authorization).toBe('Bearer groq-only-key');
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

  it('resumes a Mistral route by prefill rather than by instruction', async () => {
    const bodies: any[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: any) => {
      bodies.push(JSON.parse(init.body));
      if (bodies.length === 1) {
        return sseStream([
          token('Roses are '),
          `data: ${JSON.stringify({ error: { status: 429, message: 'tpm' } })}\n\n`,
        ]);
      }
      return sseStream([token('red.'), 'data: [DONE]\n\n']);
    }));

    const out = await collect(
      streamText({
        geminiKeys: [],
        groqKeys: [],
        mistralKeys: KEYS,
        contents: [],
        plainMessages: [{ role: 'user', content: 'poem' }],
        systemInstruction: 'sys',
        route: MODEL_ROUTES['sour-omni-flash'],
      })
    );

    expect(out).toBe('Roses are red.');
    const retry = bodies[1].messages;
    expect(retry[retry.length - 1]).toEqual({
      role: 'assistant',
      content: 'Roses are ',
      prefix: true,
    });
  });

  // Hitting max_tokens is reported as a clean finish, not an error, so before
  // this the reply simply stopped mid-token with nothing to explain why.
  it('resumes past the output cap instead of stopping mid-answer', async () => {
    const bodies: any[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: any) => {
      bodies.push(JSON.parse(init.body));
      if (bodies.length === 1) {
        return sseStream([
          token('function start() {'),
          `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'length' }] })}\n\n`,
          'data: [DONE]\n\n',
        ]);
      }
      return sseStream([token(' return 1; }'), 'data: [DONE]\n\n']);
    }));

    const out = await collect(
      streamText({
        geminiKeys: [],
        groqKeys: KEYS,
        contents: [],
        plainMessages: [{ role: 'user', content: 'write code' }],
        systemInstruction: 'sys',
        route: { provider: 'groq', model: 'm', prefill: 'openai' },
      })
    );

    expect(out).toBe('function start() { return 1; }');
    expect(bodies).toHaveLength(2);
    // Resumed by prefill, carrying what had already been emitted.
    const retry = bodies[1].messages;
    expect(retry[retry.length - 1]).toEqual({
      role: 'assistant',
      content: 'function start() {',
    });
  });

  it('fails closed after a bounded number of output-cap continuations', async () => {
    let calls = 0;
    vi.stubGlobal('fetch', vi.fn(async () => {
      calls++;
      // Distinct content each time, so this measures boundedness rather than
      // the seam de-duplication covered above.
      return sseStream([
        token(`part${calls} `),
        `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'length' }] })}\n\n`,
        'data: [DONE]\n\n',
      ]);
    }));

    await expect(collect(
      streamText({
        geminiKeys: [],
        groqKeys: KEYS,
        contents: [],
        plainMessages: [{ role: 'user', content: 'endless' }],
        systemInstruction: 'sys',
        route: { provider: 'groq', model: 'm', prefill: 'openai' },
      })
    )).rejects.toThrow(/remained incomplete/i);

    // First response plus a capped number of resumes — it terminates.
    expect(calls).toBe(4);
  });

  // A provider that ignores the prefill replies to it, retelling the whole
  // answer. Splicing is impossible because sampling never reproduces it token
  // for token, so the caller would receive the opening several times over.
  // Keeps the partial rather than failing the request. The client drops every
  // file op when a fence is left unclosed, so a truncated answer cannot be
  // applied, and a near-complete reply beats replacing it with a bare 502.
  it('keeps the partial when the model restarts instead of resuming', async () => {
    const opening = 'A'.repeat(150) + ' the quick brown fox jumps over the lazy dog';
    let calls = 0;
    vi.stubGlobal('fetch', vi.fn(async () => {
      calls++;
      if (calls === 1) {
        return sseStream([
          token(opening),
          `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'length' }] })}\n\n`,
          'data: [DONE]\n\n',
        ]);
      }
      // Retells the answer from the top rather than continuing it.
      return sseStream([token(opening + ' and then some more'), 'data: [DONE]\n\n']);
    }));

    const out = await collect(
      streamText({
        geminiKeys: [],
        groqKeys: KEYS,
        contents: [],
        plainMessages: [{ role: 'user', content: 'write' }],
        systemInstruction: 'sys',
        route: { provider: 'groq', model: 'm', prefill: 'openai' },
      })
    );

    // Exactly what was delivered before the restart — no second copy appended.
    expect(out).toBe(opening);
    expect(out.match(/quick brown fox/g)).toHaveLength(1);
    expect(calls).toBeGreaterThanOrEqual(2);
  });

  it('rejects a transport that closes without a terminal SSE event', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => sseStream([token('partial code')])));

    await expect(collect(
      streamText({
        geminiKeys: [],
        groqKeys: KEYS,
        contents: [],
        plainMessages: [{ role: 'user', content: 'write code' }],
        systemInstruction: 'sys',
        route: { provider: 'groq', model: 'm' },
      })
    )).rejects.toThrow(/ended before signalling completion/i);
  });

  // Observed live on a Gemini route: the resume opened with
  // "<thinking>Continuing game.js from the exact cut-off point ...</thinking>",
  // which landed in the middle of the generated file.
  it('strips a status tag the model emits at the head of a resume', async () => {
    let calls = 0;
    vi.stubGlobal('fetch', vi.fn(async () => {
      calls++;
      if (calls === 1) {
        return sseStream([
          token('const CONFIG = { sunset: { skyTop: 0'),
          `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'length' }] })}\n\n`,
          'data: [DONE]\n\n',
        ]);
      }
      return sseStream([
        token('<thinking>Continuing from the cut-off point.</thinking>x101830 } };'),
        'data: [DONE]\n\n',
      ]);
    }));

    const out = await collect(
      streamText({
        geminiKeys: [],
        groqKeys: KEYS,
        contents: [],
        plainMessages: [{ role: 'user', content: 'write' }],
        systemInstruction: 'sys',
        route: { provider: 'groq', model: 'm', prefill: 'openai' },
      })
    );

    expect(out).toBe('const CONFIG = { sunset: { skyTop: 0x101830 } };');
    expect(out).not.toContain('thinking');
  });

  it('de-duplicates an overlapping seam when the model repeats its last words', async () => {
    let calls = 0;
    vi.stubGlobal('fetch', vi.fn(async () => {
      calls++;
      if (calls === 1) {
        return sseStream([
          token('function add(a, b) { return a'),
          `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'length' }] })}\n\n`,
          'data: [DONE]\n\n',
        ]);
      }
      // Repeats "return a" before carrying on.
      return sseStream([token(' return a + b; }'), 'data: [DONE]\n\n']);
    }));

    const out = await collect(
      streamText({
        geminiKeys: [],
        groqKeys: KEYS,
        contents: [],
        plainMessages: [{ role: 'user', content: 'write' }],
        systemInstruction: 'sys',
        route: { provider: 'groq', model: 'm', prefill: 'openai' },
      })
    );

    expect(out).toBe('function add(a, b) { return a + b; }');
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
