import { generateText, streamText, resolveModelRoute, getApiKeys, type GenerationTuning } from '../shared/ai';
import { AGENT_SYSTEM_PROMPT, AGENT_WRITE_MODE_NOTE, AGENT_PLAN_MODE_NOTE, buildAgentContextBlock, buildReasoningEffortInstruction } from '../shared/systemPrompts';
import { resolveEffortProfile } from '../shared/effortProfile';
import { splitThinkingAndText } from '../shared/responseFormatting';

const AGENT_SYSTEM_PROMPT_BASE = AGENT_SYSTEM_PROMPT;

export const onRequest: PagesFunction = async (context) => {
  if (context.request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  try {
    const env = context.env as Record<string, string>;
    const { geminiKeys, groqKeys, cerebrasKeys, mistralKeys } = getApiKeys(env);

    if (geminiKeys.length === 0 && groqKeys.length === 0 && cerebrasKeys.length === 0 && mistralKeys.length === 0) {
      return new Response(
        JSON.stringify({ error: 'No API keys configured' }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const body = await context.request.json() as {
      messages?: any[];
      model?: string;
      mode?: string;
      activeFile?: { path: string; content: string } | null;
      projectFiles?: string[];
      mentionedFiles?: { path: string; content: string }[];
      projectMemory?: { key: string; value: string }[];
      reasoningEffort?: string;
      stream?: boolean;
    };

    const {
      messages = [],
      model,
      mode = 'plan',
      activeFile,
      projectFiles = [],
      mentionedFiles = [],
      projectMemory = [],
      reasoningEffort = 'standard',
      stream = false,
    } = body;

    if (!Array.isArray(messages) || messages.length === 0) {
      return new Response(
        JSON.stringify({ error: 'Messages array is required' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const route = resolveModelRoute(model);

    // The selected effort drives real generation parameters, not just the
    // prompt wording: sampling temperature, the output cap, and the provider's
    // own reasoning budget.
    const effort = resolveEffortProfile(reasoningEffort);
    const tuning: GenerationTuning = {
      temperature: effort.temperature,
      // Deliberately no max_tokens. Capping it truncated whole-file edits, and
      // resuming past the cap depends on the model continuing a prefill turn,
      // which some refuse — leaving the request to fail outright. Omitting it
      // lets each provider use its own model maximum, which is what this did
      // before effort profiles existed and is enough for a full file.
      openAiEffort: effort.openAiEffort,
      // Deliberately no thinkingBudget. Gemini charges thinking against the
      // output budget, so reserving a large allowance left nothing for the
      // answer: measured against one payload, Light (budget 0) returned 162
      // characters while Standard, Deep and UltraCODE returned 0, 18 and 0.
      // An empty reply is indistinguishable downstream from a model that had
      // nothing to say, which surfaced as "no final answer".
    };

    // Build the context block with file information
    const safeProjectMemory = Array.isArray(projectMemory)
      ? projectMemory.slice(0, 32).flatMap((entry) => {
          if (!entry || typeof entry.key !== 'string' || typeof entry.value !== 'string') return [];
          const key = entry.key.replace(/[^a-zA-Z0-9._-]/g, '').slice(0, 64);
          const value = entry.value.replace(/\s+/g, ' ').trim().slice(0, 1200);
          return key && value ? [{ key, value }] : [];
        })
      : [];
    const contextBlock = buildAgentContextBlock(
      projectFiles,
      activeFile,
      mentionedFiles,
      safeProjectMemory,
      effort.context.maxProjectFiles
    );

    // Build the full prompt with system instruction
    const systemInstruction = [
      AGENT_SYSTEM_PROMPT,
      buildReasoningEffortInstruction(reasoningEffort),
      mode === 'write' ? AGENT_WRITE_MODE_NOTE : AGENT_PLAN_MODE_NOTE,
      '',
      'File context:',
      contextBlock,
      '',
      'Progress reporting:',
      '- Keep private chain-of-thought private.',
      '- If a task is long, use at most one short <thinking> status describing the current action.',
      '- Never repeat reasoning tags or narrate obvious steps.',
    ].join('\n');

    // Prepare message content for Gemini format
    const contents = messages.map((m: any) => ({
      role: m.role === 'user' ? 'user' : 'model',
      parts: [{ text: m.content || '' }],
    }));

    const plainMessages = messages.map((m: any) => ({
      role: m.role,
      content: m.content || '',
    }));

    // ── Streaming mode ─────────────────────────────────────────────────────
    if (stream) {
      const encoder = new TextEncoder();
      const streamResponse = new ReadableStream({
        async start(controller) {
          try {
            let fullText = '';
            for await (const token of streamText({
              geminiKeys, groqKeys, cerebrasKeys, mistralKeys,
              contents, plainMessages, systemInstruction, route, tuning,
            })) {
              fullText += token;
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({ token })}\n\n`));
            }
            // Send final event with thinking extraction
            const { text, thinking } = splitThinkingAndText(fullText);
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({
              done: true,
              text,
              thinking,
              thinkingLabel: thinking ? 'Reasoning' : '',
            })}\n\n`));
            controller.close();
          } catch (err: any) {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ error: err?.message || 'Stream failed' })}\n\n`));
            controller.close();
          }
        }
      });
      return new Response(streamResponse, {
        status: 200,
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
        },
      });
    }

    // ── Non-streaming mode (fallback) ──────────────────────────────────────
    const rawText = (await generateText({
      geminiKeys,
      groqKeys,
      cerebrasKeys,
      mistralKeys,
      contents,
      plainMessages,
      systemInstruction,
      route,
      tuning,
    })) || '';

    const { text, thinking } = splitThinkingAndText(rawText);

    return new Response(JSON.stringify({
      text,
      thinking,
      thinkingLabel: thinking ? 'Reasoning' : '',
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err: any) {
    console.error('Agent error:', err);
    return new Response(
      JSON.stringify({ error: err?.message || 'Internal server error' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};
