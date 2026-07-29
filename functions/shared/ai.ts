import { redactString } from '../../src/security/redaction';

function parseKeyList(raw: string | undefined): string[] {
  return [...new Set(
    (raw || '')
      .split(',')
      .map((k) => k.trim())
      .filter(Boolean)
  )];
}

export function getApiKeys(env: Record<string, string>) {
  const geminiKeys = parseKeyList(env.GEMINI_API_KEYS || env.GEMINI_API_KEY);
  const groqKeys = parseKeyList(env.GROQ_API_KEYS || env.GROQ_API_KEY);
  const cerebrasKeys = parseKeyList(env.CEREBRAS_API_KEYS || env.CEREBRAS_API_KEY);
  const mistralKeys = parseKeyList(env.MISTRAL_API_KEYS || env.MISTRAL_API_KEY);
  return { geminiKeys, groqKeys, cerebrasKeys, mistralKeys };
}

/**
 * Round-robin key picker, starting from a random offset.
 *
 * The starting offset is the important part. Pages runs each request in a
 * Worker isolate and module state is per-isolate, so a cold isolate starts
 * this counter from scratch. Starting at a fixed 0 meant every new isolate
 * began at `keys[0]`; under the many short-lived isolates Pages actually
 * creates, the first key absorbed nearly all the traffic and the rest of the
 * list was barely touched. A long key list then behaves like a list of one,
 * and rate limits appear immediately no matter how many keys are configured.
 */
export function createKeyPicker(): (keys: string[]) => string | null {
  let cursor: number | null = null;
  return (keys: string[]): string | null => {
    if (keys.length === 0) return null;
    // Drawn against the real key count on first use. Seeding from a large
    // constant instead would reintroduce modulo bias: any fixed multiplier
    // sharing factors with the list length collapses many seeds onto the
    // same starting key.
    if (cursor === null) cursor = Math.floor(Math.random() * keys.length);
    const key = keys[cursor % keys.length];
    cursor++;
    return key;
  };
}

export const takeGeminiKey = createKeyPicker();
export const takeGroqKey = createKeyPicker();
export const takeCerebrasKey = createKeyPicker();
export const takeMistralKey = createKeyPicker();

export type Provider = 'gemini' | 'groq' | 'cerebras' | 'mistral';

/**
 * Per-request generation knobs. Every field is optional so existing callers
 * (e.g. /api/chat) keep their previous behaviour when they pass nothing.
 */
export interface GenerationTuning {
  readonly temperature?: number;
  readonly maxOutputTokens?: number;
  /** Applied only to models whose route declares `openai_effort`. */
  readonly openAiEffort?: 'low' | 'medium' | 'high';
  /** Applied only to models whose route declares `gemini_thinking`. */
  readonly thinkingBudget?: number;
}

/**
 * Which provider-side reasoning control a model accepts. Sending the wrong one
 * is a 400, so this is opt-in per route rather than assumed.
 */
export type ReasoningControl = 'openai_effort' | 'gemini_thinking' | null;

// ─── Failover ──────────────────────────────────────────────────────────────

/** Rate limits and transient upstream faults deserve another key. */
const RETRYABLE_STATUSES = new Set([408, 409, 425, 429, 500, 502, 503, 504]);
/** A rejected or exhausted key — a different one may well work. */
const KEY_SPECIFIC_STATUSES = new Set([401, 403]);

export class ProviderHttpError extends Error {
  constructor(
    readonly status: number,
    readonly body: string,
    readonly retryAfterMs?: number
  ) {
    super(`HTTP ${status}: ${body.slice(0, 300)}`);
    this.name = 'ProviderHttpError';
  }

  get retryable(): boolean {
    return RETRYABLE_STATUSES.has(this.status) || KEY_SPECIFIC_STATUSES.has(this.status);
  }
}

export interface ProviderFailureDetails {
  readonly code: 'agent_provider_failed';
  readonly provider: Provider;
  readonly model: string;
  readonly status?: number;
  readonly providerMessage: string;
  /** One-based position in the configured provider key list. */
  readonly keyIndex?: number;
  readonly keyCount: number;
  readonly keysTried: number;
  readonly keyBudget: number;
  readonly attempts: number;
  readonly message: string;
}

const PROVIDER_LABELS: Record<Provider, string> = {
  gemini: 'Gemini',
  groq: 'Groq',
  cerebras: 'Cerebras',
  mistral: 'Mistral',
};

function replaceKnownSecrets(value: string, secrets: readonly string[]): string {
  let safe = value;
  for (const secret of [...new Set(secrets)].sort((a, b) => b.length - a.length)) {
    if (secret) safe = safe.split(secret).join('[redacted]');
  }
  return redactString(safe);
}

function extractProviderMessage(raw: string, secrets: readonly string[]): string {
  let message = raw;
  try {
    const parsed = JSON.parse(raw);
    const candidate =
      parsed?.error?.message ??
      parsed?.error?.error?.message ??
      parsed?.message ??
      parsed?.error;
    if (typeof candidate === 'string') message = candidate;
    else if (candidate) message = JSON.stringify(candidate);
  } catch {
    // Plain-text provider bodies are already the useful message.
  }
  const normalized = replaceKnownSecrets(message, secrets).replace(/\s+/g, ' ').trim();
  return (normalized || 'The provider returned an empty error response.').slice(0, 600);
}

