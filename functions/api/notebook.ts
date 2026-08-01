import { generateText, resolveModelRoute, getApiKeys } from '../shared/ai';
import {
  buildNotebookChatPrompt,
  buildOverviewPrompt,
  buildSourceSummaryPrompt,
  buildStudioPrompt,
  isStudioKind,
  isStructuredStudioKind,
  packSources,
  parseJsonReply,
  renderSourceCorpus,
  type NotebookSourcePayload,
} from '../shared/notebookPrompts';
import { normalizeFlashcards, normalizeQuiz } from '../shared/studyContent';
import { fetchWebSource, WebSourceError } from '../shared/webSource';
import { splitThinkingAndText } from '../shared/responseFormatting';

interface NotebookRequestBody {
  action?: string;
  sources?: NotebookSourcePayload[];
  messages?: { role?: string; content?: string }[];
  model?: string;
  kind?: string;
  url?: string;
}

/** Carries an HTTP status out of a helper without unwinding through prose. */
class NotebookHttpError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message);
    this.name = 'NotebookHttpError';
  }
}

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

const MAX_TURNS = 24;

function normalizeTurns(messages: NotebookRequestBody['messages']): { role: string; content: string }[] {
  if (!Array.isArray(messages)) return [];
  return messages
    .filter((message) => message && typeof message.content === 'string' && message.content.trim())
    .map((message) => ({
      role: message!.role === 'assistant' ? 'assistant' : 'user',
      content: String(message!.content).slice(0, 20_000),
    }))
    .slice(-MAX_TURNS);
}

async function runNotebookModel(
  env: Record<string, string>,
  model: unknown,
  systemInstruction: string,
  turns: { role: string; content: string }[]
): Promise<string> {
  const { geminiKeys, groqKeys, cerebrasKeys, mistralKeys } = getApiKeys(env);
  if (
    geminiKeys.length === 0 &&
    groqKeys.length === 0 &&
    cerebrasKeys.length === 0 &&
    mistralKeys.length === 0
  ) {
    throw new NotebookHttpError(
      500,
      'No AI API keys are configured in Cloudflare Pages environment variables.'
    );
  }

  const contents = turns.map((turn) => ({
    role: turn.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: turn.content }],
  }));

  const raw =
    (await generateText({
      geminiKeys,
      groqKeys,
      cerebrasKeys,
      mistralKeys,
      contents,
      plainMessages: turns,
      systemInstruction,
      route: resolveModelRoute(model),
      // Grounded reading, not creative writing: a low temperature keeps the
      // answer close to the sources it has to cite.
      tuning: { temperature: 0.25 },
    })) || '';

  return splitThinkingAndText(raw).text.trim();
}

export const onRequest: PagesFunction = async (context) => {
  if (context.request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  let body: NotebookRequestBody;
  try {
    body = (await context.request.json()) as NotebookRequestBody;
  } catch {
    return json({ error: 'Request body must be JSON.' }, 400);
  }

  const env = context.env as Record<string, string>;
  const action = typeof body.action === 'string' ? body.action : 'chat';

  try {
    if (action === 'fetch_url') {
      const fetched = await fetchWebSource(String(body.url ?? ''));
      return json(fetched);
    }

    if (action === 'source_summary') {
      const packed = packSources(body.sources ?? [], 40_000);
      if (packed.length === 0) return json({ error: 'A source is required.' }, 400);
      const reply = await runNotebookModel(env, body.model, buildSourceSummaryPrompt(), [
        {
          role: 'user',
          content: `Summarise this document.\n\n${renderSourceCorpus(packed)}`,
        },
      ]);
      const parsed = parseJsonReply<{ summary?: unknown; topics?: unknown }>(reply);
      return json({
        summary:
          typeof parsed?.summary === 'string' && parsed.summary.trim()
            ? parsed.summary.trim()
            : reply,
        topics: Array.isArray(parsed?.topics)
          ? parsed!.topics.filter((topic): topic is string => typeof topic === 'string').slice(0, 6)
          : [],
      });
    }

    if (action === 'overview') {
      const packed = packSources(body.sources ?? []);
      if (packed.length === 0) return json({ error: 'At least one source is required.' }, 400);
      const reply = await runNotebookModel(env, body.model, buildOverviewPrompt(), [
        {
          role: 'user',
          content: `Introduce this notebook.\n\n${renderSourceCorpus(packed)}`,
        },
      ]);
      const parsed = parseJsonReply<{
        title?: unknown;
        summary?: unknown;
        topics?: unknown;
        questions?: unknown;
      }>(reply);
      const strings = (value: unknown, limit: number): string[] =>
        Array.isArray(value)
          ? value.filter((item): item is string => typeof item === 'string' && !!item.trim()).slice(0, limit)
          : [];
      return json({
        title: typeof parsed?.title === 'string' ? parsed.title.trim().slice(0, 80) : '',
        summary:
          typeof parsed?.summary === 'string' && parsed.summary.trim()
            ? parsed.summary.trim()
            : reply,
        topics: strings(parsed?.topics, 6),
        questions: strings(parsed?.questions, 4),
      });
    }

    if (action === 'studio') {
      if (!isStudioKind(body.kind)) {
        return json({ error: 'Unsupported studio output.' }, 400);
      }
      const packed = packSources(body.sources ?? []);
      if (packed.length === 0) return json({ error: 'At least one source is required.' }, 400);
      const text = await runNotebookModel(env, body.model, buildStudioPrompt(body.kind, packed), [
        { role: 'user', content: 'Generate the requested document from the sources.' },
      ]);
      if (!text) return json({ error: 'The model returned an empty document.' }, 502);

      // Flashcards and quizzes are answered rather than read, so they are
      // validated here and stored as normalised JSON. Handing the raw reply to
      // the client would put a malformed question in front of the user.
      if (isStructuredStudioKind(body.kind)) {
        const parsed = parseJsonReply<unknown>(text);
        const normalized =
          body.kind === 'flashcards' ? normalizeFlashcards(parsed) : normalizeQuiz(parsed);
        const count =
          'cards' in normalized ? normalized.cards.length : normalized.questions.length;
        if (count === 0) {
          return json(
            {
              error:
                body.kind === 'flashcards'
                  ? 'No usable flashcards could be built from these sources.'
                  : 'No usable quiz questions could be built from these sources.',
            },
            502
          );
        }
        return json({
          text: JSON.stringify(normalized),
          sourceIds: packed.map((source) => source.id),
        });
      }

      return json({ text, sourceIds: packed.map((source) => source.id) });
    }

    if (action !== 'chat') {
      return json({ error: 'Unsupported notebook action.' }, 400);
    }

    const turns = normalizeTurns(body.messages);
    if (turns.length === 0) {
      return json({ error: 'A question is required.' }, 400);
    }
    const packed = packSources(body.sources ?? []);
    if (packed.length === 0) {
      return json(
        { error: 'Select at least one source before asking a question.' },
        400
      );
    }

    const text = await runNotebookModel(env, body.model, buildNotebookChatPrompt(packed), turns);
    if (!text) {
      return json({ error: 'The model returned an empty answer.' }, 502);
    }
    return json({ text, sourceIds: packed.map((source) => source.id) });
  } catch (error: any) {
    if (error instanceof WebSourceError || error instanceof NotebookHttpError) {
      return json({ error: error.message }, error.status);
    }
    console.error('Notebook error:', error);
    return json({ error: error?.message || 'Internal server error' }, 500);
  }
};
