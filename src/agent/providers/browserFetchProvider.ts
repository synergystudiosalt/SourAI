import { normalizeError, SourError, cancelled } from '../../contracts/errors';
import { redactString, registerSecret, unregisterSecret } from '../../security/redaction';
import type {
  AgentProvider,
  BrowserProviderSupport,
  ProviderDescriptor,
  ProviderRequest,
  ProviderRunOptions,
  ProviderStreamEvent,
  ProviderToolCall,
} from './types';
import { providerId } from './types';

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
const MAX_STREAM_BYTES = 16 * 1024 * 1024;
const MAX_FRAME_BYTES = 256 * 1024;
const MAX_TOOL_CALLS = 64;
const MAX_TOOL_ARGUMENT_BYTES = 1024 * 1024;

export interface BrowserFetchProviderConfig {
  readonly id: string;
  readonly label: string;
  readonly endpoint: string;
  readonly models: readonly { id: string; label: string }[];
  readonly browserSupport: BrowserProviderSupport;
  readonly fetch?: FetchLike;
  readonly credentialHeader?: string;
}

/**
 * OpenAI-compatible SSE adapter for endpoints whose vendor explicitly supports
 * browser CORS. Unknown/unsupported endpoints fail closed before any request.
 */
export function createBrowserFetchProvider(config: BrowserFetchProviderConfig): AgentProvider {
  const endpoint = validateEndpoint(config.endpoint);
  const fetchImpl = config.fetch ?? globalThis.fetch.bind(globalThis);
  const descriptor: ProviderDescriptor = Object.freeze({
    id: providerId(config.id),
    label: config.label,
    capabilities: Object.freeze({
      streaming: true,
      structuredToolCalls: true,
      cancellation: true,
      usage: true,
      localExecution: false,
      browser: Object.freeze(config.browserSupport),
    }),
    models: Object.freeze(config.models.map((model) => Object.freeze({ ...model }))),
    endpointHost: new URL(endpoint).host,
  });

  return {
    descriptor,
    async *stream(request: ProviderRequest, options: ProviderRunOptions) {
      if (config.browserSupport.state !== 'supported') {
        throw new SourError({
          code: 'provider_browser_unsupported',
          message: `${config.label} cannot be called directly from this browser.`,
          causeCategory: 'unsupported',
          retryable: false,
          userAction:
            config.browserSupport.state === 'unsupported'
              ? config.browserSupport.reason
              : 'Browser CORS support has not been verified for this provider.',
        });
      }
      if (options.signal.aborted) throw cancelled('Provider request');
      if (!options.credential) {
        throw new SourError({
          code: 'provider_credential_missing',
          message: `${config.label} needs a session credential.`,
          causeCategory: 'provider',
          retryable: false,
        });
      }

      registerSecret(options.credential);
      try {
        const response = await fetchImpl(endpoint, {
          method: 'POST',
          redirect: 'error',
          signal: options.signal,
          headers: {
            'content-type': 'application/json',
            [config.credentialHeader ?? 'authorization']: `Bearer ${options.credential}`,
          },
          body: JSON.stringify(toWireRequest(request)),
        });
        if (!response.ok) {
          const raw = await boundedResponseText(response, 8_192);
          throw new SourError({
            code: `provider_http_${response.status}`,
            message: raw || `${config.label} returned HTTP ${response.status}.`,
            causeCategory: 'provider',
            retryable: response.status === 408 || response.status === 429 || response.status >= 500,
            details: { status: response.status },
          });
        }
        if (!response.body) {
          throw new SourError({
            code: 'provider_stream_missing',
            message: `${config.label} returned no response stream.`,
            causeCategory: 'provider',
            retryable: true,
          });
        }

        yield* parseOpenAiSse(response.body, options.signal);
      } catch (error) {
        if (options.signal.aborted) throw cancelled('Provider stream');
        throw normalizeError(error, {
          code: 'provider_request_failed',
          message: `${config.label} request failed.`,
          causeCategory: 'provider',
        });
      } finally {
        unregisterSecret(options.credential);
      }
    },
  };
}

function validateEndpoint(value: string): string {
  const url = new URL(value);
  const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
  if (url.protocol !== 'https:' && !(local && url.protocol === 'http:')) {
    throw new TypeError('Browser provider endpoints must use HTTPS.');
  }
  if (url.username || url.password) throw new TypeError('Provider endpoints cannot contain credentials.');
  return url.toString();
}

function toWireRequest(request: ProviderRequest): Record<string, unknown> {
  return {
    model: request.model,
    messages: request.messages,
    stream: true,
    ...(request.maxOutputTokens === undefined ? {} : { max_tokens: request.maxOutputTokens }),
    ...(request.temperature === undefined ? {} : { temperature: request.temperature }),
    ...(request.tools?.length
      ? {
          tools: request.tools.map((tool) => ({
            type: 'function',
            function: {
              name: tool.name,
              description: tool.description,
              parameters: tool.inputSchema,
            },
          })),
        }
      : {}),
  };
}