function providerMessageFromError(err: unknown, secrets: readonly string[]): string {
  if (err instanceof ProviderHttpError) return extractProviderMessage(err.body, secrets);
  if (err instanceof Error) return extractProviderMessage(err.message, secrets);
  return extractProviderMessage(String(err || 'Unknown provider error'), secrets);
}

function formatProviderFailure(
  details: Omit<ProviderFailureDetails, 'code' | 'message'>
): string {
  const http = details.status ? ` HTTP ${details.status}` : '';
  const key = details.keyIndex
    ? ` — key ${details.keyIndex}/${details.keyCount};`
    : ' —';
  const attempts = `${details.attempts} attempt${details.attempts === 1 ? '' : 's'}`;
  return `${PROVIDER_LABELS[details.provider]} (${details.model})${http}: ${details.providerMessage}${key} tried ${details.keysTried}/${details.keyBudget} keys, ${attempts}`;
}

export class AgentProviderError extends Error {
  readonly details: ProviderFailureDetails;
  readonly failures: readonly ProviderFailureDetails[];

  constructor(
    details: Omit<ProviderFailureDetails, 'code' | 'message'>,
    failures?: readonly ProviderFailureDetails[]
  ) {
    const complete: ProviderFailureDetails = {
      ...details,
      code: 'agent_provider_failed',
      message: formatProviderFailure(details),
    };
    super(complete.message);
    this.name = 'AgentProviderError';
    this.details = complete;
    this.failures = failures?.length ? failures : [complete];
  }
}

function chainProviderErrors(
  finalError: unknown,
  earlierErrors: readonly unknown[]
): unknown {
  if (!(finalError instanceof AgentProviderError)) return finalError;
  const failures = [
    ...earlierErrors.flatMap((error) =>
      error instanceof AgentProviderError ? [...error.failures] : []
    ),
    ...finalError.failures,
  ];
  return new AgentProviderError(finalError.details, failures);
}

export interface SerializedAiError {
  readonly code: string;
  readonly message: string;
  readonly provider?: Provider;
  readonly model?: string;
  readonly status?: number;
  readonly providerMessage?: string;
  readonly keyIndex?: number;
  readonly keyCount?: number;
  readonly keysTried?: number;
  readonly keyBudget?: number;
  readonly attempts?: number;
  readonly failures?: readonly ProviderFailureDetails[];
}

/** Safe for logs and API responses: contains key positions, never key values. */
export function serializeAiError(
  err: unknown,
  configuredKeys: readonly string[] = []
): SerializedAiError {
  if (err instanceof AgentProviderError) {
    return { ...err.details, failures: err.failures };
  }
  const raw = err instanceof Error ? err.message : String(err || 'Internal server error');
  return {
    code: 'agent_request_failed',
    message: extractProviderMessage(raw, configuredKeys),
  };
}

export function parseRetryAfter(header: string | null): number | undefined {
  if (!header) return undefined;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const at = Date.parse(header);
  return Number.isNaN(at) ? undefined : Math.max(0, at - Date.now());
}

async function httpError(res: Response, secrets: readonly string[]): Promise<ProviderHttpError> {
  const body = extractProviderMessage(await res.text().catch(() => ''), secrets);
  return new ProviderHttpError(res.status, body, parseRetryAfter(res.headers.get('retry-after')));
}

/** Network faults surface as TypeError rather than a status; those retry too. */
export function isRetryableError(err: unknown): boolean {
  return err instanceof ProviderHttpError ? err.retryable : true;
}

/** Waiting stalls the user's response, so cap it hard and prefer rotating keys. */
const MAX_BACKOFF_MS = 4000;
/** How many times to cycle the tried keys before giving up. */
const FAILOVER_ROUNDS = 2;

/**
 * Upper bound on keys tried for a single request, regardless of how many are
 * configured.
 *
 * The budget used to be `keys.length * FAILOVER_ROUNDS`, so a 37-key list meant
 * 74 sequential provider calls for one request — far past the Worker's
 * wall-clock budget, so a bad request timed out with no error rather than
 * failing cleanly. It also fires 37 calls with no delay between them, which is
 * itself reported back as too many requests.
 *
 * Exhausting this is not the end of the road: generateText/streamText then fall
 * through to a different provider entirely, which is worth more than trying
 * another thirty keys on the one that is already refusing.
 */
const MAX_KEYS_PER_REQUEST = 8;

function attemptBudget(keyCount: number): { perRound: number; total: number } {
  const perRound = Math.max(1, Math.min(keyCount, MAX_KEYS_PER_REQUEST));
  return { perRound, total: perRound * FAILOVER_ROUNDS };
}

interface KeySelection {
  readonly key: string;
  /** Zero-based position in the de-duplicated configured list. */
  readonly index: number;
  readonly total: number;
}

/**
 * Stable per-request key subset. Retry rounds cycle this same subset instead of
 * silently expanding an eight-key budget into sixteen different credentials.
 */
class KeyAttemptState {
  private readonly keys: string[];
  private readonly plan: KeySelection[];
  private readonly disabled = new Set<number>();
  private readonly tried = new Set<number>();
  private cursor = 0;
  private failures = 0;
  attempts = 0;

