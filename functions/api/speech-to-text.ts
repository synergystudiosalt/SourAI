import { transcribeWithGroq, getApiKeys, serializeAiError } from '../shared/ai';

/** Groq rejects clips over 25MB on the free tier; reject early rather than upload for nothing. */
const MAX_AUDIO_BYTES = 25 * 1024 * 1024;

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

    const contentType = context.request.headers.get('content-type') || '';
    if (!contentType.includes('multipart/form-data')) {
      return new Response(
        JSON.stringify({ error: 'Expected multipart/form-data with an "audio" field.' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const form = await context.request.formData();
    const audio = form.get('audio');
    if (!(audio instanceof Blob) || audio.size === 0) {
      return new Response(
        JSON.stringify({ error: 'An "audio" file is required.' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }
    if (audio.size > MAX_AUDIO_BYTES) {
      return new Response(
        JSON.stringify({ error: 'Audio clip is too large (25MB max).' }),
        { status: 413, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const language = form.get('language');
    const filename = audio instanceof File && audio.name ? audio.name : 'dictation.webm';

    const text = await transcribeWithGroq(
      groqKeys,
      audio,
      filename,
      undefined,
      typeof language === 'string' && language ? language : undefined
    );

    return new Response(JSON.stringify({ text }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err: unknown) {
    console.error('Speech-to-text error:', err);
    const serialized = serializeAiError(err);
    return new Response(
      JSON.stringify({ error: serialized.message || 'Transcription failed' }),
      { status: 502, headers: { 'Content-Type': 'application/json' } }
    );
  }
};
