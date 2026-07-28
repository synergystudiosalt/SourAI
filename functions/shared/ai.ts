function parseKeyList(raw: string | undefined): string[] {
  return (raw || '')
    .split(',')
    .map((k) => k.trim())
    .filter(Boolean);
}

export function getApiKeys(env: Record<string, string>) {
  const geminiKeys = parseKeyList(env.GEMINI_API_KEYS || env.GEMINI_API_KEY);
  const groqKeys = parseKeyList(env.GROQ_API_KEYS || env.GROQ_API_KEY);
  const cerebrasKeys = parseKeyList(env.CEREBRAS_API_KEYS || env.CEREBRAS_API_KEY);
  const mistralKeys = parseKeyList(env.MISTRAL_API_KEYS || env.MISTRAL_API_KEY);
  return { geminiKeys, groqKeys, cerebrasKeys, mistralKeys };
}

let geminiKeyCursor = 0;
let groqKeyCursor = 0;
let cerebrasKeyCursor = 0;
let mistralKeyCursor = 0;

export function takeGeminiKey(keys: string[]): string | null {
  if (keys.length === 0) return null;
  const key = keys[geminiKeyCursor % keys.length];
  geminiKeyCursor++;
  return key;
}

export function takeGroqKey(keys: string[]): string | null {
  if (keys.length === 0) return null;
  const key = keys[groqKeyCursor % keys.length];
  groqKeyCursor++;
  return key;
}

export function takeCerebrasKey(keys: string[]): string | null {
  if (keys.length === 0) return null;
  const key = keys[cerebrasKeyCursor % keys.length];
  cerebrasKeyCursor++;
  return key;
}

export function takeMistralKey(keys: string[]): string | null {
  if (keys.length === 0) return null;
  const key = keys[mistralKeyCursor % keys.length];
  mistralKeyCursor++;
  return key;
}

/**
 * Per-request generation knobs. Every field is optional so existing callers
 * (e.g. /api/chat) keep their previous behaviour when they pass nothing.
 */
export interface GenerationTuning {
  readonly temperature?: number;
  readonly maxOutputTokens?: number;
  /** Applied only to models whose route declares `openai_effort`. */
  readonly openAiEffort?: 'low' | 'medium' | 'high';
  /** Applied only to models whose route declares `gemini_thinking`. */
  readonly thinkingBudget?: number;
}

/**
 * Which provider-side reasoning control a model accepts. Sending the wrong one
 * is a 400, so this is opt-in per route rather than assumed.
 */
export type ReasoningControl = 'openai_effort' | 'gemini_thinking' | null;

function buildGeminiGenerationConfig(
  tuning: GenerationTuning | undefined,
  reasoning: ReasoningControl
): Record<string, unknown> {
  const config: Record<string, unknown> = { temperature: tuning?.temperature ?? 0.3 };
  if (tuning?.maxOutputTokens) config.maxOutputTokens = tuning.maxOutputTokens;
  if (reasoning === 'gemini_thinking' && typeof tuning?.thinkingBudget === 'number') {
    config.thinkingConfig = { thinkingBudget: tuning.thinkingBudget };
  }
  return config;
}

export async function generateWithGemini(
  keys: string[],
  contents: any,
  systemInstruction: string,
  model: string,
  tuning?: GenerationTuning,
  reasoning: ReasoningControl = null
): Promise<string> {
  if (keys.length === 0) throw new Error('No Gemini API keys configured');
  let lastErr: unknown;
  for (let attempt = 0; attempt < keys.length; attempt++) {
    const key = takeGeminiKey(keys)!;
    try {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents,
            systemInstruction: { parts: [{ text: systemInstruction }] },
            generationConfig: buildGeminiGenerationConfig(tuning, reasoning),
          }),
        }
      );
      const data: any = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(`Gemini HTTP ${response.status}: ${data?.error?.message || 'Request failed'}`);
      }
      const text = data?.candidates?.[0]?.content?.parts
        ?.map((part: any) => part?.text || '')
        .join('')
        .trim();
      if (!text) throw new Error('Gemini returned no text content');
      return text;
    } catch (err: any) {
      lastErr = err;
      console.warn(`Gemini key #${attempt + 1}/${keys.length} failed on ${model}:`, err?.message || err);
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error('All Gemini API keys failed');
}