  constructor(keys: string[], takeKey: (keys: string[]) => string | null) {
    this.keys = [...new Set(keys)];
    const { perRound } = attemptBudget(this.keys.length);
    this.plan = [];
    for (let i = 0; i < perRound && this.keys.length > 0; i++) {
      const key = takeKey(this.keys);
      if (!key) break;
      const index = this.keys.indexOf(key);
      if (index >= 0 && !this.plan.some((choice) => choice.index === index)) {
        this.plan.push({ key, index, total: this.keys.length });
      }
    }
  }

  get keyBudget(): number {
    return this.plan.length;
  }

  get keysTried(): number {
    return this.tried.size;
  }

  next(): KeySelection | null {
    if (this.plan.length === 0 || this.disabled.size >= this.plan.length) return null;
    for (let scanned = 0; scanned < this.plan.length; scanned++) {
      const choice = this.plan[this.cursor % this.plan.length];
      this.cursor++;
      if (!this.disabled.has(choice.index)) return choice;
    }
    return null;
  }

  begin(choice: KeySelection): void {
    this.attempts++;
    this.tried.add(choice.index);
  }

  reject(err: unknown, choice: KeySelection): void {
    this.failures++;
    if (err instanceof ProviderHttpError && KEY_SPECIFIC_STATUSES.has(err.status)) {
      this.disabled.add(choice.index);
    }
  }

  canRetry(): boolean {
    return (
      this.failures < this.plan.length * FAILOVER_ROUNDS &&
      this.disabled.size < this.plan.length
    );
  }

  roundComplete(): boolean {
    return this.plan.length > 0 && this.failures % this.plan.length === 0;
  }

  safeMessage(err: unknown): string {
    return providerMessageFromError(err, this.keys);
  }

  failure(
    provider: Provider,
    model: string,
    err: unknown,
    choice?: KeySelection
  ): AgentProviderError {
    return new AgentProviderError({
      provider,
      model,
      status: err instanceof ProviderHttpError ? err.status : undefined,
      providerMessage: this.safeMessage(err),
      keyIndex: choice ? choice.index + 1 : undefined,
      keyCount: this.keys.length,
      keysTried: this.keysTried,
      keyBudget: this.keyBudget,
      attempts: this.attempts,
    });
  }
}
/**
 * Extra rounds allowed purely for resuming past the output cap. Whole-file
 * code generation routinely exceeds it, and the provider reports that as a
 * clean finish rather than an error, so without this the reply just stops
 * mid-token with nothing to signal why.
 */
const MAX_OUTPUT_CONTINUATIONS = 3;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Only pauses once every key has been tried this round — switching keys is
 * instant and is the whole point of holding several.
 */
async function pauseBeforeRetry(err: unknown, roundComplete: boolean): Promise<void> {
  if (!roundComplete) return;
  const suggested = err instanceof ProviderHttpError ? err.retryAfterMs : undefined;
  await sleep(Math.min(suggested ?? 700, MAX_BACKOFF_MS));
}

const CONTINUATION_INSTRUCTION =
  'Your previous reply was cut off mid-sentence by a provider rate limit. This is exactly what you had already sent to the user:';
const CONTINUATION_RULES =
  'Continue from precisely where it stopped. Do not repeat any of it, do not restate the question, and do not apologise — emit only the remaining output, so the two halves join seamlessly. ' +
  'Emit no <thinking>, <think> or <check_for_errors> tag and no commentary of any kind: your very next character is appended directly onto the cut-off text, so anything else lands in the middle of the file you were writing.';

/**
 * Rebuilds the request so a stream cut off by a rate limit can be *finished*
 * on another key instead of restarting. Restarting would re-emit text the
 * client has already appended, so the user would see it twice.
 *
 * Sent as a user turn rather than an assistant prefill because a trailing
 * assistant message is not accepted by every provider.
 */
export function withContinuation(
  messages: { role: string; content: string }[],
  partial: string
): { role: string; content: string }[] {
  return [
    ...messages,
    { role: 'user', content: `${CONTINUATION_INSTRUCTION}\n\n${partial}\n\n${CONTINUATION_RULES}` },
  ];
}

/**
 * How a model resumes an interrupted answer.
 * - `openai`  trailing assistant turn (OpenAI-compatible)
 * - `mistral` trailing assistant turn flagged `prefix: true`
 * - `gemini`  trailing `model` turn
 * - `null`    no prefill; resume by written instruction instead
 */
export type PrefillMode = 'openai' | 'mistral' | 'gemini' | null;

/**
 * Prefer prefill: the model literally continues the text rather than being
 * asked to, so the halves join without it restating or apologising.
 */
export function continueChatMessages(
  messages: ChatMessage[],
  partial: string,
  mode: PrefillMode
): ChatMessage[] {
  if (mode === 'openai' || mode === 'mistral') {
    const assistant: ChatMessage = { role: 'assistant', content: partial };
    // Mistral requires the turn to be marked as a prefix, otherwise it
    // replies to it instead of continuing it.
    if (mode === 'mistral') assistant.prefix = true;
    return [...messages, assistant];
  }
  return withContinuation(messages, partial);
}

