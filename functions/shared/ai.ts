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
  'sour-omni-flash': { provider: 'groq', model: 'llama-3.1-8b-instant' },
  'sour-intelligence': { provider: 'groq', model: 'llama-3.3-70b-versatile' },
  'sour-ultra': { provider: 'gemini', model: 'gemini-3.5-flash-lite' },
  'sour-overclock': { provider: 'cerebras', model: 'zai-glm-4.7' },
  'sour-ultracode': { provider: 'gemini', model: 'gemini-3.6-flash' },
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