export function buildOpenAICompatibleBody(
  model: string,
  messages: { role: string; content: string }[],
  systemInstruction: string,
  tuning: GenerationTuning | undefined,
  reasoning: ReasoningControl,
  extra?: Record<string, unknown>
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model,
    messages: [
      { role: 'system', content: systemInstruction },
      ...messages.map((m) => ({
        role: m.role === 'assistant' ? 'assistant' : 'user',
        content: m.content || '',
      })),
    ],
    ...extra,
  };
  if (typeof tuning?.temperature === 'number') body.temperature = tuning.temperature;
  if (tuning?.maxOutputTokens) body.max_tokens = tuning.maxOutputTokens;
  if (reasoning === 'openai_effort' && tuning?.openAiEffort) {
    body.reasoning_effort = tuning.openAiEffort;
  }
  return body;
}

/**
 * POSTs a chat completion, and if the provider rejects the request with a 400
 * while we were sending `reasoning_effort`, retries once without it. Provider
 * support for that field varies per model and changes over time; degrading to
 * a normal completion beats failing the user's request outright.
 */
async function postChatCompletion(
  baseUrl: string,
  key: string,
  body: Record<string, unknown>
): Promise<Response> {
  const send = (payload: Record<string, unknown>) =>
    fetch(`${baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify(payload),
    });

  const res = await send(body);
  if (res.status === 400 && 'reasoning_effort' in body) {
    const { reasoning_effort: _dropped, ...withoutReasoning } = body;
    console.warn(`${baseUrl} rejected reasoning_effort for ${body.model}; retrying without it.`);
    return send(withoutReasoning);
  }
  return res;
}

async function generateWithOpenAICompatible(
  baseUrl: string,
  keys: string[],
  takeKey: (keys: string[]) => string | null,
  messages: { role: string; content: string }[],
  systemInstruction: string,
  model: string,
  tuning?: GenerationTuning,
  reasoning: ReasoningControl = null
): Promise<string> {
  if (keys.length === 0) throw new Error(`No API keys configured for ${baseUrl}`);
  const body = buildOpenAICompatibleBody(model, messages, systemInstruction, tuning, reasoning);
  let lastErr: unknown;
  for (let attempt = 0; attempt < keys.length; attempt++) {
    const key = takeKey(keys)!;
    try {
      const res = await postChatCompletion(baseUrl, key, body);
      if (!res.ok) {
        const errText = await res.text().catch(() => '');
        throw new Error(`HTTP ${res.status}: ${errText.slice(0, 300)}`);
      }
      const data: any = await res.json();
      return data?.choices?.[0]?.message?.content || '';
    } catch (err: any) {
      lastErr = err;
      console.warn(`Attempt ${attempt + 1}/${keys.length} failed for ${model} at ${baseUrl}:`, err?.message || err);
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(`All API keys failed for ${baseUrl}`);
}

export async function generateWithGroq(
  keys: string[],
  messages: { role: string; content: string }[],
  systemInstruction: string,
  model: string = 'llama-3.3-70b-versatile',
  tuning?: GenerationTuning,
  reasoning: ReasoningControl = null
): Promise<string> {
  return generateWithOpenAICompatible('https://api.groq.com', keys, takeGroqKey, messages, systemInstruction, model, tuning, reasoning);
}

export async function generateWithCerebras(
  keys: string[],
  messages: { role: string; content: string }[],
  systemInstruction: string,
  model: string,
  tuning?: GenerationTuning,
  reasoning: ReasoningControl = null
): Promise<string> {
  return generateWithOpenAICompatible('https://api.cerebras.ai', keys, takeCerebrasKey, messages, systemInstruction, model, tuning, reasoning);
}

export async function generateWithMistral(
  keys: string[],
  messages: { role: string; content: string }[],
  systemInstruction: string,
  model: string,
  tuning?: GenerationTuning,
  reasoning: ReasoningControl = null
): Promise<string> {
  return generateWithOpenAICompatible('https://api.mistral.ai', keys, takeMistralKey, messages, systemInstruction, model, tuning, reasoning);
}

export type Provider = 'gemini' | 'groq' | 'cerebras' | 'mistral';
export interface ModelRoute {
  provider: Provider;
  model: string;
  /**
   * Reasoning control this model accepts, if any. Left null where support is
   * unconfirmed — `postChatCompletion` degrades on 400, but not asking for a
   * knob we aren't sure exists avoids the wasted round trip.
   */
  reasoning?: ReasoningControl;
}

export const MODEL_ROUTES: Record<string, ModelRoute> = {
  'sour-omni-flash': { provider: 'groq', model: 'openai/gpt-oss-20b', reasoning: 'openai_effort' },
  'sour-intelligence': { provider: 'groq', model: 'qwen/qwen3.6-27b', reasoning: null },
  'sour-ultra': { provider: 'gemini', model: 'gemini-3.5-flash-lite', reasoning: 'gemini_thinking' },
  'sour-overclock': { provider: 'cerebras', model: 'zai-glm-4.7', reasoning: null },
  'sour-overcode': { provider: 'gemini', model: 'gemini-3.6-flash', reasoning: 'gemini_thinking' },
};

const DEFAULT_ROUTE: ModelRoute = MODEL_ROUTES['sour-omni-flash'];

export function resolveModelRoute(model: unknown): ModelRoute {
  if (typeof model === 'string' && MODEL_ROUTES[model]) return MODEL_ROUTES[model];
  return DEFAULT_ROUTE;
}

export async function generateText(opts: {
  geminiKeys: string[];
  groqKeys: string[];
  cerebrasKeys?: string[];
  mistralKeys?: string[];
  contents: any;
  plainMessages: { role: string; content: string }[];
  systemInstruction: string;
  route: ModelRoute;
  tuning?: GenerationTuning;
}): Promise<string> {
  const { route, contents, plainMessages, systemInstruction, geminiKeys, groqKeys, cerebrasKeys = [], mistralKeys = [], tuning } = opts;
  const reasoning = route.reasoning ?? null;

  const tryProvider = async (): Promise<string> => {
    switch (route.provider) {
      case 'groq':
        return await generateWithGroq(groqKeys, plainMessages, systemInstruction, route.model, tuning, reasoning);
      case 'cerebras':
        return await generateWithCerebras(cerebrasKeys, plainMessages, systemInstruction, route.model, tuning, reasoning);
      case 'mistral':
        return await generateWithMistral(mistralKeys, plainMessages, systemInstruction, route.model, tuning, reasoning);
      case 'gemini':
      default:
        return await generateWithGemini(geminiKeys, contents, systemInstruction, route.model, tuning, reasoning);
    }
  };

  try {
    return await tryProvider();
  } catch (primaryErr) {
    console.warn(
      `Primary ${route.provider} model "${route.model}" exhausted, trying global Gemini fallback...`,
      primaryErr
    );
    try {
      // Fallback models have their own capabilities: keep temperature and the
      // output cap, but only ask for the reasoning knob the fallback supports.
      return await generateWithGemini(geminiKeys, contents, systemInstruction, 'gemini-3.5-flash-lite', tuning, 'gemini_thinking');
    } catch (fallbackErr) {
      console.warn('Global Gemini fallback exhausted, falling back to Groq default...', fallbackErr);
      return await generateWithGroq(groqKeys, plainMessages, systemInstruction, undefined, tuning, null);
    }
  }
}

// ─── Streaming variants ────────────────────────────────────────────────────

async function* streamWithOpenAICompatible(
  baseUrl: string,
  keys: string[],
  takeKey: (keys: string[]) => string | null,
  messages: { role: string; content: string }[],
  systemInstruction: string,
  model: string,
  tuning?: GenerationTuning,
  reasoning: ReasoningControl = null
): AsyncGenerator<string> {
  if (keys.length === 0) throw new Error(`No API keys configured for ${baseUrl}`);
  const body = buildOpenAICompatibleBody(model, messages, systemInstruction, tuning, reasoning, { stream: true });
  let lastErr: unknown;
  for (let attempt = 0; attempt < keys.length; attempt++) {
    const key = takeKey(keys)!;
    try {
      const res = await postChatCompletion(baseUrl, key, body);
      if (!res.ok) {
        const errText = await res.text().catch(() => '');
        throw new Error(`HTTP ${res.status}: ${errText.slice(0, 300)}`);
      }
      const reader = res.body?.getReader();
      if (!reader) throw new Error('No response body');
      const decoder = new TextDecoder();
      let buffer = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith('data: ')) continue;
          const data = trimmed.slice(6);
          if (data === '[DONE]') return;
          try {
            const parsed = JSON.parse(data);
            const token = parsed?.choices?.[0]?.delta?.content;
            if (token) yield token;
          } catch { /* skip malformed lines */ }
        }
      }
      return;
    } catch (err: any) {
      lastErr = err;
      console.warn(`Stream attempt ${attempt + 1}/${keys.length} failed for ${model} at ${baseUrl}:`, err?.message || err);
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(`All API keys failed for ${baseUrl}`);
}

async function* streamWithGemini(
  keys: string[],
  contents: any,
  systemInstruction: string,
  model: string,
  tuning?: GenerationTuning,
  reasoning: ReasoningControl = null
): AsyncGenerator<string> {
  if (keys.length === 0) throw new Error('No Gemini API keys configured');
  let lastErr: unknown;
  for (let attempt = 0; attempt < keys.length; attempt++) {
    const key = takeGeminiKey(keys)!;
    try {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse&key=${encodeURIComponent(key)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents,
            systemInstruction: { parts: [{ text: systemInstruction }] },
            generationConfig: buildGeminiGenerationConfig(tuning, reasoning),
          }),
        }
      );
      if (!response.ok) {
        const data: any = await response.json().catch(() => ({}));
        throw new Error(`Gemini HTTP ${response.status}: ${data?.error?.message || 'Request failed'}`);
      }
      const reader = response.body?.getReader();
      if (!reader) throw new Error('No response body');
      const decoder = new TextDecoder();
      let buffer = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith('data: ')) continue;
          try {
            const parsed = JSON.parse(trimmed.slice(6));
            const token = parsed?.candidates?.[0]?.content?.parts?.[0]?.text;
            if (token) yield token;
          } catch { /* skip malformed lines */ }
        }
      }
      return;
    } catch (err: any) {
      lastErr = err;
      console.warn(`Gemini stream key #${attempt + 1}/${keys.length} failed on ${model}:`, err?.message || err);
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error('All Gemini API keys failed');
}

export async function* streamText(opts: {
  geminiKeys: string[];
  groqKeys: string[];
  cerebrasKeys?: string[];
  mistralKeys?: string[];
  contents: any;
  plainMessages: { role: string; content: string }[];
  systemInstruction: string;
  route: ModelRoute;
  tuning?: GenerationTuning;
}): AsyncGenerator<string> {
  const { route, contents, plainMessages, systemInstruction, geminiKeys, groqKeys, cerebrasKeys = [], mistralKeys = [], tuning } = opts;
  const reasoning = route.reasoning ?? null;

  try {
    switch (route.provider) {
      case 'groq':
        yield* streamWithOpenAICompatible('https://api.groq.com', groqKeys, takeGroqKey, plainMessages, systemInstruction, route.model, tuning, reasoning);
        return;
      case 'cerebras':
        yield* streamWithOpenAICompatible('https://api.cerebras.ai', cerebrasKeys, takeCerebrasKey, plainMessages, systemInstruction, route.model, tuning, reasoning);
        return;
      case 'mistral':
        yield* streamWithOpenAICompatible('https://api.mistral.ai', mistralKeys, takeMistralKey, plainMessages, systemInstruction, route.model, tuning, reasoning);
        return;
      case 'gemini':
      default:
        yield* streamWithGemini(geminiKeys, contents, systemInstruction, route.model, tuning, reasoning);
        return;
    }
  } catch (primaryErr) {
    console.warn(`Primary ${route.provider} stream failed, trying Gemini fallback...`, primaryErr);
    try {
      yield* streamWithGemini(geminiKeys, contents, systemInstruction, 'gemini-3.5-flash-lite', tuning, 'gemini_thinking');
    } catch {
      console.warn('Gemini fallback exhausted, falling back to non-streaming Groq...');
      const text = await generateWithGroq(groqKeys, plainMessages, systemInstruction, undefined, tuning, null);
      yield text;
    }
  }
}