export function continueGeminiContents(contents: any, partial: string, mode: PrefillMode): any {
  if (mode === 'gemini') {
    const base = Array.isArray(contents) ? contents : [];
    return [...base, { role: 'model', parts: [{ text: partial }] }];
  }
  return withGeminiContinuation(contents, partial);
}

export function withGeminiContinuation(contents: any, partial: string): any {
  const base = Array.isArray(contents) ? contents : [];
  return [
    ...base,
    {
      role: 'user',
      parts: [{ text: `${CONTINUATION_INSTRUCTION}\n\n${partial}\n\n${CONTINUATION_RULES}` }],
    },
  ];
}

/** How much of a resumed stream to inspect before letting it through. */
const RESUME_SCAN_CHARS = 1200;

/**
 * A status tag emitted at the head of a resumed stream. The splice happens
 * mid-token, so anything the model says before continuing is written straight
 * into the middle of the file it was generating.
 */
const RESUME_PREAMBLE_RE = /^\s*<(thinking|think|check_for_errors)>[\s\S]*?<\/\1>\s*/i;

export function stripResumePreamble(text: string): string {
  let out = text;
  let previous = '';
  while (out !== previous) {
    previous = out;
    out = out.replace(RESUME_PREAMBLE_RE, '');
  }
  return out;
}

/** Longest suffix of what was sent that the continuation repeats as a prefix. */
export function seamOverlap(sent: string, next: string): number {
  const max = Math.min(sent.length, next.length, RESUME_SCAN_CHARS);
  for (let k = max; k > 0; k--) {
    if (sent.endsWith(next.slice(0, k))) return k;
  }
  return 0;
}

/**
 * True when a resume began the answer over instead of continuing it.
 *
 * Not every provider honours a prefill turn, and one that doesn't replies to
 * it — restating the whole answer. Splicing that is hopeless, because sampling
 * means the retelling never matches token for token, so the caller would
 * receive the opening several times over.
 */
export function looksLikeRestart(sent: string, next: string): boolean {
  const probe = Math.min(200, sent.length, next.length);
  return probe >= 80 && next.slice(0, probe) === sent.slice(0, probe);
}

/**
 * Gates a resumed stream: holds the opening back, decides whether the model
 * continued or started over, and de-duplicates the seam before anything
 * reaches the caller. A first attempt passes straight through.
 */
class ResumeGate {
  private pending = '';
  private open: boolean;
  restarted = false;

  constructor(private readonly alreadySent: string) {
    this.open = alreadySent.length === 0;
  }

  /** Returns text to emit, or '' while still deciding. */
  push(token: string): string {
    if (this.open) return token;
    this.pending += token;
    return this.pending.length >= RESUME_SCAN_CHARS ? this.flush() : '';
  }

  /** Releases whatever is still held once the stream ends. */
  flush(): string {
    if (this.open) return '';
    this.open = true;
    // Strip any status tag before the restart check, so a preamble does not
    // hide the fact that the model began the answer again.
    const buffered = stripResumePreamble(this.pending);
    this.pending = '';
    if (looksLikeRestart(this.alreadySent, buffered)) {
      this.restarted = true;
      return '';
    }
    return buffered.slice(seamOverlap(this.alreadySent, buffered));
  }
}

/** Providers report mid-stream faults as an error object inside the SSE body. */
function streamPayloadError(parsed: any, secrets: readonly string[]): ProviderHttpError | null {
  const error = parsed?.error;
  if (!error) return null;
  const status = Number(error.status ?? error.code);
  return new ProviderHttpError(
    Number.isFinite(status) && status >= 400 ? status : 503,
    extractProviderMessage(
      typeof error.message === 'string' ? error.message : JSON.stringify(error),
      secrets
    )
  );
}

function buildGeminiGenerationConfig(
  tuning: GenerationTuning | undefined,
  reasoning: ReasoningControl
): Record<string, unknown> {
  const config: Record<string, unknown> = { temperature: tuning?.temperature ?? 0.3 };
  if (tuning?.maxOutputTokens) config.maxOutputTokens = tuning.maxOutputTokens;
  if (reasoning === 'gemini_thinking' && typeof tuning?.thinkingBudget === 'number') {
    config.thinkingConfig = { thinkingBudget: tuning.thinkingBudget };
  }
  return config;
}

export async function generateWithGemini(
  keys: string[],
  contents: any,
  systemInstruction: string,
  model: string,
  tuning?: GenerationTuning,
  reasoning: ReasoningControl = null
): Promise<string> {
  const state = new KeyAttemptState(keys, takeGeminiKey);
  let lastErr: unknown = new Error('No Gemini API keys configured');
  let lastChoice: KeySelection | undefined;

  while (true) {
    const choice = state.next();
    if (!choice) throw state.failure('gemini', model, lastErr, lastChoice);
    lastChoice = choice;
    state.begin(choice);
    try {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(choice.key)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents,
            systemInstruction: { parts: [{ text: systemInstruction }] },
            generationConfig: buildGeminiGenerationConfig(tuning, reasoning),
          }),
        }
      );
      if (!response.ok) throw await httpError(response, keys);
      const data: any = await response.json().catch(() => ({}));
      if (data?.candidates?.[0]?.finishReason === 'MAX_TOKENS') {
        throw new ProviderHttpError(502, 'The model reached its output limit before completing the response.');
      }
      const text = data?.candidates?.[0]?.content?.parts
        ?.map((part: any) => part?.text || '')
        .join('')
        .trim();
      if (!text) throw new Error('Gemini returned no text content');
      return text;
    } catch (err: unknown) {
      lastErr = err;
      state.reject(err, choice);
      const failure = state.failure('gemini', model, err, choice);
      console.warn(failure.message);
      if (!isRetryableError(err) || !state.canRetry()) throw failure;
      await pauseBeforeRetry(err, state.roundComplete());
    }
  }
}

