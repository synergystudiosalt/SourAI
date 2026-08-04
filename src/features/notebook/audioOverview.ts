import { apiUrl } from '../../lib/api';

export const MAX_AUDIO_TRANSCRIPT_CHARS = 4000;

/** Removes visual-only notation before the transcript is sent to Groq TTS. */
export function transcriptForSpeech(transcript: string): string {
  const spoken = String(transcript ?? '')
    .replace(/\[(\d+)\]/g, '')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/[*_`]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (spoken.length <= MAX_AUDIO_TRANSCRIPT_CHARS) return spoken;
  const clipped = spoken.slice(0, MAX_AUDIO_TRANSCRIPT_CHARS);
  const sentenceEnd = Math.max(clipped.lastIndexOf('. '), clipped.lastIndexOf('! '), clipped.lastIndexOf('? '));
  return (sentenceEnd > 3000 ? clipped.slice(0, sentenceEnd + 1) : clipped).trim();
}

/** Sends the generated overview transcript to the server-side Groq speech API. */
export async function synthesizeAudioOverview(transcript: string, signal?: AbortSignal): Promise<Blob> {
  const text = transcriptForSpeech(transcript);
  if (!text) throw new Error('The audio overview transcript is empty.');
  const response = await fetch(apiUrl('/api/text-to-speech'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
    signal,
  });
  if (!response.ok) {
    const data = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(data.error || `Audio generation failed (${response.status}).`);
  }
  return response.blob();
}
