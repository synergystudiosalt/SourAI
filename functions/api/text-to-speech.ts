import { synthesizeSpeechWithGroq, getApiKeys, serializeAiError } from '../shared/ai';

/** Groq's PlayAI TTS caps a single request around this length; trim rather than error. */
const MAX_TEXT_CHARS = 4000;

const ALLOWED_VOICES = new Set([
  'Arista-PlayAI', 'Atlas-PlayAI', 'Basil-PlayAI', 'Briggs-PlayAI', 'Calum-PlayAI',
  'Celeste-PlayAI', 'Cheyenne-PlayAI', 'Chip-PlayAI', 'Cillian-PlayAI', 'Deedee-PlayAI',
  'Fritz-PlayAI', 'Gail-PlayAI', 'Indigo-PlayAI', 'Mamaw-PlayAI', 'Mason-PlayAI',
  'Mikail-PlayAI', 'Mitch-PlayAI', 'Quinn-PlayAI', 'Thunder-PlayAI',
]);

export const onRequest: PagesFunction = async (context) => {
  if (context.request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  try {
    const env = context.env as Record<string, string>;
    const { groqKeys } = getApiKeys(env);

    if (groqKeys.length === 0) {
      return new Response(
        JSON.stringify({ error: 'No Groq API keys are configured in Cloudflare Pages environment variables.' }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const body = (await context.request.json().catch(() => ({}))) as { text?: string; voice?: string };
    const text = (body.text || '').trim().slice(0, MAX_TEXT_CHARS);
    if (!text) {
      return new Response(
        JSON.stringify({ error: 'Text is required' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const voice = body.voice && ALLOWED_VOICES.has(body.voice) ? body.voice : undefined;

    const audio = await synthesizeSpeechWithGroq(groqKeys, text, voice);

    return new Response(audio, {
      status: 200,
      headers: {
        'Content-Type': 'audio/wav',
        'Cache-Control': 'no-store',
      },
    });
  } catch (err: unknown) {
    console.error('Text-to-speech error:', err);
    const serialized = serializeAiError(err);
    return new Response(
      JSON.stringify({ error: serialized.message || 'Speech synthesis failed' }),
      { status: 502, headers: { 'Content-Type': 'application/json' } }
    );
  }
};