export interface ChatMessage {
  role: string;
  content: string;
  /** Mistral: marks a trailing assistant turn as text to continue, not answer. */
  prefix?: boolean;
}

export function buildOpenAICompatibleBody(
  model: string,
  messages: ChatMessage[],
  systemInstruction: string,
  tuning: GenerationTuning | undefined,
  reasoning: ReasoningControl,
  extra?: Record<string, unknown>
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model,
    messages: [
      { role: 'system', content: systemInstruction },
      ...messages.map((m) => {
        const mapped: Record<string, unknown> = {
          role: m.role === 'assistant' ? 'assistant' : 'user',
          content: m.content || '',
        };
        // This mapping rebuilds each message, so the prefix flag has to be
        // carried across explicitly or Mistral silently loses it.
        if (m.prefix) mapped.prefix = true;
        return mapped;
      }),
    ],
    ...extra,
  };
  if (typeof tuning?.temperature === 'number') body.temperature = tuning.temperature;
  if (tuning?.maxOutputTokens) body.max_tokens = tuning.maxOutputTokens;
  if (reasoning === 'openai_effort' && tuning?.openAiEffort) {
    body.reasoning_effort = tuning.openAiEffort;
  }
  return body;
}

/**
 * POSTs a chat completion, and if the provider rejects the request with a 400
 * while we were sending `reasoning_effort`, retries once without it. Provider
 * support for that field varies per model and changes over time; degrading to
 * a normal completion beats failing the user's request outright.
 */
