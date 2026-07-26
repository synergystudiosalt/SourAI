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

export async function generateWithGemini(
  keys: string[],
  contents: any,
  systemInstruction: string,
  model: string
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
            generationConfig: { temperature: 0.3 },
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

async function generateWithOpenAICompatible(
  baseUrl: string,
  keys: string[],
  takeKey: (keys: string[]) => string | null,
  messages: { role: string; content: string }[],
  systemInstruction: string,
  model: string
): Promise<string> {
  if (keys.length === 0) throw new Error(`No API keys configured for ${baseUrl}`);
  const body = {
    model,
    messages: [
      { role: 'system', content: systemInstruction },
      ...messages.map((m) => ({
        role: m.role === 'assistant' ? 'assistant' : 'user',
        content: m.content || '',
      })),
    ],
  };
  let lastErr: unknown;
  for (let attempt = 0; attempt < keys.length; attempt++) {
    const key = takeKey(keys)!;
    try {
      const res = await fetch(`${baseUrl}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
        body: JSON.stringify(body),
      });
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
  model: string = 'llama-3.3-70b-versatile'
): Promise<string> {
  return generateWithOpenAICompatible('https://api.groq.com', keys, takeGroqKey, messages, systemInstruction, model);
}

export async function generateWithCerebras(
  keys: string[],
  messages: { role: string; content: string }[],
  systemInstruction: string,
  model: string
): Promise<string> {
  return generateWithOpenAICompatible('https://api.cerebras.ai', keys, takeCerebrasKey, messages, systemInstruction, model);
}

export async function generateWithMistral(
  keys: string[],
  messages: { role: string; content: string }[],
  systemInstruction: string,
  model: string
): Promise<string> {
  return generateWithOpenAICompatible('https://api.mistral.ai', keys, takeMistralKey, messages, systemInstruction, model);
}

export type Provider = 'gemini' | 'groq' | 'cerebras' | 'mistral';
export interface ModelRoute {
  provider: Provider;
  model: string;
}

export const MODEL_ROUTES: Record<string, ModelRoute> = {
  'sour-omni-flash': { provider: 'groq', model: 'openai/gpt-oss-20b' },
  'sour-intelligence': { provider: 'groq', model: 'qwen/qwen3.6-27b' },
  'sour-ultra': { provider: 'gemini', model: 'gemini-3.5-flash-lite' },
  'sour-overclock': { provider: 'cerebras', model: 'zai-glm-4.7' },
  'sour-overcode': { provider: 'gemini', model: 'gemini-3.6-flash' },
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
}): Promise<string> {
  const { route, contents, plainMessages, systemInstruction, geminiKeys, groqKeys, cerebrasKeys = [], mistralKeys = [] } = opts;

  const tryProvider = async (): Promise<string> => {
    switch (route.provider) {
      case 'groq':
        return await generateWithGroq(groqKeys, plainMessages, systemInstruction, route.model);
      case 'cerebras':
        return await generateWithCerebras(cerebrasKeys, plainMessages, systemInstruction, route.model);
      case 'mistral':
        return await generateWithMistral(mistralKeys, plainMessages, systemInstruction, route.model);
      case 'gemini':
      default:
        return await generateWithGemini(geminiKeys, contents, systemInstruction, route.model);
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
      return await generateWithGemini(geminiKeys, contents, systemInstruction, 'gemini-3.5-flash-lite');
    } catch (fallbackErr) {
      console.warn('Global Gemini fallback exhausted, falling back to Groq default...', fallbackErr);
      return await generateWithGroq(groqKeys, plainMessages, systemInstruction);
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
  model: string
): AsyncGenerator<string> {
  if (keys.length === 0) throw new Error(`No API keys configured for ${baseUrl}`);
  const body = {
    model,
    messages: [
      { role: 'system', content: systemInstruction },
      ...messages.map((m) => ({
        role: m.role === 'assistant' ? 'assistant' : 'user',
        content: m.content || '',
      })),
    ],
    stream: true,
  };
  let lastErr: unknown;
  for (let attempt = 0; attempt < keys.length; attempt++) {
    const key = takeKey(keys)!;
    try {
      const res = await fetch(`${baseUrl}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
        body: JSON.stringify(body),
      });
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
  model: string
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
            generationConfig: { temperature: 0.3 },
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
}): AsyncGenerator<string> {
  const { route, contents, plainMessages, systemInstruction, geminiKeys, groqKeys, cerebrasKeys = [], mistralKeys = [] } = opts;

  try {
    switch (route.provider) {
      case 'groq':
        yield* streamWithOpenAICompatible('https://api.groq.com', groqKeys, takeGroqKey, plainMessages, systemInstruction, route.model);
        return;
      case 'cerebras':
        yield* streamWithOpenAICompatible('https://api.cerebras.ai', cerebrasKeys, takeCerebrasKey, plainMessages, systemInstruction, route.model);
        return;
      case 'mistral':
        yield* streamWithOpenAICompatible('https://api.mistral.ai', mistralKeys, takeMistralKey, plainMessages, systemInstruction, route.model);
        return;
      case 'gemini':
      default:
        yield* streamWithGemini(geminiKeys, contents, systemInstruction, route.model);
        return;
    }
  } catch (primaryErr) {
    console.warn(`Primary ${route.provider} stream failed, trying Gemini fallback...`, primaryErr);
    try {
      yield* streamWithGemini(geminiKeys, contents, systemInstruction, 'gemini-3.5-flash-lite');
    } catch {
      console.warn('Gemini fallback exhausted, falling back to non-streaming Groq...');
      const text = await generateWithGroq(groqKeys, plainMessages, systemInstruction);
      yield text;
    }
  }
}