async function* parseOpenAiSse(
  stream: ReadableStream<Uint8Array>,
  signal: AbortSignal
): AsyncIterable<ProviderStreamEvent> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let receivedBytes = 0;
  const calls = new Map<number, { id: string; name: string; argumentsText: string }>();
  try {
    while (true) {
      if (signal.aborted) throw cancelled('Provider stream');
      const { done, value } = await reader.read();
      if (done) break;
      receivedBytes += value.byteLength;
      if (receivedBytes > MAX_STREAM_BYTES) {
        throw streamLimitError('The provider response exceeded the streaming byte limit.');
      }
      buffer += decoder.decode(value, { stream: true });
      if (new TextEncoder().encode(buffer).byteLength > MAX_FRAME_BYTES) {
        throw streamLimitError('The provider returned an oversized streaming frame.');
      }
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        if (new TextEncoder().encode(line).byteLength > MAX_FRAME_BYTES) {
          throw streamLimitError('The provider returned an oversized streaming frame.');
        }
        if (!line.startsWith('data:')) continue;
        const data = line.slice(5).trim();
        if (!data || data === '[DONE]') continue;
        const parsed = parseChunk(data);
        for (const event of chunkEvents(parsed, calls)) yield event;
      }
    }
    if (buffer.trim().startsWith('data:')) {
      const data = buffer.trim().slice(5).trim();
      if (data && data !== '[DONE]') {
        for (const event of chunkEvents(parseChunk(data), calls)) yield event;
      }
    }
    for (const call of calls.values()) yield { type: 'tool_call', call: finalizeToolCall(call) };
    yield { type: 'completed', finishReason: calls.size ? 'tool_calls' : 'stop' };
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  } finally {
    reader.releaseLock();
  }
}

type WireChunk = {
  choices?: Array<{
    delta?: {
      content?: unknown;
      tool_calls?: Array<{
        index?: unknown;
        id?: unknown;
        function?: { name?: unknown; arguments?: unknown };
      }>;
    };
  }>;
  usage?: { prompt_tokens?: unknown; completion_tokens?: unknown; total_tokens?: unknown };
};

function parseChunk(data: string): WireChunk {
  try {
    const value: unknown = JSON.parse(data);
    if (!value || typeof value !== 'object') throw new Error('not an object');
    return value as WireChunk;
  } catch (cause) {
    throw new SourError({
      code: 'provider_stream_invalid_json',
      message: 'The provider returned an invalid stream frame.',
      causeCategory: 'provider',
      retryable: false,
      cause,
    });
  }
}

function chunkEvents(
  chunk: WireChunk,
  calls: Map<number, { id: string; name: string; argumentsText: string }>
): ProviderStreamEvent[] {
  const events: ProviderStreamEvent[] = [];
  const delta = chunk.choices?.[0]?.delta;
  if (typeof delta?.content === 'string' && delta.content) {
    events.push({ type: 'text_delta', text: redactString(delta.content) });
  }
  for (const raw of delta?.tool_calls ?? []) {
    const index = typeof raw.index === 'number' && Number.isSafeInteger(raw.index) ? raw.index : 0;
    const current = calls.get(index) ?? { id: '', name: '', argumentsText: '' };
    if (!calls.has(index) && calls.size >= MAX_TOOL_CALLS) {
      throw streamLimitError('The provider returned too many tool calls.');
    }
    if (typeof raw.id === 'string') current.id = raw.id;
    if (typeof raw.function?.name === 'string') current.name += raw.function.name;
    if (typeof raw.function?.arguments === 'string') {
      current.argumentsText += redactString(raw.function.arguments);
      if (new TextEncoder().encode(current.argumentsText).byteLength > MAX_TOOL_ARGUMENT_BYTES) {
        throw streamLimitError('The provider returned oversized tool arguments.');
      }
    }
    calls.set(index, current);
  }
  if (chunk.usage) {
    events.push({
      type: 'usage',
      usage: {
        inputTokens: finiteNumber(chunk.usage.prompt_tokens),
        outputTokens: finiteNumber(chunk.usage.completion_tokens),
        totalTokens: finiteNumber(chunk.usage.total_tokens),
      },
    });
  }
  return events;
}

function streamLimitError(message: string): SourError {
  return new SourError({
    code: 'provider_stream_limit_exceeded',
    message,
    causeCategory: 'provider',
    retryable: false,
  });
}

function finalizeToolCall(call: { id: string; name: string; argumentsText: string }): ProviderToolCall {
  if (!call.id || !call.name || call.argumentsText.length > 1_000_000) {
    throw new SourError({
      code: 'provider_tool_call_invalid',
      message: 'The provider returned an invalid tool call.',
      causeCategory: 'validation',
      retryable: false,
    });
  }
  let args: unknown;
  try {
    args = JSON.parse(call.argumentsText || '{}');
  } catch (cause) {
    throw new SourError({
      code: 'provider_tool_arguments_invalid',
      message: 'The provider returned malformed tool arguments.',
      causeCategory: 'validation',
      retryable: false,
      cause,
    });
  }
  return { id: call.id, name: call.name, arguments: args };
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;
}

async function boundedResponseText(response: Response, maxBytes: number): Promise<string> {
  if (!response.body) return '';
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytesRead = 0;
  let output = '';
  try {
    while (bytesRead < maxBytes) {
      const { done, value } = await reader.read();
      if (done) break;
      const remaining = maxBytes - bytesRead;
      const slice = value.subarray(0, remaining);
      bytesRead += slice.byteLength;
      output += decoder.decode(slice, { stream: bytesRead < maxBytes });
      if (value.byteLength > remaining) break;
    }
    return output;
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}