async function postChatCompletion(
  baseUrl: string,
  key: string,
  body: Record<string, unknown>
): Promise<Response> {
  const send = (payload: Record<string, unknown>) =>
    fetch(`${baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify(payload),
    });

  const res = await send(body);
  if (res.status === 400 && 'reasoning_effort' in body) {
    const { reasoning_effort: _dropped, ...withoutReasoning } = body;
    console.warn(`${baseUrl} rejected reasoning_effort for ${body.model}; retrying without it.`);
    return send(withoutReasoning);
  }
  return res;
}

async function generateWithOpenAICompatible(
  provider: Exclude<Provider, 'gemini'>,
  baseUrl: string,
  keys: string[],
  takeKey: (keys: string[]) => string | null,
  messages: { role: string; content: string }[],
  systemInstruction: string,
  model: string,
  tuning?: GenerationTuning,
  reasoning: ReasoningControl = null
): Promise<string> {
  const state = new KeyAttemptState(keys, takeKey);
  const body = buildOpenAICompatibleBody(model, messages, systemInstruction, tuning, reasoning);
  let lastErr: unknown = new Error(`No API keys configured for ${PROVIDER_LABELS[provider]}`);
  let lastChoice: KeySelection | undefined;

  while (true) {
    const choice = state.next();
    if (!choice) throw state.failure(provider, model, lastErr, lastChoice);
    lastChoice = choice;
    state.begin(choice);
    try {
      const res = await postChatCompletion(baseUrl, choice.key, body);
      if (!res.ok) throw await httpError(res, keys);
      const data: any = await res.json();
      if (data?.choices?.[0]?.finish_reason === 'length') {
        throw new ProviderHttpError(502, 'The model reached its output limit before completing the response.');
      }
      return data?.choices?.[0]?.message?.content || '';
    } catch (err: unknown) {
      lastErr = err;
      state.reject(err, choice);
      const failure = state.failure(provider, model, err, choice);
      console.warn(failure.message);
      if (!isRetryableError(err) || !state.canRetry()) throw failure;
      await pauseBeforeRetry(err, state.roundComplete());
    }
  }
}

export async function generateWithGroq(
  keys: string[],
  messages: { role: string; content: string }[],
  systemInstruction: string,
  model: string = 'llama-3.3-70b-versatile',
  tuning?: GenerationTuning,
  reasoning: ReasoningControl = null
): Promise<string> {
  return generateWithOpenAICompatible('groq', 'https://api.groq.com/openai', keys, takeGroqKey, messages, systemInstruction, model, tuning, reasoning);
}

export async function generateWithCerebras(
  keys: string[],
  messages: { role: string; content: string }[],
  systemInstruction: string,
  model: string,
  tuning?: GenerationTuning,
  reasoning: ReasoningControl = null
): Promise<string> {
  return generateWithOpenAICompatible('cerebras', 'https://api.cerebras.ai', keys, takeCerebrasKey, messages, systemInstruction, model, tuning, reasoning);
}

export async function generateWithMistral(
  keys: string[],
  messages: { role: string; content: string }[],
  systemInstruction: string,
  model: string,
  tuning?: GenerationTuning,
  reasoning: ReasoningControl = null
): Promise<string> {
  return generateWithOpenAICompatible('mistral', 'https://api.mistral.ai', keys, takeMistralKey, messages, systemInstruction, model, tuning, reasoning);
}

export interface ModelRoute {
  /** User-facing product name. Keep UI labels sourced from this catalogue. */
  label?: string;
  provider: Provider;
  model: string;
  /**
   * Reasoning control this model accepts, if any. Left null where support is
   * unconfirmed — `postChatCompletion` degrades on 400, but not asking for a
   * knob we aren't sure exists avoids the wasted round trip.
   */
  reasoning?: ReasoningControl;
  /**
   * How this model resumes an interrupted answer. Prefill (continuing a
   * trailing assistant turn) is far more reliable than asking in prose, but
   * a model that doesn't support it would *answer* that turn instead of
   * continuing it — worse than the instruction fallback. So it is per-route.
   */
  prefill?: PrefillMode;
}

export const MODEL_ROUTES = {
  'sour-omni-flash': { label: 'Omni-Flash 3.0', provider: 'mistral', model: 'mistral-small-latest', reasoning: null, prefill: 'mistral' },
  'sour-intelligence': { label: 'Intelligence 3.0', provider: 'groq', model: 'qwen/qwen3.6-27b', reasoning: null, prefill: 'openai' },
  'sour-velocity': { label: 'Velocity 2.0', provider: 'cerebras', model: 'zai-glm-4.7', reasoning: null, prefill: 'openai' },
  // Neither Gemini route continues a trailing model turn, so both resume by
  // written instruction instead.
  'sour-lumen': { label: 'Lumen 1.5', provider: 'gemini', model: 'gemini-3.5-flash-lite', reasoning: 'gemini_thinking', prefill: null },
  'sour-overdrive': { label: 'Overdrive 4.0', provider: 'gemini', model: 'gemini-3.6-flash', reasoning: 'gemini_thinking', prefill: null },
} as const satisfies Record<string, ModelRoute>;

export type ModelId = keyof typeof MODEL_ROUTES;

/** Selectable IDs in catalogue order, from fastest/cheapest to most capable. */
export const MODEL_IDS: readonly ModelId[] = Object.freeze(Object.keys(MODEL_ROUTES) as ModelId[]);

export const LEGACY_MODEL_IDS = {
  'sour-overclock': 'sour-velocity',
  'sour-ultra': 'sour-lumen',
  'sour-overcode': 'sour-overdrive',
} as const satisfies Record<string, ModelId>;

export const DEFAULT_ROUTE: ModelRoute = MODEL_ROUTES['sour-omni-flash'];

/** Converts current or legacy persisted values to a selectable model ID. */
export function migrateModelId(model: unknown): ModelId | null {
  if (typeof model !== 'string') return null;
  const migrated = Object.prototype.hasOwnProperty.call(LEGACY_MODEL_IDS, model)
    ? LEGACY_MODEL_IDS[model as keyof typeof LEGACY_MODEL_IDS]
    : model;
  return Object.prototype.hasOwnProperty.call(MODEL_ROUTES, migrated)
    ? migrated as ModelId
    : null;
}

export function resolveModelRoute(model: unknown): ModelRoute {
  const modelId = migrateModelId(model);
  return modelId ? MODEL_ROUTES[modelId] : DEFAULT_ROUTE;
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
  tuning?: GenerationTuning;
}): Promise<string> {
  const { route, contents, plainMessages, systemInstruction, geminiKeys, groqKeys, cerebrasKeys = [], mistralKeys = [], tuning } = opts;
  const reasoning = route.reasoning ?? null;

  const tryProvider = async (): Promise<string> => {
    switch (route.provider) {
      case 'groq':
        return await generateWithGroq(groqKeys, plainMessages, systemInstruction, route.model, tuning, reasoning);
      case 'cerebras':
        return await generateWithCerebras(cerebrasKeys, plainMessages, systemInstruction, route.model, tuning, reasoning);
      case 'mistral':
        return await generateWithMistral(mistralKeys, plainMessages, systemInstruction, route.model, tuning, reasoning);
      case 'gemini':
      default:
        return await generateWithGemini(geminiKeys, contents, systemInstruction, route.model, tuning, reasoning);
    }
  };

  try {
    return await tryProvider();
  } catch (primaryErr) {
    console.warn(
      `Primary ${route.provider} model "${route.model}" exhausted; trying Gemini fallback.`,
      serializeAiError(primaryErr, [...geminiKeys, ...groqKeys, ...cerebrasKeys, ...mistralKeys]).message
    );
    try {
      // Fallback models have their own capabilities: keep temperature and the
      // output cap, but only ask for the reasoning knob the fallback supports.
      return await generateWithGemini(geminiKeys, contents, systemInstruction, 'gemini-3.5-flash-lite', tuning, 'gemini_thinking');
    } catch (fallbackErr) {
      console.warn(
        'Gemini fallback exhausted; trying Groq default.',
        serializeAiError(fallbackErr, [...geminiKeys, ...groqKeys]).message
      );
      try {
        return await generateWithGroq(groqKeys, plainMessages, systemInstruction, undefined, tuning, null);
      } catch (finalErr) {
        throw chainProviderErrors(finalErr, [primaryErr, fallbackErr]);
      }
    }
  }
}

// ─── Streaming variants ────────────────────────────────────────────────────

async function* streamWithOpenAICompatible(
  provider: Exclude<Provider, 'gemini'>,
  baseUrl: string,
  keys: string[],
  takeKey: (keys: string[]) => string | null,
  messages: ChatMessage[],
  systemInstruction: string,
  model: string,
  tuning?: GenerationTuning,
  reasoning: ReasoningControl = null,
  prefill: PrefillMode = null
): AsyncGenerator<string> {
  // Everything already handed to the caller. On a mid-stream rate limit we ask
  // the next key to continue from here rather than restarting, because the
  // client appends tokens and would otherwise render the opening twice.
  const state = new KeyAttemptState(keys, takeKey);
  let emitted = '';
  let continuations = 0;
  let lastErr: unknown = new Error(`No API keys configured for ${PROVIDER_LABELS[provider]}`);
  let lastChoice: KeySelection | undefined;

  while (true) {
    const choice = state.next();
    if (!choice) throw state.failure(provider, model, lastErr, lastChoice);
    lastChoice = choice;
    state.begin(choice);
    const body = buildOpenAICompatibleBody(
      model,
      emitted ? continueChatMessages(messages, emitted, prefill) : messages,
      systemInstruction,
      tuning,
      reasoning,
      { stream: true }
    );
    try {
      const res = await postChatCompletion(baseUrl, choice.key, body);
      if (!res.ok) throw await httpError(res, keys);
      const reader = res.body?.getReader();
      if (!reader) throw new Error('No response body');
      const decoder = new TextDecoder();
      const gate = new ResumeGate(emitted);
      let buffer = '';
      let hitOutputCap = false;
      let complete = false;
      let sawTerminalEvent = false;
      while (!complete) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith('data: ')) continue;
          const data = trimmed.slice(6);
          if (data === '[DONE]') {
            sawTerminalEvent = true;
            complete = true;
            break;
          }
          let parsed: any;
          try {
            parsed = JSON.parse(data);
          } catch {
            continue; // skip malformed lines
          }
          const payloadError = streamPayloadError(parsed, keys);
          if (payloadError) throw payloadError;
          const choice = parsed?.choices?.[0];
          // Running out of output budget is reported as a normal finish, so it
          // has to be detected rather than waited on as an error.
          if (choice?.finish_reason) sawTerminalEvent = true;
          if (choice?.finish_reason === 'length') hitOutputCap = true;
          const token = choice?.delta?.content;
          if (token) {
            const out = gate.push(token);
            if (out) {
              emitted += out;
              yield out;
            }
          }
        }
      }
      const tail = gate.flush();
      if (tail) {
        emitted += tail;
        yield tail;
      }
      if (!sawTerminalEvent) {
        throw new ProviderHttpError(502, 'The provider stream ended before signalling completion.');
      }
      if (gate.restarted) {
        // Deliver the partial rather than failing the request. The client drops
        // every file op when a fence is left unclosed, so a truncated answer
        // cannot be applied — and showing it beats replacing a near-complete
        // reply with a bare 502.
        console.warn(`${model} restarted instead of resuming; keeping the partial answer.`);
        return;
      }
      if (hitOutputCap && continuations < MAX_OUTPUT_CONTINUATIONS) {
        continuations++;
        console.warn(
          `${model} hit its output cap at ${emitted.length} chars; resuming (${continuations}/${MAX_OUTPUT_CONTINUATIONS}).`
        );
        continue;
      }
      if (hitOutputCap) {
        throw new ProviderHttpError(
          422,
          `${model} remained incomplete after ${MAX_OUTPUT_CONTINUATIONS} continuation attempts.`
        );
      }
      return;
    } catch (err: unknown) {
      lastErr = err;
      state.reject(err, choice);
      const failure = state.failure(provider, model, err, choice);
      const stage = emitted ? `after ${emitted.length} chars — continuing` : 'before any output';
      console.warn(`${failure.message} (${stage})`);
      if (!isRetryableError(err) || !state.canRetry()) throw failure;
      await pauseBeforeRetry(err, state.roundComplete());
    }
  }
}

async function* streamWithGemini(
  keys: string[],
  contents: any,
  systemInstruction: string,
  model: string,
  tuning?: GenerationTuning,
  reasoning: ReasoningControl = null,
  prefill: PrefillMode = null
): AsyncGenerator<string> {
  const state = new KeyAttemptState(keys, takeGeminiKey);
  let emitted = '';
  let continuations = 0;
  let lastErr: unknown = new Error('No Gemini API keys configured');
  let lastChoice: KeySelection | undefined;

  while (true) {
    const choice = state.next();
    if (!choice) throw state.failure('gemini', model, lastErr, lastChoice);
    lastChoice = choice;
    state.begin(choice);
    try {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse&key=${encodeURIComponent(choice.key)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: emitted ? continueGeminiContents(contents, emitted, prefill) : contents,
            systemInstruction: { parts: [{ text: systemInstruction }] },
            generationConfig: buildGeminiGenerationConfig(tuning, reasoning),
          }),
        }
      );
      if (!response.ok) throw await httpError(response, keys);
      const reader = response.body?.getReader();
      if (!reader) throw new Error('No response body');
      const decoder = new TextDecoder();
      const gate = new ResumeGate(emitted);
      let buffer = '';
      let hitOutputCap = false;
      let sawTerminalEvent = false;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith('data: ')) continue;
          let parsed: any;
          try {
            parsed = JSON.parse(trimmed.slice(6));
          } catch {
            continue; // skip malformed lines
          }
          const payloadError = streamPayloadError(parsed, keys);
          if (payloadError) throw payloadError;
          const candidate = parsed?.candidates?.[0];
          if (candidate?.finishReason) sawTerminalEvent = true;
          if (candidate?.finishReason === 'MAX_TOKENS') hitOutputCap = true;
          const token = candidate?.content?.parts?.[0]?.text;
          if (token) {
            const out = gate.push(token);
            if (out) {
              emitted += out;
              yield out;
            }
          }
        }
      }
      const tail = gate.flush();
      if (tail) {
        emitted += tail;
        yield tail;
      }
      if (!sawTerminalEvent) {
        throw new ProviderHttpError(502, 'The Gemini stream ended before signalling completion.');
      }
      if (gate.restarted) {
        // Deliver the partial rather than failing the request. The client drops
        // every file op when a fence is left unclosed, so a truncated answer
        // cannot be applied — and showing it beats replacing a near-complete
        // reply with a bare 502.
        console.warn(`${model} restarted instead of resuming; keeping the partial answer.`);
        return;
      }
      if (hitOutputCap && continuations < MAX_OUTPUT_CONTINUATIONS) {
        continuations++;
        console.warn(
          `${model} hit its output cap at ${emitted.length} chars; resuming (${continuations}/${MAX_OUTPUT_CONTINUATIONS}).`
        );
        continue;
      }
      if (hitOutputCap) {
        throw new ProviderHttpError(
          422,
          `${model} remained incomplete after ${MAX_OUTPUT_CONTINUATIONS} continuation attempts.`
        );
      }
      return;
    } catch (err: unknown) {
      lastErr = err;
      state.reject(err, choice);
      const failure = state.failure('gemini', model, err, choice);
      const stage = emitted ? `after ${emitted.length} chars — continuing` : 'before any output';
      console.warn(`${failure.message} (${stage})`);
      if (!isRetryableError(err) || !state.canRetry()) throw failure;
      await pauseBeforeRetry(err, state.roundComplete());
    }
  }
}

export async function* streamText(opts: {
  geminiKeys: string[];
  groqKeys: string[];
  cerebrasKeys?: string[];
  mistralKeys?: string[];
  contents: any;
  plainMessages: { role: string; content: string }[];
  systemInstruction: string;
  route: ModelRoute;
  tuning?: GenerationTuning;
}): AsyncGenerator<string> {
  const { route, contents, plainMessages, systemInstruction, geminiKeys, groqKeys, cerebrasKeys = [], mistralKeys = [], tuning } = opts;
  const reasoning = route.reasoning ?? null;
  const prefill = route.prefill ?? null;
  let emittedPrimaryOutput = false;

  try {
    let primary: AsyncGenerator<string>;
    switch (route.provider) {
      case 'groq':
        primary = streamWithOpenAICompatible('groq', 'https://api.groq.com/openai', groqKeys, takeGroqKey, plainMessages, systemInstruction, route.model, tuning, reasoning, prefill);
        break;
      case 'cerebras':
        primary = streamWithOpenAICompatible('cerebras', 'https://api.cerebras.ai', cerebrasKeys, takeCerebrasKey, plainMessages, systemInstruction, route.model, tuning, reasoning, prefill);
        break;
      case 'mistral':
        primary = streamWithOpenAICompatible('mistral', 'https://api.mistral.ai', mistralKeys, takeMistralKey, plainMessages, systemInstruction, route.model, tuning, reasoning, prefill);
        break;
      case 'gemini':
      default:
        primary = streamWithGemini(geminiKeys, contents, systemInstruction, route.model, tuning, reasoning, prefill);
        break;
    }
    for await (const token of primary) {
      emittedPrimaryOutput = true;
      yield token;
    }
    return;
  } catch (primaryErr) {
    // Once bytes have reached the browser, restarting on a different provider
    // would append a second answer to the first. Surface the interrupted run;
    // the client will not parse or apply it without the final `done` event.
    if (emittedPrimaryOutput) throw primaryErr;
    console.warn(
      `Primary ${route.provider} stream failed; trying Gemini fallback.`,
      serializeAiError(primaryErr, [...geminiKeys, ...groqKeys, ...cerebrasKeys, ...mistralKeys]).message
    );
    try {
      // The fallback's own capabilities, not the original route's: it takes
      // a thinking budget but no longer continues a trailing model turn.
      yield* streamWithGemini(geminiKeys, contents, systemInstruction, 'gemini-3.5-flash-lite', tuning, 'gemini_thinking', null);
    } catch (fallbackErr) {
      console.warn(
        'Gemini fallback exhausted; trying non-streaming Groq.',
        serializeAiError(fallbackErr, [...geminiKeys, ...groqKeys]).message
      );
      try {
        const text = await generateWithGroq(groqKeys, plainMessages, systemInstruction, undefined, tuning, null);
        yield text;
      } catch (finalErr) {
        throw chainProviderErrors(finalErr, [primaryErr, fallbackErr]);
      }
    }
  }
}
