import { synthesizeSpeechWithGroq, getApiKeys, serializeAiError } from '../shared/ai';

/** Bound the complete overview; the smaller Orpheus requests are chunked below. */
const MAX_TEXT_CHARS = 4000;
const MAX_CHUNK_CHARS = 190;

const ALLOWED_VOICES = new Set([
  'autumn', 'diana', 'hannah', 'austin', 'daniel', 'troy',
]);

export function splitSpeechText(text: string, maxChars = MAX_CHUNK_CHARS): string[] {
  const chunks: string[] = [];
  let rest = text.replace(/\s+/g, ' ').trim();
  while (rest.length > maxChars) {
    const window = rest.slice(0, maxChars + 1);
    const sentence = Math.max(window.lastIndexOf('. '), window.lastIndexOf('! '), window.lastIndexOf('? '));
    const whitespace = window.lastIndexOf(' ');
    const end = sentence >= Math.floor(maxChars * 0.55) ? sentence + 1 : whitespace > 0 ? whitespace : maxChars;
    chunks.push(rest.slice(0, end).trim());
    rest = rest.slice(end).trim();
  }
  if (rest) chunks.push(rest);
  return chunks;
}

function ascii(bytes: Uint8Array, offset: number, length: number): string {
  return String.fromCharCode(...bytes.slice(offset, offset + length));
}

function wavParts(buffer: ArrayBuffer): { format: Uint8Array; data: Uint8Array } {
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);
  if (bytes.length < 44 || ascii(bytes, 0, 4) !== 'RIFF' || ascii(bytes, 8, 4) !== 'WAVE') {
    throw new Error('Groq returned an invalid WAV segment.');
  }
  let offset = 12;
  let format: Uint8Array | undefined;
  let data: Uint8Array | undefined;
  while (offset + 8 <= bytes.length) {
    const id = ascii(bytes, offset, 4);
    const size = view.getUint32(offset + 4, true);
    const start = offset + 8;
    const end = start + size;
    if (id === 'fmt ') {
      if (end > bytes.length) break;
      format = bytes.slice(start, end);
    }
    if (id === 'data') {
      // Groq occasionally closes a response after all available PCM bytes have
      // arrived but leaves a larger size in the data header. The audio is still
      // recoverable: take the bytes that arrived and write a corrected header
      // in mergeWavSegments below.
      data = bytes.slice(start, Math.min(end, bytes.length));
    }
    if (end > bytes.length) break;
    offset = start + size + (size % 2);
  }
  if (!format || !data) throw new Error('Groq returned an incomplete WAV segment.');
  const blockAlign = format.length >= 14
    ? new DataView(format.buffer, format.byteOffset, format.byteLength).getUint16(12, true)
    : 1;
  if (blockAlign > 1 && data.length % blockAlign) {
    data = data.slice(0, data.length - (data.length % blockAlign));
  }
  if (data.length === 0) throw new Error('Groq returned an empty WAV segment.');
  return { format, data };
}

/** Joins PCM WAV responses without leaving an invalid header between chunks. */
export function mergeWavSegments(segments: ArrayBuffer[]): ArrayBuffer {
  if (segments.length === 0) throw new Error('Groq returned no WAV segments.');
  const parts = segments.map(wavParts);
  const format = parts[0].format;
  if (parts.some((part) => part.format.length !== format.length || part.format.some((byte, i) => byte !== format[i]))) {
    throw new Error('Groq returned WAV segments with incompatible formats.');
  }
  const formatPad = format.length % 2;
  const dataLength = parts.reduce((total, part) => total + part.data.length, 0);
  const dataPad = dataLength % 2;
  const output = new Uint8Array(12 + 8 + format.length + formatPad + 8 + dataLength + dataPad);
  const view = new DataView(output.buffer);
  const writeAscii = (offset: number, value: string) => value.split('').forEach((char, index) => { output[offset + index] = char.charCodeAt(0); });
  writeAscii(0, 'RIFF');
  view.setUint32(4, output.length - 8, true);
  writeAscii(8, 'WAVE');
  writeAscii(12, 'fmt ');
  view.setUint32(16, format.length, true);
  output.set(format, 20);
  const dataHeader = 20 + format.length + formatPad;
  writeAscii(dataHeader, 'data');
  view.setUint32(dataHeader + 4, dataLength, true);
  let cursor = dataHeader + 8;
  for (const part of parts) {
    output.set(part.data, cursor);
    cursor += part.data.length;
  }
  return output.buffer;
}

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

    const chunks = splitSpeechText(text);
    const segments: ArrayBuffer[] = [];
    for (let index = 0; index < chunks.length; index += 3) {
      segments.push(...(await Promise.all(chunks.slice(index, index + 3).map((chunk) =>
        synthesizeSpeechWithGroq(groqKeys, chunk, voice)
      ))));
    }
    const audio = mergeWavSegments(segments);

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
