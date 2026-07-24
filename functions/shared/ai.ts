import { GoogleGenAI } from '@google/genai';

function parseKeyList(raw: string | undefined): string[] {
  return (raw || '')
    .split(',')
    .map((k) => k.trim())
    .filter(Boolean);
}

export function getApiKeys(env: Record<string, string>) {
  const geminiKeys = parseKeyList(env.GEMINI_API_KEYS || env.GEMINI_API_KEY);
  const groqKeys = parseKeyList(env.GROQ_API_KEYS || env.GROQ_API_KEY);
  return { geminiKeys, groqKeys };
}

let geminiKeyCursor = 0;
let groqKeyCursor = 0;

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

export function buildGeminiClient(apiKey: string) {
  return new GoogleGenAI({
    apiKey,
    httpOptions: { headers: { 'User-Agent': 'sour-ai-cf-pages' } },
  });
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
      const ai = buildGeminiClient(key);
      const response = await ai.models.generateContent({ model, contents, config: { systemInstruction } });
      return response.text || '';
    } catch (err: any) {
      lastErr = err;
      console.warn(`Gemini key #${attempt + 1}/${keys.length} failed on ${model}:`, err?.message || err);
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error('All Gemini API keys failed');
}

export async function generateWithGroq(
  keys: string[],
  messages: { role: string; content: string }[],
  systemInstruction: string,
  model: string = 'llama-3.3-70b-versatile'
): Promise<string> {
  if (keys.length === 0) throw new Error('No Groq API keys configured');
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
    const key = takeGroqKey(keys)!;
    try {
      const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const errText = await res.text().catch(() => '');
        throw new Error(`Groq HTTP ${res.status}: ${errText.slice(0, 300)}`);
      }
      const data: any = await res.json();
      return data?.choices?.[0]?.message?.content || '';
    } catch (err: any) {
      lastErr = err;
      console.warn(`Groq key #${attempt + 1}/${keys.length} failed:`, err?.message || err);
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error('All Groq API keys failed');
}

export type Provider = 'gemini' | 'groq';
export interface ModelRoute {
  provider: Provider;
  model: string;
}

export const MODEL_ROUTES: Record<string, ModelRoute> = {
  'sour-omni-flash': { provider: 'gemini', model: 'gemini-3.5-flash-lite' },
  'sour-intelligence': { provider: 'groq', model: 'llama-4-scout-17b-16e-instruct' },
  'sour-ultra': { provider: 'gemini', model: 'gemma-4-31b-it' },
  'sour-overclock': { provider: 'gemini', model: 'gemma-4-31b-it' },
};

const DEFAULT_ROUTE: ModelRoute = MODEL_ROUTES['sour-omni-flash'];
const GLOBAL_FALLBACK_MODEL = 'gemma-4-31b-it';

export function resolveModelRoute(model: unknown): ModelRoute {
  if (typeof model === 'string' && MODEL_ROUTES[model]) return MODEL_ROUTES[model];
  return DEFAULT_ROUTE;
}

export async function generateText(opts: {
  geminiKeys: string[];
  groqKeys: string[];
  contents: any;
  plainMessages: { role: string; content: string }[];
  systemInstruction: string;
  route: ModelRoute;
}): Promise<string> {
  const { route, contents, plainMessages, systemInstruction, geminiKeys, groqKeys } = opts;
  try {
    if (route.provider === 'groq') {
      return await generateWithGroq(groqKeys, plainMessages, systemInstruction, route.model);
    }
    return await generateWithGemini(geminiKeys, contents, systemInstruction, route.model);
  } catch (primaryErr) {
    console.warn(
      `Primary ${route.provider} model "${route.model}" exhausted, trying global fallback "${GLOBAL_FALLBACK_MODEL}"...`,
      primaryErr
    );
    try {
      return await generateWithGemini(geminiKeys, contents, systemInstruction, GLOBAL_FALLBACK_MODEL);
    } catch (fallbackErr) {
      console.warn('Global fallback model exhausted, falling back to Groq default...', fallbackErr);
      return await generateWithGroq(groqKeys, plainMessages, systemInstruction);
    }
  }
}
