import { describe, expect, it } from 'vitest';

import { mergeWavSegments, splitSpeechText } from '../../../functions/api/text-to-speech';

function wav(data: number[]): ArrayBuffer {
  const output = new Uint8Array(44 + data.length);
  const view = new DataView(output.buffer);
  const ascii = (offset: number, value: string) => value.split('').forEach((char, index) => { output[offset + index] = char.charCodeAt(0); });
  ascii(0, 'RIFF');
  view.setUint32(4, output.length - 8, true);
  ascii(8, 'WAVE');
  ascii(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, 24_000, true);
  view.setUint32(28, 48_000, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  ascii(36, 'data');
  view.setUint32(40, data.length, true);
  output.set(data, 44);
  return output.buffer;
}

function wavWithOversizedDataHeader(data: number[], declaredSize: number): ArrayBuffer {
  const buffer = wav(data);
  new DataView(buffer).setUint32(40, declaredSize, true);
  return buffer;
}

describe('Groq speech preparation', () => {
  it('splits long transcripts under the provider request limit without losing words', () => {
    const text = 'One sentence ends here. '.repeat(30).trim();
    const chunks = splitSpeechText(text, 80);
    expect(chunks.every((chunk) => chunk.length <= 80)).toBe(true);
    expect(chunks.join(' ')).toBe(text);
  });

  it('merges WAV payloads behind one valid header', () => {
    const merged = mergeWavSegments([wav([1, 2]), wav([3, 4, 5, 6])]);
    const bytes = new Uint8Array(merged);
    expect(new TextDecoder().decode(bytes.slice(0, 4))).toBe('RIFF');
    expect(new DataView(merged).getUint32(40, true)).toBe(6);
    expect([...bytes.slice(44)]).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('repairs a truncated Groq data chunk and drops an incomplete PCM frame', () => {
    const merged = mergeWavSegments([wavWithOversizedDataHeader([1, 2, 3], 100)]);
    const bytes = new Uint8Array(merged);
    expect(new DataView(merged).getUint32(4, true)).toBe(38);
    expect(new DataView(merged).getUint32(40, true)).toBe(2);
    expect([...bytes.slice(44)]).toEqual([1, 2]);
  });
});
