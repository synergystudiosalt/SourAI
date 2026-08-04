/**
 * Groq-backed voice I/O for dictation and read-aloud.
 *
 * Speech-to-text records the mic with MediaRecorder and sends the clip to
 * /api/speech-to-text (Groq Whisper). Text-to-speech posts to
 * /api/text-to-speech (Groq Orpheus) and plays back the returned WAV. Both
 * fall back to the browser's native Web Speech API when the Groq call can't
 * be made — no server key configured, offline, unsupported codec — so the
 * mic and speaker buttons keep working either way.
 */

import { apiUrl } from '../lib/api';
import { VoiceRecognizer } from './voiceRecognition';

export interface VoiceInputCallbacks {
  onTranscript: (text: string, isFinal: boolean) => void;
  onError: (message: string) => void;
  onStart?: () => void;
  onEnd?: () => void;
  /** Fires while the recorded clip is being sent to Groq for transcription. */
  onTranscribing?: (isTranscribing: boolean) => void;
}

function pickRecorderMimeType(): string {
  if (typeof MediaRecorder === 'undefined') return '';
  const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'];
  return candidates.find((type) => MediaRecorder.isTypeSupported(type)) || '';
}

function extensionForMimeType(mimeType: string): string {
  if (mimeType.includes('mp4')) return 'mp4';
  if (mimeType.includes('ogg')) return 'ogg';
  return 'webm';
}

/**
 * Records the mic and transcribes with Groq Whisper (`whisper-large-v3-turbo`
 * server-side). Falls back to the browser's built-in SpeechRecognition when
 * getUserMedia/MediaRecorder is unavailable, so dictation still works in
 * browsers that lack one API or the other.
 */
export class GroqVoiceRecorder {
  private mediaRecorder: MediaRecorder | null = null;
  private stream: MediaStream | null = null;
  private chunks: Blob[] = [];
  private fallbackRecognizer: VoiceRecognizer | null = null;
  private usingFallback = false;

  constructor(private readonly callbacks: VoiceInputCallbacks) {}

  isRecording(): boolean {
    if (this.usingFallback) return this.fallbackRecognizer?.getIsListening() ?? false;
    return this.mediaRecorder?.state === 'recording';
  }

  async start(): Promise<void> {
    const mimeType = pickRecorderMimeType();
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia || !mimeType) {
      this.startFallback();
      return;
    }

    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      this.chunks = [];
      const recorder = new MediaRecorder(this.stream, { mimeType });
      this.mediaRecorder = recorder;
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) this.chunks.push(event.data);
      };
      recorder.onstop = () => {
        void this.handleStop(mimeType);
      };
      recorder.onerror = (event) => {
        console.warn('MediaRecorder error:', event);
        this.callbacks.onError('Recording failed, using browser speech recognition');
        this.releaseStream();
        this.startFallback();
      };
      recorder.start();
      this.callbacks.onStart?.();
    } catch (err) {
      console.warn('Groq voice input: microphone access failed, falling back to browser dictation.', err);
      this.startFallback();
    }
  }

  stop(): void {
    if (this.usingFallback) {
      this.fallbackRecognizer?.stop();
      return;
    }
    if (this.mediaRecorder && this.mediaRecorder.state === 'recording') {
      this.mediaRecorder.stop();
    }
  }

  private startFallback(): void {
    this.usingFallback = true;
    this.fallbackRecognizer = new VoiceRecognizer({
      onTranscript: (transcript, isFinal) => this.callbacks.onTranscript(transcript, isFinal),
      onError: (error) => this.callbacks.onError(error),
      onStart: () => this.callbacks.onStart?.(),
      onEnd: () => this.callbacks.onEnd?.(),
    });
    if (!this.fallbackRecognizer.isSupported()) {
      this.callbacks.onError('Voice input is not supported in this browser');
      return;
    }
    this.fallbackRecognizer.start();
  }

  private releaseStream(): void {
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;
    this.mediaRecorder = null;
  }

  private async handleStop(mimeType: string): Promise<void> {
    const chunks = this.chunks;
    this.chunks = [];
    this.releaseStream();
    this.callbacks.onEnd?.();

    if (chunks.length === 0) return;
    const blob = new Blob(chunks, { type: mimeType });

    this.callbacks.onTranscribing?.(true);
    try {
      const form = new FormData();
      form.append('audio', blob, `dictation.${extensionForMimeType(mimeType)}`);
      const res = await fetch(apiUrl('/api/speech-to-text'), { method: 'POST', body: form });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}) as { error?: string });
        throw new Error(data?.error || `Transcription failed (${res.status})`);
      }
      const data = (await res.json()) as { text?: string };
      const text = (data.text || '').trim();
      if (text) this.callbacks.onTranscript(text, true);
      else this.callbacks.onError('No speech detected');
    } catch (err) {
      console.warn('Groq transcription failed:', err);
      this.callbacks.onError(err instanceof Error ? err.message : 'Transcription failed');
    } finally {
      this.callbacks.onTranscribing?.(false);
    }
  }
}

// ─── Text-to-speech (read aloud) ───────────────────────────────────────────

export interface SpeakCallbacks {
  onStart?: () => void;
  onEnd?: () => void;
  onError?: (message: string) => void;
}

let currentAudio: HTMLAudioElement | null = null;
let currentObjectUrl: string | null = null;

function stopCurrentPlayback(): void {
  if (currentAudio) {
    currentAudio.pause();
    currentAudio.onended = null;
    currentAudio.onerror = null;
    currentAudio.src = '';
    currentAudio = null;
  }
  if (currentObjectUrl) {
    URL.revokeObjectURL(currentObjectUrl);
    currentObjectUrl = null;
  }
  if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
    window.speechSynthesis.cancel();
  }
}

/** Stops whatever sour.ai is currently reading aloud, Groq or browser voice alike. */
export function stopSpeaking(): void {
  stopCurrentPlayback();
}

function speakWithBrowserFallback(text: string, callbacks: SpeakCallbacks): void {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
    callbacks.onError?.('Text-to-speech is not supported in this browser');
    return;
  }
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.onstart = () => callbacks.onStart?.();
  utterance.onend = () => callbacks.onEnd?.();
  utterance.onerror = () => callbacks.onError?.('Speech playback failed');
  window.speechSynthesis.speak(utterance);
}

/**
 * Reads text aloud with Groq's Orpheus TTS. Falls back to the browser's own
 * speechSynthesis if the request fails — no server key, offline, rate limit.
 */
export async function speakText(text: string, callbacks: SpeakCallbacks = {}, voice?: string): Promise<void> {
  stopCurrentPlayback();
  const trimmed = text.trim();
  if (!trimmed) return;

  try {
    const res = await fetch(apiUrl('/api/text-to-speech'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: trimmed, voice }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}) as { error?: string });
      throw new Error(data?.error || `Speech synthesis failed (${res.status})`);
    }
    const arrayBuffer = await res.arrayBuffer();
    const blob = new Blob([arrayBuffer], { type: 'audio/wav' });
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    currentObjectUrl = url;
    currentAudio = audio;
    audio.onended = () => {
      stopCurrentPlayback();
      callbacks.onEnd?.();
    };
    audio.onerror = () => {
      stopCurrentPlayback();
      callbacks.onError?.('Speech playback failed');
    };
    callbacks.onStart?.();
    await audio.play();
  } catch (err) {
    console.warn('Groq text-to-speech failed, falling back to browser speech synthesis.', err);
    speakWithBrowserFallback(trimmed, callbacks);
  }
}
