/**
 * Web Speech API wrapper for voice-to-text recognition
 */

type VoiceRecognitionCallback = (transcript: string, isFinal: boolean) => void;
type VoiceErrorCallback = (error: string) => void;

interface VoiceRecognitionConfig {
  onTranscript: VoiceRecognitionCallback;
  onError: VoiceErrorCallback;
  onStart?: () => void;
  onEnd?: () => void;
}

export class VoiceRecognizer {
  private recognition: any = null;
  private isListening = false;
  private config: VoiceRecognitionConfig;

  constructor(config: VoiceRecognitionConfig) {
    this.config = config;
    this.initializeRecognition();
  }

  private initializeRecognition() {
    if (!this.isSupported()) {
      return;
    }

    const SpeechRecognitionClass = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    this.recognition = new SpeechRecognitionClass();

    this.recognition.continuous = false;
    this.recognition.interimResults = true;
    this.recognition.language = 'en-US';

    this.recognition.onstart = () => {
      this.isListening = true;
      this.config.onStart?.();
    };

    this.recognition.onresult = (event: any) => {
      let interimTranscript = '';
      let finalTranscript = '';

      for (let i = event.resultIndex; i < event.results.length; i++) {
        const transcript = event.results[i][0].transcript;

        if (event.results[i].isFinal) {
          finalTranscript += transcript + ' ';
        } else {
          interimTranscript += transcript;
        }
      }

      const isFinal = event.results[event.results.length - 1].isFinal;
      const transcript = finalTranscript || interimTranscript;

      this.config.onTranscript(transcript, isFinal);
    };

    this.recognition.onerror = (event: any) => {
      const errorMessage = this.getErrorMessage(event.error);
      this.config.onError(errorMessage);
    };

    this.recognition.onend = () => {
      this.isListening = false;
      this.config.onEnd?.();
    };
  }

  isSupported(): boolean {
    const SpeechRecognitionClass = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    return !!SpeechRecognitionClass;
  }

  start(): void {
    if (!this.recognition) {
      this.config.onError('Speech recognition not supported');
      return;
    }

    if (this.isListening) {
      return;
    }

    try {
      this.recognition.start();
    } catch (err) {
      // Already started, ignore
    }
  }

  stop(): void {
    if (!this.recognition || !this.isListening) {
      return;
    }

    try {
      this.recognition.stop();
    } catch (err) {
      // Already stopped, ignore
    }
  }

  abort(): void {
    if (!this.recognition) {
      return;
    }

    try {
      this.recognition.abort();
    } catch (err) {
      // Already aborted, ignore
    }
  }

  getIsListening(): boolean {
    return this.isListening;
  }

  private getErrorMessage(error: string): string {
    const errorMessages: Record<string, string> = {
      'network': 'Network error occurred',
      'audio': 'Audio input error',
      'not-allowed': 'Microphone permission denied',
      'no-speech': 'No speech detected',
      'service-not-allowed': 'Speech recognition service not allowed',
      'timeout': 'Recording timeout',
    };

    return errorMessages[error] || `Voice recognition error: ${error}`;
  }
}

declare global {
  interface Window {
    SpeechRecognition?: any;
    webkitSpeechRecognition?: any;
  }

  interface SpeechRecognition {}
}
